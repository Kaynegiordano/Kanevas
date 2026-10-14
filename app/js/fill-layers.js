// Calques de remplissage dynamiques (Photoshop : Calque > Nouveau calque de remplissage) :
// couleur unie, dégradé, motif. Le calque garde ses réglages (L.fill) et se redessine quand
// on les change dans Propriétés ; « Pixelliser » en fait un calque de pixels ordinaire.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui;

  const PATTERNS = [['checker', 'Damier'], ['stripes', 'Rayures'], ['dots', 'Pois'], ['grid', 'Grille'], ['diagonal', 'Diagonales'], ['noise', 'Grain']];
  const DEFS = {
    solid: { name: 'Couleur unie', icon: 'fill', params: [{ id: 'color', label: 'Couleur', type: 'color', def: '#3d7cf0' }] },
    gradient: {
      name: 'Dégradé', icon: 'gradient', params: [
        { id: 'style', label: 'Style', type: 'select', def: 'linear', options: [['linear', 'Linéaire'], ['radial', 'Radial'], ['angle', 'Angle'], ['reflected', 'Réfléchi'], ['diamond', 'Losange']] },
        { id: 'c1', label: 'Couleur de départ', type: 'color', def: '#000000' },
        { id: 'c2', label: 'Couleur de fin', type: 'color', def: '#ffffff' },
        { id: 'angle', label: 'Angle', min: -180, max: 180, unit: '°', def: 90 },
        { id: 'scale', label: 'Échelle', min: 10, max: 150, unit: '%', def: 100 },
        { id: 'reverse', label: 'Inverser', type: 'check', def: false },
      ],
    },
    pattern: {
      name: 'Motif', icon: 'grid', params: [
        { id: 'pattern', label: 'Motif', type: 'select', def: 'checker', options: PATTERNS },
        { id: 'c1', label: 'Couleur 1', type: 'color', def: '#ffffff' },
        { id: 'c2', label: 'Couleur 2', type: 'color', def: '#cfd6e4' },
        { id: 'size', label: 'Taille', min: 2, max: 400, unit: 'px', def: 32 },
        { id: 'angle', label: 'Angle', min: -180, max: 180, unit: '°', def: 0 },
      ],
    },
  };
  const defaults = type => Object.fromEntries(DEFS[type].params.map(p => [p.id, p.def]));

  // Générateur pseudo-aléatoire stable (le grain ne change pas à chaque rendu)
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  function tile(p) {
    const s = Math.max(2, Math.round(p.size)), kind = p.pattern;
    const T = U.canvas(kind === 'checker' || kind === 'noise' ? s * 2 : s, kind === 'checker' || kind === 'noise' ? s * 2 : s), x = T.getContext('2d');
    x.fillStyle = p.c1; x.fillRect(0, 0, T.width, T.height);
    x.fillStyle = p.c2; x.strokeStyle = p.c2;
    if (kind === 'checker') { x.fillRect(0, 0, s, s); x.fillRect(s, s, s, s); }
    else if (kind === 'stripes') x.fillRect(0, 0, s, s / 2);
    else if (kind === 'dots') { x.beginPath(); x.arc(s / 2, s / 2, s * 0.28, 0, Math.PI * 2); x.fill(); }
    else if (kind === 'grid') { x.lineWidth = Math.max(1, s / 16); x.strokeRect(0, 0, s, s); }
    else if (kind === 'diagonal') { x.lineWidth = Math.max(1, s / 6); x.beginPath(); x.moveTo(-s, s); x.lineTo(s, -s); x.moveTo(0, s * 2); x.lineTo(s * 2, 0); x.moveTo(0, s); x.lineTo(s, 0); x.stroke(); }
    else if (kind === 'noise') {
      const r = rng(s * 7919), d = x.getImageData(0, 0, T.width, T.height), c1 = U.parseHex(p.c1), c2 = U.parseHex(p.c2), px = d.data;
      for (let i = 0; i < px.length; i += 4) { const t = r(); px[i] = c1.r + (c2.r - c1.r) * t; px[i + 1] = c1.g + (c2.g - c1.g) * t; px[i + 2] = c1.b + (c2.b - c1.b) * t; px[i + 3] = 255; }
      x.putImageData(d, 0, 0);
    }
    return T;
  }

  // Dessine le remplissage sur tout le document
  KS.renderFill = (L, doc) => {
    const f = L.fill;
    if (doc) { f.w = doc.width; f.h = doc.height; }
    const W = f.w || L.canvas.width, H = f.h || L.canvas.height, p = { ...defaults(f.type), ...f.params };
    const c = L.canvas && L.canvas.width === W && L.canvas.height === H ? L.canvas : U.canvas(W, H), x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, W, H);
    if (f.type === 'solid') { x.fillStyle = p.color; x.fillRect(0, 0, W, H); }
    else if (f.type === 'gradient') {
      const a = p.angle * Math.PI / 180, cx = W / 2, cy = H / 2, k = p.scale / 100;
      const [c1, c2] = p.reverse ? [p.c2, p.c1] : [p.c1, p.c2];
      const dx = Math.cos(a), dy = -Math.sin(a), half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2 * k;
      let g;
      if (p.style === 'radial') { g = x.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) / 2 * k); g.addColorStop(0, c1); g.addColorStop(1, c2); }
      else if (p.style === 'angle') { g = x.createConicGradient(-a, cx, cy); g.addColorStop(0, c1); g.addColorStop(1, c2); }
      else if (p.style === 'reflected') { g = x.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half); g.addColorStop(0, c2); g.addColorStop(0.5, c1); g.addColorStop(1, c2); }
      else if (p.style === 'linear') { g = x.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half); g.addColorStop(0, c1); g.addColorStop(1, c2); }
      if (g) { x.fillStyle = g; x.fillRect(0, 0, W, H); }
      else {
        // losange : distance « Manhattan » tournée, calculée pixel par pixel
        const A = U.parseHex(c1), B = U.parseHex(c2), R = Math.max(1, Math.hypot(W, H) / 2 * k), d = x.createImageData(W, H), px = d.data;
        const ca = Math.cos(a), sa = Math.sin(a);
        for (let yy = 0, i = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++, i += 4) {
          const u = (xx - cx) * ca - (yy - cy) * sa, v = (xx - cx) * sa + (yy - cy) * ca;
          const t = Math.min(1, (Math.abs(u) + Math.abs(v)) / R);
          px[i] = A.r + (B.r - A.r) * t; px[i + 1] = A.g + (B.g - A.g) * t; px[i + 2] = A.b + (B.b - A.b) * t; px[i + 3] = 255;
        }
        x.putImageData(d, 0, 0);
      }
    } else if (f.type === 'pattern') {
      const pat = x.createPattern(tile(p), 'repeat'), r = Math.hypot(W, H);
      x.save(); x.translate(W / 2, H / 2); x.rotate(-p.angle * Math.PI / 180);
      x.fillStyle = pat; x.fillRect(-r, -r, r * 2, r * 2);
      x.restore();
    }
    L.canvas = c; L.ctx = x; L.x = 0; L.y = 0;
    L.touch();
  };

  KS.FillLayers = { DEFS, defaults };

  // Nouveau calque de remplissage : boîte avec aperçu en direct sur le document
  KS.cmd.newFillLayer = async (type = 'solid') => {
    const d = KS.state.doc; if (!d) return;
    const def = DEFS[type], before = KS.Hist.structSnap(d);
    const L = new KS.Layer({ name: d.newLayerName(def.name), kind: 'fill', w: d.width, h: d.height, fill: { type, params: defaults(type) } });
    if (type === 'solid') L.fill.params.color = U.hex(KS.state.fg);
    if (type === 'gradient') { L.fill.params.c1 = U.hex(KS.state.fg); L.fill.params.c2 = U.hex(KS.state.bg); }
    KS.renderFill(L, d);
    if (d.selection.active) L.addMask(d, 'selection');
    d.addLayer(L, d.activeIndex + 1);
    KS.emit('layers', d);
    const vals = { ...L.fill.params };
    const ok = await KS.dialogs.params({
      title: 'Calque de remplissage : ' + def.name.toLowerCase(), def: { ...def, key: null }, values: vals, width: 420,
      preview: v => { L.fill.params = { ...v }; KS.renderFill(L, d); d.changed(); },
      cancel: () => {},
      apply: v => { L.fill.params = { ...v }; KS.renderFill(L, d); },
    });
    if (!ok) { d.removeLayer(L); KS.emit('layers', d); return; }
    d.history.push({ name: 'Calque de remplissage', icon: def.icon, ...KS.Hist.structPart(d, before) });
    KS.emit('layers', d);
  };

  // Section du panneau Propriétés
  KS.fillProperties = (doc, L, sec) => {
    const def = DEFS[L.fill.type];
    const vals = { ...defaults(L.fill.type), ...L.fill.params };
    let before = null, timer = null;
    const commit = () => {
      if (!before) return;
      const snap = before; before = null;
      doc.history.push({ name: 'Modifier le remplissage', icon: def.icon, ...KS.Hist.structPart(doc, snap) });
    };
    const content = KS.buildParamUI(def, vals, v => {
      if (!before) before = KS.Hist.structSnap(doc);
      L.fill = { ...L.fill, params: { ...v } };
      KS.renderFill(L, doc); doc.changed();
      clearTimeout(timer); timer = setTimeout(commit, 600);
    }, { width: '100%' });
    return sec(def.name, content,
      h('div.form-row', { style: { marginTop: '8px' } }, ui.btn('Pixelliser', () => KS.cmd.rasterize(), '.small', 'rasterize')));
  };
})();
