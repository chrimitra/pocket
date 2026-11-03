// Funzione server di Tasca (Supabase Edge Function).
// Firma le richieste verso Enable Banking con la tua chiave privata: la chiave resta qui,
// sul server, e l'app sul telefono non la vede mai. Il server non salva nessun dato.
//
// Segreti da impostare in Supabase (Edge Functions → Secrets):
//   EB_APP_ID       ID dell'applicazione Enable Banking
//   EB_PRIVATE_KEY  contenuto del file .pem scaricato da Enable Banking
//   TASCA_TOKEN     una password inventata da te, da inserire anche nell'app
//   ALLOWED_ORIGIN  indirizzo dell'app, es. https://tuonome.github.io (più indirizzi separati da virgola)

const API = 'https://api.enablebanking.com';
const APP_ID = Deno.env.get('EB_APP_ID') ?? '';
const PRIVATE_KEY = Deno.env.get('EB_PRIVATE_KEY') ?? '';
const TOKEN = Deno.env.get('TASCA_TOKEN') ?? '';
const ORIGINS = (Deno.env.get('ALLOWED_ORIGIN') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_CONSENT_DAYS = 180;
const MAX_PAGES = 30;

type Json = Record<string, unknown>;
class BankError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

// ---------- Firma JWT (RS256) ----------

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function derLength(n: number): number[] {
  if (n < 128) return [n];
  const bytes: number[] = [];
  for (; n > 0; n >>= 8) bytes.unshift(n & 255);
  return [0x80 | bytes.length, ...bytes];
}

// Converte una chiave "BEGIN RSA PRIVATE KEY" (PKCS#1) nel formato PKCS#8 che WebCrypto accetta.
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const body = [0x02, 0x01, 0x00, ...rsaAlgorithm, 0x04, ...derLength(pkcs1.length), ...pkcs1];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

let keyPromise: Promise<CryptoKey> | null = null;
function signingKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const pem = PRIVATE_KEY.replace(/\\n/g, '\n');
    let der = pemToDer(pem);
    if (pem.includes('BEGIN RSA PRIVATE KEY')) der = pkcs1ToPkcs8(der);
    keyPromise = crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  return keyPromise;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encodePart = (obj: Json) => base64url(new TextEncoder().encode(JSON.stringify(obj)));

let cached = { token: '', exp: 0 };
async function jwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached.exp - 60 > now) return cached.token;
  const exp = now + 3600;
  const data = `${encodePart({ typ: 'JWT', alg: 'RS256', kid: APP_ID })}.${encodePart({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp })}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(), new TextEncoder().encode(data)));
  cached = { token: `${data}.${base64url(signature)}`, exp };
  return cached.token;
}

// ---------- Enable Banking ----------

async function eb(method: string, path: string, body?: Json): Promise<Json> {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${await jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: Json = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) throw new BankError(String(data.message ?? data.detail ?? `Enable Banking ha risposto ${res.status}`), res.status);
  return data;
}

type Aspsp = { name: string; country: string; maximum_consent_validity?: number; logo?: string };

async function listBanks(country: string): Promise<Aspsp[]> {
  const data = await eb('GET', `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
  return (data.aspsps as Aspsp[]) ?? [];
}

// I saldi "contabilizzati" vengono prima: Tasca importa solo i movimenti contabilizzati.
const BALANCE_ORDER = ['ITBD', 'CLBD', 'ITAV', 'CLAV', 'XPCD', 'OPBD'];

type Handler = (body: Json) => Promise<Json>;
const actions: Record<string, Handler> = {
  async ping() {
    if (!APP_ID || !PRIVATE_KEY) throw new BankError('Sul server mancano EB_APP_ID o EB_PRIVATE_KEY', 500);
    await jwt();
    return { ok: true };
  },

  async banks(body) {
    const banks = await listBanks(String(body.country ?? 'IT'));
    return { banks: banks.map((b) => ({ name: b.name, country: b.country, logo: b.logo ?? null })) };
  },

  async start(body) {
    const aspsp = body.aspsp as { name: string; country: string };
    const redirect = String(body.redirect_url ?? '');
    if (!ORIGINS.some((o) => redirect.startsWith(o + '/') || redirect === o)) {
      throw new BankError("L'indirizzo dell'app non è tra quelli permessi (ALLOWED_ORIGIN)", 400);
    }
    const bank = (await listBanks(aspsp.country)).find((b) => b.name === aspsp.name);
    if (!bank) throw new BankError('Banca non trovata', 404);
    // La durata massima del consenso dipende dalla banca (in secondi); non oltre 180 giorni.
    const days = Math.min(MAX_CONSENT_DAYS, bank.maximum_consent_validity ? Math.floor(bank.maximum_consent_validity / 86400) : 90);
    const validUntil = new Date(Date.now() + days * 864e5).toISOString();
    const data = await eb('POST', '/auth', {
      access: { valid_until: validUntil },
      aspsp: { name: bank.name, country: bank.country },
      state: String(body.state ?? ''),
      redirect_url: redirect,
      psu_type: 'personal',
      language: 'it',
    });
    return { url: data.url };
  },

  async session(body) {
    const data = await eb('POST', '/sessions', { code: String(body.code ?? '') });
    const accounts = ((data.accounts as Json[]) ?? []).map((a) => ({
      uid: a.uid,
      iban: (a.account_id as Json | undefined)?.iban ?? null,
      name: a.name ?? a.product ?? null,
      currency: a.currency ?? 'EUR',
    }));
    return { sessionId: data.session_id, validUntil: (data.access as Json | undefined)?.valid_until ?? null, aspsp: data.aspsp, accounts };
  },

  async status(body) {
    const data = await eb('GET', `/sessions/${encodeURIComponent(String(body.sessionId))}`);
    return { status: data.status, validUntil: (data.access as Json | undefined)?.valid_until ?? null };
  },

  async balance(body) {
    const data = await eb('GET', `/accounts/${encodeURIComponent(String(body.uid))}/balances`);
    const list = (data.balances as Json[]) ?? [];
    const rank = (b: Json) => {
      const i = BALANCE_ORDER.indexOf(String(b.balance_type));
      return i < 0 ? 99 : i;
    };
    const best = [...list].sort((a, b) => rank(a) - rank(b))[0];
    const amount = best?.balance_amount as Json | undefined;
    return best ? { amount: amount?.amount, currency: amount?.currency, type: best.balance_type, date: best.reference_date ?? null } : { amount: null };
  },

  async transactions(body) {
    const uid = encodeURIComponent(String(body.uid));
    const out: Json[] = [];
    let key = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ date_from: String(body.dateFrom) });
      if (key) query.set('continuation_key', key);
      const data = await eb('GET', `/accounts/${uid}/transactions?${query}`);
      for (const t of (data.transactions as Json[]) ?? []) {
        const credit = t.credit_debit_indicator === 'CRDT';
        const amount = t.transaction_amount as Json | undefined;
        out.push({
          id: t.entry_reference ?? t.transaction_id ?? null,
          amount: amount?.amount ?? null,
          currency: amount?.currency ?? 'EUR',
          credit,
          date: t.booking_date ?? t.value_date ?? t.transaction_date ?? null,
          status: t.status ?? 'BOOK',
          info: ((t.remittance_information as string[]) ?? []).join(' '),
          counterparty: ((credit ? t.debtor : t.creditor) as Json | undefined)?.name ?? null,
        });
      }
      key = String(data.continuation_key ?? '');
      if (!key) break;
    }
    return { transactions: out };
  },

  async end(body) {
    await eb('DELETE', `/sessions/${encodeURIComponent(String(body.sessionId))}`);
    return { ok: true };
  },
};

// ---------- HTTP ----------

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const headers = {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0] ?? '',
    'Access-Control-Allow-Headers': 'content-type, x-tasca-token, authorization, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
  const reply = (data: Json, status = 200) => new Response(JSON.stringify(data), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'Usa POST' }, 405);
  if (!TOKEN || req.headers.get('x-tasca-token') !== TOKEN) return reply({ error: 'Chiave di accesso errata' }, 401);

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Richiesta non valida' }, 400);
  }
  const handler = actions[String(body.action)];
  if (!handler) return reply({ error: 'Azione sconosciuta' }, 400);
  try {
    return reply(await handler(body));
  } catch (err) {
    const status = err instanceof BankError ? err.status : 500;
    return reply({ error: err instanceof Error ? err.message : 'Errore sconosciuto', status }, status >= 400 && status < 600 ? status : 500);
  }
});
