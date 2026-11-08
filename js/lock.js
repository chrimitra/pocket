// Blocco con Face ID (o Touch ID, o il codice dell'iPhone) tramite una passkey salvata sul telefono.
// È una protezione da occhi curiosi: chi prende in mano il telefono sbloccato non vede le tue finanze.
// Non cifra i dati: quelli restano protetti dal codice di sblocco dell'iPhone.
import { icon } from './ui/icons.js';

const KEY = 'tasca:lock';
const RELOCK_AFTER_MS = 60_000;

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

function config() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function saveConfig(value) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // senza memoria il blocco non può restare attivo
  }
}

export const lockEnabled = () => Boolean(config()?.id);

export async function lockSupported() {
  try {
    return Boolean(window.PublicKeyCredential) && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

// Crea la passkey: l'iPhone chiede Face ID (o il codice) per confermare che sei tu.
async function register() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'Tasca', id: location.hostname },
      user: { id: random(16), name: 'Tasca', displayName: 'Tasca' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 60_000,
    },
  });
  saveConfig({ id: toB64(cred.rawId) });
}

async function verify() {
  await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: fromB64(config().id) }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
}

export const enableLock = register;

export async function disableLock() {
  await verify();
  saveConfig(null);
}

function showLock() {
  if (document.getElementById('lock')) return;
  document.documentElement.classList.add('locked');
  const el = document.createElement('div');
  el.id = 'lock';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Tasca è bloccata');
  el.innerHTML = `
    <div class="lock-box">
      <img src="icons/icon-192.png" alt="" class="lock-logo">
      <h1>Tasca è bloccata</h1>
      <p>Usa Face ID per vedere le tue finanze.</p>
      <button type="button" class="btn primary block" id="lock-open">${icon('faceid')}Sblocca</button>
      <p class="form-error" hidden></p>
      <button type="button" class="text-btn" id="lock-reset">Face ID non funziona?</button>
    </div>`;
  document.body.appendChild(el);

  const error = (message) => {
    const box = el.querySelector('.form-error');
    box.textContent = message;
    box.hidden = !message;
  };
  const unlock = () => {
    el.remove();
    document.documentElement.classList.remove('locked');
  };

  el.querySelector('#lock-open').addEventListener('click', async () => {
    error('');
    try {
      await verify();
      unlock();
    } catch {
      error('Sblocco non riuscito o annullato. Riprova.');
    }
  });
  // Se la passkey è stata cancellata, se ne crea una nuova: anche questo richiede Face ID o il codice.
  el.querySelector('#lock-reset').addEventListener('click', async () => {
    if (!confirm("Creo un nuovo accesso per Tasca: l'iPhone ti chiederà Face ID o il codice per confermare che sei tu. Continuare?")) return;
    try {
      await register();
      unlock();
    } catch {
      error('Non è stato possibile creare un nuovo accesso.');
    }
  });
}

/** Da chiamare all'avvio: blocca subito se attivo, e di nuovo se l'app resta in background più di un minuto. */
export function setupLock() {
  if (lockEnabled()) showLock();
  else document.documentElement.classList.remove('locked');
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (!lockEnabled()) return;
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) showLock();
  });
}
