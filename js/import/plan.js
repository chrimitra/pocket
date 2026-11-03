// Prepara la revisione dell'import: categorie dalle regole, doppioni, movimenti già importati.
import { parseISODate } from '../format.js';
import { findRule, normalizeText } from '../rules.js';
import { signedAmount } from '../store.js';

const MAX_DAYS_APART = 3;
const dayDiff = (a, b) => Math.abs(parseISODate(a) - parseISODate(b)) / 864e5;

export function targetFromRule(rule) {
  return rule.action === 'transfer' ? `t:${rule.accountId}` : `c:${rule.categoryId}`;
}

export function buildPlan(records, { accountId, transactions, rules, categories }) {
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const usableRules = rules.filter((r) => !(r.action === 'transfer' && r.accountId === accountId));
  const importedIds = new Set(transactions.map((t) => t.externalId).filter(Boolean));
  // Movimenti inseriti a mano sullo stesso conto: ognuno può coincidere con una sola riga del file.
  const manual = transactions.filter((t) => t.source !== 'import' && signedAmount(t, accountId) !== 0);
  const claimed = new Set();
  const occurrences = new Map();
  const items = [];
  let already = 0;

  for (const r of records) {
    // Due righe identiche nello stesso file (es. due caffè uguali) restano due movimenti distinti.
    const base = `${accountId}|${r.date}|${r.cents}|${normalizeText(r.description)}`;
    const n = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, n);
    const externalId = `${base}|${n}`;
    if (importedIds.has(externalId)) {
      already++;
      continue;
    }

    const twin = manual.find((t) => !claimed.has(t.id) && signedAmount(t, accountId) === r.cents && dayDiff(t.date, r.date) <= MAX_DAYS_APART);
    if (twin) claimed.add(twin.id);
    const rule = findRule(usableRules, r.description, r.cents > 0, categoriesById);
    items.push({
      ...r,
      externalId,
      include: !twin,
      duplicateOf: twin?.id ?? null,
      target: rule ? targetFromRule(rule) : '',
      manual: false,
    });
  }
  return { items, already };
}

// Trasforma le righe scelte in movimenti da salvare.
export function toTransactions(items, accountId, categories) {
  const fallback = (kind) =>
    categories.find((c) => c.kind === kind && !c.archived && /^altr[oe]/i.test(c.name)) ?? categories.find((c) => c.kind === kind && !c.archived);

  return items
    .filter((it) => it.include)
    .map((it) => {
      const amount = Math.abs(it.cents);
      const common = { amount, date: it.date, note: it.description.slice(0, 140), source: 'import', externalId: it.externalId };
      if (it.target.startsWith('t:')) {
        const other = it.target.slice(2);
        return it.cents < 0
          ? { ...common, type: 'transfer', accountId, toAccountId: other, categoryId: null }
          : { ...common, type: 'transfer', accountId: other, toAccountId: accountId, categoryId: null };
      }
      const kind = it.cents > 0 ? 'income' : 'expense';
      const categoryId = it.target.startsWith('c:') ? it.target.slice(2) : fallback(kind)?.id ?? null;
      return { ...common, type: kind, accountId, toAccountId: null, categoryId };
    });
}
