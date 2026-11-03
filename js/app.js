import { init } from './store.js';
import { onChange, refresh, state } from './state.js';
import { openTransactionSheet } from './ui/transaction-sheet.js';
import * as home from './views/home.js';
import * as movimenti from './views/movimenti.js';
import * as budget from './views/budget.js';
import * as grafici from './views/grafici.js';
import * as conti from './views/conti.js';
import * as altro from './views/altro.js';
import * as importa from './views/importa.js';
import * as regole from './views/regole.js';
import * as banca from './views/banca.js';
import { autoSync, handleBankReturn } from './sync.js';

const routes = { home, movimenti, budget, grafici, conti, altro, importa, regole, banca };
// Schermate senza una voce propria nella barra in basso: quale voce evidenziare.
const parentTab = { conti: 'home', altro: 'home', regole: 'home', banca: 'home', importa: 'movimenti' };
const view = document.getElementById('view');
let lastRoute = null;

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[name] ? name : 'home';
}

function render() {
  if (!state.data) return;
  const name = currentRoute();
  routes[name].render(view, state.data);
  document.title = name === 'home' ? 'Tasca' : `${routes[name].title} · Tasca`;
  const tab = parentTab[name] ?? name;
  document.querySelectorAll('[data-tab]').forEach((t) => {
    if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (name !== lastRoute) window.scrollTo(0, 0);
  lastRoute = name;
}

function setupInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem('tasca:installHint') === 'no';
  } catch {
    // ignora
  }
  if (!isIOS || standalone || dismissed) return;
  const hint = document.getElementById('install-hint');
  hint.hidden = false;
  hint.querySelector('button').addEventListener('click', () => {
    hint.hidden = true;
    try {
      localStorage.setItem('tasca:installHint', 'no');
    } catch {
      // ignora
    }
  });
}

async function boot() {
  onChange(render);
  window.addEventListener('hashchange', render);
  document.getElementById('add-btn').addEventListener('click', () => openTransactionSheet());
  setupInstallHint();

  try {
    await init();
    await refresh();
  } catch (err) {
    view.innerHTML = `<div class="empty"><span class="empty-icon">⚠️</span><p>Non riesco ad aprire il database del browser.<br>${err?.message ?? ''}</p></div>`;
    return;
  }

  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (!(await handleBankReturn())) autoSync();
  // Riaprendo l'app dopo un po' (iPhone la tiene sospesa), aggiorna di nuovo se serve.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && autoSync());
}

boot();
