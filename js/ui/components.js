// Pezzi di interfaccia riusati da più viste.
import { esc, euro } from '../format.js';
import { prettyDescription } from '../rules.js';
import { budgetLevel, signedAmount } from '../store.js';
import { icon } from './icons.js';
import { openTransactionSheet } from './transaction-sheet.js';

export function lookups(data) {
  return {
    acc: new Map(data.accounts.map((a) => [a.id, a])),
    cat: new Map(data.categories.map((c) => [c.id, c])),
  };
}

/**
 * Riga di un movimento. Il titolo è quello che ricordi (la nota o il negozio),
 * sotto la categoria e il conto. Con accountId gli importi hanno il segno visto da quel conto.
 */
export function txRow(t, { acc, cat }, accountId) {
  const from = acc.get(t.accountId);
  const note = t.note ? prettyDescription(t.note) : '';
  let chip, title, sub, amount, cls;
  if (t.type === 'transfer') {
    chip = `<span class="row-icon tone-neutral">${icon('transfer')}</span>`;
    title = note || 'Trasferimento';
    sub = `${from?.name ?? '—'} → ${acc.get(t.toAccountId)?.name ?? '—'}`;
    const v = accountId ? signedAmount(t, accountId) : t.amount;
    amount = euro(v, { sign: Boolean(accountId) });
    cls = !accountId ? 'neutral' : v < 0 ? 'neg' : 'pos';
  } else {
    const c = cat.get(t.categoryId);
    chip = `<span class="row-icon emoji" style="--c:${esc(c?.color ?? '#6C7A89')}">${esc(c?.icon ?? '•')}</span>`;
    title = note || c?.name || 'Senza categoria';
    sub = [note ? c?.name : null, from?.name].filter(Boolean).join(' · ');
    amount = euro(t.type === 'income' ? t.amount : -t.amount, { sign: true });
    cls = t.type === 'income' ? 'pos' : 'neg';
  }
  return `
    <button class="row" data-tx="${esc(t.id)}">
      ${chip}
      <span class="row-main">
        <span class="row-title">${esc(title)}</span>
        <span class="row-sub">${t.toReview ? '<span class="badge warn">da rivedere</span> ' : ''}${esc(sub)}</span>
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

/** Stato vuoto: icona, una frase che spiega, e se serve un pulsante per iniziare. */
export function emptyState(iconName, title, text = '', action = '') {
  return `<div class="empty">
    <span class="empty-icon">${icon(iconName)}</span>
    <p class="empty-title">${title}</p>
    ${text ? `<p class="empty-text">${text}</p>` : ''}
    ${action}
  </div>`;
}

/** Riga di navigazione (Impostazioni e simili). tone: colore dell'icona. */
export function navRow({ href, id, iconName, title, sub = '', tone = 'primary', danger = false, tag = 'a', attrs = '' }) {
  const open = tag === 'a' ? `<a class="row" href="${href}" ${attrs}>` : `<${tag} class="row ${danger ? 'danger' : ''}" ${id ? `id="${id}"` : ''} ${attrs}>`;
  return `${open}
      <span class="row-icon tone-${danger ? 'danger' : tone}">${icon(iconName)}</span>
      <span class="row-main"><span class="row-title">${title}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span>
      ${tag === 'a' ? `<span class="row-chevron">${icon('chevron-right')}</span>` : ''}
    </${tag}>`;
}

/** Intestazione di pagina con link "indietro" opzionale e azioni a destra. */
export function pageHeader(title, { back = null, actions = '', sub = '' } = {}) {
  return `<header class="page-header">
    ${back ? `<a class="back" href="${back.href}">${icon('chevron-left')}${back.label}</a>` : ''}
    <div class="page-title-row"><h1>${title}</h1>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>
    ${sub ? `<p class="page-sub">${sub}</p>` : ''}
  </header>`;
}
