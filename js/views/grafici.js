import { averageExpenseToDay, averages, categoryTotals, dailyBalance, monthlyTotals, periodMonths } from '../analytics.js';
import { esc, euro, monthLabel, parseISODate } from '../format.js';
import { columnChart, legend, lineChart } from '../ui/charts.js';
import { insightList } from '../insights.js';
import { emptyState, lookups, pageHeader } from '../ui/components.js';
import { icon } from '../ui/icons.js';

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
      ${pageHeader('Grafici')}
      <section class="card">${emptyState('chart', 'Ancora niente da mostrare', 'I grafici si riempiono man mano che registri o importi movimenti.')}</section>`;
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
  const monthName = monthLabel(current.ym).split(' ')[0].toLowerCase();

  // Uscite del mese in corso rispetto al solito ritmo allo stesso giorno: spendere di più è un segnale negativo.
  let delta = '';
  const usual = averageExpenseToDay(data.transactions, rows.slice(0, -1).map((r) => r.ym), new Date().getDate());
  if (usual > 0) {
    const r = current.expense / usual - 1;
    delta =
      Math.abs(r) < 0.03
        ? '<span class="delta">come al solito</span>'
        : `<span class="delta ${r > 0 ? 'neg' : 'pos'}">${icon(r > 0 ? 'trend-up' : 'trend-down')}${pct(Math.abs(r))} ${r > 0 ? 'più' : 'meno'} del solito</span>`;
  }
  const avgNote = avg.months === 1 ? 'su 1 mese' : `media di ${avg.months} mesi`;

  el.innerHTML = `
    ${pageHeader('Grafici', { sub: 'Come vanno i tuoi soldi nel tempo' })}
    <div class="segmented period" role="radiogroup" aria-label="Periodo">
      ${PERIODS.map(([v, l]) => `<button type="button" role="radio" data-period="${v}" aria-checked="${v === ui.period}">${l}</button>`).join('')}
    </div>

    ${periodInsights({ rows, avg, change, cats, catTotal, maps, months })}

    <section class="tiles">
      <div class="tile"><span class="tile-label">Spesi a ${monthName} finora</span><strong>${euro(current.expense)}</strong>${delta}</div>
      <div class="tile"><span class="tile-label">Spesi in media al mese</span><strong>${euro(avg.expense)}</strong><span class="delta">${avgNote}</span></div>
      <div class="tile"><span class="tile-label">Messi da parte al mese</span><strong class="${avg.saved < 0 ? 'neg' : ''}">${euro(avg.saved)}</strong><span class="delta">${avgNote}</span></div>
      <div class="tile"><span class="tile-label">Quota risparmiata</span><strong>${avg.rate === null ? '—' : pct(Math.max(0, avg.rate))}</strong><span class="delta">di quello che entra</span></div>
    </section>

    <section class="card">
      <div class="card-head"><h2 class="card-title">Andamento del saldo</h2></div>
      <p class="card-sub">${change === 0 ? 'Stabile' : change > 0 ? 'Cresciuto' : 'Sceso'}${change ? ` di <strong>${euro(Math.abs(change))}</strong>` : ''} da ${monthLabel(months[0]).toLowerCase()}. Tocca il grafico per vedere un giorno.</p>
      <div id="balance-chart"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2 class="card-title">Entrate e uscite</h2></div>
      <p class="card-sub">${esc(periodName)} · tocca una colonna per i dettagli</p>
      ${legend(SERIES)}
      <div id="months-chart"></div>
      <button type="button" class="text-btn" id="toggle-table">${icon(ui.table ? 'chevron-down' : 'chevron-right')}${ui.table ? 'Nascondi i numeri' : 'Mostra i numeri mese per mese'}</button>
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
      <div class="card-head"><h2 class="card-title">Dove sono andati i soldi</h2></div>
      <p class="card-sub">${esc(periodName)} · ${euro(catTotal)} di uscite in tutto</p>
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
    // Se nel frattempo hai cambiato pagina, non c'è niente da ridisegnare.
    if (!el.querySelector('#balance-chart')) return;
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

// Riassunto a parole del periodo scelto.
function periodInsights({ rows, avg, change, cats, catTotal, maps, months }) {
  const items = [];
  if (avg.rate !== null) {
    items.push(
      avg.saved >= 0
        ? { icon: 'piggy', tone: 'good', html: `In media metti da parte <strong>${euro(avg.saved)} al mese</strong>, il ${pct(avg.rate)} di quello che entra.` }
        : { icon: 'alert', tone: 'warn', html: `In media spendi <strong>${euro(-avg.saved)} al mese</strong> più di quanto entra.` },
    );
  }
  if (cats.length && catTotal) {
    const c = maps.cat.get(cats[0].categoryId);
    items.push({
      icon: 'coins',
      tone: '',
      html: `La voce che pesa di più è <strong>${esc(c?.icon ?? '')} ${esc(c?.name ?? 'Senza categoria')}</strong>: ${pct(cats[0].total / catTotal)} delle uscite${
        months.length > 1 ? `, circa ${euro(Math.round(cats[0].total / months.length))} al mese` : ''
      }.`,
    });
  }
  // Confronto tra gli ultimi due mesi conclusi.
  const closed = rows.slice(0, -1).filter((r) => r.expense > 0);
  if (closed.length >= 2) {
    const [prev, last] = closed.slice(-2);
    const r = last.expense / prev.expense - 1;
    if (Math.abs(r) >= 0.05) {
      const name = (ym) => monthLabel(ym).split(' ')[0].toLowerCase();
      items.push({
        icon: r < 0 ? 'trend-down' : 'trend-up',
        tone: r < 0 ? 'good' : 'warn',
        html: `A ${name(last.ym)} hai speso <strong>${pct(Math.abs(r))} ${r < 0 ? 'in meno' : 'in più'}</strong> che a ${name(prev.ym)}.`,
      });
    }
  }
  if (change) {
    items.push({
      icon: change > 0 ? 'trend-up' : 'trend-down',
      tone: change > 0 ? 'good' : 'warn',
      html: `Da ${monthLabel(months[0]).toLowerCase()} il saldo totale è ${change > 0 ? 'cresciuto' : 'sceso'} di <strong>${euro(Math.abs(change))}</strong>.`,
    });
  }
  if (!items.length) return '';
  return `<section class="card">
    <div class="card-head"><h2 class="card-title">${icon('sparkles')}In breve</h2></div>
    ${insightList(items.slice(0, 3))}
  </section>`;
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
        <div class="hbar-label"><span>${esc(it.icon)} ${esc(it.name)}</span><span class="muted">${pct(it.total / total)} del totale</span></div>
        <div class="hbar-row">
          <div class="hbar-track"><div class="hbar" style="width:${Math.max(1, (it.total / max) * 100)}%"></div></div>
          <strong>${euro(it.total)}</strong>
        </div>
        ${monthCount > 1 ? `<span class="hbar-sub">${euro(Math.round(it.total / monthCount))} al mese</span>` : ''}
      </li>`,
    )
    .join('')}</ul>`;
}
