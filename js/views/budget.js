import {
  amountToInput, currentMonth, daysInMonth, esc, euro, firstGrapheme, monthLabel, parseAmount, parseISODate, shiftMonth, toISODate,
} from '../format.js';
import { fixedStillDue } from '../recurring.js';
import { averageSpending, budgetStatus, deleteGoal, saveCategories, saveGoal } from '../store.js';
import { refresh, state } from '../state.js';
import { budgetBar, emptyState, pageHeader } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { openSheet, showError, toast } from '../ui/sheet.js';

export const title = 'Budget';

const ui = { ym: currentMonth() };

export function render(el, data) {
  const { rows, unbudgeted, totalBudget, totalSpent } = budgetStatus(data.categories, data.transactions, ui.ym);
  const isCurrent = ui.ym === currentMonth();
  const left = totalBudget - totalSpent;

  let pace = '';
  if (isCurrent && totalBudget > 0) {
    const daysLeft = daysInMonth(ui.ym) - new Date().getDate() + 1;
    pace =
      left > 0
        ? `Vuol dire circa <strong>${euro(Math.floor(left / daysLeft))} al giorno</strong> per ${daysLeft === 1 ? "l'ultimo giorno" : `i prossimi ${daysLeft} giorni`}.`
        : 'Hai già usato tutto il budget del mese: da qui in poi ogni spesa lo supera.';
  }

  // Spese fisse (ricorrenti) che devono ancora arrivare questo mese: soldi già "impegnati".
  let fixed = '';
  if (isCurrent) {
    const due = fixedStillDue(data.recurring);
    if (due.total > 0) {
      fixed = `<p class="pace">${icon('repeat')}<span>Ti restano da pagare <strong>${euro(due.total)}</strong> di spese fisse${
        due.names.length ? ` (${esc(due.names.slice(0, 3).join(', '))}${due.names.length > 3 ? '…' : ''})` : ''
      }: tienine conto.</span></p>`;
    }
  }

  el.innerHTML = `
    ${pageHeader('Budget', { sub: 'Quanto vuoi spendere, e quanto ti resta' })}
    <div class="month-nav">
      <button class="icon-btn" data-shift="-1" aria-label="Mese precedente">${icon('chevron-left')}</button>
      <strong>${monthLabel(ui.ym)}</strong>
      <button class="icon-btn" data-shift="1" aria-label="Mese successivo">${icon('chevron-right')}</button>
    </div>

    ${
      totalBudget > 0
        ? `<section class="card">
            <p class="budget-headline">${
              left >= 0
                ? `${isCurrent ? 'Puoi ancora spendere' : 'Ti sono avanzati'} <strong>${euro(left)}</strong>`
                : `Hai sforato di <strong class="neg">${euro(-left)}</strong>`
            }</p>
            ${budgetBar(totalSpent, totalBudget)}
            <p class="muted small">${euro(totalSpent)} spesi su ${euro(totalBudget)} di budget</p>
            ${pace ? `<p class="pace">${icon('info')}<span>${pace}</span></p>` : ''}
            ${fixed}
          </section>

          <section class="card flush rows">
            ${rows.map((r) => budgetRow(r.category, r.spent, r.budget)).join('')}
          </section>`
        : `<section class="card">${emptyState(
            'target',
            'Nessun budget impostato',
            'Decidi quanto vuoi spendere al mese per ogni categoria: Tasca ti avvisa quando ti avvicini al limite.',
          )}</section>`
    }

    <button class="btn ${totalBudget > 0 ? 'secondary' : 'primary'} block" id="edit-budgets">${icon(totalBudget > 0 ? 'note' : 'target')}${totalBudget > 0 ? 'Modifica i budget' : 'Imposta i budget'}</button>

    ${
      unbudgeted.length
        ? `<h2 class="section-title">Spese senza budget</h2>
          <section class="card flush rows">
            ${unbudgeted
              .map(
                ({ category: c, spent }) => `
              <button class="row" data-budget-cat>
                <span class="row-icon emoji" style="--c:${esc(c.color)}">${esc(c.icon)}</span>
                <span class="row-main"><span class="row-title">${esc(c.name)}</span><span class="row-sub">Nessun limite · tocca per impostarlo</span></span>
                <span class="row-amount">${euro(spent)}</span>
              </button>`,
              )
              .join('')}
          </section>`
        : ''
    }

    <h2 class="section-title">Obiettivi di risparmio</h2>
    ${
      data.goals.length
        ? `<div class="goals">${data.goals.map(goalCard).join('')}</div>`
        : `<p class="hint-text">Stai mettendo da parte soldi per qualcosa (una vacanza, un telefono nuovo)? Crea un obiettivo e segui i progressi.</p>`
    }
    <button class="btn secondary block" id="add-goal">${icon('flag')}Nuovo obiettivo</button>`;

  el.querySelectorAll('[data-shift]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.ym = shiftMonth(ui.ym, Number(b.dataset.shift));
      render(el, data);
    }),
  );
  el.querySelector('#edit-budgets').addEventListener('click', () => openBudgetSheet(ui.ym));
  el.querySelectorAll('[data-budget-cat]').forEach((b) => b.addEventListener('click', () => openBudgetSheet(ui.ym)));
  el.querySelector('#add-goal').addEventListener('click', () => openGoalSheet(null));
  el.querySelectorAll('[data-goal]').forEach((b) =>
    b.addEventListener('click', () => openGoalSheet(data.goals.find((g) => g.id === b.dataset.goal))),
  );
}

function budgetRow(c, spent, budget) {
  const left = budget - spent;
  return `
    <div class="budget-row">
      <span class="row-icon emoji" style="--c:${esc(c.color)}">${esc(c.icon)}</span>
      <div class="budget-main">
        <div class="budget-line">
          <span class="row-title">${esc(c.name)}</span>
          <span class="budget-nums"><strong>${euro(spent)}</strong> <span class="muted">/ ${euro(budget)}</span></span>
        </div>
        ${budgetBar(spent, budget)}
        <span class="row-sub ${left < 0 ? 'neg' : ''}">${left >= 0 ? `Ancora ${euro(left)} da spendere` : `Sforato di ${euro(-left)}`}</span>
      </div>
    </div>`;
}

function goalPlan(g) {
  const missing = g.target - g.saved;
  if (missing <= 0) return 'Obiettivo raggiunto!';
  if (!g.deadline) return `Mancano ${euro(missing)}`;
  const days = (parseISODate(g.deadline) - parseISODate(toISODate())) / 864e5;
  if (days < 0) return `Mancano ${euro(missing)} · scadenza superata`;
  const months = Math.max(1, Math.ceil(days / 30.44));
  return `Mancano ${euro(missing)} · circa ${euro(Math.ceil(missing / months))} al mese`;
}

function goalCard(g) {
  const pct = g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
  return `
    <button class="card goal" data-goal="${esc(g.id)}">
      <div class="goal-head">
        <span class="goal-icon">${esc(g.icon || '🎯')}</span>
        <span class="row-main"><span class="row-title">${esc(g.name)}</span><span class="row-sub">${goalPlan(g)}</span></span>
        <span class="goal-pct">${pct}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill level-goal" style="width:${pct}%"></div></div>
      <div class="goal-nums"><span>${euro(g.saved)}</span><span class="muted">di ${euro(g.target)}</span></div>
    </button>`;
}

function openBudgetSheet(ym) {
  const { categories, transactions } = state.data;
  const list = categories.filter((c) => c.kind === 'expense' && !c.archived);

  openSheet({
    title: 'Budget mensili',
    body: `
      <p class="hint-text">Scrivi quanto vuoi spendere al mese per ogni categoria; lascia vuoto per non mettere limiti. Il numero in grigio è quanto spendi di solito.</p>
      <div class="fields">
        ${list
          .map((c) => {
            const avg = averageSpending(transactions, c.id, ym);
            return `
            <label class="field">
              <span class="field-cat"><span>${esc(c.icon)}</span> ${esc(c.name)}</span>
              <input data-id="${esc(c.id)}" inputmode="decimal" placeholder="${avg > 0 ? amountToInput(avg) : '—'}"
                value="${c.budget > 0 ? amountToInput(c.budget) : ''}" aria-label="Budget ${esc(c.name)}">
            </label>`;
          })
          .join('')}
      </div>
      <p class="form-error" hidden></p>`,
    footer: '<button type="button" class="btn primary block" id="b-save">Salva i budget</button>',
    onMount(el, close) {
      el.querySelector('#b-save').addEventListener('click', async () => {
        const updated = [];
        for (const input of el.querySelectorAll('input[data-id]')) {
          const c = list.find((x) => x.id === input.dataset.id);
          const raw = input.value.trim();
          const budget = raw ? parseAmount(raw) : null;
          if (raw && !(budget > 0)) {
            input.focus();
            return showError(el, `Importo non valido per «${c.name}»`);
          }
          if ((c.budget ?? null) !== budget) updated.push({ ...c, budget });
        }
        await saveCategories(updated);
        close();
        toast('Budget salvati');
        await refresh();
      });
    },
  });
}

function openGoalSheet(goal) {
  openSheet({
    title: goal ? goal.name : 'Nuovo obiettivo',
    body: `
      ${
        goal
          ? `<div class="goal-move">
              <input id="g-move" inputmode="decimal" placeholder="Importo" aria-label="Importo da aggiungere o togliere">
              <button type="button" class="btn secondary" data-move="-1">Togli</button>
              <button type="button" class="btn primary" data-move="1">Aggiungi</button>
            </div>
            <p class="hint-text">Hai messo da parte <strong>${euro(goal.saved)}</strong> su ${euro(goal.target)}. Scrivi un importo e tocca <strong>Aggiungi</strong> quando ne metti da parte altri.</p>
            <p class="field-label">Modifica l'obiettivo</p>`
          : ''
      }
      <div class="fields">
        <label class="field"><span>Icona</span><input id="g-icon" class="emoji-input" maxlength="8" placeholder="🎯" value="${esc(goal?.icon ?? '')}"></label>
        <label class="field"><span>Nome</span><input id="g-name" maxlength="40" placeholder="Es. Vacanze estive" value="${esc(goal?.name ?? '')}"></label>
        <label class="field"><span>Obiettivo</span><input id="g-target" inputmode="decimal" placeholder="0,00" value="${goal ? amountToInput(goal.target) : ''}"></label>
        ${goal ? '' : '<label class="field"><span>Già da parte</span><input id="g-saved" inputmode="decimal" placeholder="0,00"></label>'}
        <label class="field"><span>Entro il</span><input type="date" id="g-deadline" value="${esc(goal?.deadline ?? '')}"></label>
      </div>
      <p class="hint-text">La data è facoltativa: se la indichi, Tasca calcola quanto mettere da parte ogni mese.</p>
      <p class="form-error" hidden></p>
      ${goal ? `<button type="button" class="btn danger-text block" id="g-delete">${icon('trash')}Elimina obiettivo</button>` : ''}`,
    footer: `<button type="button" class="btn ${goal ? 'secondary' : 'primary'} block" id="g-save">${goal ? 'Salva modifiche' : 'Crea obiettivo'}</button>`,
    onMount(el, close) {
      el.querySelectorAll('[data-move]').forEach((b) =>
        b.addEventListener('click', async () => {
          const amount = parseAmount(el.querySelector('#g-move').value);
          if (!(amount > 0)) return showError(el, 'Inserisci un importo, ad esempio 50');
          const saved = Math.max(0, goal.saved + Number(b.dataset.move) * amount);
          await saveGoal({ ...goal, saved });
          close();
          toast(saved >= goal.target && goal.saved < goal.target ? 'Obiettivo raggiunto! 🎉' : 'Obiettivo aggiornato');
          await refresh();
        }),
      );

      el.querySelector('#g-save').addEventListener('click', async () => {
        const name = el.querySelector('#g-name').value.trim();
        const target = parseAmount(el.querySelector('#g-target').value);
        const savedRaw = el.querySelector('#g-saved')?.value.trim();
        const saved = savedRaw ? parseAmount(savedRaw) : (goal?.saved ?? 0);
        if (!name) return showError(el, "Dai un nome all'obiettivo");
        if (!(target > 0)) return showError(el, "Inserisci quanto vuoi mettere da parte");
        if (!(saved >= 0)) return showError(el, 'Importo già da parte non valido');
        const emoji = el.querySelector('#g-icon').value.trim();
        await saveGoal({
          ...goal,
          name,
          icon: firstGrapheme(emoji) || '🎯',
          target,
          saved,
          deadline: el.querySelector('#g-deadline').value || null,
        });
        close();
        toast(goal ? 'Obiettivo aggiornato' : 'Obiettivo creato');
        await refresh();
      });

      el.querySelector('#g-delete')?.addEventListener('click', async () => {
        if (!confirm(`Eliminare l'obiettivo «${goal.name}»?`)) return;
        await deleteGoal(goal.id);
        close();
        toast('Obiettivo eliminato');
        await refresh();
      });
    },
  });
}
