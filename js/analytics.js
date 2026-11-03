// Calcoli per i grafici: andamento del saldo, totali mensili, spese per categoria.
import { currentMonth, parseISODate, shiftMonth, toISODate } from './format.js';

// Elenco dei mesi del periodo scelto, dal più vecchio al mese corrente.
export function periodMonths(transactions, period) {
  const now = currentMonth();
  let count = Number(period);
  if (period === 'all') {
    const first = transactions.reduce((min, t) => (t.date < min ? t.date : min), toISODate()).slice(0, 7);
    const [y1, m1] = first.split('-').map(Number);
    const [y2, m2] = now.split('-').map(Number);
    count = (y2 - y1) * 12 + (m2 - m1) + 1;
  }
  return Array.from({ length: Math.max(1, count) }, (_, i) => shiftMonth(now, i - count + 1));
}

export function monthlyTotals(transactions, months) {
  const map = new Map(months.map((ym) => [ym, { ym, income: 0, expense: 0 }]));
  for (const t of transactions) {
    const row = map.get(t.date.slice(0, 7));
    if (!row) continue;
    if (t.type === 'income') row.income += t.amount;
    if (t.type === 'expense') row.expense += t.amount;
  }
  return [...map.values()];
}

// Saldo totale (conti attivi) alla fine di ogni giorno, dal primo giorno del periodo a oggi.
export function dailyBalance(accounts, transactions, fromISO) {
  const active = new Set(accounts.filter((a) => !a.archived).map((a) => a.id));
  const delta = (t) => {
    let d = 0;
    if (t.type === 'income' && active.has(t.accountId)) d += t.amount;
    if (t.type === 'expense' && active.has(t.accountId)) d -= t.amount;
    if (t.type === 'transfer') {
      if (active.has(t.accountId)) d -= t.amount;
      if (active.has(t.toAccountId)) d += t.amount;
    }
    return d;
  };

  let balance = accounts.filter((a) => active.has(a.id)).reduce((s, a) => s + (a.initialBalance || 0), 0);
  const byDay = new Map();
  for (const t of transactions) {
    if (t.date < fromISO) balance += delta(t);
    else byDay.set(t.date, (byDay.get(t.date) || 0) + delta(t));
  }

  const points = [];
  const today = toISODate();
  for (let d = parseISODate(fromISO); toISODate(d) <= today; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d);
    balance += byDay.get(iso) || 0;
    points.push({ date: iso, value: balance });
  }
  return points;
}

export function categoryTotals(transactions, months) {
  const from = months[0];
  const to = months[months.length - 1];
  const map = new Map();
  for (const t of transactions) {
    const ym = t.date.slice(0, 7);
    if (t.type !== 'expense' || ym < from || ym > to) continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
  }
  return [...map].map(([categoryId, total]) => ({ categoryId, total })).sort((a, b) => b.total - a.total);
}

// Spesa media dei mesi indicati fino allo stesso giorno del mese: serve a confrontare
// il mese in corso (ancora a metà) con il solito ritmo, invece che con mesi interi.
export function averageExpenseToDay(transactions, months, day) {
  if (!months.length) return 0;
  const set = new Set(months);
  let total = 0;
  for (const t of transactions) {
    if (t.type === 'expense' && set.has(t.date.slice(0, 7)) && Number(t.date.slice(8)) <= day) total += t.amount;
  }
  return Math.round(total / months.length);
}

// Medie sui mesi già conclusi del periodo (il mese in corso falserebbe la media).
export function averages(rows) {
  const closed = rows.length > 1 ? rows.slice(0, -1) : rows;
  const income = closed.reduce((s, r) => s + r.income, 0);
  const expense = closed.reduce((s, r) => s + r.expense, 0);
  return {
    months: closed.length,
    income: Math.round(income / closed.length),
    expense: Math.round(expense / closed.length),
    saved: Math.round((income - expense) / closed.length),
    rate: income > 0 ? (income - expense) / income : null,
  };
}
