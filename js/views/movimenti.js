import { currentMonth, dayLabel, esc, euro, monthLabel, shiftMonth } from '../format.js';
import { signedAmount, sortTransactions } from '../store.js';
import { bindTxRows, emptyState, lookups, txRow } from '../ui/components.js';

export const title = 'Movimenti';

// Filtri ricordati finché l'app resta aperta.
const ui = { ym: currentMonth(), q: '', account: '', review: false };

export function render(el, data) {
  const maps = lookups(data);
  const accounts = data.accounts.filter((a) => !a.archived || a.id === ui.account);
  const toReview = data.transactions.filter((t) => t.toReview);
  if (!toReview.length) ui.review = false;
  if (location.hash.endsWith('?rivedi') && toReview.length) {
    ui.review = true;
    history.replaceState(null, '', '#/movimenti');
  }

  el.innerHTML = `
    <header class="page-header with-action"><h1>Movimenti</h1><a class="pill-btn" href="#/importa">⬇︎ Importa</a></header>
    ${
      toReview.length
        ? `<button type="button" class="review-chip ${ui.review ? 'on' : ''}" id="review">
            🔔 ${toReview.length} dalla banca da rivedere${ui.review ? ' · mostra tutti' : ''}
          </button>`
        : ''
    }
    ${
      ui.review
        ? `<p class="hint-text">Questi movimenti non avevano una regola: sono finiti in «Altro». Toccane uno, scegli la categoria e salva.</p>
           <section class="card flush rows" id="review-list">${sortTransactions(toReview).map((t) => txRow(t, maps)).join('')}</section>`
        : ''
    }
    <div class="month-nav" ${ui.review ? 'hidden' : ''}>
      <button class="icon-btn" data-shift="-1" aria-label="Mese precedente">‹</button>
      <strong>${monthLabel(ui.ym)}</strong>
      <button class="icon-btn" data-shift="1" aria-label="Mese successivo">›</button>
    </div>
    <div class="filters" ${ui.review ? 'hidden' : ''}>
      <input type="search" id="q" placeholder="Cerca" value="${esc(ui.q)}" aria-label="Cerca nei movimenti">
      <select id="acc" aria-label="Filtra per conto">
        <option value="">Tutti i conti</option>
        ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === ui.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      </select>
    </div>
    <div id="list" ${ui.review ? 'hidden' : ''}></div>`;

  el.querySelector('#review')?.addEventListener('click', () => {
    ui.review = !ui.review;
    render(el, data);
  });
  const reviewList = el.querySelector('#review-list');
  if (reviewList) bindTxRows(reviewList, data);

  const listEl = el.querySelector('#list');

  function draw() {
    const q = ui.q.trim().toLowerCase();
    const items = sortTransactions(data.transactions).filter((t) => {
      if (!t.date.startsWith(ui.ym)) return false;
      if (ui.account && t.accountId !== ui.account && t.toAccountId !== ui.account) return false;
      if (!q) return true;
      const haystack = [t.note, maps.cat.get(t.categoryId)?.name, maps.acc.get(t.accountId)?.name, maps.acc.get(t.toAccountId)?.name]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    if (!items.length) {
      listEl.innerHTML = emptyState('🔎', q ? 'Nessun movimento trovato.' : 'Nessun movimento in questo mese.');
      return;
    }

    let income = 0;
    let expense = 0;
    const days = new Map();
    for (const t of items) {
      const v = signedAmount(t, ui.account || undefined);
      if (t.type !== 'transfer' || ui.account) v > 0 ? (income += v) : (expense -= v);
      if (!days.has(t.date)) days.set(t.date, []);
      days.get(t.date).push(t);
    }

    listEl.innerHTML = `
      <div class="summary-line">
        <span>Entrate <strong class="pos">${euro(income)}</strong></span>
        <span>Uscite <strong class="neg">${euro(expense)}</strong></span>
      </div>
      ${[...days]
        .map(([date, list]) => {
          const net = list.reduce((s, t) => s + signedAmount(t, ui.account || undefined), 0);
          return `
          <section class="day">
            <h2 class="day-head"><span>${dayLabel(date)}</span><span class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${euro(net, { sign: true })}</span></h2>
            <div class="card flush rows">${list.map((t) => txRow(t, maps, ui.account)).join('')}</div>
          </section>`;
        })
        .join('')}`;
    bindTxRows(listEl, data);
  }

  el.querySelectorAll('[data-shift]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.ym = shiftMonth(ui.ym, Number(b.dataset.shift));
      render(el, data);
    }),
  );
  el.querySelector('#q').addEventListener('input', (e) => {
    ui.q = e.target.value;
    draw();
  });
  el.querySelector('#acc').addEventListener('change', (e) => {
    ui.account = e.target.value;
    draw();
  });

  draw();
}
