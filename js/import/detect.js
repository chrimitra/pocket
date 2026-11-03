// Riconosce intestazioni e colonne di un estratto conto e trasforma le righe in movimenti.
import { parseAmount } from '../format.js';

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const MONEY = /importo|ammontare|addebit|accredit|^dare|^avere|uscit|entrat/;

// Le banche spesso mettono qualche riga di intestazione (titolare, IBAN...) prima della tabella.
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(norm);
    if (cells.some((c) => c.startsWith('data')) && cells.some((c) => MONEY.test(c))) return i;
  }
  return -1;
}

export function detectColumns(header) {
  const h = header.map(norm);
  const find = (...patterns) => {
    for (const re of patterns) {
      const i = h.findIndex((c) => re.test(c));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    date: find(/^data cont/, /^data oper/, /^data reg/, /^data$/, /^data(?!.*valuta)/, /^data/),
    description: find(/descri/, /causale/, /dettagl/, /^operazione/, /movimento/, /beneficiario/),
    amount: find(/^importo/, /ammontare/),
    debit: find(/addebit/, /^dare/, /uscit/),
    credit: find(/accredit/, /^avere/, /entrat/),
  };
}

export function isValidMapping(m) {
  return m.date >= 0 && m.description >= 0 && (m.amount >= 0 || m.debit >= 0 || m.credit >= 0);
}

const pad = (n) => String(n).padStart(2, '0');

export function parseDate(value) {
  const s = String(value ?? '').trim();
  // Numero seriale di Excel (giorni dal 30/12/1899).
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  let y, m, d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [, y, m, d] = match.map(Number);
  else if ((match = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/))) {
    [, d, m, y] = match.map(Number);
    if (y < 100) y += 2000;
  } else return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Come parseAmount, ma tollera "EUR", "+", e il segno meno in fondo ("12,50-").
export function parseLooseAmount(value) {
  let s = String(value ?? '').replace(/eur|€|\s| /gi, '').replace(/^\+/, '');
  if (!s) return NaN;
  if (/[-−]$/.test(s)) s = '-' + s.slice(0, -1);
  // Excel salva i numeri con tutti i decimali (es. 23.900000000000002).
  if (/^-?\d+\.\d{4,}$/.test(s)) return Math.round(Number(s) * 100);
  return parseAmount(s);
}

// Converte una riga in { date, cents (negativo = uscita), description } oppure null se non è un movimento.
export function toRecord(row, map) {
  const date = parseDate(row[map.date]);
  if (!date) return null;
  let cents = NaN;
  if (map.amount >= 0) cents = parseLooseAmount(row[map.amount]);
  else {
    const debit = map.debit >= 0 ? parseLooseAmount(row[map.debit]) : NaN;
    const credit = map.credit >= 0 ? parseLooseAmount(row[map.credit]) : NaN;
    if (debit) cents = -Math.abs(debit);
    else if (credit) cents = Math.abs(credit);
  }
  if (!cents || Number.isNaN(cents)) return null;
  const description = String(row[map.description] ?? '').replace(/\s+/g, ' ').trim() || 'Movimento senza descrizione';
  return { date, cents, description };
}

export function columnName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
