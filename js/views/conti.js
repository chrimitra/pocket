import { amountToInput, esc, euro, parseAmount } from '../format.js';
import { ACCOUNT_TYPES, balances, deleteAccount, saveAccount } from '../store.js';
import { refresh, state } from '../state.js';
import { pageHeader } from '../ui/components.js';
import { ACCOUNT_ICONS, icon } from '../ui/icons.js';
import { openSheet, showError, toast } from '../ui/sheet.js';

export const title = 'Conti';

export function render(el, data) {
  const bal = balances(data.accounts, data.transactions);
  const active = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);
  const total = active.reduce((s, a) => s + bal.get(a.id), 0);

  const row = (a) => `
    <button class="row" data-acc="${esc(a.id)}">
      <span class="row-icon tone-primary">${icon(ACCOUNT_ICONS[a.type] ?? 'wallet')}</span>
      <span class="row-main">
        <span class="row-title">${esc(a.name)}</span>
        <span class="row-sub">${ACCOUNT_TYPES[a.type]?.label ?? ''}</span>
      </span>
      <span class="row-amount ${bal.get(a.id) < 0 ? 'neg' : ''}">${euro(bal.get(a.id))}</span>
    </button>`;

  el.innerHTML = `
    ${pageHeader('Conti', { back: { href: '#/altro', label: 'Impostazioni' }, sub: `In tutto hai <strong>${euro(total)}</strong>` })}
    <section class="card flush rows">${active.map(row).join('') || '<p class="muted pad">Nessun conto attivo.</p>'}</section>
    <button class="btn secondary block" id="add-acc">${icon('plus')}Aggiungi un conto</button>
    ${archived.length ? `<h2 class="section-title">Archiviati</h2><section class="card flush rows">${archived.map(row).join('')}</section>` : ''}
    <p class="footnote">Tocca un conto per cambiarne nome o saldo. Archivia i conti che non usi più: spariscono dalle scelte ma i loro movimenti restano.</p>`;

  el.querySelectorAll('[data-acc]').forEach((b) =>
    b.addEventListener('click', () => openAccountSheet(data.accounts.find((a) => a.id === b.dataset.acc))),
  );
  el.querySelector('#add-acc').addEventListener('click', () => openAccountSheet(null));
}

function openAccountSheet(account) {
  const { accounts, transactions } = state.data;
  const current = account ? balances([account], transactions).get(account.id) : 0;
  const used =
    account &&
    (transactions.some((t) => t.accountId === account.id || t.toAccountId === account.id) ||
      state.data.recurring.some((r) => r.accountId === account.id || r.toAccountId === account.id));

  openSheet({
    title: account ? 'Modifica conto' : 'Nuovo conto',
    body: `
      <div class="fields">
        <label class="field"><span>Nome</span><input id="a-name" maxlength="40" placeholder="Es. Conto BancoPosta" value="${esc(account?.name ?? '')}"></label>
        <label class="field"><span>Tipo</span><select id="a-type">
          ${Object.entries(ACCOUNT_TYPES)
            .map(([k, v]) => `<option value="${k}" ${k === (account?.type ?? 'bank') ? 'selected' : ''}>${v.icon} ${v.label}</option>`)
            .join('')}
        </select></label>
        <label class="field"><span>Saldo di oggi</span><input id="a-balance" inputmode="decimal" placeholder="0,00" value="${account ? amountToInput(current) : ''}"></label>
        ${account ? `<label class="field toggle"><span>Archiviato</span><input type="checkbox" id="a-archived" ${account.archived ? 'checked' : ''}></label>` : ''}
      </div>
      <p class="hint-text">Scrivi quanto c'è sul conto <strong>adesso</strong> (lo vedi nell'app della banca): i movimenti già inseriti restano come sono.</p>
      <p class="form-error" hidden></p>
      ${account && !used ? `<button type="button" class="btn danger-text block" id="a-delete">${icon('trash')}Elimina conto</button>` : ''}`,
    footer: `<button type="button" class="btn primary block" id="a-save">${account ? 'Salva modifiche' : 'Aggiungi conto'}</button>`,
    onMount(el, close) {
      el.querySelector('#a-save').addEventListener('click', async () => {
        const name = el.querySelector('#a-name').value.trim();
        const raw = el.querySelector('#a-balance').value;
        const balance = raw.trim() ? parseAmount(raw) : 0;
        if (!name) return showError(el, 'Dai un nome al conto');
        if (Number.isNaN(balance)) return showError(el, 'Saldo non valido, ad esempio 1.250,00 oppure -30');
        // Il saldo iniziale è ciò che serve perché, sommati i movimenti, si arrivi al saldo indicato.
        const movements = account ? current - (account.initialBalance || 0) : 0;
        await saveAccount({
          ...account,
          name,
          type: el.querySelector('#a-type').value,
          initialBalance: balance - movements,
          archived: el.querySelector('#a-archived')?.checked ?? false,
          order: account?.order ?? accounts.length,
        });
        close();
        toast('Conto salvato');
        await refresh();
      });
      el.querySelector('#a-delete')?.addEventListener('click', async () => {
        if (!confirm(`Eliminare il conto «${account.name}»?`)) return;
        await deleteAccount(account.id);
        close();
        toast('Conto eliminato');
        await refresh();
      });
      if (!account) el.querySelector('#a-name').focus();
    },
  });
}
