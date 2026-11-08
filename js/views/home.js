import { dailyBalance } from '../analytics.js';
import { daysLeft, RENEW_WARNING_DAYS } from '../bank.js';
import { currentMonth, esc, euro, monthLabel, toISODate } from '../format.js';
import { insightList, monthInsights } from '../insights.js';
import { balances, budgetLevel, budgetStatus, monthSummary, sortTransactions } from '../store.js';
import { bindTxRows, budgetBar, emptyState, lookups, txRow } from '../ui/components.js';
import { ACCOUNT_ICONS, icon } from '../ui/icons.js';
import { openTransactionSheet } from '../ui/transaction-sheet.js';

export const title = 'Home';
const TREND_DAYS = 30;

export function render(el, data) {
  const { accounts, transactions } = data;
  const maps = lookups(data);
  const bal = balances(accounts, transactions);
  const active = accounts.filter((a) => !a.archived);
  const total = active.reduce((sum, a) => sum + bal.get(a.id), 0);
  const ym = currentMonth();
  const month = monthLabel(ym).split(' ')[0];
  const { income, expense, byCategory } = monthSummary(transactions, ym);
  const top = [...byCategory].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const recent = sortTransactions(transactions).slice(0, 5);
  const isFresh = !transactions.length && active.every((a) => !a.initialBalance);
  const insights = isFresh ? [] : monthInsights(data, 3);

  el.innerHTML = `
    <header class="home-top">
      <div>
        <p class="greeting">${greeting()}</p>
        <h1 class="home-title">I tuoi soldi</h1>
      </div>
      <a class="icon-btn raised" href="#/altro" aria-label="Impostazioni, conti e categorie">${icon('settings')}</a>
    </header>

    <section class="hero-card">
      <p class="hero-label">Hai in totale</p>
      <p class="hero-amount">${euro(total)}</p>
      ${trend(data, total)}
    </section>

    <div class="account-strip" role="list">
      ${active
        .map(
          (a) => `
        <a class="account-chip" href="#/conti" role="listitem">
          <span class="account-icon">${icon(ACCOUNT_ICONS[a.type] ?? 'wallet')}</span>
          <span class="account-text"><span>${esc(a.name)}</span><strong class="${bal.get(a.id) < 0 ? 'neg' : ''}">${euro(bal.get(a.id))}</strong></span>
        </a>`,
        )
        .join('')}
    </div>

    ${bankNotices(data)}

    ${
      isFresh
        ? `<section class="card onboarding">
            <span class="onboarding-icon">${icon('sparkles')}</span>
            <h2>Benvenuto in Tasca</h2>
            <p>Per iniziare dimmi quanto c'è adesso sui tuoi conti: da lì Tasca terrà il conto per te.</p>
            <a class="btn primary" href="#/conti">Imposta i saldi</a>
          </section>`
        : `<section class="card">
            <div class="card-head"><h2 class="card-title">${esc(month)} finora</h2></div>
            <div class="flow">
              <div class="flow-item in">${icon('arrow-in')}<span>Entrate</span><strong>${euro(income)}</strong></div>
              <div class="flow-item out">${icon('arrow-out')}<span>Uscite</span><strong>${euro(expense)}</strong></div>
            </div>
            ${insights.length ? insightList(insights) : '<p class="muted small">Registra qualche movimento e qui vedrai come sta andando il mese.</p>'}
          </section>`
    }

    ${isFresh ? '' : budgetCard(data, ym)}

    ${
      top.length
        ? `<section class="card">
            <div class="card-head"><h2 class="card-title">Dove vanno i soldi</h2><a class="card-link" href="#/grafici">Grafici ${icon('chevron-right')}</a></div>
            <ul class="bars">${top
              .map(([id, v]) => {
                const c = maps.cat.get(id);
                const pct = Math.round((v / expense) * 100);
                return `
                <li>
                  <div class="bar-label"><span>${esc(c?.icon ?? '•')} ${esc(c?.name ?? 'Senza categoria')}</span><strong>${euro(v)}</strong></div>
                  <div class="bar-row"><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, pct)}%"></div></div><span class="bar-pct">${pct}%</span></div>
                </li>`;
              })
              .join('')}</ul>
          </section>`
        : ''
    }

    <section class="card flush">
      <div class="card-head padded"><h2 class="card-title">Ultimi movimenti</h2>${recent.length ? `<a class="card-link" href="#/movimenti">Tutti ${icon('chevron-right')}</a>` : ''}</div>
      ${
        recent.length
          ? `<div class="rows">${recent.map((t) => txRow(t, maps)).join('')}</div>`
          : emptyState(
              'receipt',
              'Ancora nessun movimento',
              'Ogni volta che paghi, tocca + e registra la spesa: bastano pochi secondi.',
              '<button type="button" class="btn primary" id="first-tx">Aggiungi il primo</button>',
            )
      }
    </section>`;

  bindTxRows(el, data);
  el.querySelector('#first-tx')?.addEventListener('click', () => openTransactionSheet());
}

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

// Mini grafico dell'andamento del saldo negli ultimi 30 giorni, con la variazione scritta a parole.
function trend(data, total) {
  if (!data.transactions.length) return '';
  const from = toISODate(new Date(Date.now() - (TREND_DAYS - 1) * 864e5));
  const points = dailyBalance(data.accounts, data.transactions, from);
  if (points.length < 2) return '';
  const change = total - points[0].value;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = 300;
  const h = 56;
  const y = (v) => (max === min ? h / 2 : h - 4 - ((v - min) / (max - min)) * (h - 8));
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const sentence =
    change === 0
      ? 'Stabile negli ultimi 30 giorni'
      : `${change > 0 ? '+' : '−'}${euro(Math.abs(change))} negli ultimi 30 giorni`;
  return `
    <div class="hero-trend">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${path}L${w},${h}L0,${h}Z" class="spark-area"/>
        <path d="${path}" class="spark-line"/>
      </svg>
      <p class="hero-change ${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${icon(change >= 0 ? 'trend-up' : 'trend-down')}${sentence}</p>
    </div>`;
}

// Avvisi sul collegamento con la banca: consenso in scadenza e movimenti da rivedere.
function bankNotices(data) {
  const notes = [];
  for (const c of data.bank?.connections ?? []) {
    const left = daysLeft(c);
    if (left === null || left > RENEW_WARNING_DAYS) continue;
    notes.push(`<a class="card notice ${left < 0 ? 'over' : 'warn'}" href="#/banca">
      <span class="notice-icon">${icon('alert')}</span>
      <span><strong>${left < 0 ? 'Collegamento con la banca scaduto' : `Il collegamento con la banca scade tra ${left} ${left === 1 ? 'giorno' : 'giorni'}`}</strong>
      <span>Tocca per rinnovarlo con PosteID: ci vuole un minuto.</span></span>
    </a>`);
  }
  const review = data.transactions.filter((t) => t.toReview).length;
  if (review) {
    notes.push(`<a class="card notice" href="#/movimenti?rivedi">
      <span class="notice-icon">${icon('bell')}</span>
      <span><strong>${review} ${review === 1 ? 'movimento' : 'movimenti'} dalla banca da rivedere</strong>
      <span>${review === 1 ? 'Non aveva' : 'Non avevano'} una regola: scegli tu la categoria.</span></span>
    </a>`);
  }
  return notes.join('');
}

function budgetCard(data, ym) {
  const { rows, totalBudget, totalSpent } = budgetStatus(data.categories, data.transactions, ym);
  if (!totalBudget) {
    return `<a class="card notice tip" href="#/budget">
      <span class="notice-icon">${icon('target')}</span>
      <span><strong>Imposta un budget</strong>
      <span>Decidi quanto vuoi spendere al mese: Tasca ti avvisa quando ti avvicini al limite.</span></span>
    </a>`;
  }
  const left = totalBudget - totalSpent;
  const alerts = rows.filter((r) => budgetLevel(r.ratio) !== 'ok');
  return `
    <a class="card budget-card" href="#/budget">
      <div class="card-head"><h2 class="card-title">Budget del mese</h2><span class="card-link">Dettagli ${icon('chevron-right')}</span></div>
      <p class="budget-headline">${
        left >= 0
          ? `Puoi ancora spendere <strong>${euro(left)}</strong>`
          : `Hai sforato di <strong class="neg">${euro(-left)}</strong>`
      }</p>
      ${budgetBar(totalSpent, totalBudget)}
      <p class="muted small">${euro(totalSpent)} spesi su ${euro(totalBudget)}</p>
      ${
        alerts.length
          ? `<ul class="budget-alerts">${alerts
              .map((r) => {
                const level = budgetLevel(r.ratio);
                return `<li class="${level}">${icon('alert')}<span>${esc(r.category.icon)} ${esc(r.category.name)}: ${
                  level === 'over' ? `sforato di ${euro(r.spent - r.budget)}` : `usato il ${Math.round(r.ratio * 100)}%`
                }</span></li>`;
              })
              .join('')}</ul>`
          : ''
      }
    </a>`;
}
