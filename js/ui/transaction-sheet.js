// Inserimento e modifica di un movimento, con tastierino numerico integrato:
// la tastiera dell'iPhone non compare per l'importo, quindi non copre più nulla.
import { esc, euro, parseISODate, toISODate } from '../format.js';
import { describeSchedule } from '../recurring.js';
import { guessKeyword, prettyDescription, ruleMatches } from '../rules.js';
import { budgetLevel, deleteTransaction, monthSummary, saveRecurring, saveRule, saveTransaction, saveTransactions } from '../store.js';
import { refresh, state } from '../state.js';
import { icon } from './icons.js';
import { openSheet, showError, toast } from './sheet.js';

const TYPES = {
  expense: { label: 'Spesa', save: 'Salva spesa', saved: 'Spesa salvata', sign: '−' },
  income: { label: 'Entrata', save: 'Salva entrata', saved: 'Entrata salvata', sign: '+' },
  transfer: { label: 'Trasferimento', save: 'Salva trasferimento', saved: 'Trasferimento salvato', sign: '' },
};
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'];
const MAX_INT_DIGITS = 7;
const USAGE_DAYS = 120;
const LAST_ACCOUNT_KEY = 'tasca:lastAccount';

function lastAccount() {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function rememberAccount(id) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Memoria del browser non disponibile: pazienza.
  }
}

// Le categorie che usi di più compaiono per prime: quella che cerchi è quasi sempre in alto.
function byUsage(list, transactions) {
  const since = toISODate(new Date(Date.now() - USAGE_DAYS * 864e5));
  const uses = new Map();
  for (const t of transactions) if (t.categoryId && t.date >= since) uses.set(t.categoryId, (uses.get(t.categoryId) || 0) + 1);
  return [...list].sort((a, b) => (uses.get(b.id) || 0) - (uses.get(a.id) || 0) || (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Spese frequenti: le combinazioni categoria + importo che registri più spesso
 * (es. "☕ Ristoranti e bar 1,20 €"), da inserire con un tocco.
 */
const QUICK_DAYS = 90;
const QUICK_MAX = 6;
function frequentEntries(transactions) {
  const since = toISODate(new Date(Date.now() - QUICK_DAYS * 864e5));
  const groups = new Map();
  for (const t of transactions) {
    if ((t.type !== 'expense' && t.type !== 'income') || t.date < since || !t.categoryId) continue;
    const key = `${t.type}|${t.categoryId}|${t.amount}`;
    const g = groups.get(key) ?? { type: t.type, categoryId: t.categoryId, amount: t.amount, count: 0, last: '', notes: new Map(), accounts: new Map() };
    g.count++;
    if (t.date > g.last) g.last = t.date;
    const note = t.note ? prettyDescription(t.note) : '';
    if (note) g.notes.set(note, (g.notes.get(note) || 0) + 1);
    g.accounts.set(t.accountId, (g.accounts.get(t.accountId) || 0) + 1);
    groups.set(key, g);
  }
  const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, QUICK_MAX)
    .map((g) => ({ ...g, note: top(g.notes), accountId: top(g.accounts) }));
}

// L'importo si scrive come su una calcolatrice: "12,5" vale 12,50 €.
function rawToCents(raw) {
  if (!raw) return 0;
  const [int, dec = ''] = raw.split(',');
  return Number(int || 0) * 100 + Number(`${dec}00`.slice(0, 2));
}

function centsToRaw(cents) {
  const int = String(Math.floor(cents / 100));
  const dec = String(cents % 100).padStart(2, '0');
  return dec === '00' ? int : `${int},${dec}`;
}

function formatRaw(raw) {
  if (!raw) return '0';
  const [int, dec] = raw.split(',');
  const grouped = Number(int || 0).toLocaleString('it-IT', { useGrouping: 'always' });
  return dec === undefined ? grouped : `${grouped},${dec}`;
}

function dateLabel(iso) {
  const today = toISODate();
  if (iso === today) return 'Oggi';
  if (iso === toISODate(new Date(Date.now() - 864e5))) return 'Ieri';
  const d = parseISODate(iso);
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return new Intl.DateTimeFormat('it-IT', opts).format(d);
}

// Dopo una spesa: avvisa se la sua categoria è oltre l'80% del budget del mese.
function budgetAlert(categoryId, ym) {
  const category = state.data.categories.find((c) => c.id === categoryId);
  if (!(category?.budget > 0)) return null;
  const { byCategory } = monthSummary(state.data.transactions, ym);
  const spent = byCategory.get(categoryId) || 0;
  const level = budgetLevel(spent / category.budget);
  if (level === 'ok') return null;
  const message =
    level === 'over'
      ? `Budget «${category.name}» superato di ${euro(spent - category.budget)}`
      : `«${category.name}»: hai usato il ${Math.round((spent / category.budget) * 100)}% del budget`;
  return { level, message };
}

export function openTransactionSheet(tx = null) {
  const { accounts, categories, transactions } = state.data;
  const usable = accounts.filter((a) => !a.archived || a.id === tx?.accountId || a.id === tx?.toAccountId);
  if (!usable.length) {
    toast('Crea prima un conto');
    location.hash = '#/conti';
    return;
  }

  let type = tx?.type ?? 'expense';
  let categoryId = tx?.categoryId ?? null;
  let raw = tx ? centsToRaw(tx.amount) : '';
  const defaultAccount = usable.some((a) => a.id === lastAccount()) ? lastAccount() : usable[0].id;
  const fromId = tx?.accountId ?? defaultAccount;
  const toId = tx?.toAccountId ?? usable.find((a) => a.id !== fromId)?.id ?? fromId;
  const options = (selected) =>
    usable.map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const bankText = tx?.bankDescription ?? (tx?.source === 'import' ? tx.note : null);
  const quick = tx ? [] : frequentEntries(transactions);
  let repeat = false;

  const top = `
    <div class="segmented type-switch" role="radiogroup" aria-label="Tipo di movimento">
      ${Object.entries(TYPES)
        .map(([k, v]) => `<button type="button" role="radio" data-type="${k}">${v.label}</button>`)
        .join('')}
    </div>
    <div class="amount-display" id="f-amount" role="status" aria-live="polite">
      <span class="amount-sign"></span><span class="amount-value"></span><span class="amount-caret" aria-hidden="true"></span><span class="amount-cur">€</span>
    </div>
    <div class="detail-chips">
      <label class="chip-select">
        ${icon('wallet')}<span class="chip-text" id="v-from"></span>${icon('chevron-down', 'chev')}
        <select id="f-from" aria-label="Conto">${options(fromId)}</select>
      </label>
      <label class="chip-select" id="c-to">
        ${icon('transfer')}<span class="chip-text" id="v-to"></span>${icon('chevron-down', 'chev')}
        <select id="f-to" aria-label="Conto di destinazione">${options(toId)}</select>
      </label>
      <label class="chip-select" id="c-date">
        ${icon('calendar')}<span class="chip-text" id="v-date"></span>${icon('chevron-down', 'chev')}
        <input type="date" id="f-date" value="${esc(tx?.date ?? toISODate())}" aria-label="Data">
      </label>
      <button type="button" class="chip-select" id="c-note">${icon('note')}<span class="chip-text" id="v-note"></span></button>
      ${
        tx?.recurringId
          ? ''
          : `<button type="button" class="chip-select" id="c-repeat" aria-pressed="false">${icon('repeat')}<span class="chip-text" id="v-repeat">Ripeti</span></button>`
      }
    </div>
    <div class="note-box" hidden>
      <input id="f-note" maxlength="140" enterkeyhint="done" placeholder="Es. pizza con gli amici" value="${esc(tx?.note ?? '')}" aria-label="Nota">
    </div>`;

  const body = `
    ${
      quick.length
        ? `<div class="quick-row" id="f-quick" aria-label="Spese frequenti">${quick
            .map((q, i) => {
              const c = categories.find((x) => x.id === q.categoryId);
              return `<button type="button" class="quick-chip" data-quick="${i}" data-kind="${q.type}" style="--c:${esc(c?.color ?? '#6C7A89')}">
                <span class="quick-emoji">${esc(c?.icon ?? '•')}</span>
                <span class="quick-text"><span>${esc(q.note || c?.name || '')}</span><strong>${euro(q.amount)}</strong></span>
              </button>`;
            })
            .join('')}</div>`
        : ''
    }
    <p class="field-label" id="l-cats">Categoria</p>
    <div class="cat-grid" id="f-cats" role="radiogroup" aria-labelledby="l-cats"></div>
    ${
      bankText
        ? `<div class="bank-desc">${icon('bank')}<div><strong>${esc(prettyDescription(bankText))}</strong><span>${esc(bankText)}</span></div></div>
           <label class="remember" hidden>
             <input type="checkbox" id="f-remember" checked>
             <span>Usa sempre questa categoria quando la descrizione contiene
               <input id="f-keyword" value="${esc(guessKeyword(bankText))}" aria-label="Parola chiave"></span>
           </label>`
        : ''
    }`;

  const footer = `
    <p class="form-error" hidden></p>
    <div class="keypad" role="group" aria-label="Tastierino importo">
      ${KEYS.map(
        (k) =>
          `<button type="button" class="key" data-key="${k}" aria-label="${k === 'back' ? 'Cancella una cifra' : k === ',' ? 'Virgola' : k}">${
            k === 'back' ? icon('backspace') : k
          }</button>`,
      ).join('')}
    </div>
    <button type="button" class="btn primary block save-btn" id="f-save"></button>`;

  // Tasti del computer per l'importo: assegnato in onMount, rimosso alla chiusura.
  let onKeyboard = () => {};

  openSheet({
    title: tx ? 'Modifica movimento' : 'Nuovo movimento',
    className: 'tx-sheet',
    actions: tx ? `<button type="button" class="icon-btn danger" id="f-delete" aria-label="Elimina movimento">${icon('trash')}</button>` : '',
    top,
    body,
    footer,
    onClose: () => document.removeEventListener('keydown', onKeyboard),
    onMount(el, close) {
      const $ = (s) => el.querySelector(s);
      const noteInput = $('#f-note');

      function drawAmount(shake = false) {
        $('.amount-value').textContent = formatRaw(raw);
        $('.amount-display').classList.toggle('is-empty', !raw);
        $('.amount-sign').textContent = raw ? TYPES[type].sign : '';
        if (shake) {
          $('.amount-display').classList.remove('shake');
          void $('.amount-display').offsetWidth;
          $('.amount-display').classList.add('shake');
        }
      }

      function press(key) {
        if (key === 'back') raw = raw.slice(0, -1);
        else if (key === ',') {
          if (!raw.includes(',')) raw = `${raw || '0'},`;
        } else {
          const [int, dec] = raw.split(',');
          if (dec !== undefined && dec.length >= 2) return drawAmount(true);
          if (dec === undefined && int.replace(/^0$/, '').length >= MAX_INT_DIGITS) return drawAmount(true);
          raw = raw === '0' ? key : raw + key;
        }
        showError(el, '');
        drawAmount();
      }

      function drawCategories() {
        const kind = type === 'income' ? 'income' : 'expense';
        const list = byUsage(
          categories.filter((c) => c.kind === kind && (!c.archived || c.id === categoryId)),
          transactions,
        );
        if (!list.some((c) => c.id === categoryId)) categoryId = null;
        $('#f-cats').innerHTML = list
          .map(
            (c) => `
            <button type="button" role="radio" class="cat ${c.id === categoryId ? 'selected' : ''}" data-cat="${esc(c.id)}"
              aria-checked="${c.id === categoryId}" style="--c:${esc(c.color)}">
              <span class="cat-icon">${esc(c.icon)}</span><span class="cat-name">${esc(c.name)}</span>
            </button>`,
          )
          .join('');
      }

      function drawDetails() {
        const name = (sel) => sel.selectedOptions[0]?.textContent ?? '';
        $('#v-from').textContent = type === 'transfer' ? `Da ${name($('#f-from'))}` : name($('#f-from'));
        $('#v-to').textContent = `A ${name($('#f-to'))}`;
        $('#v-date').textContent = dateLabel($('#f-date').value || toISODate());
        const note = noteInput.value.trim();
        $('#v-note').textContent = note ? (note.length > 18 ? `${note.slice(0, 17)}…` : note) : 'Nota';
        $('#c-note').classList.toggle('filled', Boolean(note));
      }

      function setType(next) {
        type = next;
        el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === type)));
        $('.amount-display').dataset.type = type;
        $('#l-cats').hidden = $('#f-cats').hidden = type === 'transfer';
        $('#c-to').hidden = type !== 'transfer';
        $('#f-save').textContent = TYPES[type].save;
        el.querySelectorAll('[data-quick]').forEach((b) => (b.hidden = b.dataset.kind !== type));
        if ($('#f-quick')) $('#f-quick').hidden = !el.querySelector(`[data-quick][data-kind="${type}"]`);
        drawAmount();
        drawCategories();
        drawDetails();
      }

      $('.type-switch').addEventListener('click', (e) => {
        const b = e.target.closest('[data-type]');
        if (b) setType(b.dataset.type);
      });

      $('.keypad').addEventListener('click', (e) => {
        const k = e.target.closest('[data-key]');
        if (k) press(k.dataset.key);
      });

      $('#f-cats').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        categoryId = b.dataset.cat;
        drawCategories();
        showError(el, '');
        // Per i movimenti arrivati da banca o file, proponi di creare una regola.
        const remember = $('.remember');
        if (remember) remember.hidden = categoryId === tx.categoryId || !$('#f-keyword').value;
      });

      el.querySelectorAll('#f-from, #f-to, #f-date').forEach((input) => input.addEventListener('change', drawDetails));
      // Sul computer il selettore della data si apre solo cliccando l'icona: lo apriamo noi.
      $('#f-date').addEventListener('click', (e) => {
        try {
          e.target.showPicker?.();
        } catch {
          // non supportato: il browser apre il suo selettore
        }
      });

      // Nota: mentre scrivi il tastierino si nasconde, così la tastiera dell'iPhone ha spazio.
      $('#c-note').addEventListener('click', () => {
        $('.note-box').hidden = false;
        noteInput.focus();
      });
      noteInput.addEventListener('focus', () => el.classList.add('typing'));
      noteInput.addEventListener('blur', () => {
        el.classList.remove('typing');
        if (!noteInput.value.trim()) $('.note-box').hidden = true;
        drawDetails();
      });
      noteInput.addEventListener('keydown', (e) => e.key === 'Enter' && noteInput.blur());

      // Spesa frequente: un tocco compila importo, categoria, conto e nota; poi basta Salva.
      $('#f-quick')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-quick]');
        if (!b) return;
        const q = quick[b.dataset.quick];
        categoryId = q.categoryId;
        raw = centsToRaw(q.amount);
        if (q.accountId && [...$('#f-from').options].some((o) => o.value === q.accountId)) $('#f-from').value = q.accountId;
        if (q.note && !noteInput.value.trim()) {
          noteInput.value = q.note;
          $('.note-box').hidden = false;
        }
        el.querySelectorAll('[data-quick]').forEach((x) => x.classList.toggle('selected', x === b));
        showError(el, '');
        setType(q.type);
        $('#f-save').classList.add('pulse');
      });

      // Ripeti: crea anche una ricorrente mensile a partire da questo movimento.
      $('#c-repeat')?.addEventListener('click', () => {
        repeat = !repeat;
        $('#c-repeat').classList.toggle('filled', repeat);
        $('#c-repeat').setAttribute('aria-pressed', String(repeat));
        $('#v-repeat').textContent = repeat ? 'Ogni mese' : 'Ripeti';
      });

      $('#f-save').addEventListener('click', save);
      $('#f-delete')?.addEventListener('click', remove);

      // Sul computer si può scrivere l'importo anche con la tastiera.
      onKeyboard = (e) => {
        if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey) return;
        if (/^[0-9]$/.test(e.key)) press(e.key);
        else if (e.key === ',' || e.key === '.') press(',');
        else if (e.key === 'Backspace') press('back');
        else if (e.key === 'Enter') save();
        else return;
        e.preventDefault();
      };
      document.addEventListener('keydown', onKeyboard);

      async function save() {
        const amount = rawToCents(raw);
        const accountId = $('#f-from').value;
        const toAccountId = $('#f-to').value;
        const date = $('#f-date').value;
        if (!(amount > 0)) {
          drawAmount(true);
          return showError(el, "Scrivi l'importo con il tastierino");
        }
        if (type !== 'transfer' && !categoryId) return showError(el, 'Scegli una categoria');
        if (type === 'transfer' && accountId === toAccountId) return showError(el, 'Scegli due conti diversi');
        if (!date) return showError(el, 'Scegli una data');

        const note = noteInput.value.trim();
        const rec = repeat
          ? await saveRecurring({
              type,
              amount,
              note,
              accountId,
              toAccountId: type === 'transfer' ? toAccountId : null,
              categoryId: type === 'transfer' ? null : categoryId,
              every: 'month',
              day: Number(date.slice(8)),
              startDate: date,
              lastDone: date,
            })
          : null;
        const saved = await saveTransaction({
          ...tx,
          ...(rec ? { recurringId: rec.id } : {}),
          type,
          amount,
          accountId,
          toAccountId: type === 'transfer' ? toAccountId : null,
          categoryId: type === 'transfer' ? null : categoryId,
          date,
          note,
          toReview: false,
        });
        const remember = $('.remember');
        const keyword = $('#f-keyword')?.value.trim();
        let alsoFixed = 0;
        if (remember && !remember.hidden && $('#f-remember').checked && keyword && type !== 'transfer') {
          const rule = { keyword, action: 'category', categoryId };
          await saveRule(rule);
          // La nuova regola sistema subito anche gli altri movimenti ancora da rivedere.
          const others = state.data.transactions.filter(
            (t) => t.id !== tx.id && t.toReview && t.type === type && ruleMatches(rule, t.bankDescription ?? t.note),
          );
          await saveTransactions(others.map((t) => ({ ...t, categoryId, toReview: false })));
          alsoFixed = others.length;
        }
        rememberAccount(accountId);
        close();
        await refresh();

        // Un movimento appena creato si può annullare subito dal messaggio.
        const undo = tx
          ? null
          : {
              label: 'Annulla',
              run: async () => {
                await deleteTransaction(saved.id);
                await refresh();
              },
            };
        const alert = type === 'expense' ? budgetAlert(categoryId, date.slice(0, 7)) : null;
        if (alert) toast(alert.message, { tone: alert.level, action: undo });
        else if (alsoFixed) toast(`Regola salvata · sistemati altri ${alsoFixed} movimenti`);
        else if (rec) toast(`${TYPES[type].saved} · si ripeterà ${describeSchedule(rec).toLowerCase()}`);
        else toast(tx ? 'Movimento aggiornato' : TYPES[type].saved, { action: undo });
      }

      async function remove() {
        if (!confirm('Eliminare questo movimento?')) return;
        await deleteTransaction(tx.id);
        close();
        await refresh();
        toast('Movimento eliminato', {
          action: {
            label: 'Annulla',
            run: async () => {
              await saveTransaction(tx);
              await refresh();
            },
          },
        });
      }

      if (tx?.note) $('.note-box').hidden = false;
      setType(type);
    },
  });
}
