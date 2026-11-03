// Regole automatiche: "se la descrizione contiene X → categoria Y" (oppure → trasferimento verso un conto).
// Servono per l'import da file e, più avanti, per i movimenti scaricati dalla banca.

// [parola chiave, nome categoria] oppure [parola chiave, { transferTo: tipo di conto }]
export const DEFAULT_RULES = [
  ...['ESSELUNGA', 'CONAD', 'COOP', 'LIDL', 'CARREFOUR', 'EUROSPIN', 'PAM', 'IPERCOOP', 'PENNY', 'ALDI', 'TIGROS', 'BENNET', 'DESPAR', 'SIMPLY', 'CRAI'].map(
    (k) => [k, 'Spesa'],
  ),
  ...['ENI', 'Q8', 'TAMOIL', 'ESSO', 'ENILIVE', 'IP STATION'].map((k) => [k, 'Carburante']),
  ...['NETFLIX', 'SPOTIFY', 'DISNEY', 'DAZN', 'AMAZON PRIME', 'APPLE.COM', 'YOUTUBE'].map((k) => [k, 'Abbonamenti']),
  ...['ENEL', 'A2A', 'HERA', 'IREN', 'EDISON', 'TIM', 'VODAFONE', 'WINDTRE', 'ILIAD', 'FASTWEB', 'SORGENIA', 'ACEA'].map((k) => [k, 'Bollette']),
  ...['FARMACIA', 'PARAFARMACIA'].map((k) => [k, 'Salute']),
  ...['MCDONALD', 'BURGER KING', 'RISTORANTE', 'PIZZERIA', 'TRATTORIA', 'OSTERIA', 'GLOVO', 'DELIVEROO', 'JUST EAT'].map((k) => [k, 'Ristoranti e bar']),
  ...['TRENITALIA', 'ITALO', 'ATAC', 'UBER', 'FREENOW', 'TELEPASS', 'AUTOSTRADE', 'RYANAIR', 'EASYJET'].map((k) => [k, 'Trasporti']),
  ...['AMAZON', 'ZALANDO', 'DECATHLON', 'IKEA', 'ZARA', 'H&M', 'MEDIAWORLD', 'UNIEURO'].map((k) => [k, 'Shopping']),
  ...['STIPENDIO', 'EMOLUMENTI', 'RETRIBUZIONE'].map((k) => [k, 'Stipendio']),
  ['RIMBORSO', 'Rimborsi'],
  ['PRELIEVO', { transferTo: 'cash' }],
];

// Parole troppo generiche per identificare un negozio.
const STOP_WORDS = new Set(
  `PAGAMENTO PAGAMENTI POS CARTA CARTE DEBITO CREDITO EUR EURO DEL DELLA DELLE DEI ALLE ORE ADDEBITO ADDEBITI ACCREDITO
  BONIFICO BONIFICI SEPA SDD SCT DISPOSIZIONE OPERAZIONE PRESSO ITA ITALIA VIA NUM TRAMITE APP ONLINE INTERNET
  COMMISSIONE COMMISSIONI FAVORE ORDINE RIF CRO TRN BENEF BENEFICIARIO MANDATO DIRETTO CONTACTLESS MASTERCARD VISA
  MAESTRO POSTAMAT BANCOPOSTA POSTEPAY DATA VALUTA ESEGUITO EFFETTUATO CON PER DA AL ALLA SU SRL SPA SNC SAS`.split(/\s+/),
);

export function normalizeText(s) {
  return String(s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Corrispondenza a parola intera: "ENI" trova "ENI STATION" ma non "SERENITA".
export function ruleMatches(rule, description) {
  const kw = normalizeText(rule.keyword);
  if (!kw) return false;
  return new RegExp(`(^|[^A-Z0-9])${escapeRe(kw)}($|[^A-Z0-9])`).test(normalizeText(description));
}

/**
 * La prima regola compatibile con il movimento: una categoria di spesa vale solo per le uscite,
 * una di entrata solo per le entrate; un trasferimento vale per entrambe.
 */
export function findRule(rules, description, isCredit, categoriesById) {
  return rules.find((r) => {
    if (!ruleMatches(r, description)) return false;
    if (r.action === 'transfer') return true;
    const c = categoriesById.get(r.categoryId);
    return c && !c.archived && c.kind === (isCredit ? 'income' : 'expense');
  });
}

// Prima le regole create da te (le più recenti vincono), poi quelle dei conti, poi quelle di partenza
// dalla più specifica.
export const ruleOrder = (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.keyword.length - a.keyword.length;

// Parole troppo comuni nel nome di un conto per riconoscerlo in una descrizione.
const GENERIC_ACCOUNT_WORDS = new Set(['CONTO', 'CONTI', 'CARTA', 'CARTE', 'MIO', 'MIA', 'CONTANTI', 'RISPARMI', 'PERSONALE']);

/**
 * Regole implicite dai nomi dei tuoi conti: se in un movimento di BancoPosta compare "REVOLUT"
 * e hai un conto che si chiama "Revolut", è un trasferimento tra i due, non una spesa.
 */
export function accountRules(accounts, excludeAccountId) {
  const rules = [];
  for (const a of accounts) {
    if (a.archived || a.id === excludeAccountId || a.type === 'cash') continue;
    for (const word of normalizeText(a.name).split(/[^A-Z0-9]+/)) {
      if (word.length >= 4 && !GENERIC_ACCOUNT_WORDS.has(word)) {
        rules.push({ id: `account:${a.id}:${word}`, keyword: word, action: 'transfer', accountId: a.id, createdAt: 1 });
      }
    }
  }
  return rules;
}

// Tutte le regole valide per i movimenti di un conto, nell'ordine in cui vanno provate.
export function rulesForAccount(rules, accounts, accountId) {
  return [...rules.filter((r) => !(r.action === 'transfer' && r.accountId === accountId)), ...accountRules(accounts, accountId)].sort(ruleOrder);
}

// Indovina la parola che identifica il negozio, es. "PAGAMENTO POS ESSELUNGA MILANO" → "ESSELUNGA".
export function guessKeyword(description) {
  const words = normalizeText(description).split(/[^A-Z0-9&']+/);
  return words.find((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP_WORDS.has(w)) ?? '';
}
