import { amountToInput, esc, euro, parseAmount, toISODate } from '../format.js';
import { monthlyTotal, nextDate, shortDate } from '../recurring.js';
import { deleteRecurring, saveRecurring } from '../store.js';
import { refresh, state } from '../state.js';
import { emptyState, lookups, pageHeader } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { openSheet, showError, toast } from '../ui/sheet.js';

export const title = 'Ricorrenti';

const TYPES = { expense: 'Spesa', income: 'Entrata', transfer: 'Trasferimento' };
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

export function recurringName(r, maps) {
  if (r.note) return r.note;
  if (r.type === 'transfer') return `Trasferimento verso ${maps.acc.get(r.toAccountId)?.name ?? '—'}`;
  return maps.cat.get(r.categoryId)?.name ?? 'Ricorrente';
}

export function recurringChip(r, maps) {
  if (r.type === 'transfer') return `<span class="row-icon tone-neutral">${icon('transfer')}</span>`;
  const c = maps.cat.get(r.categoryId);
  return `<span class="row-icon emoji" style="--c:${esc(c?.color ?? '#6C7A89')}">${esc(c?.icon ?? '•')}</span>`;
}

export function signedRecurring(r) {
  return r.type === 'income' ? euro(r.amount, { sign: true }) : r.type === 'expense' ? euro(-r.amount, { sign: true }) : euro(r.amount);
}

export function render(el, data) {
  const maps = lookups(data);
  const out = monthlyTotal(data.recurring, 'expense');
  const inc = monthlyTotal(data.recurring, 'income');
  const summary = data.recurring.length
    ? [out ? `Spese fisse <strong>${euro(out)}</strong> al mese` : '', inc ? `entrate fisse <strong>${euro(inc)}</strong>` : ''].filter(Boolean).join(' · ')
    : 'Affitto, bollette, abbonamenti, stipendio';

  el.innerHTML = `
    ${pageHeader('Spese ricorrenti', { back: { href: '#/altro', label: 'Impostazioni' }, sub: summary })}
    ${
      data.recurring.length
        ? `<section class="card flush rows">${data.recurring
            .map((r) => {
              const next = nextDate(r);
              return `
              <button class="row" data-rec="${esc(r.id)}">
                ${recurringChip(r, maps)}
                <span class="row-main">
                  <span class="row-title">${esc(recurringName(r, maps))}</span>
                  <span class="row-sub">${r.every === 'year' ? 'Ogni anno' : 'Ogni mese'}${next ? ` · prossima ${shortDate(next)}` : ''}${r.auto ? ' · automatica' : ''}</span>
                </span>
                <span class="row-amount ${r.type === 'income' ? 'pos' : ''}">${signedRecurring(r)}</span>
              </button>`;
            })
            .join('')}</section>`
        : `<section class="card">${emptyState(
            'repeat',
            'Nessuna ricorrente',
            'Imposta una volta le spese che tornano ogni mese: il giorno giusto Tasca te le propone e le registri con un tocco.',
          )}</section>`
    }
    <button class="btn ${data.recurring.length ? 'secondary' : 'primary'} block" id="add-rec">${icon('plus')}Nuova ricorrente</button>
    <p class="hint-text">${icon('info')} Quando una ricorrente arriva, la trovi in Home da confermare. Se l'hai già registrata (a mano o con un import), Tasca se ne accorge e non la duplica. Con «Aggiungi da sola» non devi nemmeno confermarla.</p>`;

  el.querySelectorAll('[data-rec]').forEach((b) =>
    b.addEventListener('click', () => openRecurringSheet(data.recurring.find((r) => r.id === b.dataset.rec))),
  );
  el.querySelector('#add-rec').addEventListener('click', () => openRecurringSheet(null));
}

export function openRecurringSheet(rec, preset = {}) {
  const { accounts, categories } = state.data;
  const usable = accounts.filter((a) => !a.archived || a.id === rec?.accountId || a.id === rec?.toAccountId);
  if (!usable.length) {
    toast('Crea prima un conto');
    return;
  }
  const r = { type: 'expense', every: 'month', day: new Date().getDate(), month: new Date().getMonth() + 1, startDate: toISODate(), auto: false, ...preset, ...rec };
  const accountOptions = (selected) =>
    usable.map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

  openSheet({
    title: rec ? 'Modifica ricorrente' : 'Nuova ricorrente',
    top: `<div class="segmented" role="radiogroup" aria-label="Tipo">
      ${Object.entries(TYPES)
        .map(([k, v]) => `<button type="button" role="radio" data-type="${k}" aria-checked="${k === r.type}">${v}</button>`)
        .join('')}
    </div>`,
    body: `
      <div class="fields">
        <label class="field"><span>Nome</span><input id="r-note" maxlength="60" placeholder="Es. Affitto" value="${esc(r.note ?? '')}"></label>
        <label class="field"><span>Importo</span><input id="r-amount" inputmode="decimal" placeholder="0,00" value="${r.amount ? amountToInput(r.amount) : ''}"></label>
        <label class="field" id="row-cat"><span>Categoria</span><select id="r-cat"></select></label>
        <label class="field"><span id="l-acc">Conto</span><select id="r-acc">${accountOptions(r.accountId ?? usable[0].id)}</select></label>
        <label class="field" id="row-to"><span>Verso</span><select id="r-to">${accountOptions(r.toAccountId ?? usable.find((a) => a.id !== (r.accountId ?? usable[0].id))?.id)}</select></label>
      </div>
      <div class="fields">
        <label class="field"><span>Ripeti</span><select id="r-every">
          <option value="month" ${r.every === 'month' ? 'selected' : ''}>Ogni mese</option>
          <option value="year" ${r.every === 'year' ? 'selected' : ''}>Ogni anno</option>
        </select></label>
        <label class="field" id="row-month"><span>Mese</span><select id="r-month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === r.month ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="field"><span>Giorno</span><select id="r-day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${i + 1 === r.day ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <label class="field"><span>A partire dal</span><input type="date" id="r-start" value="${esc(r.startDate)}"></label>
        <label class="field toggle"><span>Aggiungi da sola</span><input type="checkbox" role="switch" id="r-auto" ${r.auto ? 'checked' : ''}></label>
      </div>
      <p class="hint-text">Con «Aggiungi da sola» il movimento viene registrato in automatico quando arriva il giorno. Altrimenti lo trovi in Home da confermare con un tocco. Il giorno 31 nei mesi più corti diventa l'ultimo del mese.</p>
      <p class="form-error" hidden></p>
      ${rec ? `<button type="button" class="btn danger-text block" id="r-delete">${icon('trash')}Elimina ricorrente</button>` : ''}`,
    footer: `<button type="button" class="btn primary block" id="r-save">${rec ? 'Salva modifiche' : 'Crea ricorrente'}</button>`,
    onMount(el, close) {
      const $ = (s) => el.querySelector(s);
      let type = r.type;

      function draw() {
        el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === type)));
        const kind = type === 'income' ? 'income' : 'expense';
        const current = $('#r-cat').value || r.categoryId;
        const list = categories.filter((c) => c.kind === kind && (!c.archived || c.id === current));
        $('#r-cat').innerHTML = list
          .map((c) => `<option value="${esc(c.id)}" ${c.id === current ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
          .join('');
        $('#row-cat').hidden = type === 'transfer';
        $('#row-to').hidden = type !== 'transfer';
        $('#l-acc').textContent = type === 'transfer' ? 'Da' : 'Conto';
        $('#row-month').hidden = $('#r-every').value !== 'year';
      }

      el.querySelector('.segmented').addEventListener('click', (e) => {
        const b = e.target.closest('[data-type]');
        if (!b) return;
        type = b.dataset.type;
        draw();
      });
      $('#r-every').addEventListener('change', draw);

      $('#r-save').addEventListener('click', async () => {
        const amount = parseAmount($('#r-amount').value);
        if (!(amount > 0)) return showError(el, 'Scrivi un importo, ad esempio 650');
        if (type !== 'transfer' && !$('#r-cat').value) return showError(el, 'Scegli una categoria');
        if (type === 'transfer' && $('#r-acc').value === $('#r-to').value) return showError(el, 'Scegli due conti diversi');
        if (!$('#r-start').value) return showError(el, 'Scegli da quando parte');
        const every = $('#r-every').value;
        await saveRecurring({
          ...rec,
          type,
          amount,
          note: $('#r-note').value.trim(),
          categoryId: type === 'transfer' ? null : $('#r-cat').value,
          accountId: $('#r-acc').value,
          toAccountId: type === 'transfer' ? $('#r-to').value : null,
          every,
          day: Number($('#r-day').value),
          month: every === 'year' ? Number($('#r-month').value) : null,
          startDate: $('#r-start').value,
          auto: $('#r-auto').checked,
          lastDone: rec?.lastDone ?? preset.lastDone ?? null,
        });
        close();
        toast(rec ? 'Ricorrente aggiornata' : 'Ricorrente creata');
        await refresh();
      });

      $('#r-delete')?.addEventListener('click', async () => {
        if (!confirm('Eliminare questa ricorrente? I movimenti già registrati restano.')) return;
        await deleteRecurring(rec.id);
        close();
        toast('Ricorrente eliminata');
        await refresh();
      });

      draw();
    },
  });
}
