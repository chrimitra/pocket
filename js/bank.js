// Collegamento con la banca tramite la funzione server (vedi GUIDA-BANCA.md).
// La configurazione e i collegamenti restano nel database del dispositivo.
import * as db from './db.js';
import { reconcile } from './bank-sync.js';
import { toISODate } from './format.js';
import { balances, saveAccount, saveTransactions } from './store.js';

const KEY = 'bank';
const FIRST_SYNC_DAYS = 90;
const OVERLAP_DAYS = 7;
export const AUTO_SYNC_HOURS = 6;
export const RENEW_WARNING_DAYS = 14;

export async function getBank() {
  return (await db.get('meta', KEY))?.value ?? { serverUrl: '', token: '', connections: [], pending: null };
}

async function setBank(value) {
  await db.put('meta', { key: KEY, value });
}

async function call(cfg, action, payload = {}) {
  let res;
  try {
    res = await fetch(cfg.serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tasca-Token': cfg.token },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error('Il server non risponde. Controlla l\'indirizzo e la connessione.');
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    // risposta vuota o non JSON
  }
  if (!res.ok) throw new Error(data.error || `Errore del server (${res.status})`);
  return data;
}

export async function saveServer(serverUrl, token) {
  const cfg = { ...(await getBank()), serverUrl: serverUrl.trim(), token: token.trim() };
  await call(cfg, 'ping');
  await setBank(cfg);
}

export async function posteBanks() {
  const cfg = await getBank();
  const { banks } = await call(cfg, 'banks', { country: 'IT' });
  return banks.filter((b) => /poste|bancoposta|postepay/i.test(b.name));
}

// L'indirizzo a cui la banca rimanda dopo l'autorizzazione: la pagina dell'app stessa.
export const redirectUrl = () => location.origin + location.pathname;

export async function startLink(aspsp, accountId) {
  const cfg = await getBank();
  const state = crypto.randomUUID();
  const { url } = await call(cfg, 'start', { aspsp, state, redirect_url: redirectUrl() });
  await setBank({ ...cfg, pending: { state, aspsp, accountId, at: Date.now() } });
  location.href = url;
}

export async function completeLink(code, state) {
  const cfg = await getBank();
  if (!cfg.pending || cfg.pending.state !== state) throw new Error('Collegamento non riconosciuto: riprova da Impostazioni → Banca.');
  const session = await call(cfg, 'session', { code });
  // Se ricolleghi lo stesso conto (rinnovo), tieni gli abbinamenti precedenti.
  const previous = new Map(cfg.connections.flatMap((c) => c.accounts).filter((a) => a.iban).map((a) => [a.iban, a]));
  const accounts = session.accounts.map((a, i) => {
    const old = a.iban && previous.get(a.iban);
    return { ...a, tascaAccountId: old?.tascaAccountId ?? (i === 0 ? cfg.pending.accountId : null), aligned: old?.aligned ?? false, lastSync: old?.lastSync ?? null };
  });
  const ibans = new Set(accounts.map((a) => a.iban).filter(Boolean));
  const connections = cfg.connections.filter((c) => !c.accounts.some((a) => ibans.has(a.iban)));
  connections.push({ sessionId: session.sessionId, aspsp: session.aspsp ?? cfg.pending.aspsp, validUntil: session.validUntil, accounts, createdAt: Date.now() });
  await setBank({ ...cfg, pending: null, connections });
}

export async function setAccountLink(sessionId, uid, tascaAccountId) {
  const cfg = await getBank();
  for (const c of cfg.connections) {
    if (c.sessionId !== sessionId) continue;
    for (const a of c.accounts) if (a.uid === uid) Object.assign(a, { tascaAccountId: tascaAccountId || null, aligned: false });
  }
  await setBank(cfg);
}

export async function unlink(sessionId) {
  const cfg = await getBank();
  try {
    await call(cfg, 'end', { sessionId });
  } catch {
    // Se il consenso è già scaduto la banca rifiuta: lo togliamo comunque.
  }
  await setBank({ ...cfg, connections: cfg.connections.filter((c) => c.sessionId !== sessionId) });
}

export function daysLeft(connection) {
  if (!connection.validUntil) return null;
  return Math.floor((new Date(connection.validUntil) - Date.now()) / 864e5);
}

export function needsSync(cfg) {
  const cutoff = Date.now() - AUTO_SYNC_HOURS * 36e5;
  return cfg.connections.some((c) => daysLeft(c) >= 0 && c.accounts.some((a) => a.tascaAccountId && (a.lastSync ?? 0) < cutoff));
}

/**
 * Scarica movimenti e saldo di ogni conto collegato.
 * data: lo stato attuale dell'app (conti, movimenti, regole, categorie).
 */
export async function syncAll(data) {
  const cfg = await getBank();
  const summary = { added: 0, matched: 0, toReview: 0, errors: [] };
  let transactions = data.transactions;

  for (const conn of cfg.connections) {
    if (daysLeft(conn) < 0) {
      summary.errors.push(`Il consenso per ${conn.aspsp?.name ?? 'la banca'} è scaduto: rinnovalo.`);
      continue;
    }
    for (const acc of conn.accounts) {
      const account = data.accounts.find((a) => a.id === acc.tascaAccountId);
      if (!account) continue;
      try {
        const from = acc.lastSync ? new Date(acc.lastSync - OVERLAP_DAYS * 864e5) : new Date(Date.now() - FIRST_SYNC_DAYS * 864e5);
        const { transactions: bankTxs } = await call(cfg, 'transactions', { uid: acc.uid, dateFrom: toISODate(from) });
        const { create, update } = reconcile(bankTxs, { accountId: account.id, transactions, rules: data.rules, categories: data.categories });
        await saveTransactions([...update, ...create]);
        transactions = [...transactions.filter((t) => !update.some((u) => u.id === t.id)), ...update, ...create];
        summary.added += create.length;
        summary.matched += update.length;
        summary.toReview += create.filter((t) => t.toReview).length;

        const bal = await call(cfg, 'balance', { uid: acc.uid });
        // L'API usa sempre il punto come separatore decimale ("1234.56").
        const bankCents = bal.amount == null ? NaN : Math.round(Number(bal.amount) * 100);
        acc.bankBalance = Number.isNaN(bankCents) ? null : bankCents;
        acc.balanceDate = bal.date ?? toISODate();
        // Al primo collegamento il saldo di Tasca viene allineato a quello della banca.
        if (!acc.aligned && acc.bankBalance != null) {
          await alignBalance(account, transactions, acc.bankBalance);
          acc.aligned = true;
        }
        acc.lastSync = Date.now();
      } catch (err) {
        summary.errors.push(`${account.name}: ${err.message}`);
      }
    }
  }
  await setBank(cfg);
  return summary;
}

// Sistema il saldo iniziale del conto così che il saldo di Tasca coincida con quello della banca.
export async function alignBalance(account, transactions, bankCents) {
  const current = balances([account], transactions).get(account.id);
  await saveAccount({ ...account, initialBalance: (account.initialBalance || 0) + (bankCents - current) });
}
