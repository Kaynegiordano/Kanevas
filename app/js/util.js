// Outils communs : espace de noms, bus d'événements, DOM, canevas, couleurs.
'use strict';
const KS = window.KS = {
  native: window.ksNative || null,
  state: { docs: [], doc: null, tool: 'brush', fg: { r: 0, g: 0, b: 0 }, bg: { r: 255, g: 255, b: 255 }, clipboard: null, quickMask: false },
};

/* ---------------------------------------------------------------- bus */
(() => {
  const handlers = {};
  KS.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return fn; };
  KS.off = (ev, fn) => { const h = handlers[ev]; if (h) { const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); } };
  KS.emit = (ev, ...args) => { (handlers[ev] || []).slice().forEach(fn => { try { fn(...args); } catch (e) { console.error(ev, e); } }); };
})();

/* ---------------------------------------------------------------- préférences */
KS.prefs = (() => {
  const defaults = {
    autoRecovery: true, recoveryInterval: 30, editableAdjustments: true,
    theme: 'light', accent: '#2f6fdb', historySize: 60, wheelZoom: true, rulers: true, gridSize: 64, gridSub: 4,
    gridColor: 'rgba(120,160,255,0.35)', guideColor: '#00d4ff', snap: true, showGrid: false, showGuides: true,
    pixelGrid: true, checker: 8, dockWidth: 300, recent: [], swatches: null, toolOpts: {}, panels: {},
  };
  let data = {};
  try { data = JSON.parse(localStorage.getItem('kanevas.prefs') || localStorage.getItem('kaneshop.prefs') || '{}'); } catch { data = {}; }
  // Une seule migration de la palette par défaut ; garder les accents personnalisés.
  if (!data.kanevasPalette) {
    if (!data.theme || data.theme === 'dark') data.theme = 'light';
    if (!data.accent || data.accent === '#3d7cf0') data.accent = '#2f6fdb';
    data.kanevasPalette = true;
  }
  const p = Object.assign({}, defaults, data);
  p.save = () => { try { const o = {}; for (const k in p) if (typeof p[k] !== 'function') o[k] = p[k]; localStorage.setItem('kanevas.prefs', JSON.stringify(o)); } catch { /* stockage indisponible */ } };
  return p;
})();

/* ---------------------------------------------------------------- maths */
KS.util = {};
const U = KS.util;
U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
U.lerp = (a, b, t) => a + (b - a) * t;
U.round = (v, d = 0) => { const m = Math.pow(10, d); return Math.round(v * m) / m; };
U.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
U.uid = (() => { let n = 0; return () => ++n; })();
U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
U.throttle = (fn, ms) => {
  let last = 0, t = null, args = null;
  return (...a) => {
    args = a; const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else if (!t) t = setTimeout(() => { t = null; last = performance.now(); fn(...args); }, ms - (now - last));
  };
};
U.rect = (x, y, w, h) => ({ x, y, w, h });
U.rectUnion = (a, b) => {
  if (!a) return b ? { ...b } : null; if (!b) return { ...a };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
U.rectIntersect = (a, b) => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
};
U.rectInt = r => {
  const x = Math.floor(r.x), y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
};
U.normRect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
U.fmtBytes = n => n < 1024 ? n + ' o' : n < 1048576 ? (n / 1024).toFixed(1) + ' Ko' : (n / 1048576).toFixed(1) + ' Mo';

/* ---------------------------------------------------------------- canevas */
U.canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
};
U.ctx = c => c.getContext('2d');
U.copyCanvas = (src, r) => {
  if (r) {
    const c = U.canvas(r.w, r.h);
    c.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return c;
  }
  const c = U.canvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
};
U.clearCanvas = c => c.getContext('2d').clearRect(0, 0, c.width, c.height);
U.fitCanvas = (c, w, h) => { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } else U.clearCanvas(c); return c; };
U.getData = (c, r) => r ? c.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h) : c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
U.putData = (c, d, x = 0, y = 0) => c.getContext('2d').putImageData(d, x, y);
// Boîte englobante des pixels non transparents (null si vide)
U.alphaBounds = (c, threshold = 0) => {
  const w = c.width, h = c.height;
  if (w * h === 0) return null;
  const d = U.getData(c).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let row = y * w * 4 + 3;
    for (let x = 0; x < w; x++, row += 4) {
      if (d[row] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
U.blobFromCanvas = (c, type = 'image/png', quality) => new Promise(res => c.toBlob(res, type, quality));
U.loadImage = src => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('Image illisible'));
  img.src = src;
});
U.canvasFromBlob = async blob => {
  const url = URL.createObjectURL(blob);
  try {
    const img = await U.loadImage(url);
    const c = U.canvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  } finally { URL.revokeObjectURL(url); }
};
U.download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
U.checkerPattern = (ctx, size = 8, light = '#ffffff', dark = '#cfd3d8') => {
  const c = U.canvas(size * 2, size * 2), x = c.getContext('2d');
  x.fillStyle = light; x.fillRect(0, 0, size * 2, size * 2);
  x.fillStyle = dark; x.fillRect(0, 0, size, size); x.fillRect(size, size, size, size);
  return ctx.createPattern(c, 'repeat');
};
// Copie avec extension des bords (pour les flous : évite les franges sombres)
U.padCanvas = (src, pad) => {
  const w = src.width, h = src.height, c = U.canvas(w + pad * 2, h + pad * 2), x = c.getContext('2d');
  x.drawImage(src, pad, pad);
  x.drawImage(src, 0, 0, w, 1, pad, 0, w, pad);
  x.drawImage(src, 0, h - 1, w, 1, pad, h + pad, w, pad);
  x.drawImage(c, pad, 0, 1, h + pad * 2, 0, 0, pad, h + pad * 2);
  x.drawImage(c, pad + w - 1, 0, 1, h + pad * 2, pad + w, 0, pad, h + pad * 2);
  return c;
};
U.blurCanvas = (src, radius) => {
  if (radius <= 0) return U.copyCanvas(src);
  const pad = Math.ceil(radius * 3);
  const p = U.padCanvas(src, pad), out = U.canvas(src.width, src.height), x = out.getContext('2d');
  x.filter = `blur(${radius}px)`;
  x.drawImage(p, -pad, -pad);
  x.filter = 'none';
  return out;
};

/* ---------------------------------------------------------------- couleurs */
U.hex = c => '#' + [c.r, c.g, c.b].map(v => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
U.parseHex = s => {
  s = String(s || '').trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map(ch => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
};
U.css = (c, a = 1) => a >= 1 ? U.hex(c) : `rgba(${c.r},${c.g},${c.b},${a})`;
U.rgb2hsv = ({ r, g, b }) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
};
U.hsv2rgb = ({ h, s, v }) => {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
};
U.rgb2hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
};
U.hsl2rgb = (h, s, l) => {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
};
U.luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
U.gray = c => { const v = Math.round(U.luma(c.r, c.g, c.b)); return { r: v, g: v, b: v }; };

/* ---------------------------------------------------------------- modes de fusion */
KS.BLENDS = [
  ['normal', 'Normal', 'source-over'],
  null,
  ['darken', 'Obscurcir', 'darken'],
  ['multiply', 'Produit', 'multiply'],
  ['color-burn', 'Densité couleur +', 'color-burn'],
  null,
  ['lighten', 'Éclaircir', 'lighten'],
  ['screen', 'Superposition', 'screen'],
  ['color-dodge', 'Densité couleur -', 'color-dodge'],
  ['lighter', 'Densité linéaire - (ajout)', 'lighter'],
  null,
  ['overlay', 'Incrustation', 'overlay'],
  ['soft-light', 'Lumière tamisée', 'soft-light'],
  ['hard-light', 'Lumière crue', 'hard-light'],
  null,
  ['difference', 'Différence', 'difference'],
  ['exclusion', 'Exclusion', 'exclusion'],
  null,
  ['hue', 'Teinte', 'hue'],
  ['saturation', 'Saturation', 'saturation'],
  ['color', 'Couleur', 'color'],
  ['luminosity', 'Luminosité', 'luminosity'],
];
KS.blendOp = id => { const b = KS.BLENDS.find(x => x && x[0] === id); return b ? b[2] : 'source-over'; };
KS.blendSelect = (value, onChange, includePass = false) => {
  const s = document.createElement('select');
  s.className = 'field';
  if (includePass) { const o = document.createElement('option'); o.value = 'pass'; o.textContent = 'Passage'; o.className = 'opt-pass'; s.appendChild(o); }
  for (const b of KS.BLENDS) {
    if (!b) { const o = document.createElement('option'); o.disabled = true; o.textContent = '──────────'; s.appendChild(o); continue; }
    const o = document.createElement('option'); o.value = b[0]; o.textContent = b[1]; s.appendChild(o);
  }
  s.value = value || 'normal';
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
};

/* ---------------------------------------------------------------- DOM */
KS.$ = (sel, root = document) => root.querySelector(sel);
KS.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// h('div.cls#id', {attrs, on:{}}, children...)
KS.h = (tag, attrs, ...kids) => {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const e = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) {
    if (part[0] === '.') e.classList.add(part.slice(1)); else e.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'on') for (const ev in v) e.addEventListener(ev, v[ev]);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k in e && k !== 'list' && k !== 'form') { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else e.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return e;
};

/* ---------------------------------------------------------------- retours visuels */
KS.toast = (msg, type = 'info', ms = 2600) => {
  const icon = type === 'err' ? 'alert' : type === 'ok' ? 'check' : 'info';
  const t = KS.h('div.toast.' + type, { html: (KS.icon ? KS.icon(icon) : '') });
  t.appendChild(document.createTextNode(msg));
  KS.$('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, ms);
};
KS.busy = async (fn, delay = 0) => {
  const b = KS.h('div.busy', KS.h('div.spin'));
  document.body.appendChild(b);
  await new Promise(r => setTimeout(r, delay || 16));
  try { return await fn(); } finally { b.remove(); }
};
KS.nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
