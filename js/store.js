// Logica di dominio: conti, categorie, movimenti, saldi e riepiloghi.
import * as db from './db.js';
import { DEFAULT_RULES, ruleOrder } from './rules.js';

export const ACCOUNT_TYPES = {
  bank: { label: 'Conto corrente', icon: '🏦' },
  card: { label: 'Carta prepagata', icon: '💳' },
  cash: { label: 'Contanti', icon: '💶' },
  savings: { label: 'Risparmi', icon: '🐷' },
};

export const CATEGORY_COLORS = ['#E07A5F', '#3D8BD9', '#E9A23B', '#7B61C9', '#2FA37A', '#D35D8F', '#5B9AA0', '#C46A3A', '#8A9A3B', '#6C7A89'];

const DEFAULT_CATEGORIES = [
  ['expense', '🛒', 'Spesa'],
  ['expense', '🍽️', 'Ristoranti e bar'],
  ['expense', '🚗', 'Trasporti'],
  ['expense', '⛽', 'Carburante'],
  ['expense', '🏠', 'Casa'],
  ['expense', '💡', 'Bollette'],
  ['expense', '💊', 'Salute'],
  ['expense', '🛍️', 'Shopping'],
  ['expense', '🎬', 'Svago'],
  ['expense', '📺', 'Abbonamenti'],
  ['expense', '✈️', 'Viaggi'],
  ['expense', '🎁', 'Regali'],
  ['expense', '📚', 'Istruzione'],
  ['expense', '📦', 'Altro'],
  ['income', '💼', 'Stipendio'],
  ['income', '↩️', 'Rimborsi'],
  ['income', '🎁', 'Regali ricevuti'],
  ['income', '🏷️', 'Vendite'],
  ['income', '💰', 'Altre entrate'],
];

export const uid = () => crypto.randomUUID();

export async function init() {
  if (!(await db.get('meta', 'seeded'))) await seedBasics();
  if (!(await db.get('meta', 'rulesSeeded'))) await seedRules();
}

async function seedBasics() {
  const now = Date.now();
  await db.putMany(
    'categories',
    DEFAULT_CATEGORIES.map(([kind, icon, name], i) => ({
      id: uid(), kind, icon, name, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], order: i, archived: false,
    })),
  );
  await db.putMany('accounts', [
    { id: uid(), name: 'Conto BancoPosta', type: 'bank', initialBalance: 0, archived: false, order: 0, createdAt: now },
    { id: uid(), name: 'Contanti', type: 'cash', initialBalance: 0, archived: false, order: 1, createdAt: now },
  ]);
  await db.put('meta', { key: 'seeded', value: true });
}

// Regole di partenza per i negozi più comuni; quelle che puntano a categorie o conti mancanti vengono saltate.
async function seedRules() {
  const [categories, accounts] = await Promise.all([db.getAll('categories'), db.getAll('accounts')]);
  const rules = [];
  for (const [keyword, target] of DEFAULT_RULES) {
    if (typeof target === 'string') {
      const c = categories.find((x) => x.name === target);
      if (c) rules.push({ id: uid(), keyword, action: 'category', categoryId: c.id, createdAt: 0 });
    } else {
      const a = accounts.find((x) => x.type === target.transferTo && !x.archived);
      if (a) rules.push({ id: uid(), keyword, action: 'transfer', accountId: a.id, createdAt: 0 });
    }
  }
  await db.putMany('rules', rules);
  await db.put('meta', { key: 'rulesSeeded', value: true });
}

export async function loadAll() {
  const [accounts, categories, transactions, goals, rules, bank] = await Promise.all([
    db.getAll('accounts'), db.getAll('categories'), db.getAll('transactions'), db.getAll('goals'), db.getAll('rules'),
    db.get('meta', 'bank'),
  ]);
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  return {
    accounts: accounts.sort(byOrder),
    categories: categories.sort(byOrder),
    transactions,
    goals: goals.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    rules: rules.sort(ruleOrder),
    bank: bank?.value ?? null,
  };
}

// Importo con segno rispetto a un conto (o al patrimonio totale se accountId è assente).
export function signedAmount(t, accountId) {
  if (t.type === 'income') return !accountId || t.accountId === accountId ? t.amount : 0;
  if (t.type === 'expense') return !accountId || t.accountId === accountId ? -t.amount : 0;
  if (!accountId) return 0;
  if (t.accountId === accountId) return -t.amount;
  if (t.toAccountId === accountId) return t.amount;
  return 0;
}

export function balances(accounts, transactions) {
  const map = new Map(accounts.map((a) => [a.id, a.initialBalance || 0]));
  const add = (id, v) => map.has(id) && map.set(id, map.get(id) + v);
  for (const t of transactions) {
    if (t.type === 'income') add(t.accountId, t.amount);
    else if (t.type === 'expense') add(t.accountId, -t.amount);
    else if (t.type === 'transfer') {
      add(t.accountId, -t.amount);
      add(t.toAccountId, t.amount);
    }
  }
  return map;
}

export function monthSummary(transactions, ym) {
  let income = 0;
  let expense = 0;
  const byCategory = new Map();
  for (const t of transactions) {
    if (!t.date.startsWith(ym)) continue;
    if (t.type === 'income') income += t.amount;
    if (t.type === 'expense') {
      expense += t.amount;
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + t.amount);
    }
  }
  return { income, expense, byCategory };
}

// Soglia oltre la quale una categoria è "quasi al limite".
export const BUDGET_WARN = 0.8;

// Budget mensili per categoria di spesa: quanto è previsto, quanto è già speso.
export function budgetStatus(categories, transactions, ym) {
  const { expense, byCategory } = monthSummary(transactions, ym);
  const rows = [];
  const unbudgeted = [];
  for (const c of categories) {
    if (c.kind !== 'expense') continue;
    const spent = byCategory.get(c.id) || 0;
    if (c.budget > 0 && !c.archived) rows.push({ category: c, budget: c.budget, spent, ratio: spent / c.budget });
    else if (spent > 0) unbudgeted.push({ category: c, spent });
  }
  rows.sort((a, b) => b.ratio - a.ratio);
  unbudgeted.sort((a, b) => b.spent - a.spent);
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  return { rows, unbudgeted, totalBudget, totalSpent, expense };
}

export function budgetLevel(ratio) {
  if (ratio > 1) return 'over';
  if (ratio >= BUDGET_WARN) return 'warn';
  return 'ok';
}

// Spesa media mensile di una categoria nei mesi precedenti a ym (per suggerire un budget).
export function averageSpending(transactions, categoryId, ym, months = 3) {
  const [y, m] = ym.split('-').map(Number);
  const from = new Date(y, m - 1 - months, 1);
  const start = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
  let total = 0;
  const activeMonths = new Set();
  for (const t of transactions) {
    if (t.date < start || t.date >= ym) continue;
    activeMonths.add(t.date.slice(0, 7));
    if (t.type === 'expense' && t.categoryId === categoryId) total += t.amount;
  }
  // Divide solo per i mesi in cui hai registrato qualcosa, così chi ha iniziato da poco non ha medie troppo basse.
  return activeMonths.size ? Math.round(total / activeMonths.size) : 0;
}

export function sortTransactions(list) {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}

export async function saveTransaction(t) {
  const now = Date.now();
  await db.put('transactions', { source: 'manual', createdAt: now, ...t, id: t.id || uid(), updatedAt: now });
}

export const deleteTransaction = (id) => db.remove('transactions', id);

export async function saveTransactions(list) {
  const now = Date.now();
  await db.putMany('transactions', list.map((t, i) => ({ createdAt: now + i, ...t, id: t.id || uid(), updatedAt: now })));
}

export async function saveRule(r) {
  await db.put('rules', { createdAt: Date.now(), ...r, id: r.id || uid() });
}

export const deleteRule = (id) => db.remove('rules', id);

export async function saveAccount(a) {
  await db.put('accounts', { archived: false, createdAt: Date.now(), ...a, id: a.id || uid() });
}

export const deleteAccount = (id) => db.remove('accounts', id);

export async function saveCategory(c) {
  await db.put('categories', { archived: false, ...c, id: c.id || uid() });
}

export const deleteCategory = (id) => db.remove('categories', id);

export const saveCategories = (list) => db.putMany('categories', list);

export async function saveGoal(g) {
  await db.put('goals', { saved: 0, createdAt: Date.now(), ...g, id: g.id || uid() });
}

export const deleteGoal = (id) => db.remove('goals', id);

export async function exportData() {
  // Il collegamento alla banca (chiave del server, sessioni) non finisce nel file di backup.
  const { bank, ...data } = await loadAll();
  return { app: 'tasca', version: 1, exportedAt: new Date().toISOString(), ...data };
}

export async function importData(data) {
  if (data?.app !== 'tasca' || !['accounts', 'categories', 'transactions'].every((k) => Array.isArray(data[k]))) {
    throw new Error('Il file non è un backup valido di Tasca.');
  }
  await db.clearAll();
  await db.putMany('accounts', data.accounts);
  await db.putMany('categories', data.categories);
  await db.putMany('transactions', data.transactions);
  await db.putMany('goals', Array.isArray(data.goals) ? data.goals : []);
  await db.put('meta', { key: 'seeded', value: true });
  if (Array.isArray(data.rules)) {
    await db.putMany('rules', data.rules);
    await db.put('meta', { key: 'rulesSeeded', value: true });
  } else await seedRules();
}

export async function wipe() {
  await db.clearAll();
  await init();
}
