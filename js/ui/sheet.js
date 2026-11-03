// Pannello che sale dal basso (stile iOS) per i moduli.
import { esc } from '../format.js';

export function openSheet({ title, body, onMount }) {
  const root = document.createElement('div');
  root.className = 'sheet-root';
  root.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-header">
        <h2>${esc(title)}</h2>
        <button class="sheet-close" data-close aria-label="Chiudi">✕</button>
      </header>
      <div class="sheet-body">${body}</div>
    </section>`;

  // Su iPhone la tastiera non rimpicciolisce la pagina: la copre. Adattiamo il pannello
  // all'area davvero visibile, così resta tutto sopra la tastiera e scorre al suo interno.
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
    if (e.target.matches('input, select, textarea')) setTimeout(() => e.target.scrollIntoView({ block: 'nearest' }), 300);
  });

  const onKey = (e) => e.key === 'Escape' && close();
  function close() {
    root.classList.remove('open');
    document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    setTimeout(() => root.remove(), 260);
  }

  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(root);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => root.classList.add('open'));
  onMount?.(root.querySelector('.sheet-body'), close);
  return close;
}

export function showError(el, message) {
  const box = el.querySelector('.form-error');
  box.textContent = message;
  box.hidden = !message;
}

let toastTimer;
// tone: '' (neutro), 'warn' (arancione) o 'over' (rosso). Gli avvisi restano visibili più a lungo.
export function toast(message, tone = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), tone ? 4000 : 2200);
}
