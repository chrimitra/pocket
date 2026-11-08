import { esc, euro, parseISODate } from '../format.js';
import { columnName, detectColumns, findHeader, isRevolut, isValidMapping, toRecord } from '../import/detect.js';
import { readTable } from '../import/files.js';
import { buildPlan, targetFromRule, toTransactions } from '../import/plan.js';
import { guessKeyword, ruleMatches } from '../rules.js';
import { saveRule, saveTransactions } from '../store.js';
import { refresh, state } from '../state.js';
import { pageHeader } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { openSheet, showError, toast } from '../ui/sheet.js';

export const title = 'Importa';

// Stato dell'import in corso: resta finché non importi o cambi file.
const ui = { accountId: null, fileName: '', rows: null, header: -1, map: null, showMapping: false, plan: null, error: '', revolut: false };
const EMPTY_MAP = { date: -1, description: -1, amount: -1, debit: -1, credit: -1, fee: -1, state: -1, type: -1, currency: -1 };
const REVOLUT_NAME = /revolut/i;

const MAP_FIELDS = [
  ['date', 'Data'],
  ['description', 'Descrizione'],
  ['amount', 'Importo (con segno)'],
  ['debit', 'Addebiti / uscite'],
  ['credit', 'Accrediti / entrate'],
];

const shortDate = (iso) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }).format(parseISODate(iso));

function records() {
  return ui.rows.slice(ui.header + 1).map((r) => toRecord(r, ui.map)).filter(Boolean);
}

function rebuildPlan() {
  const { accounts, transactions, rules, categories } = state.data;
  ui.plan = isValidMapping(ui.map) ? buildPlan(records(), { accountId: ui.accountId, accounts, transactions, rules, categories }) : null;
}

function reset() {
  Object.assign(ui, { fileName: '', rows: null, header: -1, map: null, showMapping: false, plan: null, error: '', revolut: false });
}

export function render(el, data) {
  const accounts = data.accounts.filter((a) => !a.archived);
  if (!accounts.some((a) => a.id === ui.accountId)) ui.accountId = (accounts.find((a) => a.type === 'bank') ?? accounts[0])?.id ?? null;
  const chosen = accounts.find((a) => a.id === ui.accountId);

  el.innerHTML = `
    ${pageHeader('Importa movimenti', { back: { href: '#/movimenti', label: 'Movimenti' }, sub: 'Dal file Excel della tua banca, senza doppioni' })}

    <section class="card import-start">
      <details class="howto" ${ui.rows ? '' : 'open'}>
        <summary>${icon('info')}Dove trovo il file?</summary>
        <ul class="howto-list">
          <li><strong>BancoPosta:</strong> da Safari vai su <strong>poste.it</strong>, apri la lista movimenti del conto e tocca <strong>Scarica Excel</strong>.</li>
          <li><strong>Revolut:</strong> nell'app apri il conto in euro → <strong>…</strong> → <strong>Estratto conto</strong> → formato <strong>Excel</strong>.</li>
        </ul>
        <p class="muted small">Il file finisce nell'app File. I movimenti già presenti in Tasca vengono riconosciuti e saltati.</p>
      </details>
      <div class="fields">
        <label class="field"><span>Nel conto</span><select id="imp-account">
          ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === ui.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select></label>
      </div>
      <label class="btn ${ui.rows ? 'secondary' : 'primary'} block file-btn">
        ${icon(ui.rows ? 'refresh' : 'file')}<span>${ui.rows ? `Cambia file · ${esc(ui.fileName)}` : 'Scegli il file (Excel o CSV)'}</span>
        <input type="file" id="imp-file" accept=".xlsx,.xls,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden>
      </label>
      ${ui.error ? `<p class="form-error">${esc(ui.error)}</p>` : ''}
      ${
        ui.revolut
          ? REVOLUT_NAME.test(chosen?.name ?? '')
            ? `<p class="hint-text ok">${icon('check')} Estratto conto Revolut riconosciuto: importo solo le operazioni completate in euro, commissioni comprese.</p>`
            : '<p class="form-error">Questo sembra un estratto conto Revolut: scegli il conto Revolut qui sopra. Se non ce l\'hai, crealo in Impostazioni → Conti con un nome che contenga "Revolut".</p>'
          : ''
      }
    </section>

    ${ui.rows ? (ui.showMapping || !ui.plan ? mappingCard() : reviewSection(data)) : ''}`;

  el.querySelector('#imp-account').addEventListener('change', (e) => {
    ui.accountId = e.target.value;
    if (ui.rows) rebuildPlan();
    render(el, data);
  });
  el.querySelector('#imp-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    try {
      ui.rows = await readTable(file);
      ui.fileName = file.name;
      ui.header = findHeader(ui.rows);
      ui.map = ui.header >= 0 ? detectColumns(ui.rows[ui.header]) : { ...EMPTY_MAP };
      if (!ui.rows.length) throw new Error('Il file è vuoto.');
      // Scegli da solo il conto giusto: Revolut per il suo estratto conto, altrimenti il conto corrente
      // (così dopo aver importato Revolut il file di BancoPosta non finisce sul conto sbagliato).
      ui.revolut = ui.header >= 0 && isRevolut(ui.rows[ui.header]);
      const current = accounts.find((a) => a.id === ui.accountId);
      if (ui.revolut) ui.accountId = accounts.find((a) => REVOLUT_NAME.test(a.name))?.id ?? ui.accountId;
      else if (REVOLUT_NAME.test(current?.name ?? '')) ui.accountId = accounts.find((a) => a.type === 'bank')?.id ?? ui.accountId;
      rebuildPlan();
      // Colonne non riconosciute, o riconosciute ma senza movimenti validi: le fa scegliere a te.
      ui.showMapping = !ui.plan || (!ui.plan.items.length && !ui.plan.already);
    } catch (err) {
      reset();
      ui.error = err.message || 'Non riesco a leggere questo file.';
    }
    render(el, data);
  });

  bindMapping(el, data);
  bindReview(el, data);
}

// ---------- Scelta delle colonne ----------

function mappingCard() {
  const header = ui.header >= 0 ? ui.rows[ui.header] : null;
  const sample = ui.rows[ui.header + 1] ?? [];
  const width = Math.max(...ui.rows.slice(0, 50).map((r) => r.length));
  const options = (selected) =>
    `<option value="-1">—</option>` +
    Array.from({ length: width }, (_, i) => {
      const name = header?.[i] || `Colonna ${columnName(i)}`;
      const hint = sample[i] ? ` (es. ${sample[i].slice(0, 18)})` : '';
      return `<option value="${i}" ${i === selected ? 'selected' : ''}>${esc(name + hint)}</option>`;
    }).join('');
  const preview = isValidMapping(ui.map) ? records().slice(0, 3) : [];

  return `
    <section class="card">
      <h2 class="card-title">Colonne del file</h2>
      <p class="card-sub">${
        isValidMapping(ui.map)
          ? 'Controlla che le colonne siano giuste.'
          : 'Non ho riconosciuto da solo le colonne: indica dove si trovano data, descrizione e importo.'
      }</p>
      <div class="fields mapping">
        ${MAP_FIELDS.map(([key, label]) => `<label class="field"><span>${label}</span><select data-map="${key}">${options(ui.map[key])}</select></label>`).join('')}
      </div>
      <p class="hint-text">Basta una colonna "Importo" con il segno, oppure le due colonne separate per addebiti e accrediti.</p>
      ${
        preview.length
          ? `<div class="preview">${preview
              .map((r) => `<div><span>${shortDate(r.date)} · ${esc(r.description.slice(0, 40))}</span><strong class="${r.cents > 0 ? 'pos' : ''}">${euro(r.cents, { sign: true })}</strong></div>`)
              .join('')}</div>`
          : isValidMapping(ui.map)
            ? '<p class="form-error">Con queste colonne non trovo nessun movimento valido.</p>'
            : ''
      }
      <button type="button" class="btn primary block" id="map-done" ${preview.length ? '' : 'disabled'}>Continua</button>
    </section>`;
}

function bindMapping(el, data) {
  el.querySelectorAll('[data-map]').forEach((s) =>
    s.addEventListener('change', () => {
      ui.map = { ...ui.map, [s.dataset.map]: Number(s.value) };
      // Se l'intestazione non è stata trovata, tutte le righe sono dati.
      render(el, data);
    }),
  );
  el.querySelector('#map-done')?.addEventListener('click', () => {
    ui.showMapping = false;
    rebuildPlan();
    render(el, data);
  });
}

// ---------- Revisione ----------

function targetOptions(item, data) {
  const kind = item.cents > 0 ? 'income' : 'expense';
  const cats = data.categories.filter((c) => c.kind === kind && !c.archived);
  const others = data.accounts.filter((a) => !a.archived && a.id !== ui.accountId);
  return (
    `<option value="" ${item.target ? '' : 'selected'}>Scegli categoria…</option>` +
    cats.map((c) => `<option value="c:${esc(c.id)}" ${item.target === `c:${c.id}` ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('') +
    (others.length
      ? `<optgroup label="Trasferimento">${others
          .map((a) => `<option value="t:${esc(a.id)}" ${item.target === `t:${a.id}` ? 'selected' : ''}>⇄ ${item.cents < 0 ? 'Verso' : 'Da'} ${esc(a.name)}</option>`)
          .join('')}</optgroup>`
      : '')
  );
}

function reviewSection(data) {
  const { items, already } = ui.plan;
  const included = items.filter((it) => it.include);
  const uncategorized = included.filter((it) => !it.target).length;
  const dups = items.filter((it) => it.duplicateOf).length;

  if (!items.length) {
    return `<section class="card">
      <p><strong>Niente di nuovo da importare.</strong></p>
      <p class="muted">${already ? `Tutti i ${already} movimenti del file sono già stati importati.` : 'Nel file non ho trovato movimenti.'}</p>
      <button type="button" class="text-btn" id="show-mapping">Controlla le colonne</button>
    </section>`;
  }

  return `
    <div class="import-summary">
      <span><strong>${items.length}</strong> nuovi</span>
      ${dups ? `<span class="warn-text"><strong>${dups}</strong> forse già presenti</span>` : ''}
      ${already ? `<span><strong>${already}</strong> già importati (saltati)</span>` : ''}
    </div>
    ${dups ? '<p class="hint-text">I movimenti che sembrano già presenti in Tasca (inseriti a mano o arrivati dall\'altro conto, con stesso importo e data vicina) sono deselezionati: spuntali solo se sono davvero diversi.</p>' : ''}
    <section class="card flush imp-list">
      ${items
        .map(
          (it, i) => `
        <div class="imp-row ${it.include ? '' : 'off'}">
          <input type="checkbox" class="imp-check" data-check="${i}" ${it.include ? 'checked' : ''} aria-label="Includi movimento">
          <div class="imp-main">
            <div class="imp-top">
              <span class="imp-desc">${esc(it.description)}</span>
              <strong class="imp-amount ${it.cents > 0 ? 'pos' : ''}">${euro(it.cents, { sign: true })}</strong>
            </div>
            <div class="imp-meta">${shortDate(it.date)}${it.duplicateOf ? ' · <span class="badge warn">forse già presente</span>' : ''}</div>
            <select class="imp-select ${it.target ? '' : 'is-empty'}" data-target="${i}" aria-label="Categoria">${targetOptions(it, data)}</select>
            ${it.manual && it.target && guessKeyword(it.description) ? `<button type="button" class="text-btn small" data-remember="${i}">Ricorda per i movimenti simili</button>` : ''}
          </div>
        </div>`,
        )
        .join('')}
    </section>
    <button type="button" class="text-btn" id="show-mapping">Colonne sbagliate? Controllale</button>
    <div class="import-bar">
      ${uncategorized ? `<p>${uncategorized} senza categoria finiranno in «Altro»</p>` : ''}
      <button type="button" class="btn primary block" id="do-import" ${included.length ? '' : 'disabled'}>Importa ${included.length} moviment${included.length === 1 ? 'o' : 'i'}</button>
    </div>`;
}

function bindReview(el, data) {
  el.querySelector('#show-mapping')?.addEventListener('click', () => {
    ui.showMapping = true;
    render(el, data);
  });
  if (!ui.plan) return;
  const { items } = ui.plan;

  el.querySelectorAll('[data-check]').forEach((c) =>
    c.addEventListener('change', () => {
      items[c.dataset.check].include = c.checked;
      render(el, data);
    }),
  );
  el.querySelectorAll('[data-target]').forEach((s) =>
    s.addEventListener('change', () => {
      Object.assign(items[s.dataset.target], { target: s.value, manual: true });
      render(el, data);
    }),
  );
  el.querySelectorAll('[data-remember]').forEach((b) =>
    b.addEventListener('click', async () => {
      const item = items[b.dataset.remember];
      const keyword = await askKeyword(item.description);
      if (!keyword) return;
      const rule = item.target.startsWith('t:')
        ? { keyword, action: 'transfer', accountId: item.target.slice(2) }
        : { keyword, action: 'category', categoryId: item.target.slice(2) };
      await saveRule(rule);
      // Applica subito la regola alle altre righe dello stesso tipo (entrata/uscita) non modificate a mano.
      let applied = 0;
      for (const it of items) {
        if (it === item || it.manual || Math.sign(it.cents) !== Math.sign(item.cents) || !ruleMatches(rule, it.description)) continue;
        it.target = targetFromRule(rule);
        applied++;
      }
      toast(applied ? `Regola salvata · applicata ad altri ${applied}` : 'Regola salvata');
      await refresh();
    }),
  );
  el.querySelector('#do-import')?.addEventListener('click', async () => {
    const list = toTransactions(items, ui.accountId, data.categories);
    await saveTransactions(list);
    reset();
    toast(`${list.length} movimenti importati`);
    location.hash = '#/movimenti';
    await refresh();
  });
}

// Chiede la parola chiave per una nuova regola, proponendo quella più probabile.
function askKeyword(description) {
  return new Promise((resolve) => {
    let answer = null;
    openSheet({
      title: 'Ricorda questa scelta',
      body: `
        <p class="hint-text">Da ora in poi, i movimenti la cui descrizione contiene questa parola riceveranno la stessa categoria.</p>
        <div class="fields"><label class="field"><span>Parola</span><input id="k-word" autocapitalize="characters" value="${esc(guessKeyword(description))}"></label></div>
        <p class="bank-desc plain">${icon('file')}<span>${esc(description)}</span></p>
        <p class="form-error" hidden></p>`,
      footer: '<button type="button" class="btn primary block" id="k-save">Ricorda</button>',
      onClose: () => resolve(answer),
      onMount(el, close) {
        el.querySelector('#k-save').addEventListener('click', () => {
          const word = el.querySelector('#k-word').value.trim();
          if (!word) return showError(el, 'Scrivi una parola');
          if (!ruleMatches({ keyword: word }, description)) return showError(el, `«${word}» non compare nella descrizione di questo movimento`);
          answer = word;
          close();
        });
      },
    });
  });
}
