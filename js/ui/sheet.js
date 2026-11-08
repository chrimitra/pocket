// Pannello che sale dal basso (stile iOS) per i moduli, e messaggi brevi (toast).
import { esc } from '../format.js';
import { icon } from './icons.js';

/**
 * Struttura: intestazione · `top` (fisso) · `body` (scorre) · `footer` (fisso, per i pulsanti).
 * I pulsanti nel footer restano sempre visibili e della loro altezza, qualunque sia lo spazio.
 * onMount riceve l'elemento del pannello e la funzione per chiuderlo.
 */
export function openSheet({ title, top = '', body = '', footer = '', actions = '', className = '', onMount, onClose }) {
  const root = document.createElement('div');
  root.className = 'sheet-root';
  root.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-header">
        <h2>${esc(title)}</h2>
        <div class="sheet-actions">${actions}<button type="button" class="icon-btn" data-close aria-label="Chiudi">${icon('x')}</button></div>
      </header>
      ${top ? `<div class="sheet-top">${top}</div>` : ''}
      <div class="sheet-body">${body}</div>
      ${footer ? `<div class="sheet-footer">${footer}</div>` : ''}
    </section>`;
  const sheet = root.querySelector('.sheet');

  // Su iPhone la tastiera non rimpicciolisce la pagina: la copre. Adattiamo il pannello
  // all'area davvero visibile, così resta tutto sopra la tastiera.
  const vv = window.visualViewport;
  const fit = () => {
    root.style.top = `${vv.offsetTop}px`;
    root.style.height = `${vv.height}px`;
  };
  if (vv) {
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    fit();
  }
  // Il campo che stai compilando resta in vista quando compare la tastiera.
  root.addEventListener('focusin', (e) => {
    if (e.target.matches('input:not([type=checkbox]):not([type=date]), textarea')) {
      setTimeout(() => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 320);
    }
  });

  const scrollY = window.scrollY;
  const onKey = (e) => e.key === 'Escape' && close();
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    root.classList.remove('open');
    document.body.classList.remove('sheet-open');
    document.body.style.top = '';
    window.scrollTo(0, scrollY);
    document.removeEventListener('keydown', onKey);
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    onClose?.();
    setTimeout(() => root.remove(), 260);
  }

  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(root);
  // Blocca lo scorrimento della pagina sotto il pannello (anche su iPhone).
  document.body.style.top = `-${scrollY}px`;
  document.body.classList.add('sheet-open');
  // Forza il calcolo del layout e poi apri: l'animazione parte senza dipendere da requestAnimationFrame.
  void root.offsetHeight;
  root.classList.add('open');
  onMount?.(sheet, close);
  return close;
}

export function showError(el, message) {
  const box = el.querySelector('.form-error');
  box.textContent = message;
  box.hidden = !message;
}

let toastTimer;
/**
 * Messaggio breve in basso. opts può essere il tono ('warn' | 'over') oppure
 * { tone, action: { label, run } } per offrire un pulsante, es. "Annulla".
 */
export function toast(message, opts = {}) {
  const { tone = '', action = null } = typeof opts === 'string' ? { tone: opts } : opts;
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  const text = document.createElement('span');
  text.textContent = message;
  el.replaceChildren(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.classList.remove('show');
      action.run();
    });
    el.appendChild(btn);
  }
  el.className = `show ${tone} ${action ? 'has-action' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5500 : tone ? 4000 : 2400);
}
