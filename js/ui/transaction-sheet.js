// Modulo per creare o modificare un movimento (uscita, entrata, trasferimento).
import { amountToInput, esc, euro, parseAmount, toISODate } from '../format.js';
import { guessKeyword, ruleMatches } from '../rules.js';
import { budgetLevel, deleteTransaction, monthSummary, saveRule, saveTransaction, saveTransactions } from '../store.js';
import { refresh, state } from '../state.js';
import { openSheet, showError, toast } from './sheet.js';

const LAST_ACCOUNT_KEY = 'tasca:lastAccount';

function lastAccount() {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function rememberAccount(id) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Memoria del browser non disponibile: pazienza.
  }
}

// Dopo una spesa: avvisa se la sua categoria è oltre l'80% del budget del mese.
function budgetAlert(categoryId, ym) {
  const category = state.data.categories.find((c) => c.id === categoryId);
  if (!(category?.budget > 0)) return null;
  const { byCategory } = monthSummary(state.data.transactions, ym);
  const spent = byCategory.get(categoryId) || 0;
  const level = budgetLevel(spent / category.budget);
  if (level === 'ok') return null;
  const message =
    level === 'over'
      ? `Budget «${category.name}» superato di ${euro(spent - category.budget)}`
      : `«${category.name}»: ${Math.round((spent / category.budget) * 100)}% del budget usato`;
  return { level, message };
}

export function openTransactionSheet(tx = null) {
  const { accounts, categories } = state.data;
  const usable = accounts.filter((a) => !a.archived || a.id === tx?.accountId || a.id === tx?.toAccountId);
  if (!usable.length) {
    toast('Crea prima un conto');
    location.hash = '#/conti';
    return;
  }

  let type = tx?.type ?? 'expense';
  let categoryId = tx?.categoryId ?? null;
  const defaultAccount = usable.some((a) => a.id === lastAccount()) ? lastAccount() : usable[0].id;
  const fromId = tx?.accountId ?? defaultAccount;
  const toId = tx?.toAccountId ?? usable.find((a) => a.id !== fromId)?.id ?? fromId;
  const options = (selected) =>
    usable.map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

  const body = `
    <div class="segmented" role="radiogroup" aria-label="Tipo di movimento">
      <button type="button" role="radio" data-type="expense">Uscita</button>
      <button type="button" role="radio" data-type="income">Entrata</button>
      <button type="button" role="radio" data-type="transfer">Trasferimento</button>
    </div>
    <label class="amount-field">
      <span class="amount-sign" aria-hidden="true">−</span>
      <input id="f-amount" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Importo in euro"
        value="${tx ? amountToInput(tx.amount) : ''}">
      <span class="amount-currency">€</span>
    </label>
    <div class="cat-grid" id="f-cats" role="radiogroup" aria-label="Categoria"></div>
    <div class="fields">
      <label class="field"><span id="l-from">Conto</span><select id="f-from">${options(fromId)}</select></label>
      <label class="field" id="row-to"><span>Verso</span><select id="f-to">${options(toId)}</select></label>
      <label class="field"><span>Data</span><input type="date" id="f-date" value="${esc(tx?.date ?? toISODate())}"></label>
      <label class="field"><span>Nota</span><input id="f-note" maxlength="140" placeholder="Facoltativa" value="${esc(tx?.note ?? '')}"></label>
    </div>
    ${
      tx?.bankDescription || tx?.source === 'import'
        ? `<p class="bank-desc">🏦 ${esc(tx.bankDescription ?? tx.note)}</p>
           <label class="remember" hidden>
             <input type="checkbox" id="f-remember" checked>
             <span>Usa sempre questa categoria quando la descrizione contiene
               <input id="f-keyword" value="${esc(guessKeyword(tx.bankDescription ?? tx.note))}" aria-label="Parola chiave"></span>
           </label>`
        : ''
    }
    <p class="form-error" hidden></p>
    <button type="button" class="btn primary block" id="f-save">Salva</button>
    ${tx ? '<button type="button" class="btn danger block" id="f-delete">Elimina movimento</button>' : ''}`;

  openSheet({
    title: tx ? 'Modifica movimento' : 'Nuovo movimento',
    body,
    onMount(el, close) {
      const amountInput = el.querySelector('#f-amount');

      function drawCategories() {
        const kind = type === 'income' ? 'income' : 'expense';
        const list = categories.filter((c) => c.kind === kind && (!c.archived || c.id === categoryId));
        if (!list.some((c) => c.id === categoryId)) categoryId = null;
        el.querySelector('#f-cats').innerHTML = list
          .map(
            (c) => `
            <button type="button" role="radio" class="cat ${c.id === categoryId ? 'selected' : ''}" data-cat="${esc(c.id)}"
              aria-checked="${c.id === categoryId}" style="--c:${esc(c.color)}">
              <span class="cat-icon">${esc(c.icon)}</span><span class="cat-name">${esc(c.name)}</span>
            </button>`,
          )
          .join('');
      }

      function setType(next) {
        type = next;
        el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === type)));
        el.querySelector('.amount-field').dataset.type = type;
        el.querySelector('.amount-sign').textContent = type === 'income' ? '+' : type === 'expense' ? '−' : '';
        el.querySelector('#f-cats').hidden = type === 'transfer';
        el.querySelector('#row-to').hidden = type !== 'transfer';
        el.querySelector('#l-from').textContent = type === 'transfer' ? 'Da' : 'Conto';
        drawCategories();
      }

      el.querySelector('.segmented').addEventListener('click', (e) => {
        const b = e.target.closest('[data-type]');
        if (b) setType(b.dataset.type);
      });

      el.querySelector('#f-cats').addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (!b) return;
        categoryId = b.dataset.cat;
        drawCategories();
        showError(el, '');
        // Per i movimenti arrivati da banca o file, proponi di creare una regola.
        const remember = el.querySelector('.remember');
        if (remember) remember.hidden = categoryId === tx.categoryId || !el.querySelector('#f-keyword').value;
      });

      el.querySelector('#f-save').addEventListener('click', async () => {
        const amount = parseAmount(amountInput.value);
        const accountId = el.querySelector('#f-from').value;
        const toAccountId = el.querySelector('#f-to').value;
        const date = el.querySelector('#f-date').value;
        if (!(amount > 0)) return showError(el, 'Inserisci un importo valido, ad esempio 12,50');
        if (type !== 'transfer' && !categoryId) return showError(el, 'Scegli una categoria');
        if (type === 'transfer' && accountId === toAccountId) return showError(el, 'Scegli due conti diversi');
        if (!date) return showError(el, 'Scegli una data');

        await saveTransaction({
          ...tx,
          type,
          amount,
          accountId,
          toAccountId: type === 'transfer' ? toAccountId : null,
          categoryId: type === 'transfer' ? null : categoryId,
          date,
          note: el.querySelector('#f-note').value.trim(),
          toReview: false,
        });
        const remember = el.querySelector('.remember');
        const keyword = el.querySelector('#f-keyword')?.value.trim();
        let alsoFixed = 0;
        if (remember && !remember.hidden && el.querySelector('#f-remember').checked && keyword && type !== 'transfer') {
          const rule = { keyword, action: 'category', categoryId };
          await saveRule(rule);
          // La nuova regola sistema subito anche gli altri movimenti ancora da rivedere.
          const others = state.data.transactions.filter(
            (t) => t.id !== tx.id && t.toReview && t.type === type && ruleMatches(rule, t.bankDescription ?? t.note),
          );
          await saveTransactions(others.map((t) => ({ ...t, categoryId, toReview: false })));
          alsoFixed = others.length;
        }
        rememberAccount(accountId);
        close();
        await refresh();
        const alert = type === 'expense' ? budgetAlert(categoryId, date.slice(0, 7)) : null;
        if (alert) toast(alert.message, alert.level);
        else if (alsoFixed) toast(`Regola salvata · sistemati altri ${alsoFixed} movimenti`);
        else toast(tx ? 'Movimento aggiornato' : 'Movimento salvato');
      });

      el.querySelector('#f-delete')?.addEventListener('click', async () => {
        if (!confirm('Eliminare questo movimento?')) return;
        await deleteTransaction(tx.id);
        close();
        toast('Movimento eliminato');
        await refresh();
      });

      setType(type);
      if (!tx) amountInput.focus();
    },
  });
}
