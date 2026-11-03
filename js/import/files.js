// Legge un file di movimenti e lo trasforma in una tabella (array di righe di testo).
// Supporta Excel .xlsx, CSV/TXT, tabelle HTML salvate come .xls e il vecchio "XML Excel 2003".

export async function readTable(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(buf);
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new Error(
      'Questo è un file Excel di vecchio formato (.xls) che non riesco a leggere. Aprilo con Numbers o Excel e salvalo come .xlsx oppure .csv, poi riprova.',
    );
  }
  const text = decodeText(buf);
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) return /urn:schemas-microsoft-com:office:spreadsheet/.test(trimmed) ? readXml2003(trimmed) : readHtml(trimmed);
  return parseCSV(text);
}

function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// ---------- CSV ----------

export function parseCSV(text) {
  const sample = text.split(/\r?\n/).slice(0, 30).join('\n');
  const count = (ch) => sample.split(ch).length - 1;
  // Le banche italiane usano quasi sempre ";" (la virgola serve per i decimali).
  const delimiter = count('\t') >= count(';') && count('\t') > 0 ? '\t' : count(';') > 0 ? ';' : ',';

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return clean(rows);
}

function clean(rows) {
  return rows.map((r) => r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim())).filter((r) => r.some(Boolean));
}

// ---------- HTML e XML 2003 ----------

function readHtml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const tables = [...doc.querySelectorAll('table')];
  if (!tables.length) throw new Error('Nel file non c\'è nessuna tabella di movimenti.');
  const table = tables.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
  return clean([...table.rows].map((tr) => [...tr.cells].map((td) => td.textContent)));
}

function readXml2003(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const rows = [];
  for (const r of doc.getElementsByTagName('Row')) {
    const row = [];
    for (const c of r.getElementsByTagName('Cell')) {
      const index = Number(c.getAttribute('ss:Index'));
      while (index && row.length < index - 1) row.push('');
      row.push(c.textContent);
    }
    rows.push(row);
  }
  return clean(rows);
}

// ---------- XLSX (zip + XML), senza librerie ----------

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unzip(buf) {
  const view = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Il file Excel sembra danneggiato.');
  const dec = new TextDecoder();
  const entries = new Map();
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0, n = view.getUint16(eocd + 10, true); i < n; i++) {
    const nameLen = view.getUint16(p + 28, true);
    entries.set(dec.decode(new Uint8Array(buf, p + 46, nameLen)), {
      method: view.getUint16(p + 10, true),
      size: view.getUint32(p + 20, true),
      offset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return {
    names: [...entries.keys()],
    async read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
      const data = new Uint8Array(buf, start, e.size);
      return dec.decode(e.method === 0 ? data : await inflateRaw(data));
    },
  };
}

const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(buf) {
  if (typeof DecompressionStream !== 'function') throw new Error('Questo browser non sa leggere i file Excel: usa un CSV.');
  const zip = unzip(buf);
  const sheetName = zip.names.includes('xl/worksheets/sheet1.xml')
    ? 'xl/worksheets/sheet1.xml'
    : zip.names.find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetName) throw new Error('Nel file Excel non trovo nessun foglio.');

  const sharedXml = await zip.read('xl/sharedStrings.xml');
  const shared = sharedXml
    ? [...xml(sharedXml).getElementsByTagName('si')].map((si) =>
        [...si.getElementsByTagName('t')].filter((t) => t.parentNode.nodeName !== 'rPh').map((t) => t.textContent).join(''),
      )
    : [];

  const rows = [];
  for (const r of xml(await zip.read(sheetName)).getElementsByTagName('row')) {
    const row = [];
    for (const c of r.getElementsByTagName('c')) {
      const index = columnIndex(c.getAttribute('r') || '');
      while (row.length < index) row.push('');
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      if (type === 's') row.push(shared[Number(v)] ?? '');
      else if (type === 'inlineStr') row.push(c.getElementsByTagName('t')[0]?.textContent ?? '');
      else row.push(v);
    }
    rows.push(row);
  }
  return clean(rows);
}
