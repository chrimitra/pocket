# Tasca – finanze personali (PWA)

App web installabile su iPhone per registrare movimenti, conti e spese.
HTML, CSS e JavaScript puri: nessuna dipendenza e nessuna compilazione.

**App online:** https://chrimitra.github.io/pocket/ (pubblicata con GitHub Pages dal branch `main`).
Per pubblicare un aggiornamento: alzare `CACHE` in `sw.js`, poi commit e push.

## Avviarla sul Mac

```bash
python3 -m http.server 5173
```

Poi apri http://localhost:5173.

## Struttura

- `index.html`: guscio dell'app e barra in basso
- `css/app.css`: stile, con modalità chiara e scura automatiche
- `js/db.js`: salvataggio nel database del browser (IndexedDB)
- `js/store.js`: conti, categorie, movimenti, calcolo dei saldi
- `js/views/`: le schermate (Home, Movimenti, Budget, Grafici, Conti, Impostazioni)
- `js/analytics.js`, `js/ui/charts.js`: calcoli e grafici SVG (nessuna libreria esterna)
- `js/import/`: lettura dei file (xlsx, csv, html), riconoscimento colonne, revisione e doppioni
- `js/rules.js`: regole automatiche "descrizione contiene X → categoria Y"
- `js/bank.js`, `js/bank-sync.js`, `js/sync.js`: collegamento banca, abbinamento con i movimenti esistenti, aggiornamento automatico
- `server/supabase/functions/banca/index.ts`: funzione server che firma le richieste a Enable Banking (vedi `GUIDA-BANCA.md`)
- `js/ui/`: pannello dal basso e modulo dei movimenti
- `sw.js`: funzionamento offline (alzare `CACHE` a ogni pubblicazione)
- `manifest.json`, `icons/`: installazione sulla schermata Home

Gli importi sono salvati in centesimi interi, così i calcoli non hanno errori di arrotondamento.

## Stato del piano

- [x] Fase 0 – Basi e design
- [x] Fase 1 – Conti, movimenti, categorie, offline, installabile
- [x] Fase 2 – Budget mensili per categoria, avvisi, obiettivi di risparmio
- [x] Fase 3 – Grafici: saldo nel tempo, entrate/uscite per mese, spese per categoria, medie
- [x] Fase 4 – Import da file (Excel .xlsx, CSV) di BancoPosta e Revolut, con regole automatiche e anti-doppioni
- [x] Fase 5 – Collegamento BancoPosta via Enable Banking (codice pronto; da configurare con GUIDA-BANCA.md)
- [ ] Fase 6 – Login, sincronizzazione cloud (Supabase), pubblicazione
