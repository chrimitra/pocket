// Confronta i movimenti arrivati dalla banca con quelli già in Tasca.
// - già scaricati in passato → saltati
// - già presenti (inseriti a mano o importati da file) → "riconciliati": restano i tuoi, con la categoria che hai scelto
// - nuovi → creati, con la categoria delle regole; quelli senza regola finiscono "da rivedere"
import { parseISODate } from './format.js';
import { findRule, normalizeText } from './rules.js';
import { signedAmount } from './store.js';

const MAX_DAYS_APART = 3;
const dayDiff = (a, b) => Math.abs(parseISODate(a) - parseISODate(b)) / 864e5;

export function bankCents(t) {
  const n = Math.round(Math.abs(Number(t.amount)) * 100);
  return t.credit ? n : -n;
}

export function bankDescription(t) {
  const parts = [t.counterparty, t.info].map((s) => String(s ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Evita di ripetere il nome se compare già nella causale.
  if (parts.length === 2 && normalizeText(parts[1]).includes(normalizeText(parts[0]))) parts.shift();
  return parts.join(' · ') || 'Movimento bancario';
}

export function reconcile(bankTxs, { accountId, transactions, rules, categories }) {
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const usableRules = rules.filter((r) => !(r.action === 'transfer' && r.accountId === accountId));
  const known = new Set(transactions.map((t) => t.externalId).filter((id) => id?.startsWith('eb:')));
  const candidates = transactions.filter((t) => !t.externalId?.startsWith('eb:') && signedAmount(t, accountId) !== 0);
  const claimed = new Set();
  const occurrences = new Map();
  const fallback = (kind) =>
    categories.find((c) => c.kind === kind && !c.archived && /^altr[oe]/i.test(c.name)) ?? categories.find((c) => c.kind === kind && !c.archived);

  const create = [];
  const update = [];
  let skipped = 0;

  for (const t of bankTxs) {
    if (t.status && t.status !== 'BOOK') continue; // in attesa: arriveranno quando contabilizzati
    if (!t.date || t.amount == null) continue;
    const cents = bankCents(t);
    if (!cents) continue;
    const description = bankDescription(t);

    // Se la banca non dà un identificativo, ne costruiamo uno stabile dal contenuto.
    let externalId = t.id ? `eb:${accountId}:${t.id}` : null;
    if (!externalId) {
      const base = `eb:${accountId}:${t.date}|${cents}|${normalizeText(description)}`;
      const n = (occurrences.get(base) || 0) + 1;
      occurrences.set(base, n);
      externalId = `${base}|${n}`;
    }
    if (known.has(externalId)) {
      skipped++;
      continue;
    }
    known.add(externalId);

    const twin = candidates
      .filter((c) => !claimed.has(c.id) && signedAmount(c, accountId) === cents && dayDiff(c.date, t.date) <= MAX_DAYS_APART)
      .sort((a, b) => dayDiff(a.date, t.date) - dayDiff(b.date, t.date))[0];
    if (twin) {
      claimed.add(twin.id);
      update.push({ ...twin, externalId, bankDescription: description });
      continue;
    }

    const rule = findRule(usableRules, description, cents > 0, categoriesById);
    const common = { amount: Math.abs(cents), date: t.date, note: description.slice(0, 140), bankDescription: description, source: 'bank', externalId };
    if (rule?.action === 'transfer') {
      create.push(
        cents < 0
          ? { ...common, type: 'transfer', accountId, toAccountId: rule.accountId, categoryId: null }
          : { ...common, type: 'transfer', accountId: rule.accountId, toAccountId: accountId, categoryId: null },
      );
    } else {
      const kind = cents > 0 ? 'income' : 'expense';
      create.push({ ...common, type: kind, accountId, toAccountId: null, categoryId: rule?.categoryId ?? fallback(kind)?.id ?? null, toReview: !rule });
    }
  }
  return { create, update, skipped };
}
