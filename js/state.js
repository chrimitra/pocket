// Stato condiviso: i dati caricati dal database e il ridisegno della vista corrente.
import { loadAll } from './store.js';

export const state = { data: null };

let renderFn = () => {};

export function onChange(fn) {
  renderFn = fn;
}

export async function refresh() {
  state.data = await loadAll();
  renderFn();
}
