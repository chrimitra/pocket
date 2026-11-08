// Frasi semplici che spiegano i numeri ("questo mese hai speso meno del solito…").
import { averageExpenseToDay, monthlyTotals } from './analytics.js';
import { currentMonth, daysInMonth, esc, euro, monthLabel, shiftMonth } from './format.js';
import { budgetStatus, monthSummary } from './store.js';
import { icon } from './ui/icons.js';

const pct = (r) => `${Math.round(r * 100)}%`;
const monthName = (ym) => monthLabel(ym).split(' ')[0].toLowerCase();

/**
 * Le osservazioni sul mese in corso, dalla più utile. Ognuna: { icon, tone, html }.
 * tone: 'good' (va bene), 'warn' (attenzione) o '' (informazione).
 */
export function monthInsights(data, max = 3) {
  const ym = currentMonth();
  const today = new Date().getDate();
  const { income, expense, byCategory } = monthSummary(data.transactions, ym);
  const out = [];

  // 1. Ritmo di spesa rispetto ai mesi scorsi, allo stesso giorno del mese.
  const previous = monthlyTotals(data.transactions, [shiftMonth(ym, -3), shiftMonth(ym, -2), shiftMonth(ym, -1)])
    .filter((r) => r.income || r.expense)
    .map((r) => r.ym);
  const usual = averageExpenseToDay(data.transactions, previous, today);
  if (usual > 0 && expense > 0) {
    const r = expense / usual - 1;
    if (Math.abs(r) < 0.05) {
      out.push({ icon: 'check', tone: 'good', html: `Stai spendendo <strong>come al solito</strong> per questo punto del mese.` });
    } else {
      out.push({
        icon: r < 0 ? 'trend-down' : 'trend-up',
        tone: r < 0 ? 'good' : 'warn',
        html: `Finora hai speso <strong>${pct(Math.abs(r))} ${r < 0 ? 'in meno' : 'in più'}</strong> del solito a questo punto del mese.`,
      });
    }
  }

  // 2. Budget: quanto puoi ancora spendere.
  const budget = budgetStatus(data.categories, data.transactions, ym);
  if (budget.totalBudget > 0) {
    const left = budget.totalBudget - budget.totalSpent;
    const daysLeft = daysInMonth(ym) - today + 1;
    out.push(
      left > 0
        ? { icon: 'target', tone: '', html: `Puoi ancora spendere <strong>${euro(left)}</strong>: circa ${euro(Math.floor(left / daysLeft))} al giorno fino a fine mese.` }
        : { icon: 'alert', tone: 'warn', html: `Hai superato il budget del mese di <strong>${euro(-left)}</strong>.` },
    );
  }

  // 3. La voce di spesa più grande.
  const top = [...byCategory].sort((a, b) => b[1] - a[1])[0];
  if (top && expense > 0) {
    const c = data.categories.find((x) => x.id === top[0]);
    out.push({
      icon: 'coins',
      tone: '',
      html: `La spesa più grande di ${monthName(ym)} è <strong>${esc(c?.icon ?? '')} ${esc(c?.name ?? 'Senza categoria')}</strong>: ${euro(top[1])}, il ${pct(top[1] / expense)} delle uscite.`,
    });
  }

  // 4. Quanto stai mettendo da parte.
  if (income > 0) {
    const saved = income - expense;
    out.push(
      saved >= 0
        ? { icon: 'piggy', tone: 'good', html: `Finora hai messo da parte <strong>${euro(saved)}</strong>, il ${pct(saved / income)} di quello che è entrato.` }
        : { icon: 'alert', tone: 'warn', html: `Questo mese sono usciti <strong>${euro(-saved)}</strong> in più di quelli entrati.` },
    );
  }

  return out.slice(0, max);
}

export function insightList(items) {
  return `<ul class="insights">${items
    .map((i) => `<li class="insight ${i.tone}"><span class="insight-icon">${icon(i.icon)}</span><p>${i.html}</p></li>`)
    .join('')}</ul>`;
}
