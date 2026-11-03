// Pezzi di interfaccia riusati da più viste.
import { esc, euro } from '../format.js';
import { budgetLevel, signedAmount } from '../store.js';
import { openTransactionSheet } from './transaction-sheet.js';

export function lookups(data) {
  return {
    acc: new Map(data.accounts.map((a) => [a.id, a])),
    cat: new Map(data.categories.map((c) => [c.id, c])),
  };
}

export function txRow(t, { acc, cat }, accountId) {
  const from = acc.get(t.accountId);
  let icon, title, sub, color, amount, cls;
  if (t.type === 'transfer') {
    icon = '⇄';
    title = t.note || 'Trasferimento';
    sub = `${from?.name ?? '—'} → ${acc.get(t.toAccountId)?.name ?? '—'}`;
    color = '#6C7A89';
    const v = accountId ? signedAmount(t, accountId) : t.amount;
    amount = euro(v, { sign: Boolean(accountId) });
    cls = !accountId ? 'neutral' : v < 0 ? 'neg' : 'pos';
  } else {
    const c = cat.get(t.categoryId);
    icon = c?.icon ?? '•';
    title = c?.name ?? 'Senza categoria';
    sub = [t.note, from?.name].filter(Boolean).join(' · ');
    color = c?.color ?? '#6C7A89';
    amount = euro(t.type === 'income' ? t.amount : -t.amount, { sign: true });
    cls = t.type === 'income' ? 'pos' : 'neg';
  }
  return `
    <button class="row" data-tx="${esc(t.id)}">
      <span class="row-icon" style="--c:${esc(color)}">${esc(icon)}</span>
      <span class="row-main">
        <span class="row-title">${esc(title)}</span>
        <span class="row-sub">${esc(sub)}</span>
      </span>
      <span class="row-amount ${cls}">${amount}</span>
    </button>`;
}

export function bindTxRows(el, data) {
  el.querySelectorAll('[data-tx]').forEach((row) => {
    row.addEventListener('click', () => {
      const t = data.transactions.find((x) => x.id === row.dataset.tx);
      if (t) openTransactionSheet(t);
    });
  });
}

// Barra di avanzamento di un budget: verde, arancione oltre l'80%, rossa se sforato.
export function budgetBar(spent, budget) {
  const ratio = budget > 0 ? spent / budget : 0;
  const level = budgetLevel(ratio);
  const width = Math.min(100, Math.round(ratio * 100));
  return `<div class="bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio * 100)}">
    <div class="bar-fill level-${level}" style="width:${spent > 0 ? Math.max(3, width) : 0}%"></div>
  </div>`;
}

export function emptyState(icon, text, action = '') {
  return `<div class="empty"><span class="empty-icon">${icon}</span><p>${text}</p>${action}</div>`;
}
