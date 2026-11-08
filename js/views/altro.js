import { amountsHidden, esc, euro, firstGrapheme, setAmountsHidden, toISODate } from '../format.js';
import { disableLock, enableLock, lockEnabled, lockSupported } from '../lock.js';
import { monthlyTotal } from '../recurring.js';
import { CATEGORY_COLORS, deleteCategory, exportData, importData, saveCategory, wipe } from '../store.js';
import { refresh, state } from '../state.js';
import { getTheme, setTheme } from '../theme.js';
import { navRow, pageHeader } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { openSheet, showError, toast } from '../ui/sheet.js';

export const APP_VERSION = '1.1';

export const title = 'Impostazioni';

export function render(el, data) {
  const group = (kind, label) => {
    const list = data.categories.filter((c) => c.kind === kind);
    return `
      <h2 class="section-title">${label}</h2>
      <section class="card flush rows">
        ${list
          .map(
            (c) => `
          <button class="row ${c.archived ? 'archived' : ''}" data-cat="${esc(c.id)}">
            <span class="row-icon emoji" style="--c:${esc(c.color)}">${esc(c.icon)}</span>
            <span class="row-main"><span class="row-title">${esc(c.name)}</span>${c.archived ? '<span class="row-sub">Archiviata</span>' : ''}</span>
            <span class="row-chevron">${icon('chevron-right')}</span>
          </button>`,
          )
          .join('')}
        <button class="row add" data-new="${kind}"><span class="row-icon tone-primary">${icon('plus')}</span><span class="row-main"><span class="row-title">Nuova categoria</span></span></button>
      </section>`;
  };
  const connections = data.bank?.connections?.length ?? 0;
  const theme = getTheme();

  el.innerHTML = `
    ${pageHeader('Impostazioni', { back: { href: '#/home', label: 'Home' } })}

    <h2 class="section-title">Aspetto</h2>
    <div class="segmented with-icons" role="radiogroup" aria-label="Aspetto">
      ${[
        ['auto', 'contrast', 'Automatico'],
        ['light', 'sun', 'Chiaro'],
        ['dark', 'moon', 'Scuro'],
      ]
        .map(([v, i, l]) => `<button type="button" role="radio" data-theme-choice="${v}" aria-checked="${theme === v}">${icon(i)}${l}</button>`)
        .join('')}
    </div>

    <h2 class="section-title">Conti e movimenti</h2>
    <section class="card flush rows">
      ${navRow({ href: '#/conti', iconName: 'wallet', title: 'Conti', sub: 'Saldi, nuovi conti, archiviati' })}
      ${navRow({
        href: '#/ricorrenti',
        iconName: 'repeat',
        title: 'Spese ricorrenti',
        sub: data.recurring.length
          ? `${data.recurring.length} attive · ${euro(monthlyTotal(data.recurring, 'expense'))} al mese di spese fisse`
          : 'Affitto, bollette, abbonamenti, stipendio',
        tone: 'primary',
      })}
      ${navRow({ href: '#/importa', iconName: 'file', title: 'Importa da file', sub: 'Excel di BancoPosta o Revolut', tone: 'blue' })}
      ${navRow({ href: '#/regole', iconName: 'wand', title: 'Regole automatiche', sub: `${data.rules.length} regole che scelgono la categoria per te`, tone: 'violet' })}
      ${navRow({
        href: '#/banca',
        iconName: 'link',
        title: 'Collegamento banca',
        sub: connections ? `${connections} collegamento attivo` : 'Facoltativo · scarica i movimenti da solo',
        tone: 'neutral',
      })}
    </section>

    <h2 class="section-title">Privacy</h2>
    <section class="card flush rows">
      <label class="row">
        <span class="row-icon tone-neutral">${icon('eye-off')}</span>
        <span class="row-main"><span class="row-title">Nascondi gli importi</span><span class="row-sub">Mostra ••• al posto delle cifre (anche con l'occhio in Home)</span></span>
        <input type="checkbox" role="switch" class="switch" id="hide-amounts" ${amountsHidden() ? 'checked' : ''}>
      </label>
      <label class="row" id="lock-row">
        <span class="row-icon tone-neutral">${icon('faceid')}</span>
        <span class="row-main"><span class="row-title">Blocca con Face ID</span><span class="row-sub" id="lock-sub">All'apertura Tasca chiede Face ID o il codice dell'iPhone</span></span>
        <input type="checkbox" role="switch" class="switch" id="lock-switch" ${lockEnabled() ? 'checked' : ''}>
      </label>
    </section>

    ${group('expense', 'Categorie di spesa')}
    ${group('income', 'Categorie di entrata')}

    <h2 class="section-title">I tuoi dati</h2>
    <section class="card flush rows">
      ${navRow({ tag: 'button', id: 'export', iconName: 'upload', title: 'Esporta backup', sub: 'Salva un file con tutti i dati, ad esempio su iCloud Drive', tone: 'blue' })}
      ${navRow({ tag: 'label', iconName: 'download', title: 'Ripristina backup', sub: 'Sostituisce i dati di adesso con quelli del file', tone: 'neutral', attrs: 'for="import-file"' })}
      ${navRow({ tag: 'button', id: 'wipe', iconName: 'trash', title: 'Cancella tutti i dati', danger: true })}
    </section>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <p class="hint-text">${icon('shield')} I tuoi dati restano solo su questo telefono, non vengono inviati a nessuno. Per non perderli se cambi o perdi il telefono, esporta un backup una volta al mese.</p>

    <h2 class="section-title">Installa su iPhone</h2>
    <section class="card">
      <ol class="steps">
        <li>Apri Tasca in <strong>Safari</strong>.</li>
        <li>Tocca <strong>Condividi</strong> (il quadrato con la freccia in su).</li>
        <li>Scegli <strong>Aggiungi alla schermata Home</strong>.</li>
      </ol>
    </section>

    <p class="footnote">Tasca · versione ${APP_VERSION}</p>`;

  el.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => openCategorySheet(data.categories.find((c) => c.id === b.dataset.cat))),
  );
  el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openCategorySheet(null, b.dataset.new)));
  el.querySelectorAll('[data-theme-choice]').forEach((b) =>
    b.addEventListener('click', () => {
      setTheme(b.dataset.themeChoice);
      render(el, data);
    }),
  );
  el.querySelector('#hide-amounts').addEventListener('change', async (e) => {
    setAmountsHidden(e.target.checked);
    await refresh();
  });
  const lockSwitch = el.querySelector('#lock-switch');
  lockSupported().then((ok) => {
    if (ok || lockEnabled()) return;
    lockSwitch.disabled = true;
    el.querySelector('#lock-sub').textContent = 'Non disponibile su questo dispositivo o browser';
  });
  lockSwitch.addEventListener('change', async () => {
    const wanted = lockSwitch.checked;
    try {
      if (wanted) {
        await enableLock();
        toast('Blocco attivo: la prossima volta Tasca chiederà Face ID');
      } else {
        await disableLock();
        toast('Blocco disattivato');
      }
    } catch {
      lockSwitch.checked = !wanted;
      toast(wanted ? 'Blocco non attivato' : 'Serve Face ID per disattivare il blocco', 'warn');
    }
  });
  el.querySelector('#export').addEventListener('click', exportBackup);
  el.querySelector('#import-file').addEventListener('change', importBackup);
  el.querySelector('#wipe').addEventListener('click', async () => {
    if (!confirm('Cancellare tutti i conti, le categorie e i movimenti? Non si può annullare.')) return;
    await wipe();
    toast('Dati cancellati');
    await refresh();
  });
}

function openCategorySheet(category, kind = category?.kind) {
  const { categories, transactions } = state.data;
  const used = category && (transactions.some((t) => t.categoryId === category.id) || state.data.recurring.some((r) => r.categoryId === category.id));

  openSheet({
    title: category ? 'Modifica categoria' : 'Nuova categoria',
    body: `
      <div class="fields">
        <label class="field"><span>Icona</span><input id="c-icon" class="emoji-input" maxlength="8" placeholder="🙂" value="${esc(category?.icon ?? '')}"></label>
        <label class="field"><span>Nome</span><input id="c-name" maxlength="30" placeholder="Es. Palestra" value="${esc(category?.name ?? '')}"></label>
        ${category ? `<label class="field toggle"><span>Archiviata</span><input type="checkbox" id="c-archived" ${category.archived ? 'checked' : ''}></label>` : ''}
      </div>
      <p class="hint-text">Per l'icona scegli un'emoji dalla tastiera (il tasto con la faccina). Le categorie archiviate non compaiono più tra le scelte, ma i vecchi movimenti le mantengono.</p>
      <p class="form-error" hidden></p>
      ${category && !used ? `<button type="button" class="btn danger-text block" id="c-delete">${icon('trash')}Elimina categoria</button>` : ''}`,
    footer: `<button type="button" class="btn primary block" id="c-save">${category ? 'Salva modifiche' : 'Crea categoria'}</button>`,
    onMount(el, close) {
      el.querySelector('#c-save').addEventListener('click', async () => {
        const name = el.querySelector('#c-name').value.trim();
        const icon = firstGrapheme(el.querySelector('#c-icon').value.trim()) || '•';
        if (!name) return showError(el, 'Dai un nome alla categoria');
        await saveCategory({
          ...category,
          kind,
          name,
          icon,
          color: category?.color ?? CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
          order: category?.order ?? categories.length,
          archived: el.querySelector('#c-archived')?.checked ?? false,
        });
        close();
        toast('Categoria salvata');
        await refresh();
      });
      el.querySelector('#c-delete')?.addEventListener('click', async () => {
        if (!confirm(`Eliminare la categoria «${category.name}»?`)) return;
        await deleteCategory(category.id);
        close();
        toast('Categoria eliminata');
        await refresh();
      });
    },
  });
}

async function exportBackup() {
  const data = await exportData();
  const file = new File([JSON.stringify(data, null, 2)], `tasca-backup-${toISODate()}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Backup Tasca' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm('Ripristinare questo backup? I dati attuali verranno sostituiti.')) return;
    await importData(data);
    toast('Backup ripristinato');
    await refresh();
  } catch (err) {
    alert(err instanceof SyntaxError ? 'Il file non è leggibile.' : err.message);
  }
}
