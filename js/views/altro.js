import { esc, firstGrapheme, toISODate } from '../format.js';
import { CATEGORY_COLORS, deleteCategory, exportData, importData, saveCategory, wipe } from '../store.js';
import { refresh, state } from '../state.js';
import { openSheet, showError, toast } from '../ui/sheet.js';

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
            <span class="row-icon" style="--c:${esc(c.color)}">${esc(c.icon)}</span>
            <span class="row-main"><span class="row-title">${esc(c.name)}</span>${c.archived ? '<span class="row-sub">Archiviata</span>' : ''}</span>
            <span class="row-chevron" aria-hidden="true">›</span>
          </button>`,
          )
          .join('')}
        <button class="row add" data-new="${kind}"><span class="row-icon">＋</span><span class="row-main"><span class="row-title">Nuova categoria</span></span></button>
      </section>`;
  };

  el.innerHTML = `
    <header class="page-header"><a class="back" href="#/home">‹ Home</a><h1>Impostazioni</h1></header>
    <section class="card flush rows">
      <a class="row" href="#/conti">
        <span class="row-icon">🏦</span>
        <span class="row-main"><span class="row-title">Conti</span><span class="row-sub">Saldi, nuovi conti, archiviati</span></span>
        <span class="row-chevron" aria-hidden="true">›</span>
      </a>
      <a class="row" href="#/banca">
        <span class="row-icon">🏤</span>
        <span class="row-main"><span class="row-title">Collegamento banca</span><span class="row-sub">${
          data.bank?.connections?.length ? `${data.bank.connections.length} collegamento attivo` : 'Scarica i movimenti da BancoPosta'
        }</span></span>
        <span class="row-chevron" aria-hidden="true">›</span>
      </a>
      <a class="row" href="#/importa">
        <span class="row-icon">📥</span>
        <span class="row-main"><span class="row-title">Importa da file</span><span class="row-sub">Lista movimenti BancoPosta (Excel o CSV)</span></span>
        <span class="row-chevron" aria-hidden="true">›</span>
      </a>
      <a class="row" href="#/regole">
        <span class="row-icon">🪄</span>
        <span class="row-main"><span class="row-title">Regole automatiche</span><span class="row-sub">${data.rules.length} regole per categorizzare</span></span>
        <span class="row-chevron" aria-hidden="true">›</span>
      </a>
    </section>
    ${group('expense', 'Categorie di spesa')}
    ${group('income', 'Categorie di entrata')}

    <h2 class="section-title">I tuoi dati</h2>
    <section class="card flush rows">
      <button class="row" id="export"><span class="row-icon">⬆️</span><span class="row-main"><span class="row-title">Esporta backup</span><span class="row-sub">Salva un file con tutti i dati</span></span></button>
      <label class="row" for="import-file"><span class="row-icon">⬇️</span><span class="row-main"><span class="row-title">Ripristina backup</span><span class="row-sub">Sostituisce i dati attuali</span></span></label>
      <button class="row danger" id="wipe"><span class="row-icon">🗑️</span><span class="row-main"><span class="row-title">Cancella tutti i dati</span></span></button>
    </section>
    <input type="file" id="import-file" accept="application/json,.json" hidden>

    <h2 class="section-title">Installa su iPhone</h2>
    <section class="card">
      <ol class="steps">
        <li>Apri Tasca in <strong>Safari</strong>.</li>
        <li>Tocca <strong>Condividi</strong> (il quadrato con la freccia verso l'alto).</li>
        <li>Scegli <strong>Aggiungi alla schermata Home</strong>.</li>
      </ol>
    </section>

    <p class="footnote">Per ora i dati sono salvati solo su questo dispositivo. Fai un backup ogni tanto: la sincronizzazione sul cloud arriverà in una fase successiva.<br>Tasca · versione 0.5</p>`;

  el.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => openCategorySheet(data.categories.find((c) => c.id === b.dataset.cat))),
  );
  el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openCategorySheet(null, b.dataset.new)));
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
  const used = category && transactions.some((t) => t.categoryId === category.id);

  openSheet({
    title: category ? 'Modifica categoria' : 'Nuova categoria',
    body: `
      <div class="fields">
        <label class="field"><span>Icona</span><input id="c-icon" class="emoji-input" maxlength="8" placeholder="🙂" value="${esc(category?.icon ?? '')}"></label>
        <label class="field"><span>Nome</span><input id="c-name" maxlength="30" placeholder="Es. Palestra" value="${esc(category?.name ?? '')}"></label>
        ${category ? `<label class="field toggle"><span>Archiviata</span><input type="checkbox" id="c-archived" ${category.archived ? 'checked' : ''}></label>` : ''}
      </div>
      <p class="hint-text">Per l'icona usa un'emoji dalla tastiera. Le categorie archiviate non compaiono più tra le scelte, ma i vecchi movimenti le mantengono.</p>
      <p class="form-error" hidden></p>
      <button type="button" class="btn primary block" id="c-save">Salva</button>
      ${category && !used ? '<button type="button" class="btn danger block" id="c-delete">Elimina categoria</button>' : ''}`,
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
