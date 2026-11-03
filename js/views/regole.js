import { esc } from '../format.js';
import { ruleMatches } from '../rules.js';
import { deleteRule, saveRule } from '../store.js';
import { refresh, state } from '../state.js';
import { emptyState } from '../ui/components.js';
import { openSheet, showError, toast } from '../ui/sheet.js';

export const title = 'Regole';

const ui = { q: '' };

function targetLabel(rule, maps) {
  if (rule.action === 'transfer') {
    const a = maps.acc.get(rule.accountId);
    return { icon: '⇄', text: a ? `Trasferimento · ${a.name}` : 'Conto eliminato', broken: !a };
  }
  const c = maps.cat.get(rule.categoryId);
  return { icon: c?.icon ?? '⚠️', text: c ? c.name : 'Categoria eliminata', color: c?.color, broken: !c };
}

export function render(el, data) {
  const maps = {
    acc: new Map(data.accounts.map((a) => [a.id, a])),
    cat: new Map(data.categories.map((c) => [c.id, c])),
  };

  el.innerHTML = `
    <header class="page-header"><a class="back" href="#/altro">‹ Impostazioni</a><h1>Regole automatiche</h1></header>
    <p class="hint-text">Quando importi un file, i movimenti la cui descrizione contiene la parola indicata ricevono subito la categoria giusta. Le regole in alto hanno la precedenza.</p>
    <div class="filters single"><input type="search" id="rq" placeholder="Cerca una parola o una categoria" value="${esc(ui.q)}" aria-label="Cerca regole"></div>
    <button class="btn secondary block" id="add-rule">+ Nuova regola</button>
    <div id="rule-list"></div>`;

  const listEl = el.querySelector('#rule-list');
  const draw = () => {
    const q = ui.q.trim().toLowerCase();
    const list = data.rules.filter((r) => !q || r.keyword.toLowerCase().includes(q) || targetLabel(r, maps).text.toLowerCase().includes(q));
    listEl.innerHTML = list.length
      ? `<section class="card flush rows">${list
          .map((r) => {
            const t = targetLabel(r, maps);
            return `
          <button class="row" data-rule="${esc(r.id)}">
            <span class="row-icon" style="--c:${esc(t.color ?? '#6C7A89')}">${esc(t.icon)}</span>
            <span class="row-main"><span class="row-title">${esc(r.keyword)}</span><span class="row-sub ${t.broken ? 'neg' : ''}">→ ${esc(t.text)}</span></span>
            <span class="row-chevron" aria-hidden="true">›</span>
          </button>`;
          })
          .join('')}</section>`
      : emptyState('🔎', 'Nessuna regola trovata.');
    listEl.querySelectorAll('[data-rule]').forEach((b) =>
      b.addEventListener('click', () => openRuleSheet(data.rules.find((r) => r.id === b.dataset.rule))),
    );
  };

  el.querySelector('#rq').addEventListener('input', (e) => {
    ui.q = e.target.value;
    draw();
  });
  el.querySelector('#add-rule').addEventListener('click', () => openRuleSheet(null));
  draw();
}

function openRuleSheet(rule) {
  const { categories, accounts } = state.data;
  const current = rule ? (rule.action === 'transfer' ? `t:${rule.accountId}` : `c:${rule.categoryId}`) : '';
  const group = (kind, label) =>
    `<optgroup label="${label}">${categories
      .filter((c) => c.kind === kind && (!c.archived || current === `c:${c.id}`))
      .map((c) => `<option value="c:${esc(c.id)}" ${current === `c:${c.id}` ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
      .join('')}</optgroup>`;

  openSheet({
    title: rule ? 'Modifica regola' : 'Nuova regola',
    body: `
      <div class="fields">
        <label class="field"><span>Se contiene</span><input id="r-keyword" maxlength="40" placeholder="Es. ESSELUNGA" autocapitalize="characters" value="${esc(rule?.keyword ?? '')}"></label>
        <label class="field"><span>Allora</span><select id="r-target">
          <option value="" ${current ? '' : 'selected'}>Scegli…</option>
          ${group('expense', 'Spese')}
          ${group('income', 'Entrate')}
          <optgroup label="Trasferimento verso / da">${accounts
            .filter((a) => !a.archived || current === `t:${a.id}`)
            .map((a) => `<option value="t:${esc(a.id)}" ${current === `t:${a.id}` ? 'selected' : ''}>⇄ ${esc(a.name)}</option>`)
            .join('')}</optgroup>
        </select></label>
        <label class="field"><span>Prova</span><input id="r-test" placeholder="Incolla una descrizione per provarla"></label>
      </div>
      <p class="hint-text" id="r-result">Conta la parola intera: «ENI» riconosce "ENI STATION" ma non "SERENITÀ". Maiuscole e accenti non contano.</p>
      <p class="form-error" hidden></p>
      <button type="button" class="btn primary block" id="r-save">Salva</button>
      ${rule ? '<button type="button" class="btn danger block" id="r-delete">Elimina regola</button>' : ''}`,
    onMount(el, close) {
      const keyword = el.querySelector('#r-keyword');
      const test = el.querySelector('#r-test');
      const result = el.querySelector('#r-result');
      const check = () => {
        if (!test.value.trim() || !keyword.value.trim()) return;
        const ok = ruleMatches({ keyword: keyword.value }, test.value);
        result.textContent = ok ? '✅ La regola riconosce questa descrizione.' : '❌ La regola non riconosce questa descrizione.';
      };
      keyword.addEventListener('input', check);
      test.addEventListener('input', check);

      el.querySelector('#r-save').addEventListener('click', async () => {
        const kw = keyword.value.trim();
        const target = el.querySelector('#r-target').value;
        if (!kw) return showError(el, 'Scrivi la parola da cercare');
        if (!target) return showError(el, 'Scegli cosa fare con questi movimenti');
        await saveRule({
          ...rule,
          keyword: kw,
          action: target.startsWith('t:') ? 'transfer' : 'category',
          categoryId: target.startsWith('c:') ? target.slice(2) : null,
          accountId: target.startsWith('t:') ? target.slice(2) : null,
          // Una regola nuova o modificata da te passa in cima.
          createdAt: Date.now(),
        });
        close();
        toast('Regola salvata');
        await refresh();
      });
      el.querySelector('#r-delete')?.addEventListener('click', async () => {
        if (!confirm(`Eliminare la regola «${rule.keyword}»?`)) return;
        await deleteRule(rule.id);
        close();
        toast('Regola eliminata');
        await refresh();
      });
      if (!rule) keyword.focus();
    },
  });
}
