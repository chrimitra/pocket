// Formattazione di importi e date in italiano. Gli importi sono sempre in centesimi (interi).
const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });

// "Nascondi importi": tutti gli importi diventano •••, utile se apri l'app in pubblico.
const HIDE_KEY = 'tasca:hideAmounts';
let hidden = false;
try {
  hidden = localStorage.getItem(HIDE_KEY) === '1';
} catch {
  // memoria non disponibile: importi visibili
}
export const amountsHidden = () => hidden;
export function setAmountsHidden(value) {
  hidden = value;
  try {
    if (value) localStorage.setItem(HIDE_KEY, '1');
    else localStorage.removeItem(HIDE_KEY);
  } catch {
    // vale finché l'app resta aperta
  }
}

export function euro(cents, { sign = false } = {}) {
  if (hidden) return '•••• €';
  const s = eur.format(Math.abs(cents) / 100);
  if (cents < 0) return '−' + s;
  if (sign && cents > 0) return '+' + s;
  return s;
}

// Accetta "12,50", "1.234,56", "12.5", "€ 30". Restituisce centesimi o NaN.
export function parseAmount(input) {
  let s = String(input ?? '').trim().replace(/[\s€]/g, '');
  if (!s) return NaN;
  let neg = false;
  if (/^[-−]/.test(s)) {
    neg = true;
    s = s.slice(1);
  }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const cents = Math.round(parseFloat(s) * 100);
  return neg ? -cents : cents;
}

// Importo da mostrare in un campo modificabile: "1.234,50" (parseAmount lo rilegge uguale).
const plain = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
export function amountToInput(cents) {
  return plain.format(cents / 100).replace(/[\u2212]/, '-');
}

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function currentMonth() {
  return toISODate().slice(0, 7);
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return capitalize(new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1)));
}

export function dayLabel(iso) {
  const today = toISODate();
  const yesterday = toISODate(new Date(Date.now() - 864e5));
  if (iso === today) return 'Oggi';
  if (iso === yesterday) return 'Ieri';
  const d = parseISODate(iso);
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return capitalize(new Intl.DateTimeFormat('it-IT', opts).format(d));
}

// Primo carattere "visibile" di una stringa (un'emoji composta conta come uno).
export function firstGrapheme(s) {
  if (!s) return '';
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter().segment(s)][0]?.segment ?? '';
  return [...s][0];
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
