import { daysLeft, RENEW_WARNING_DAYS } from '../bank.js';
import { currentMonth, esc, euro, monthLabel } from '../format.js';
import { ACCOUNT_TYPES, balances, budgetLevel, budgetStatus, monthSummary, sortTransactions } from '../store.js';
import { bindTxRows, budgetBar, emptyState, lookups, txRow } from '../ui/components.js';

export const title = 'Home';

export function render(el, data) {
  const { accounts, transactions } = data;
  const maps = lookups(data);
  const bal = balances(accounts, transactions);
  const active = accounts.filter((a) => !a.archived);
  const total = active.reduce((sum, a) => sum + bal.get(a.id), 0);
  const ym = currentMonth();
  const { income, expense, byCategory } = monthSummary(transactions, ym);
  const saved = income - expense;
  const top = [...byCategory].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = sortTransactions(transactions).slice(0, 6);
  const isFresh = !transactions.length && active.every((a) => !a.initialBalance);

  el.innerHTML = `
    <header class="hero">
      <a class="settings-btn" href="#/altro" aria-label="Conti, categorie e impostazioni">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></svg>
      </a>
      <p class="eyebrow">Saldo totale</p>
      <h1 class="hero-amount ${total < 0 ? 'neg' : ''}">${euro(total)}</h1>
      <div class="chips">
        ${active
          .map(
            (a) => `
          <a class="chip" href="#/conti">
            <span>${ACCOUNT_TYPES[a.type]?.icon ?? '🏦'} ${esc(a.name)}</span>
            <strong class="${bal.get(a.id) < 0 ? 'neg' : ''}">${euro(bal.get(a.id))}</strong>
          </a>`,
          )
          .join('')}
      </div>
    </header>

    ${bankNotices(data)}

    ${
      isFresh
        ? `<a class="card callout" href="#/conti">
            <strong>Inizia da qui</strong>
            <span>Inserisci quanto c'è adesso sul tuo conto BancoPosta e nei contanti: da lì Tasca terrà il conto per te.</span>
          </a>`
        : ''
    }

    <section class="card">
      <h2 class="card-title">${monthLabel(ym)}</h2>
      <div class="stats">
        <div><span>Entrate</span><strong class="pos">${euro(income)}</strong></div>
        <div><span>Uscite</span><strong class="neg">${euro(expense)}</strong></div>
        <div><span>Risparmio</span><strong class="${saved < 0 ? 'neg' : ''}">${euro(saved)}</strong></div>
      </div>
    </section>

    ${isFresh ? '' : budgetCard(data, ym)}

    <section class="card">
      <div class="card-head flat"><h2 class="card-title">Dove vanno i soldi</h2>${top.length ? '<a href="#/grafici">Grafici</a>' : ''}</div>
      ${
        top.length
          ? `<ul class="bars">${top
              .map(([id, v]) => {
                const c = maps.cat.get(id);
                const pct = Math.max(3, Math.round((v / expense) * 100));
                return `
                <li style="--c:${esc(c?.color ?? '#6C7A89')}">
                  <div class="bar-label"><span>${esc(c?.icon ?? '•')} ${esc(c?.name ?? 'Senza categoria')}</span><strong>${euro(v)}</strong></div>
                  <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                </li>`;
              })
              .join('')}</ul>`
          : '<p class="muted">Nessuna spesa questo mese.</p>'
      }
    </section>

    <section class="card flush">
      <div class="card-head"><h2 class="card-title">Ultimi movimenti</h2>${recent.length ? '<a href="#/movimenti">Vedi tutti</a>' : ''}</div>
      ${
        recent.length
          ? `<div class="rows">${recent.map((t) => txRow(t, maps)).join('')}</div>`
          : emptyState('🧾', 'Ancora nessun movimento.<br>Tocca <strong>+</strong> per aggiungere il primo.')
      }
    </section>`;

  bindTxRows(el, data);
}

// Avvisi sul collegamento con la banca: consenso in scadenza e movimenti da rivedere.
function bankNotices(data) {
  const notes = [];
  for (const c of data.bank?.connections ?? []) {
    const left = daysLeft(c);
    if (left === null || left > RENEW_WARNING_DAYS) continue;
    notes.push(`<a class="card notice ${left < 0 ? 'over' : 'warn'}" href="#/banca">
      <strong>${left < 0 ? 'Collegamento con la banca scaduto' : `Il collegamento con la banca scade tra ${left} ${left === 1 ? 'giorno' : 'giorni'}`}</strong>
      <span>Tocca per rinnovarlo con PosteID: ci vuole un minuto.</span>
    </a>`);
  }
  const review = data.transactions.filter((t) => t.toReview).length;
  if (review) {
    notes.push(`<a class="card notice" href="#/movimenti?rivedi">
      <strong>🔔 ${review} ${review === 1 ? 'movimento' : 'movimenti'} dalla banca da rivedere</strong>
      <span>${review === 1 ? 'Non aveva' : 'Non avevano'} una regola: scegli tu la categoria.</span>
    </a>`);
  }
  return notes.join('');
}

function budgetCard(data, ym) {
  const { rows, totalBudget, totalSpent } = budgetStatus(data.categories, data.transactions, ym);
  if (!totalBudget) {
    return `<a class="card callout" href="#/budget">
      <strong>Imposta un budget</strong>
      <span>Decidi quanto spendere al mese per categoria e tieni sotto controllo le uscite.</span>
    </a>`;
  }
  const left = totalBudget - totalSpent;
  const alerts = rows.filter((r) => budgetLevel(r.ratio) !== 'ok');
  return `
    <a class="card budget-card" href="#/budget">
      <div class="card-head flat"><h2 class="card-title">Budget del mese</h2><span class="link">Dettagli</span></div>
      <div class="budget-line">
        <span>${euro(totalSpent)} <span class="muted">di ${euro(totalBudget)}</span></span>
        <strong class="${left < 0 ? 'neg' : ''}">${left >= 0 ? `Rimangono ${euro(left)}` : `Sforato di ${euro(-left)}`}</strong>
      </div>
      ${budgetBar(totalSpent, totalBudget)}
      ${
        alerts.length
          ? `<ul class="budget-alerts">${alerts
              .map((r) => {
                const level = budgetLevel(r.ratio);
                return `<li class="${level}">${level === 'over' ? '⛔' : '⚠️'} ${esc(r.category.name)}: ${
                  level === 'over' ? `sforato di ${euro(r.spent - r.budget)}` : `${Math.round(r.ratio * 100)}% usato`
                }</li>`;
              })
              .join('')}</ul>`
          : ''
      }
    </a>`;
}
