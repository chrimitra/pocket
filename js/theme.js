// Aspetto dell'app: automatico (come l'iPhone), chiaro o scuro. La scelta resta su questo dispositivo.
const KEY = 'tasca:theme';
const BAR = { light: '#F3F5F4', dark: '#0D1110' };

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function setTheme(theme) {
  try {
    if (theme === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Memoria non disponibile: il tema vale finché l'app resta aperta.
  }
  applyTheme(theme);
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Colore della barra di stato: segue il tema scelto oppure quello del sistema.
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((m, i) => {
    const mode = i === 0 ? 'light' : 'dark';
    if (theme === 'auto') {
      m.setAttribute('media', `(prefers-color-scheme: ${mode})`);
      m.setAttribute('content', BAR[mode]);
    } else {
      m.removeAttribute('media');
      m.setAttribute('content', BAR[theme]);
    }
  });
}
