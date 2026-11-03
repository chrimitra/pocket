// Avvia la sincronizzazione con la banca e mostra il risultato.
import { completeLink, getBank, needsSync, syncAll } from './bank.js';
import { refresh, state } from './state.js';
import { toast } from './ui/sheet.js';

let running = null;

export function runSync({ manual = false } = {}) {
  if (!running) {
    running = (async () => {
      try {
        const summary = await syncAll(state.data);
        await refresh();
        if (summary.errors.length) toast(summary.errors[0], 'warn');
        else if (summary.added || summary.matched) {
          const parts = [`${summary.added} nuovi movimenti`];
          if (summary.matched) parts.push(`${summary.matched} già presenti abbinati`);
          if (summary.toReview) parts.push(`${summary.toReview} da rivedere`);
          toast(parts.join(' · '));
        } else if (manual) toast('Nessun movimento nuovo');
      } catch (err) {
        toast(err.message, 'over');
      } finally {
        running = null;
      }
    })();
  }
  return running;
}

// All'apertura: aggiorna da solo se sono passate alcune ore dall'ultimo aggiornamento.
export async function autoSync() {
  if (!navigator.onLine) return;
  const cfg = await getBank();
  if (cfg.serverUrl && needsSync(cfg)) await runSync();
}

// Ritorno dalla pagina della banca: l'indirizzo contiene ?code=...&state=... (oppure ?error=...).
export async function handleBankReturn() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  history.replaceState(null, '', location.pathname + '#/banca');
  if (params.has('error')) {
    toast(params.get('error') === 'access_denied' ? 'Collegamento annullato' : `La banca ha risposto: ${params.get('error')}`, 'warn');
    return true;
  }
  try {
    await completeLink(params.get('code'), params.get('state'));
    toast('BancoPosta collegato ✓ Scarico i movimenti…');
    await refresh();
    await runSync({ manual: true });
  } catch (err) {
    toast(err.message, 'over');
  }
  return true;
}
