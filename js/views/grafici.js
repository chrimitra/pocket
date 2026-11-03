import { averageExpenseToDay, averages, categoryTotals, dailyBalance, monthlyTotals, periodMonths } from '../analytics.js';
import { esc, euro, monthLabel, parseISODate } from '../format.js';
import { columnChart, legend, lineChart } from '../ui/charts.js';
import { emptyState, lookups } from '../ui/components.js';

export const title = 'Grafici';

const PERIODS = [
  ['3', '3 mesi'],
  ['6', '6 mesi'],
  ['12', '12 mesi'],
  ['all', 'Tutto'],
];
const SERIES = [
  { name: 'Entrate', cls: 's1' },
  { name: 'Uscite', cls: 's2' },
];
const TOP_CATEGORIES = 7;

const ui = { period: '6', table: false };
let redraw = null;

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => redraw?.(), 150);
});

const monthShort = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Intl.DateTimeFormat('it-IT', { month: 'short' }).format(new Date(y, m - 1, 1));
  return m === 1 ? `${s} ${String(y).slice(2)}` : s;
};
const longDate = (iso) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseISODate(iso));
const pct = (r) => `${Math.round(r * 100)}%`;

export function render(el, data) {
  redraw = null;
  if (!data.transactions.length) {
    el.innerHTML = `
      <header class="page-header"><h1>Grafici</h1></header>
      <section class="card">${emptyState('📈', 'I grafici compariranno quando avrai registrato qualche movimento.')}</section>`;
    return;
  }

  const months = periodMonths(data.transactions, ui.period);
  const rows = monthlyTotals(data.transactions, months);
  const avg = averages(rows);
  const current = rows[rows.length - 1];
  const balance = dailyBalance(data.accounts, data.transactions, `${months[0]}-01`);
  const change = balance[balance.length - 1].value - balance[0].value;
  const cats = categoryTotals(data.transactions, months);
  const catTotal = cats.reduce((s, c) => s + c.total, 0);
  const maps = lookups(data);
  const periodName = months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} – ${monthLabel(current.ym)}`;

  // Uscite del mese in corso rispetto al solito ritmo allo stesso giorno: spendere di più è un segnale negativo.
  let delta = '';
  const usual = averageExpenseToDay(data.transactions, rows.slice(0, -1).map((r) => r.ym), new Date().getDate());
  if (usual > 0) {
    const r = current.expense / usual - 1;
    delta =
      Math.abs(r) < 0.03
        ? '<span class="delta">in linea con il solito</span>'
        : `<span class="delta ${r > 0 ? 'neg' : 'pos'}">${r > 0 ? '▲' : '▼'} ${pct(Math.abs(r))} ${r > 0 ? 'più' : 'meno'} del solito</span>`;
    delta += '<span class="delta">rispetto allo stesso giorno dei mesi scorsi</span>';
  }
  const avgNote = avg.months === 1 ? 'su 1 mese' : `media di ${avg.months} mesi conclusi`;

  el.innerHTML = `
    <header class="page-header"><h1>Grafici</h1></header>
    <div class="segmented period" role="radiogroup" aria-label="Periodo">
      ${PERIODS.map(([v, l]) => `<button type="button" role="radio" data-period="${v}" aria-checked="${v === ui.period}">${l}</button>`).join('')}
    </div>

    <section class="tiles">
      <div class="tile"><span class="tile-label">Uscite di ${monthLabel(current.ym).split(' ')[0].toLowerCase()} finora</span><strong>${euro(current.expense)}</strong>${delta}</div>
      <div class="tile"><span class="tile-label">Uscite medie al mese</span><strong>${euro(avg.expense)}</strong><span class="delta">${avgNote}</span></div>
      <div class="tile"><span class="tile-label">Risparmio medio al mese</span><strong class="${avg.saved < 0 ? 'neg' : ''}">${euro(avg.saved)}</strong><span class="delta">${avgNote}</span></div>
      <div class="tile"><span class="tile-label">Tasso di risparmio</span><strong>${avg.rate === null ? '—' : pct(avg.rate)}</strong><span class="delta">delle entrate</span></div>
    </section>

    <section class="card">
      <h2 class="card-title">Andamento del saldo</h2>
      <p class="card-sub">${change >= 0 ? 'Aumentato' : 'Diminuito'} di <strong>${euro(Math.abs(change))}</strong> da inizio periodo</p>
      <div id="balance-chart"></div>
    </section>

    <section class="card">
      <h2 class="card-title">Entrate e uscite</h2>
      <p class="card-sub">${esc(periodName)}</p>
      ${legend(SERIES)}
      <div id="months-chart"></div>
      <button type="button" class="text-btn" id="toggle-table">${ui.table ? 'Nascondi tabella' : 'Mostra tabella'}</button>
      ${
        ui.table
          ? `<table class="data-table">
              <thead><tr><th>Mese</th><th>Entrate</th><th>Uscite</th><th>Risparmio</th></tr></thead>
              <tbody>${[...rows]
                .reverse()
                .map(
                  (r) => `<tr><td>${monthLabel(r.ym)}</td><td>${euro(r.income)}</td><td>${euro(r.expense)}</td>
                    <td class="${r.income - r.expense < 0 ? 'neg' : ''}">${euro(r.income - r.expense)}</td></tr>`,
                )
                .join('')}</tbody>
            </table>`
          : ''
      }
    </section>

    <section class="card">
      <h2 class="card-title">Spese per categoria</h2>
      <p class="card-sub">${esc(periodName)} · totale ${euro(catTotal)}</p>
      ${cats.length ? categoryBars(cats, catTotal, maps, months.length) : '<p class="muted">Nessuna spesa nel periodo.</p>'}
    </section>`;

  el.querySelectorAll('[data-period]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.period = b.dataset.period;
      render(el, data);
    }),
  );
  el.querySelector('#toggle-table').addEventListener('click', () => {
    ui.table = !ui.table;
    render(el, data);
  });

  const single = months.length === 1;
  const balancePoints = balance.map((p) => {
    const day = Number(p.date.slice(8));
    let tick = '';
    if (single) tick = day % 7 === 1 ? String(day) : '';
    else if (day === 1) tick = monthShort(p.date.slice(0, 7));
    return { value: p.value, label: longDate(p.date), tick };
  });
  const groups = rows.map((r) => ({
    tick: monthShort(r.ym),
    label: monthLabel(r.ym),
    values: [r.income, r.expense],
    extra: `Risparmio ${euro(r.income - r.expense)}`,
  }));

  redraw = () => {
    lineChart(el.querySelector('#balance-chart'), {
      points: balancePoints,
      format: euro,
      ariaLabel: `Saldo totale giorno per giorno, ${periodName}. Ultimo valore ${euro(balancePoints.at(-1).value)}.`,
    });
    columnChart(el.querySelector('#months-chart'), {
      groups,
      series: SERIES,
      format: euro,
      ariaLabel: `Entrate e uscite per mese, ${periodName}. I valori sono anche nella tabella.`,
    });
  };
  redraw();
}

function categoryBars(cats, total, maps, monthCount) {
  const top = cats.slice(0, TOP_CATEGORIES);
  const rest = cats.slice(TOP_CATEGORIES).reduce((s, c) => s + c.total, 0);
  const items = top.map((c) => {
    const cat = maps.cat.get(c.categoryId);
    return { icon: cat?.icon ?? '•', name: cat?.name ?? 'Senza categoria', total: c.total };
  });
  if (rest) items.push({ icon: '⋯', name: 'Altre categorie', total: rest });
  const max = items[0].total;
  return `<ul class="hbars">${items
    .map(
      (it) => `
      <li>
        <div class="hbar-label"><span>${esc(it.icon)} ${esc(it.name)}</span><span class="muted">${pct(it.total / total)}</span></div>
        <div class="hbar-row">
          <div class="hbar-track"><div class="hbar" style="width:${Math.max(1, (it.total / max) * 100)}%"></div></div>
          <strong>${euro(it.total)}</strong>
        </div>
        ${monthCount > 1 ? `<span class="hbar-sub">${euro(Math.round(it.total / monthCount))} al mese</span>` : ''}
      </li>`,
    )
    .join('')}</ul>`;
}
