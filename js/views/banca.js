import { alignBalance, daysLeft, getBank, posteBanks, redirectUrl, RENEW_WARNING_DAYS, saveServer, setAccountLink, startLink, unlink } from '../bank.js';
import { esc, euro, parseISODate } from '../format.js';
import { balances } from '../store.js';
import { refresh, state } from '../state.js';
import { runSync } from '../sync.js';
import { openSheet, showError, toast } from '../ui/sheet.js';

export const title = 'Banca';

const longDate = (d) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const when = (ms) =>
  new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
const maskIban = (iban) => (iban ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : 'Conto');

export async function render(el, data) {
  const cfg = await getBank();
  const configured = Boolean(cfg.serverUrl && cfg.token);
  const bal = balances(data.accounts, data.transactions);
  const accountOptions = (selected) =>
    `<option value="">Non sincronizzare</option>` +
    data.accounts
      .filter((a) => !a.archived)
      .map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`)
      .join('');

  el.innerHTML = `
    <header class="page-header"><a class="back" href="#/altro">‹ Impostazioni</a><h1>Collegamento banca</h1></header>

    ${
      !configured
        ? `<section class="card callout-plain">
            <p>Per scaricare i movimenti da BancoPosta serve un piccolo server personale, gratuito, che custodisce la chiave di Enable Banking. Segui la <strong>guida</strong> che trovi nel progetto (GUIDA-BANCA.md), poi inserisci qui i dati.</p>
          </section>`
        : ''
    }

    ${cfg.connections
      .map((c) => {
        const left = daysLeft(c);
        const expired = left !== null && left < 0;
        const warn = left !== null && left <= RENEW_WARNING_DAYS;
        return `
        <section class="card bank-card">
          <div class="bank-head">
            <span class="bank-logo">🏤</span>
            <div class="row-main"><span class="row-title">${esc(c.aspsp?.name ?? 'Banca')}</span>
              <span class="row-sub ${warn ? (expired ? 'neg' : 'warn-text') : ''}">${
                left === null
                  ? 'Consenso attivo'
                  : expired
                    ? 'Consenso scaduto: rinnovalo per continuare'
                    : `Consenso valido fino al ${longDate(new Date(c.validUntil))} (${left} giorni)`
              }</span></div>
          </div>
          ${c.accounts
            .map((a) => {
              const local = data.accounts.find((x) => x.id === a.tascaAccountId);
              const diff = local && a.bankBalance != null ? a.bankBalance - bal.get(local.id) : 0;
              return `
              <div class="bank-account">
                <div class="bank-line"><strong>${esc(maskIban(a.iban))}</strong><span class="muted">${a.lastSync ? `aggiornato ${when(a.lastSync)}` : 'mai aggiornato'}</span></div>
                <label class="field compact"><span>In Tasca</span><select data-link="${esc(c.sessionId)}|${esc(a.uid)}">${accountOptions(a.tascaAccountId)}</select></label>
                ${
                  local && a.bankBalance != null
                    ? `<div class="bank-line"><span>Saldo in banca</span><strong>${euro(a.bankBalance)}</strong></div>
                       ${
                         diff
                           ? `<div class="bank-line warn-text"><span>Tasca segna ${euro(bal.get(local.id))}</span>
                                <button type="button" class="text-btn small" data-align="${esc(c.sessionId)}|${esc(a.uid)}">Allinea</button></div>`
                           : '<div class="bank-line muted"><span>Tasca è allineata alla banca ✓</span></div>'
                       }`
                    : ''
                }
              </div>`;
            })
            .join('')}
          <div class="bank-actions">
            <button type="button" class="btn ${expired ? 'secondary' : 'primary'}" data-sync ${expired ? 'disabled' : ''}>Aggiorna ora</button>
            <button type="button" class="btn ${warn ? 'primary' : 'secondary'}" data-renew="${esc(c.sessionId)}">Rinnova</button>
          </div>
          <button type="button" class="btn danger block" data-unlink="${esc(c.sessionId)}">Scollega</button>
        </section>`;
      })
      .join('')}

    ${configured ? `<button type="button" class="btn ${cfg.connections.length ? 'secondary' : 'primary'} block" id="link">${cfg.connections.length ? '+ Collega un altro conto' : 'Collega BancoPosta'}</button>` : ''}

    <h2 class="section-title">Server</h2>
    <section class="card flush rows">
      <button class="row" id="server">
        <span class="row-icon">🔐</span>
        <span class="row-main"><span class="row-title">${configured ? 'Server configurato' : 'Configura il server'}</span>
          <span class="row-sub">${configured ? esc(new URL(cfg.serverUrl).host) : 'Indirizzo della funzione e chiave di accesso'}</span></span>
        <span class="row-chevron" aria-hidden="true">›</span>
      </button>
    </section>
    <p class="footnote">Tasca può solo <strong>leggere</strong> saldo e movimenti: non può fare pagamenti. Il consenso dura al massimo 180 giorni, poi va rinnovato con PosteID.<br>Indirizzo da registrare su Enable Banking: <strong>${esc(redirectUrl())}</strong></p>`;

  el.querySelector('#server').addEventListener('click', () => openServerSheet(cfg));
  el.querySelector('#link')?.addEventListener('click', () => openLinkSheet(data));
  el.querySelectorAll('[data-renew]').forEach((b) => b.addEventListener('click', () => openLinkSheet(data)));
  el.querySelectorAll('[data-sync]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Aggiornamento…';
      await runSync({ manual: true });
    }),
  );
  el.querySelectorAll('[data-link]').forEach((s) =>
    s.addEventListener('change', async () => {
      const [sessionId, uid] = s.dataset.link.split('|');
      await setAccountLink(sessionId, uid, s.value);
      toast(s.value ? 'Conto abbinato: tocca Aggiorna ora' : 'Sincronizzazione disattivata');
      await refresh();
    }),
  );
  el.querySelectorAll('[data-align]').forEach((b) =>
    b.addEventListener('click', async () => {
      const [sessionId, uid] = b.dataset.align.split('|');
      const acc = cfg.connections.find((c) => c.sessionId === sessionId).accounts.find((a) => a.uid === uid);
      const local = state.data.accounts.find((a) => a.id === acc.tascaAccountId);
      if (!confirm(`Impostare il saldo di «${local.name}» a ${euro(acc.bankBalance)} come in banca?`)) return;
      await alignBalance(local, state.data.transactions, acc.bankBalance);
      toast('Saldo allineato');
      await refresh();
    }),
  );
  el.querySelectorAll('[data-unlink]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Scollegare la banca? I movimenti già scaricati restano in Tasca.')) return;
      await unlink(b.dataset.unlink);
      toast('Banca scollegata');
      await refresh();
    }),
  );
}

function openServerSheet(cfg) {
  openSheet({
    title: 'Server personale',
    body: `
      <div class="fields">
        <label class="field"><span>Indirizzo</span><input id="s-url" type="url" inputmode="url" autocapitalize="off" placeholder="https://xxxx.supabase.co/functions/v1/banca" value="${esc(cfg.serverUrl)}"></label>
        <label class="field"><span>Chiave</span><input id="s-token" type="password" autocomplete="off" placeholder="La password scelta (TASCA_TOKEN)" value="${esc(cfg.token)}"></label>
      </div>
      <p class="hint-text">Li trovi alla fine della guida GUIDA-BANCA.md. Toccando Salva, Tasca prova subito il collegamento.</p>
      <p class="form-error" hidden></p>
      <button type="button" class="btn primary block" id="s-save">Salva e prova</button>`,
    onMount(el, close) {
      el.querySelector('#s-save').addEventListener('click', async (e) => {
        const url = el.querySelector('#s-url').value.trim();
        const token = el.querySelector('#s-token').value.trim();
        if (!/^https:\/\//.test(url)) return showError(el, "L'indirizzo deve iniziare con https://");
        if (!token) return showError(el, 'Inserisci la chiave di accesso');
        e.target.disabled = true;
        e.target.textContent = 'Provo il collegamento…';
        try {
          await saveServer(url, token);
          close();
          toast('Server collegato ✓');
          await refresh();
        } catch (err) {
          showError(el, err.message);
          e.target.disabled = false;
          e.target.textContent = 'Salva e prova';
        }
      });
    },
  });
}

async function openLinkSheet(data) {
  let banks;
  try {
    banks = await posteBanks();
  } catch (err) {
    alert(err.message);
    return;
  }
  if (!banks.length) {
    alert('Enable Banking non ha restituito Poste Italiane tra le banche disponibili.');
    return;
  }
  const accounts = data.accounts.filter((a) => !a.archived);
  const preferred = accounts.find((a) => a.type === 'bank') ?? accounts[0];
  openSheet({
    title: 'Collega BancoPosta',
    body: `
      <div class="fields">
        <label class="field"><span>Banca</span><select id="l-bank">${banks
          .map((b, i) => `<option value="${i}" ${/bancoposta/i.test(b.name) ? 'selected' : ''}>${esc(b.name)}</option>`)
          .join('')}</select></label>
        <label class="field"><span>In Tasca</span><select id="l-account">${accounts
          .map((a) => `<option value="${esc(a.id)}" ${a.id === preferred?.id ? 'selected' : ''}>${esc(a.name)}</option>`)
          .join('')}</select></label>
      </div>
      <ol class="steps small">
        <li>Verrai portato sul sito di Enable Banking e poi su quello di Poste.</li>
        <li>Accedi con le tue credenziali e conferma con <strong>PosteID</strong> nell'app.</li>
        <li>Alla fine tornerai qui e i movimenti verranno scaricati.</li>
      </ol>
      <p class="hint-text">Tasca non vede mai le tue credenziali di Poste: l'accesso avviene sulle loro pagine ufficiali.</p>
      <p class="form-error" hidden></p>
      <button type="button" class="btn primary block" id="l-go">Continua su Poste</button>`,
    onMount(el) {
      el.querySelector('#l-go').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Apro la pagina della banca…';
        try {
          await startLink(banks[Number(el.querySelector('#l-bank').value)], el.querySelector('#l-account').value);
        } catch (err) {
          showError(el, err.message);
          e.target.disabled = false;
          e.target.textContent = 'Continua su Poste';
        }
      });
    },
  });
}
