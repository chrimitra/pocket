import { currentMonth, dayLabel, esc, euro, monthLabel, parseAmount, shiftMonth } from '../format.js';
import { signedAmount, sortTransactions } from '../store.js';
import { bindTxRows, emptyState, lookups, pageHeader, txRow } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { openTransactionSheet } from '../ui/transaction-sheet.js';

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
  const isCurrent = ui.ym === currentMonth();

  el.innerHTML = `
    ${pageHeader('Movimenti', { actions: `<a class="pill-btn" href="#/importa">${icon('download')}Importa</a>` })}
    ${
      toReview.length
        ? `<button type="button" class="review-chip ${ui.review ? 'on' : ''}" id="review">
            ${icon('bell')}${ui.review ? 'Torna a tutti i movimenti' : `${toReview.length} dalla banca da rivedere`}
          </button>`
        : ''
    }
    ${
      ui.review
        ? `<p class="hint-text">Questi movimenti non avevano una regola e sono finiti in «Altro». Toccane uno, scegli la categoria e salva: puoi anche far sì che Tasca se lo ricordi.</p>
           <section class="card flush rows" id="review-list">${sortTransactions(toReview).map((t) => txRow(t, maps)).join('')}</section>`
        : `
    <div class="month-nav">
      <button class="icon-btn" data-shift="-1" aria-label="Mese precedente">${icon('chevron-left')}</button>
      <strong>${monthLabel(ui.ym)}</strong>
      <button class="icon-btn" data-shift="1" aria-label="Mese successivo" ${isCurrent ? 'disabled' : ''}>${icon('chevron-right')}</button>
    </div>
    <label class="search">
      ${icon('search')}
      <input type="search" id="q" placeholder="Cerca per nota, categoria o importo" value="${esc(ui.q)}" aria-label="Cerca nei movimenti">
    </label>
    ${
      accounts.length > 1
        ? `<div class="filter-chips" role="radiogroup" aria-label="Filtra per conto">
            <button type="button" role="radio" data-acc="" aria-checked="${!ui.account}">Tutti</button>
            ${accounts.map((a) => `<button type="button" role="radio" data-acc="${esc(a.id)}" aria-checked="${a.id === ui.account}">${esc(a.name)}</button>`).join('')}
          </div>`
        : ''
    }
    <div id="list"></div>`
    }`;

  el.querySelector('#review')?.addEventListener('click', () => {
    ui.review = !ui.review;
    render(el, data);
  });
  const reviewList = el.querySelector('#review-list');
  if (reviewList) bindTxRows(reviewList, data);
  if (ui.review) return;

  const listEl = el.querySelector('#list');

  function draw() {
    const q = ui.q.trim().toLowerCase();
    // Se scrivi un numero ("23,90") cerca anche per importo.
    const qAmount = /\d/.test(q) ? parseAmount(q) : NaN;
    const items = sortTransactions(data.transactions).filter((t) => {
      if (!t.date.startsWith(ui.ym)) return false;
      if (ui.account && t.accountId !== ui.account && t.toAccountId !== ui.account) return false;
      if (!q) return true;
      if (Math.abs(qAmount) === t.amount) return true;
      const haystack = [t.note, t.bankDescription, maps.cat.get(t.categoryId)?.name, maps.acc.get(t.accountId)?.name, maps.acc.get(t.toAccountId)?.name]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    if (!items.length) {
      listEl.innerHTML = q
        ? emptyState('search', 'Nessun risultato', `Nessun movimento di ${monthLabel(ui.ym).toLowerCase()} corrisponde a «${esc(ui.q)}».`)
        : emptyState(
            'receipt',
            `Nessun movimento a ${monthLabel(ui.ym).split(' ')[0].toLowerCase()}`,
            isCurrent ? 'Tocca + per registrare la prima spesa del mese.' : 'Prova un altro mese con le frecce qui sopra.',
            isCurrent ? '<button type="button" class="btn primary" id="first-tx">Aggiungi movimento</button>' : '',
          );
      listEl.querySelector('#first-tx')?.addEventListener('click', () => openTransactionSheet());
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
      <div class="month-totals">
        <div class="in">${icon('arrow-in')}<span>Entrate</span><strong>${euro(income)}</strong></div>
        <div class="out">${icon('arrow-out')}<span>Uscite</span><strong>${euro(expense)}</strong></div>
      </div>
      ${[...days]
        .map(([date, list]) => {
          const net = list.reduce((s, t) => s + signedAmount(t, ui.account || undefined), 0);
          return `
          <section class="day">
            <h2 class="day-head"><span>${dayLabel(date)}</span>${net ? `<span class="${net < 0 ? '' : 'pos'}">${euro(net, { sign: true })}</span>` : ''}</h2>
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
  el.querySelectorAll('[data-acc]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.account = b.dataset.acc;
      el.querySelectorAll('[data-acc]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      draw();
    }),
  );

  draw();
}
