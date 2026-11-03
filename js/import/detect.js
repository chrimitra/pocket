// Riconosce intestazioni e colonne di un estratto conto e trasforma le righe in movimenti.
import { parseAmount } from '../format.js';

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const MONEY = /importo|ammontare|addebit|accredit|^dare|^avere|uscit|entrat|^amount/;
const DATE = /^data|date/;

// Le banche spesso mettono qualche riga di intestazione (titolare, IBAN...) prima della tabella.
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(norm);
    if (cells.some((c) => DATE.test(c)) && cells.some((c) => MONEY.test(c))) return i;
  }
  return -1;
}

// L'estratto conto di Revolut ha colonne riconoscibili: Prodotto/Product e Stato/State.
export function isRevolut(header) {
  const h = header.map(norm);
  return h.some((c) => /^(product|prodotto)$/.test(c)) && h.some((c) => /^(state|stato)$/.test(c));
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
    // Per Revolut conta la data di completamento: quella di inizio può essere anteriore.
    date: find(/^data cont/, /^data oper/, /complet/, /^data reg/, /^data$/, /^date$/, /^data(?!.*valuta)/, /^data/, /date/),
    description: find(/descri/, /causale/, /dettagl/, /^operazione/, /movimento/, /beneficiario/),
    amount: find(/^importo/, /^amount/, /ammontare/),
    debit: find(/addebit/, /^dare/, /uscit/),
    credit: find(/accredit/, /^avere/, /entrat/),
    // Colonne facoltative (presenti ad esempio nel file di Revolut).
    fee: find(/^fee/, /^commission/),
    state: find(/^state$/, /^stato$/),
    type: find(/^type$/, /^tipo$/),
    currency: find(/^currency$/, /^valuta$/),
  };
}

const COMPLETED = /^(completed|completat[oa])$/i;
const TOP_UP = /top.?up|ricarica/i;

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

/**
 * Converte una riga in { date, cents (negativo = uscita), description, topUp } oppure null se non è un
 * movimento da importare: righe vuote, operazioni annullate o in attesa, valute diverse dall'euro.
 */
export function toRecord(row, map) {
  if (map.state >= 0 && !COMPLETED.test(String(row[map.state] ?? '').trim())) return null;
  if (map.currency >= 0 && row[map.currency] && String(row[map.currency]).trim().toUpperCase() !== 'EUR') return null;
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
  // La commissione è separata dall'importo: la togliamo, così il saldo torna.
  const fee = map.fee >= 0 ? parseLooseAmount(row[map.fee]) : NaN;
  if (fee) cents -= Math.abs(fee);
  const description = String(row[map.description] ?? '').replace(/\s+/g, ' ').trim() || 'Movimento senza descrizione';
  const topUp = map.type >= 0 && TOP_UP.test(String(row[map.type] ?? ''));
  return { date, cents, description, topUp };
}

export function columnName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
