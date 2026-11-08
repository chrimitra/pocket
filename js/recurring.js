// Spese e entrate ricorrenti (affitto, abbonamenti, stipendio…): quando "scattano",
// quali vanno confermate, quali sembrano già registrate.
import { daysInMonth, parseISODate, shiftMonth, toISODate } from './format.js';
import { saveRecurring, saveTransaction, signedAmount } from './store.js';

const MAX_DUE_PER_ITEM = 3;
const MATCH_DAYS = 4;
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const pad = (n) => String(n).padStart(2, '0');

// Il giorno 31 nei mesi più corti diventa l'ultimo giorno del mese.
const dateIn = (ym, day) => `${ym}-${pad(Math.min(day, daysInMonth(ym)))}`;

/** Le date in cui la ricorrenza scatta, dall'inizio fino a `until` compreso. */
export function occurrences(r, until) {
  const out = [];
  const step = r.every === 'year' ? 12 : 1;
  let ym = r.every === 'year' ? `${r.startDate.slice(0, 4)}-${pad(r.month ?? Number(r.startDate.slice(5, 7)))}` : r.startDate.slice(0, 7);
  if (dateIn(ym, r.day) < r.startDate) ym = shiftMonth(ym, step);
  for (let i = 0; i < 600; i++) {
    const d = dateIn(ym, r.day);
    if (d > until) break;
    out.push(d);
    ym = shiftMonth(ym, step);
  }
  return out;
}

/** La prossima data non ancora gestita (registrata o saltata), anche futura. */
export function nextDate(r) {
  const horizon = toISODate(new Date(Date.now() + 400 * 864e5));
  return occurrences(r, horizon).find((d) => !r.lastDone || d > r.lastDone) ?? null;
}

const dayDiff = (a, b) => Math.abs(parseISODate(a) - parseISODate(b)) / 864e5;

export function toTransaction(r, date) {
  return {
    type: r.type,
    amount: r.amount,
    accountId: r.accountId,
    toAccountId: r.type === 'transfer' ? r.toAccountId : null,
    categoryId: r.type === 'transfer' ? null : r.categoryId,
    note: r.note ?? '',
    date,
    source: 'recurring',
    recurringId: r.id,
  };
}

// Un movimento già in Tasca che corrisponde a questa scadenza (inserito a mano, importato o dalla banca).
function findMatch(r, date, transactions, claimed) {
  const cents = signedAmount(toTransaction(r, date), r.accountId) || r.amount;
  return transactions.find(
    (t) =>
      !claimed.has(t.id) &&
      t.type === r.type &&
      dayDiff(t.date, date) <= MATCH_DAYS &&
      (t.recurringId === r.id || (t.accountId === r.accountId && (signedAmount(t, r.accountId) || t.amount) === cents)),
  );
}

/** Le scadenze arrivate e non ancora gestite, con l'eventuale movimento che sembra corrispondere. */
export function dueItems(recurring, transactions, today = toISODate()) {
  const claimed = new Set();
  const items = [];
  for (const r of recurring) {
    const dates = occurrences(r, today)
      .filter((d) => !r.lastDone || d > r.lastDone)
      .slice(-MAX_DUE_PER_ITEM);
    for (const date of dates) {
      const match = findMatch(r, date, transactions, claimed);
      if (match) claimed.add(match.id);
      items.push({ recurring: r, date, match: match ?? null });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Le scadenze dei prossimi giorni (solo per avvisarti). */
export function upcomingItems(recurring, days = 7, today = toISODate()) {
  const until = toISODate(new Date(parseISODate(today).getTime() + days * 864e5));
  return recurring
    .map((r) => ({ recurring: r, date: nextDate(r) }))
    .filter((x) => x.date && x.date > today && x.date <= until)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Quanto resta da pagare questo mese in spese fisse (scadenze non ancora gestite). */
export function fixedStillDue(recurring, today = toISODate()) {
  const ym = today.slice(0, 7);
  const monthEnd = `${ym}-${pad(daysInMonth(ym))}`;
  let total = 0;
  const names = [];
  for (const r of recurring) {
    if (r.type !== 'expense') continue;
    const left = occurrences(r, monthEnd).filter((d) => d.startsWith(ym) && (!r.lastDone || d > r.lastDone));
    if (left.length) {
      total += r.amount * left.length;
      names.push(r.note || null);
    }
  }
  return { total, names: names.filter(Boolean) };
}

/** Totale al mese delle ricorrenti di un tipo (le annuali divise per 12). */
export function monthlyTotal(recurring, type) {
  return recurring.filter((r) => r.type === type).reduce((s, r) => s + (r.every === 'year' ? Math.round(r.amount / 12) : r.amount), 0);
}

export function describeSchedule(r) {
  if (r.every === 'year') return `Ogni anno il ${r.day} ${MONTHS[(r.month ?? 1) - 1]}`;
  return r.day >= 29 ? `Ogni mese il ${r.day} (o l'ultimo giorno)` : `Ogni mese il giorno ${r.day}`;
}

export function shortDate(iso, today = toISODate()) {
  if (iso === today) return 'oggi';
  const tomorrow = toISODate(new Date(parseISODate(today).getTime() + 864e5));
  const yesterday = toISODate(new Date(parseISODate(today).getTime() - 864e5));
  if (iso === tomorrow) return 'domani';
  if (iso === yesterday) return 'ieri';
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(parseISODate(iso));
}

// ---------- Azioni ----------

async function markDone(r, date) {
  if (r.lastDone && r.lastDone >= date) return;
  r.lastDone = date;
  await saveRecurring(r);
}

/** Registra la scadenza come movimento. */
export async function confirmDue({ recurring: r, date }) {
  const tx = await saveTransaction(toTransaction(r, date));
  await markDone(r, date);
  return tx;
}

/** La scadenza c'è già in Tasca (es. importata dalla banca): la collega, senza duplicarla. */
export async function linkDue({ recurring: r, date, match }) {
  if (match && !match.recurringId) await saveTransaction({ ...match, recurringId: r.id });
  await markDone(r, date);
}

/** Questa volta la salti (es. un mese senza palestra). */
export async function skipDue({ recurring: r, date }) {
  await markDone(r, date);
}

/** All'apertura: le ricorrenti con "aggiungi da sola" vengono registrate senza chiedere. */
export async function applyAutomatic(data) {
  const added = [];
  for (const item of dueItems(data.recurring.filter((r) => r.auto), data.transactions)) {
    if (item.match) await linkDue(item);
    else {
      await confirmDue(item);
      added.push(item.recurring.note || 'ricorrente');
    }
  }
  return added;
}
