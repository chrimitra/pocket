// Grafici SVG disegnati a mano: linea con mirino e colonne raggruppate, con tooltip al tocco.
// Gli importi arrivano in centesimi; gli assi mostrano euro interi.
const NS = 'http://www.w3.org/2000/svg';
const tickFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function niceTicks(min, max, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function frame(container, height, ticks) {
  container.textContent = '';
  container.classList.add('chart');
  const width = Math.max(260, container.clientWidth);
  const labelW = Math.max(...ticks.map((t) => tickFormat.format(t).length)) * 7 + 10;
  const pad = { top: 28, right: 14, bottom: 24, left: labelW };
  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, tabindex: 0 }, container);
  const plot = { x: pad.left, y: pad.top, w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (euros) => plot.y + plot.h - ((euros - lo) / (hi - lo)) * plot.h;

  for (const t of ticks) {
    el('line', { x1: plot.x, x2: plot.x + plot.w, y1: y(t), y2: y(t), class: t === 0 ? 'baseline' : 'grid' }, svg);
    const label = el('text', { x: plot.x - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg);
    label.textContent = tickFormat.format(t);
  }

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.appendChild(tip);
  return { svg, plot, y, tip, width };
}

function xLabels(svg, plot, positions, labels, maxLabels) {
  const every = Math.ceil(labels.filter(Boolean).length / maxLabels);
  let shown = 0;
  labels.forEach((text, i) => {
    if (!text) return;
    if (shown++ % every) return;
    const node = el('text', { x: positions[i], y: plot.y + plot.h + 17, 'text-anchor': 'middle', class: 'tick' }, svg);
    node.textContent = text;
  });
}

function placeTip(tip, x, width) {
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(0, x - w / 2), width - w)}px`;
}

function tipRow(value, name, cls) {
  const row = document.createElement('div');
  row.className = 'tip-row';
  if (cls) {
    const key = document.createElement('span');
    key.className = `tip-key ${cls}`;
    row.appendChild(key);
  }
  const strong = document.createElement('strong');
  strong.textContent = value;
  row.appendChild(strong);
  if (name) {
    const span = document.createElement('span');
    span.textContent = name;
    row.appendChild(span);
  }
  return row;
}

// Collega mouse, dito e tastiera a una funzione show(index).
function interact(svg, count, indexAt, show, hide) {
  let current = count - 1;
  const fromEvent = (e) => {
    const rect = svg.getBoundingClientRect();
    current = indexAt(e.clientX - rect.left);
    show(current);
  };
  svg.addEventListener('pointerdown', fromEvent);
  svg.addEventListener('pointermove', fromEvent);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(current));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    current = Math.min(count - 1, Math.max(0, current + (e.key === 'ArrowRight' ? 1 : -1)));
    show(current);
  });
}

/**
 * Linea singola (es. saldo nel tempo).
 * points: [{ value (centesimi), label (per il tooltip), tick (etichetta asse X o '') }]
 */
export function lineChart(container, { points, format, height = 210, ariaLabel }) {
  const values = points.map((p) => p.value / 100);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const { svg, plot, y, tip, width } = frame(container, height, ticks);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);

  const n = points.length;
  const x = (i) => plot.x + (n === 1 ? plot.w : (i / (n - 1)) * plot.w);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  el('path', { d: `${line}L${x(n - 1)},${plot.y + plot.h}L${x(0)},${plot.y + plot.h}Z`, class: 'area s1' }, svg);
  el('path', { d: line, class: 'line s1' }, svg);
  xLabels(svg, plot, points.map((_, i) => x(i)), points.map((p) => p.tick), Math.floor(plot.w / 48));

  // Etichetta diretta solo sull'ultimo punto.
  const endX = x(n - 1);
  const endY = y(values[n - 1]);
  el('circle', { cx: endX, cy: endY, r: 4, class: 'dot s1' }, svg);
  const endLabel = el('text', { x: endX, y: endY - 12, 'text-anchor': 'end', class: 'value-label' }, svg);
  endLabel.textContent = format(points[n - 1].value);

  const cross = el('line', { y1: plot.y, y2: plot.y + plot.h, class: 'crosshair' }, svg);
  const marker = el('circle', { r: 4, class: 'dot s1' }, svg);
  cross.style.display = marker.style.display = 'none';

  interact(
    svg,
    n,
    (px) => Math.round(Math.min(1, Math.max(0, (px - plot.x) / plot.w)) * (n - 1)),
    (i) => {
      cross.style.display = marker.style.display = '';
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      marker.setAttribute('cx', x(i));
      marker.setAttribute('cy', y(values[i]));
      tip.replaceChildren(tipRow(format(points[i].value)), tipRow('', points[i].label));
      placeTip(tip, x(i), width);
    },
    () => {
      cross.style.display = marker.style.display = 'none';
      tip.hidden = true;
    },
  );
}

/**
 * Colonne raggruppate (es. entrate e uscite per mese).
 * groups: [{ tick, label, values: [centesimi per serie], extra?: string }]
 * series: [{ name, cls }]  — cls è la classe colore (s1, s2)
 */
export function columnChart(container, { groups, series, format, height = 220, ariaLabel }) {
  const max = Math.max(0, ...groups.flatMap((g) => g.values)) / 100;
  const ticks = niceTicks(0, max || 1);
  const { svg, plot, y, tip, width } = frame(container, height, ticks);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ariaLabel);

  const n = groups.length;
  const band = plot.w / n;
  const gap = 2;
  const barW = Math.max(3, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const centers = groups.map((_, i) => plot.x + band * i + band / 2);
  const base = y(0);

  const highlight = el('rect', { y: plot.y, height: plot.h, width: band, class: 'band-hover' }, svg);
  highlight.style.display = 'none';

  groups.forEach((g, i) => {
    g.values.forEach((v, s) => {
      if (!v) return;
      const top = y(v / 100);
      const h = base - top;
      const r = Math.min(4, h, barW / 2);
      const x0 = centers[i] - groupW / 2 + s * (barW + gap);
      const x1 = x0 + barW;
      // Angoli arrotondati in cima, squadrati sulla base.
      const d = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x1 - r}Q${x1},${top} ${x1},${top + r}V${base}Z`;
      el('path', { d, class: `bar ${series[s].cls}` }, svg);
    });
  });
  xLabels(svg, plot, centers, groups.map((g) => g.tick), Math.floor(plot.w / 34));

  interact(
    svg,
    n,
    (px) => Math.min(n - 1, Math.max(0, Math.floor((px - plot.x) / band))),
    (i) => {
      highlight.style.display = '';
      highlight.setAttribute('x', plot.x + band * i);
      const rows = [tipRow('', groups[i].label)];
      series.forEach((s, k) => rows.push(tipRow(format(groups[i].values[k]), s.name, s.cls)));
      if (groups[i].extra) rows.push(tipRow('', groups[i].extra));
      tip.replaceChildren(...rows);
      placeTip(tip, centers[i], width);
    },
    () => {
      highlight.style.display = 'none';
      tip.hidden = true;
    },
  );
}

export function legend(series) {
  return `<div class="legend">${series
    .map((s) => `<span><i class="swatch ${s.cls}"></i>${s.name}</span>`)
    .join('')}</div>`;
}
