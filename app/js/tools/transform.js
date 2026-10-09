// Déplacement, transformation manuelle (Ctrl+T) et recadrage.
'use strict';
(() => {
  const U = KS.util, T = KS.tools, V = KS.view, h = KS.h, ui = KS.ui;

  // Calque le plus haut ayant un pixel visible sous le point
  function layerAt(doc, x, y) {
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const L = doc.layers[i];
      if (!doc.shown(L) || L.kind === 'adjust' || L.kind === 'group') continue;
      const img = L.image(), px = Math.floor(x - img.x), py = Math.floor(y - img.y);
      if (px < 0 || py < 0 || px >= img.canvas.width || py >= img.canvas.height) continue;
      if (img.canvas.getContext('2d', { willReadFrequently: true }).getImageData(px, py, 1, 1).data[3] > 20) return L;
    }
    return null;
  }
  KS.layerAt = layerAt;

  // Aimantation des bords/centre d'une boîte (doc) : renvoie le décalage corrigé et les guides à afficher
  function snapBox(doc, box, dx, dy) {
    V.smartGuides = null;
    if (!KS.prefs.snap || !box) return { dx, dy };
    const tol = 6 / V.zoom, b = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
    const xs = [0, doc.width / 2, doc.width, ...(KS.prefs.showGuides ? doc.guides.v : [])];
    const ys = [0, doc.height / 2, doc.height, ...(KS.prefs.showGuides ? doc.guides.h : [])];
    const guides = [];
    let bx = null, by = null;
    for (const [edge, off] of [[b.x, 0], [b.x + b.w / 2, b.w / 2], [b.x + b.w, b.w]]) for (const s of xs) if (bx === null && Math.abs(edge - s) < tol) { bx = s - off; guides.push({ x: s, a: Math.min(0, b.y), b: Math.max(doc.height, b.y + b.h) }); }
    for (const [edge, off] of [[b.y, 0], [b.y + b.h / 2, b.h / 2], [b.y + b.h, b.h]]) for (const s of ys) if (by === null && Math.abs(edge - s) < tol) { by = s - off; guides.push({ y: s, a: Math.min(0, b.x), b: Math.max(doc.width, b.x + b.w) }); }
    if (bx !== null) dx = bx - box.x;
    if (by !== null) dy = by - box.y;
    V.smartGuides = guides.length ? guides : null;
    return { dx, dy };
  }

  /* ---------------------------------------------------------------- déplacement */
  const alignBtns = () => ({
    type: 'custom', render: () => h('div.opt-group',
      ...[['align-left', 'Aligner les bords gauches', 'l'], ['align-hcenter', 'Aligner les centres horizontaux', 'hc'], ['align-right', 'Aligner les bords droits', 'r'],
        ['align-top', 'Aligner les bords supérieurs', 't'], ['align-vcenter', 'Aligner les centres verticaux', 'vc'], ['align-bottom', 'Aligner les bords inférieurs', 'b']]
        .map(([ic, tip, k]) => ui.iconBtn(ic, tip + ' (entre les calques sélectionnés, sinon sur la sélection ou le document)', () => KS.cmd.align(k))),
      ui.iconBtn('align-hcenter', 'Répartir horizontalement (3 calques ou plus)', () => KS.cmd.distribute('h')),
      ui.iconBtn('align-vcenter', 'Répartir verticalement (3 calques ou plus)', () => KS.cmd.distribute('v'))),
  });
  T.register({
    id: 'move', name: 'Déplacement', icon: 'move', shortcut: 'V', cursor: 'default', ownsCtrl: true,
    defaults: { autoSelect: false },
    options: () => [
      { type: 'check', id: 'autoSelect', label: 'Sélection automatique du calque' },
      { type: 'sep' }, alignBtns(), { type: 'sep' },
      { type: 'button', icon: 'transform', text: 'Transformer', action: () => KS.cmd.freeTransform() },
    ],
    down(ev, doc) {
      if (this.o.autoSelect || ev.ctrl && T.current.id === 'move') { const L = layerAt(doc, ev.x, ev.y); if (L) doc.setActive(L); }
      const L = doc.active;
      if (!L) return;
      if (L.lockAll) { KS.toast('Le calque est verrouillé', 'err'); return; }
      this.p0 = ev; this.L = L; this.dx = this.dy = 0;
      const sel = doc.selection;
      if (sel.active && L.kind === 'raster' && !L.editMask) {
        // déplacement des pixels sélectionnés (flottant)
        L.ensureCovers(doc.rect);
        const fl = U.canvas(doc.width, doc.height), fx = fl.getContext('2d');
        fx.drawImage(L.canvas, L.x, L.y);
        sel.clip(fl);
        const hole = U.copyCanvas(L.canvas);
        if (!ev.alt) sel.cut(hole, L.x, L.y);
        this.float = { canvas: fl, hole, tmp: U.canvas(1, 1), box: sel.bounds, selBefore: sel.snapshot(), token: KS.Hist.begin(L) };
        this.mode = 'pixels';
      } else {
        this.mode = 'layer';
        this.before = KS.Hist.structSnap(doc);
        if (ev.alt && L.kind !== 'adjust') { KS.cmd.duplicateLayer(); doc.history.items.pop(); doc.history.pos--; this.L = doc.active; KS.emit('layers', doc); }
        this.list = KS.cmd.movable(doc);
        if (!this.list.length) this.list = [this.L];
        if (this.L.kind === 'group' && this.L.mask) this.list.push(this.L);
        this.starts = this.list.map(l => ({ l, x: l.x, y: l.y, mx: l.mask?.x, my: l.mask?.y }));
        this.box = KS.cmd.boundsOf(this.list);
      }
    },
    move(ev, doc) {
      if (!this.L) return;
      let dx = ev.x - this.p0.x, dy = ev.y - this.p0.y;
      if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      ({ dx, dy } = snapBox(doc, this.mode === 'pixels' ? this.float.box : this.box, dx, dy));
      dx = Math.round(dx); dy = Math.round(dy);
      this.dx = dx; this.dy = dy;
      if (this.mode === 'layer') {
        for (const st of this.starts) {
          const L = st.l;
          if (L.kind !== 'adjust' && L.kind !== 'group') { L.x = st.x + dx; L.y = st.y + dy; }
          if (L.mask && (L.mask.linked || L.kind === 'adjust' || L.kind === 'group')) { L.mask.x = st.mx + dx; L.mask.y = st.my + dy; }
          L.touch();
        }
      } else {
        doc.selection.dragOffset = { dx, dy };
        this.need = true;
      }
      doc.changed();
    },
    preRender(doc) {
      if (this.mode !== 'pixels' || !this.float || !this.need) return;
      this.need = false;
      const L = this.L, f = this.float;
      const c = U.fitCanvas(f.tmp, L.canvas.width, L.canvas.height), x = c.getContext('2d');
      x.drawImage(f.hole, 0, 0);
      x.drawImage(f.canvas, this.dx - L.x, this.dy - L.y);
      // le flottant peut sortir du calque : on étend l'aperçu
      const r = U.rectUnion(L.bounds(), { x: this.dx, y: this.dy, w: doc.width, h: doc.height });
      if (r.w !== L.canvas.width || r.h !== L.canvas.height || r.x !== L.x || r.y !== L.y) {
        const big = U.canvas(r.w, r.h), bx = big.getContext('2d');
        bx.drawImage(f.hole, L.x - r.x, L.y - r.y); bx.drawImage(f.canvas, this.dx - r.x, this.dy - r.y);
        L.override = { canvas: big, x: r.x, y: r.y };
      } else L.override = { canvas: c, x: L.x, y: L.y };
    },
    up(ev, doc) {
      const L = this.L; if (!L) return;
      this.L = null; V.smartGuides = null;
      if (this.mode === 'layer') {
        if (this.dx || this.dy || this.before.layers.length !== doc.layers.length) doc.history.push({ name: this.before.layers.length !== doc.layers.length ? 'Dupliquer et déplacer' : 'Déplacer', icon: 'move', ...KS.Hist.structPart(doc, this.before) });
        KS.emit('layers', doc);
        return;
      }
      const f = this.float; this.float = null;
      doc.selection.dragOffset = null;
      L.override = null;
      if (!this.dx && !this.dy) { L.touch(); doc.changed(); return; }
      const r = U.rectUnion(L.bounds(), { x: this.dx, y: this.dy, w: doc.width, h: doc.height });
      const c = U.canvas(r.w, r.h), x = c.getContext('2d');
      x.drawImage(f.hole, L.x - r.x, L.y - r.y);
      x.drawImage(f.canvas, this.dx - r.x, this.dy - r.y);
      L.canvas = c; L.ctx = x; L.x = r.x; L.y = r.y; L.touch();
      doc.selection.translate(this.dx, this.dy);
      KS.Hist.commitPixels(doc, 'Déplacer la sélection', f.token, null, 'move', KS.Hist.selectionPart(doc, f.selBefore));
      doc.changed();
    },
    cancel(doc) {
      if (!this.L) return;
      if (this.mode === 'layer') { for (const st of this.starts) { const L = st.l; L.x = st.x; L.y = st.y; if (L.mask) { L.mask.x = st.mx; L.mask.y = st.my; } L.touch(); } }
      else { this.L.override = null; this.L.touch(); if (doc) doc.selection.dragOffset = null; }
      this.L = null; this.float = null; V.smartGuides = null;
    },
    key(e, doc) {
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!dirs[e.key] || !doc) return false;
      const [dx, dy] = dirs[e.key].map(v => v * (e.shiftKey ? 10 : 1));
      KS.cmd.nudge(dx, dy);
      return true;
    },
  });

  /* ---------------------------------------------------------------- transformation manuelle */
  // Géométrie projective : carré unité → quadrilatère (Heckbert), et son inverse
  function squareToQuad(q) {
    const [p0, p1, p2, p3] = q;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
    let a, b, c, d, e, f, g, hh;
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) { a = p1.x - p0.x; b = p3.x - p0.x; c = p0.x; d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y; g = 0; hh = 0; }
    else {
      const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
      g = (sx * dy2 - dx2 * sy) / den; hh = (dx1 * sy - sx * dy1) / den;
      a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + hh * p3.x; c = p0.x;
      d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + hh * p3.y; f = p0.y;
    }
    return { a, b, c, d, e, f, g, h: hh, map: (u, v) => { const w = g * u + hh * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; } };
  }
  function invert3(H) {
    const m = [H.a, H.b, H.c, H.d, H.e, H.f, H.g, H.h, 1];
    const [A, B, Cc, Dd, E, F, G, Hh, I] = m;
    const co = [E * I - F * Hh, -(B * I - Cc * Hh), B * F - Cc * E, -(Dd * I - F * G), A * I - Cc * G, -(A * F - Cc * Dd), Dd * Hh - E * G, -(A * Hh - B * G), A * E - B * Dd];
    const det = A * co[0] + B * co[3] + Cc * co[6] || 1e-12;
    const n = co.map(v => v / det);
    return (x, y) => { const w = n[6] * x + n[7] * y + n[8]; return [(n[0] * x + n[1] * y + n[2]) / w, (n[3] * x + n[4] * y + n[5]) / w]; };
  }
  const bern = [t => (1 - t) ** 3, t => 3 * t * (1 - t) ** 2, t => 3 * t * t * (1 - t), t => t ** 3];
  // Dessine img déformée : f(u, v) ∈ [0,1]² → document, sur une grille de n×n cellules
  function drawMesh(ctx, img, f, n, ox, oy) {
    const W = img.width, H = img.height, P = [];
    for (let j = 0; j <= n; j++) { const row = []; for (let i = 0; i <= n; i++) { const [x, y] = f(i / n, j / n); row.push([x - ox, y - oy]); } P.push(row); }
    const tri = (s0, s1, s2, d0, d1, d2) => {
      const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2, [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
      const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if (!den) return;
      const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / den, c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / den;
      const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / den, d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / den;
      const e = u0 - a * x0 - c * y0, ff = v0 - b * x0 - d * y0;
      const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3, k = 0.9;
      const ex = (u, v) => { const dx = u - cx, dy = v - cy, l = Math.hypot(dx, dy) || 1; return [u + dx / l * k, v + dy / l * k]; };
      ctx.save();
      ctx.beginPath(); ctx.moveTo(...ex(u0, v0)); ctx.lineTo(...ex(u1, v1)); ctx.lineTo(...ex(u2, v2)); ctx.closePath(); ctx.clip();
      ctx.transform(a, b, c, d, e, ff);
      const sx = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 1), sy = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 1);
      const sw = Math.min(W, Math.ceil(Math.max(x0, x1, x2)) + 1) - sx, sh = Math.min(H, Math.ceil(Math.max(y0, y1, y2)) + 1) - sy;
      if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.restore();
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const s00 = [i / n * W, j / n * H], s10 = [(i + 1) / n * W, j / n * H], s01 = [i / n * W, (j + 1) / n * H], s11 = [(i + 1) / n * W, (j + 1) / n * H];
      tri(s00, s10, s11, P[j][i], P[j][i + 1], P[j + 1][i + 1]);
      tri(s00, s11, s01, P[j][i], P[j + 1][i + 1], P[j + 1][i]);
    }
  }
  KS.drawMesh = drawMesh;
  const MODES = [['free', 'transform', 'Libre (Ctrl+glisser un coin : torsion)'], ['skew', 'skew', 'Inclinaison'], ['distort', 'distort', 'Torsion'], ['perspective', 'perspective', 'Perspective'], ['warp', 'warp', 'Déformation']];

  const TR = T.register({
    id: 'transform', name: 'Transformation manuelle', icon: 'transform', cursor: 'default', ownsCtrl: true, hidden: true,
    defaults: { quality: 'high' },
    options() {
      const s = this.s; if (!s) return [];
      const modeSeg = ui.seg(MODES.map(([v, ic, tip]) => [v, ic, tip]), s.mode, v => { this.setMode(v); T.renderOptions(); KS.requestRender(); });
      const tail = [
        { type: 'select', id: 'quality', label: 'Interpolation', options: [['high', 'Bicubique'], ['medium', 'Bilinéaire'], ['pixelated', 'Au plus proche']] },
        { type: 'sep' },
        { type: 'custom', render: () => h('div.opt-group', ui.btn('Annuler', () => this.finish(false), '.small', 'close'), ui.btn('Valider', () => this.finish(true), '.small.primary', 'check')) },
      ];
      if (s.mode !== 'free') return [{ type: 'custom', render: () => h('div.opt-group', modeSeg) }, { type: 'sep' },
        { type: 'custom', render: () => h('span.opt-label', { text: s.mode === 'warp' ? 'Glissez les 16 points de la grille' : s.mode === 'perspective' ? 'Glissez un coin : le coin voisin suit en miroir' : s.mode === 'skew' ? 'Glissez un bord pour incliner' : 'Glissez librement les coins et les bords' }) }, { type: 'sep' }, ...tail];
      const f = (label, get, set, unit, step = 1) => ui.scrub({ label, value: get(), min: -100000, max: 100000, step, unit, popup: false, width: 54, onInput: v => { set(v); KS.requestRender(); this.refresh(); } });
      this.ctl = {
        x: f('X', () => Math.round(s.cx), v => s.cx = v, 'px'), y: f('Y', () => Math.round(s.cy), v => s.cy = v, 'px'),
        w: f('L', () => U.round(s.sx * 100, 1), v => s.sx = Math.max(0.001, v / 100), '%', 0.1), hh: f('H', () => U.round(s.sy * 100, 1), v => s.sy = Math.max(0.001, v / 100), '%', 0.1),
        a: f('∠', () => U.round(s.rot * 180 / Math.PI, 1), v => s.rot = v * Math.PI / 180, '°', 0.1),
      };
      return [
        { type: 'custom', render: () => h('div.opt-group', modeSeg) }, { type: 'sep' },
        { type: 'custom', render: () => h('div.opt-group', this.ctl.x, this.ctl.y) }, { type: 'sep' },
        { type: 'custom', render: () => h('div.opt-group', this.ctl.w, ui.iconBtn('link', 'Conserver les proportions', e => { s.keep = !s.keep; e.currentTarget.classList.toggle('on', s.keep); }, s.keep ? '.on' : ''), this.ctl.hh) },
        { type: 'sep' }, { type: 'custom', render: () => h('div.opt-group', this.ctl.a) }, { type: 'sep' },
        { type: 'custom', render: () => h('div.opt-group', ui.iconBtn('flip-h', 'Symétrie horizontale', () => { s.fx = -s.fx; KS.requestRender(); }), ui.iconBtn('flip-v', 'Symétrie verticale', () => { s.fy = -s.fy; KS.requestRender(); }), ui.iconBtn('rotate-ccw', 'Rotation 90° antihoraire', () => { s.rot -= Math.PI / 2; this.refresh(); KS.requestRender(); }), ui.iconBtn('rotate-cw', 'Rotation 90° horaire', () => { s.rot += Math.PI / 2; this.refresh(); KS.requestRender(); })) },
        ...tail,
      ];
    },
    refresh() { const s = this.s, c = this.ctl; if (!s || !c || s.mode !== 'free') return; c.x.set(Math.round(s.cx)); c.y.set(Math.round(s.cy)); c.w.set(U.round(s.sx * 100, 1)); c.hh.set(U.round(s.sy * 100, 1)); c.a.set(U.round(s.rot * 180 / Math.PI, 1)); },
    // Passage d'un mode à l'autre en gardant la forme courante
    setMode(m) {
      const s = this.s; if (!s || s.mode === m) return;
      if (m === 'free') { if (s.mode !== 'free') { KS.toast('Retour en mode libre : la déformation est conservée tant que vous ne la modifiez pas', 'info'); } s.mode = 'free'; s.quad = null; s.grid = null; return; }
      if (s.mode === 'free') s.quad = this.affineCorners();
      if (m === 'warp' && !s.grid) {
        const f = this.mapUV.bind(this);
        s.grid = [0, 1, 2, 3].map(j => [0, 1, 2, 3].map(i => { const [x, y] = f(i / 3, j / 3); return { x, y }; }));
      }
      if (m !== 'warp') s.grid = null;
      s.mode = m;
    },
    begin(doc, opts = {}) {
      const A = doc.active;
      const vector = A && A.kind === 'shape' && !A.lockAll;
      const L = vector ? A : T.pixelLayer(doc, { allowMaskEdit: false });
      if (!L) return false;
      const sel = vector ? { active: false, snapshot: () => doc.selection.snapshot() } : doc.selection;
      if (!vector) L.ensureCovers(doc.rect);
      let box, float, hole;
      if (sel.active) {
        box = sel.bounds;
        const tmp = U.canvas(doc.width, doc.height); tmp.getContext('2d').drawImage(L.canvas, L.x, L.y); sel.clip(tmp);
        float = U.copyCanvas(tmp, box);
        hole = U.copyCanvas(L.canvas); sel.cut(hole, L.x, L.y);
      } else {
        box = L.contentBounds();
        if (!box) { KS.toast('Le calque est vide', 'err'); return false; }
        float = U.copyCanvas(L.canvas, { x: box.x - L.x, y: box.y - L.y, w: box.w, h: box.h });
        hole = null;
      }
      this.s = { L, float, hole, box, vector, mode: 'free', quad: null, grid: null, shapeBefore: vector ? JSON.parse(JSON.stringify(L.shape.subpaths)) : null, cx: box.x + box.w / 2, cy: box.y + box.h / 2, sx: 1, sy: 1, rot: opts.rot || 0, fx: opts.fx || 1, fy: opts.fy || 1, keep: true, token: KS.Hist.begin(L), selBefore: sel.snapshot(), selMask: sel.active ? U.copyCanvas(sel.mask, box) : null };
      this.prev = T.current && T.current !== this ? T.current.id : 'move';
      const rs = doc.selection;
      rs.dragOffset = null;
      const savedMask = rs.mask; if (!vector) { rs.mask = null; rs.refresh(); } this.s.savedMask = savedMask;
      T.select('transform', { silent: true });
      if (opts.mode) { this.setMode(opts.mode); T.renderOptions(); }
      doc.changed();
      return true;
    },
    matrix() { const s = this.s; return new DOMMatrix().translate(s.cx, s.cy).rotate(s.rot * 180 / Math.PI).scale(s.sx * s.fx, s.sy * s.fy).translate(-s.box.w / 2, -s.box.h / 2); },
    affineCorners() { const m = this.matrix(), w = this.s.box.w, hh = this.s.box.h; return [[0, 0], [w, 0], [w, hh], [0, hh]].map(([x, y]) => { const p = m.transformPoint(new DOMPoint(x, y)); return { x: p.x, y: p.y }; }); },
    corners() { const s = this.s; if (s.mode === 'warp') { const g = s.grid; return [g[0][0], g[0][3], g[3][3], g[3][0]]; } return s.quad || this.affineCorners(); },
    // (u, v) ∈ [0,1]² du flottant → coordonnées document
    mapUV(u, v) {
      const s = this.s;
      if (s.grid) {
        let x = 0, y = 0;
        for (let j = 0; j < 4; j++) { const bv = bern[j](v); for (let i = 0; i < 4; i++) { const b = bern[i](u) * bv; x += s.grid[j][i].x * b; y += s.grid[j][i].y * b; } }
        return [x, y];
      }
      if (s.quad) return squareToQuad(s.quad).map(u, v);
      const p = this.matrix().transformPoint(new DOMPoint(u * s.box.w, v * s.box.h));
      return [p.x, p.y];
    },
    // Rendu dans un canevas couvrant r ; exact (pixel par pixel) pour la perspective au moment de valider
    renderFloat(x, r, exact) {
      const s = this.s;
      x.imageSmoothingEnabled = this.o.quality !== 'pixelated';
      x.imageSmoothingQuality = this.o.quality === 'medium' ? 'medium' : 'high';
      if (s.mode === 'free' || (!s.quad && !s.grid)) {
        x.save(); x.translate(-r.x, -r.y); x.setTransform(x.getTransform().multiply(this.matrix())); x.drawImage(s.float, 0, 0); x.restore();
        return;
      }
      if (s.quad && !s.grid && exact) {
        const H = squareToQuad(s.quad), inv = invert3(H), src = U.getData(s.float), smp = KS.Filters.sampler(src), W = s.float.width, Hh = s.float.height;
        const out = x.getImageData(0, 0, r.w, r.h), o = out.data, px = [0, 0, 0, 0];
        for (let yy = 0; yy < r.h; yy++) for (let xx = 0; xx < r.w; xx++) {
          const [u, v] = inv(xx + r.x + 0.5, yy + r.y + 0.5);
          if (u < -0.002 || v < -0.002 || u > 1.002 || v > 1.002) continue;
          smp(u * W - 0.5, v * Hh - 0.5, px);
          const i = (yy * r.w + xx) * 4, a = px[3] / 255;
          if (a <= 0) continue;
          // composition « par-dessus » le fond déjà dessiné (trou)
          const dA = o[i + 3] / 255, oA = a + dA * (1 - a);
          for (let k = 0; k < 3; k++) o[i + k] = (px[k] * a + o[i + k] * dA * (1 - a)) / oA;
          o[i + 3] = oA * 255;
        }
        x.putImageData(out, 0, 0);
        return;
      }
      drawMesh(x, s.float, (u, v) => this.mapUV(u, v), exact ? 40 : 18, r.x, r.y);
    },
    resultRect() {
      const s = this.s, pts = [];
      if (s.grid) for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) pts.push(this.mapUV(i / 8, j / 8));
      else this.corners().forEach(p => pts.push([p.x, p.y]));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const tb = { x: Math.floor(Math.min(...xs)) - 2, y: Math.floor(Math.min(...ys)) - 2 };
      tb.w = Math.ceil(Math.max(...xs)) + 2 - tb.x; tb.h = Math.ceil(Math.max(...ys)) + 2 - tb.y;
      return s.hole ? U.rectUnion(s.L.bounds(), tb) : tb;
    },
    preRender(doc, exact = false) {
      const s = this.s; if (!s) return;
      const L = s.L, r = this.resultRect();
      const c = U.canvas(Math.max(1, r.w), Math.max(1, r.h)), x = c.getContext('2d');
      if (s.hole) x.drawImage(s.hole, L.x - r.x, L.y - r.y);
      this.renderFloat(x, r, exact);
      L.override = { canvas: c, x: r.x, y: r.y };
      s.result = { canvas: c, x: r.x, y: r.y };
      doc.compositeDirty = true;
    },
    handles() {
      const s = this.s;
      if (s.mode === 'warp') { const out = []; s.grid.forEach((row, j) => row.forEach((p, i) => out.push({ type: 'grid', i, j, p }))); return out; }
      const cs = this.corners();
      return [...cs.map((p, i) => ({ type: 'corner', i, p })), ...[0, 1, 2, 3].map(i => ({ type: 'edge', i, p: { x: (cs[i].x + cs[(i + 1) % 4].x) / 2, y: (cs[i].y + cs[(i + 1) % 4].y) / 2 } }))];
    },
    hit(ev) {
      const near = (p, d = 7) => { const q = V.toScreen(p.x, p.y); return Math.hypot(q.x - ev.sx, q.y - ev.sy) <= d; };
      for (const hd of this.handles()) if (near(hd.p, hd.type === 'edge' ? 6 : 8)) return hd;
      const cs = this.corners().map(p => V.toScreen(p.x, p.y));
      let inside = false; for (let i = 0, j = 3; i < 4; j = i++) { const a = cs[i], b = cs[j]; if ((a.y > ev.sy) !== (b.y > ev.sy) && ev.sx < (b.x - a.x) * (ev.sy - a.y) / (b.y - a.y) + a.x) inside = !inside; }
      if (inside) return { type: 'move' };
      return { type: 'rotate' };
    },
    cursor() {
      const m = V.mouse; if (!this.s || !m) return 'default';
      const ht = this.hit({ sx: m.sx, sy: m.sy });
      if (ht.type === 'move') return 'move';
      if (ht.type === 'rotate') return 'alias';
      if (ht.type === 'grid' || this.s.mode !== 'free') return 'crosshair';
      const ang = this.s.rot + (ht.type === 'corner' ? [-3, -1, 1, 3][ht.i] * Math.PI / 4 : [-2, 0, 2, 4][ht.i] * Math.PI / 4);
      const a = ((ang * 180 / Math.PI) % 180 + 180) % 180;
      return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
    },
    hover() { T.updateCursor(); },
    down(ev) {
      const s = this.s; if (!s) return;
      const hit = this.hit(ev);
      // Ctrl en mode libre : torsion d'un coin, inclinaison d'un bord (comme Photoshop)
      if (s.mode === 'free' && ev.ctrl && (hit.type === 'corner' || hit.type === 'edge')) { this.setMode(hit.type === 'corner' ? (ev.alt && ev.shift ? 'perspective' : 'distort') : 'skew'); T.renderOptions(); }
      const clone = o => JSON.parse(JSON.stringify(o));
      this.drag = { hit, p0: { x: ev.x, y: ev.y, sx: ev.sx, sy: ev.sy }, st: { ...s, quad: s.quad ? clone(s.quad) : null, grid: s.grid ? clone(s.grid) : null } };
    },
    move(ev) {
      const s = this.s, d = this.drag; if (!s || !d) return;
      const st = d.st, ht = d.hit, dx = ev.x - d.p0.x, dy = ev.y - d.p0.y;
      if (s.mode === 'free') this.moveFree(ev, d);
      else if (s.mode === 'warp') {
        if (ht.type === 'grid') { const p = s.grid[ht.j][ht.i], q = st.grid[ht.j][ht.i]; p.x = q.x + dx; p.y = q.y + dy; }
        else if (ht.type === 'move') s.grid.forEach((row, j) => row.forEach((p, i) => { p.x = st.grid[j][i].x + dx; p.y = st.grid[j][i].y + dy; }));
      } else {
        const Q = s.quad, Q0 = st.quad;
        const rotAll = () => {
          const cx = Q0.reduce((a, p) => a + p.x, 0) / 4, cy = Q0.reduce((a, p) => a + p.y, 0) / 4;
          let a = Math.atan2(ev.y - cy, ev.x - cx) - Math.atan2(d.p0.y - cy, d.p0.x - cx);
          if (ev.shift) a = Math.round(a / (Math.PI / 12)) * Math.PI / 12;
          Q0.forEach((p, i) => { const vx = p.x - cx, vy = p.y - cy; Q[i].x = cx + vx * Math.cos(a) - vy * Math.sin(a); Q[i].y = cy + vx * Math.sin(a) + vy * Math.cos(a); });
        };
        if (ht.type === 'move') Q0.forEach((p, i) => { Q[i].x = p.x + dx; Q[i].y = p.y + dy; });
        else if (ht.type === 'rotate') rotAll();
        else if (ht.type === 'corner') {
          Q[ht.i].x = Q0[ht.i].x + dx; Q[ht.i].y = Q0[ht.i].y + dy;
          if (s.mode === 'perspective') {
            const horiz = Math.abs(ev.sx - d.p0.sx) >= Math.abs(ev.sy - d.p0.sy);
            const partner = horiz ? [1, 0, 3, 2][ht.i] : [3, 2, 1, 0][ht.i];
            Q.forEach((p, i) => { if (i !== ht.i) { p.x = Q0[i].x; p.y = Q0[i].y; } });
            if (horiz) { Q[ht.i].y = Q0[ht.i].y; Q[partner].x = Q0[partner].x - dx; }
            else { Q[ht.i].x = Q0[ht.i].x; Q[partner].y = Q0[partner].y - dy; }
          } else if (s.mode === 'skew') {
            // inclinaison : le coin glisse le long de son bord
            const nb = Math.abs(ev.sx - d.p0.sx) >= Math.abs(ev.sy - d.p0.sy) ? [1, 0, 3, 2][ht.i] : [3, 2, 1, 0][ht.i];
            const ex = Q0[ht.i].x - Q0[nb].x, ey = Q0[ht.i].y - Q0[nb].y, l = Math.hypot(ex, ey) || 1, t = (dx * ex + dy * ey) / l;
            Q[ht.i].x = Q0[ht.i].x + ex / l * t; Q[ht.i].y = Q0[ht.i].y + ey / l * t;
          }
        } else if (ht.type === 'edge') {
          const a = ht.i, b = (ht.i + 1) % 4;
          let ux = dx, uy = dy;
          if (s.mode === 'skew') { const ex = Q0[b].x - Q0[a].x, ey = Q0[b].y - Q0[a].y, l = Math.hypot(ex, ey) || 1, t = (dx * ex + dy * ey) / l; ux = ex / l * t; uy = ey / l * t; }
          Q[a].x = Q0[a].x + ux; Q[a].y = Q0[a].y + uy; Q[b].x = Q0[b].x + ux; Q[b].y = Q0[b].y + uy;
        }
      }
      this.refresh();
      KS.state.doc.changed();
    },
    moveFree(ev, d) {
      const s = this.s, st = d.st, ht = d.hit;
      if (ht.type === 'move') { s.cx = st.cx + ev.x - d.p0.x; s.cy = st.cy + ev.y - d.p0.y; if (ev.shift) { if (Math.abs(ev.x - d.p0.x) > Math.abs(ev.y - d.p0.y)) s.cy = st.cy; else s.cx = st.cx; } return; }
      if (ht.type === 'rotate') {
        const a0 = Math.atan2(d.p0.y - st.cy, d.p0.x - st.cx), a1 = Math.atan2(ev.y - st.cy, ev.x - st.cx);
        s.rot = st.rot + a1 - a0;
        if (ev.shift) s.rot = Math.round(s.rot / (Math.PI / 12)) * Math.PI / 12;
        return;
      }
      // repère local centré sur le centre de départ ; signes des poignées (coins 0..3, bords haut/droite/bas/gauche)
      const [hu0, hv0] = ht.type === 'corner' ? [[-1, -1], [1, -1], [1, 1], [-1, 1]][ht.i] : [[0, -1], [1, 0], [0, 1], [-1, 0]][ht.i];
      const hu = hu0 * st.fx, hv = hv0 * st.fy;
      const cos = Math.cos(st.rot), sin = Math.sin(st.rot);
      const w0 = st.box.w * st.sx, h0 = st.box.h * st.sy;
      const px = ev.x - st.cx, py = ev.y - st.cy;
      const lu = px * cos + py * sin, lv = -px * sin + py * cos;
      const fromCenter = ev.alt;
      const size = (hs, l, s0) => !hs ? s0 : Math.max(1, fromCenter ? 2 * hs * l : hs * l + s0 / 2);
      let nw = size(hu, lu, w0), nh = size(hv, lv, h0);
      if (ht.type === 'corner' && (s.keep !== ev.shift)) { const sc = Math.max(nw / w0, nh / h0); nw = w0 * sc; nh = h0 * sc; }
      const off = (hs, n, s0) => !hs || fromCenter ? 0 : -hs * s0 / 2 + hs * n / 2;
      const cu = off(hu, nw, w0), cv = off(hv, nh, h0);
      s.sx = nw / st.box.w; s.sy = nh / st.box.h;
      s.cx = st.cx + cu * cos - cv * sin; s.cy = st.cy + cu * sin + cv * cos;
    },
    up() { this.drag = null; },
    dblclick() { this.finish(true); },
    key(e) {
      if (e.key === 'Enter') { this.finish(true); return true; }
      if (e.key === 'Escape') { this.finish(false); return true; }
      return false;
    },
    commitOnLeave() { if (this.s && !this.finishing) this.finish(true, true); },
    cancel() { if (this.s) this.finish(false); },
    finish(ok, noSwitch) {
      const s = this.s, doc = KS.state.doc; if (!s) return;
      this.finishing = true;
      const L = s.L;
      if (ok && !s.vector) this.preRender(doc, true);
      L.override = null;
      doc.selection.mask = s.savedMask; doc.selection.refresh();
      if (ok && s.vector) {
        // forme vectorielle : on transforme les points, sans perte
        const before = KS.Hist.structSnap(doc);
        before.props.set(L, { ...before.props.get(L), shape: { ...L.shape, subpaths: s.shapeBefore }, x: s.token.before.x, y: s.token.before.y });
        const box = s.box;
        L.shape.subpaths = JSON.parse(JSON.stringify(s.shapeBefore));
        KS.mapSubpaths(L.shape.subpaths, (x, y) => this.mapUV((x - box.x) / box.w, (y - box.y) / box.h));
        L.shape._x = undefined; L.renderShape();
        doc.history.push({ name: 'Transformation manuelle', icon: 'transform', ...KS.Hist.structPart(doc, before) });
      } else if (ok) {
        const r = s.result;
        L.canvas = r.canvas; L.ctx = r.canvas.getContext('2d'); L.x = r.x; L.y = r.y; L.touch();
        if (s.selMask) {
          const m = U.canvas(doc.width, doc.height), x = m.getContext('2d');
          if (s.mode === 'free') { x.setTransform(this.matrix()); x.drawImage(s.selMask, 0, 0); }
          else drawMesh(x, s.selMask, (u, v) => this.mapUV(u, v), 24, 0, 0);
          doc.selection.mask = m; doc.selection.refresh();
        }
        KS.Hist.commitPixels(doc, 'Transformation manuelle', s.token, null, 'transform', KS.Hist.selectionPart(doc, s.selBefore));
      } else L.touch();
      this.s = null; this.drag = null;
      doc.changed();
      KS.emit('selection', doc);
      if (!noSwitch) T.select(this.prev || 'move', { silent: true });
      this.finishing = false;
    },
    overlay(ctx) {
      const s = this.s; if (!s) return;
      ctx.save();
      const line = pts => { ctx.beginPath(); pts.forEach((p, i) => { const q = V.toScreen(p[0], p[1]); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); };
      const strokeLine = (w = 1.2) => { ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = w + 2; ctx.stroke(); ctx.strokeStyle = V.colors.accent || '#3d7cf0'; ctx.lineWidth = w; ctx.stroke(); };
      if (s.mode === 'warp') {
        // grille déformée (3×3 cellules) et poignées
        for (let k = 0; k <= 3; k++) {
          line([...Array(25)].map((_, t) => this.mapUV(t / 24, k / 3))); strokeLine(k === 0 || k === 3 ? 1.2 : 0.8);
          line([...Array(25)].map((_, t) => this.mapUV(k / 3, t / 24))); strokeLine(k === 0 || k === 3 ? 1.2 : 0.8);
        }
        s.grid.forEach(row => row.forEach(p => { const q = V.toScreen(p.x, p.y); V.handle(ctx, q.x, q.y, 7, true); }));
      } else {
        const cs = this.corners();
        line([...cs.map(p => [p.x, p.y]), [cs[0].x, cs[0].y]]); strokeLine();
        this.handles().forEach(hd => { const q = V.toScreen(hd.p.x, hd.p.y); V.handle(ctx, q.x, q.y, hd.type === 'edge' ? 7 : 9); });
        if (s.mode === 'free') { const c = V.toScreen(s.cx, s.cy); ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
      ctx.restore();
    },
  });

  /* ---------------------------------------------------------------- recadrage */
  const RATIOS = [['free', 'Libre'], ['orig', 'Original'], ['1:1', '1:1 (carré)'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['21:9', '21:9'], ['4:5', '4:5'], ['9:16', '9:16'], ['5:7', '5:7']];
  T.register({
    id: 'crop', name: 'Recadrage', icon: 'crop', shortcut: 'C', cursor: 'crosshair', ownsCtrl: false,
    defaults: { ratio: 'free', deletePixels: false, overlayMode: 'thirds' },
    options() {
      return [
        { type: 'select', id: 'ratio', label: 'Format', options: RATIOS },
        { type: 'button', icon: 'swap', label: 'Permuter largeur et hauteur', action: () => { const b = this.box; if (!b) return; const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; this.box = { x: c.x - b.h / 2, y: c.y - b.w / 2, w: b.h, h: b.w }; this.flipRatio = !this.flipRatio; KS.requestRender(); } },
        { type: 'sep' },
        { type: 'select', id: 'overlayMode', label: 'Superposition', options: [['thirds', 'Règle des tiers'], ['grid', 'Grille'], ['golden', 'Nombre d\'or'], ['none', 'Aucune']] },
        { type: 'check', id: 'deletePixels', label: 'Supprimer les pixels rognés' },
        { type: 'sep' },
        { type: 'custom', render: () => h('div.opt-group', ui.btn('Réinitialiser', () => { this.reset(KS.state.doc); }, '.small', 'undo'), ui.btn('Annuler', () => { this.reset(KS.state.doc); T.select('move'); }, '.small', 'close'), ui.btn('Recadrer', () => this.commit(KS.state.doc), '.small.primary', 'check')) },
      ];
    },
    onOption(k) { if (k === 'ratio' && this.box) { this.box = this.constrain(this.box, 'br'); KS.requestRender(); } },
    ratio(doc) {
      const r = this.o.ratio;
      if (r === 'free') return null;
      let v = r === 'orig' ? doc.width / doc.height : (([a, b]) => a / b)(r.split(':').map(Number));
      if (this.flipRatio) v = 1 / v;
      return v;
    },
    reset(doc) { if (doc) this.box = { x: 0, y: 0, w: doc.width, h: doc.height }; this.flipRatio = false; KS.requestRender(); },
    activate(doc) { this.reset(doc); },
    deactivate() { this.box = null; },
    constrain(b, corner) {
      const doc = KS.state.doc, r = this.ratio(doc);
      if (!r) return b;
      const nb = { ...b };
      if (b.w / b.h > r) nb.w = b.h * r; else nb.h = b.w / r;
      if (corner && corner.includes('l')) nb.x = b.x + b.w - nb.w;
      if (corner && corner.includes('t')) nb.y = b.y + b.h - nb.h;
      return nb;
    },
    hit(ev) {
      const b = this.box; if (!b) return null;
      const a = V.toScreen(b.x, b.y), c = V.toScreen(b.x + b.w, b.y + b.h), tol = 8;
      const L = Math.abs(ev.sx - a.x) < tol, R = Math.abs(ev.sx - c.x) < tol, Tp = Math.abs(ev.sy - a.y) < tol, B = Math.abs(ev.sy - c.y) < tol;
      const inX = ev.sx > a.x - tol && ev.sx < c.x + tol, inY = ev.sy > a.y - tol && ev.sy < c.y + tol;
      let k = '';
      if (Tp && inX) k += 't'; if (B && inX) k += 'b'; if (L && inY) k += 'l'; if (R && inY) k += 'r';
      if (k) return k;
      if (ev.sx > a.x && ev.sx < c.x && ev.sy > a.y && ev.sy < c.y) return 'move';
      return 'new';
    },
    cursor() {
      const m = V.mouse; if (!m || !this.box) return 'crosshair';
      const k = this.hit({ sx: m.sx, sy: m.sy });
      return { move: 'move', new: 'crosshair', t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize', tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', bt: 'ns-resize', rl: 'ew-resize' }[k] || 'crosshair';
    },
    hover() { T.updateCursor(); },
    down(ev, doc) {
      if (!this.box) this.reset(doc);
      this.drag = { k: this.hit(ev), p0: { x: ev.x, y: ev.y }, b0: { ...this.box } };
    },
    move(ev, doc) {
      const d = this.drag; if (!d) return;
      const p = T.snapPoint(doc, ev);
      const dx = p.x - d.p0.x, dy = p.y - d.p0.y, b0 = d.b0;
      if (d.k === 'move') { this.box = { ...b0, x: b0.x + dx, y: b0.y + dy }; return; }
      if (d.k === 'new') { const r = U.normRect(d.p0, p); this.box = this.constrain(r.w > 1 && r.h > 1 ? r : b0, (p.x < d.p0.x ? 'l' : 'r') + (p.y < d.p0.y ? 't' : 'b')); return; }
      let { x, y, w, h: hh } = b0;
      if (d.k.includes('l')) { x = b0.x + dx; w = b0.w - dx; }
      if (d.k.includes('r')) w = b0.w + dx;
      if (d.k.includes('t')) { y = b0.y + dy; hh = b0.h - dy; }
      if (d.k.includes('b')) hh = b0.h + dy;
      if (w < 1) { x += w - 1; w = 1; } if (hh < 1) { y += hh - 1; hh = 1; }
      let nb = { x, y, w, h: hh };
      const r = this.ratio(doc) || (ev.shift && d.k.length === 2 ? b0.w / b0.h : null);
      if (r) {
        if (d.k.length === 2) { if (nb.w / nb.h > r) nb.w = nb.h * r; else nb.h = nb.w / r; }
        else if (d.k === 't' || d.k === 'b') { nb.w = nb.h * r; nb.x = b0.x + (b0.w - nb.w) / 2; }
        else { nb.h = nb.w / r; nb.y = b0.y + (b0.h - nb.h) / 2; }
        if (d.k.includes('l')) nb.x = b0.x + b0.w - nb.w;
        if (d.k.includes('t')) nb.y = b0.y + b0.h - nb.h;
      }
      this.box = nb;
    },
    up() { this.drag = null; },
    dblclick(ev, doc) { this.commit(doc); },
    key(e, doc) {
      if (e.key === 'Enter') { this.commit(doc); return true; }
      if (e.key === 'Escape') { this.reset(doc); return true; }
      return false;
    },
    commit(doc) {
      if (!doc || !this.box) return;
      const b = { x: Math.round(this.box.x), y: Math.round(this.box.y), w: Math.max(1, Math.round(this.box.w)), h: Math.max(1, Math.round(this.box.h)) };
      if (b.x === 0 && b.y === 0 && b.w === doc.width && b.h === doc.height) return;
      KS.cmd.cropTo(doc, b, this.o.deletePixels);
      this.reset(doc);
    },
    overlay(ctx, v, doc) {
      if (!this.box) return;
      const b = this.box, a = V.toScreen(b.x, b.y), c = V.toScreen(b.x + b.w, b.y + b.h), w = c.x - a.x, hh = c.y - a.y;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, V.w, V.h); ctx.rect(a.x, a.y, w, hh);
      ctx.fillStyle = 'rgba(8,10,14,0.62)'; ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath();
      const lines = (fr) => fr.forEach(t => { ctx.moveTo(a.x + w * t, a.y); ctx.lineTo(a.x + w * t, c.y); ctx.moveTo(a.x, a.y + hh * t); ctx.lineTo(c.x, a.y + hh * t); });
      if (this.o.overlayMode === 'thirds') lines([1 / 3, 2 / 3]);
      else if (this.o.overlayMode === 'grid') lines([1, 2, 3, 4, 5, 6, 7, 8].map(i => i / 9));
      else if (this.o.overlayMode === 'golden') lines([0.382, 0.618]);
      ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, hh);
      // poignées en L façon Photoshop
      ctx.lineWidth = 4; ctx.strokeStyle = '#fff';
      const L = 16;
      ctx.beginPath();
      for (const [x, y, sx, sy] of [[a.x, a.y, 1, 1], [c.x, a.y, -1, 1], [c.x, c.y, -1, -1], [a.x, c.y, 1, -1]]) { ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); }
      for (const [x, y, horiz] of [[(a.x + c.x) / 2, a.y, true], [(a.x + c.x) / 2, c.y, true], [a.x, (a.y + c.y) / 2, false], [c.x, (a.y + c.y) / 2, false]]) { if (horiz) { ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); } else { ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); } }
      ctx.stroke();
      const label = `${Math.round(b.w)} × ${Math.round(b.h)} px`;
      ctx.font = '11.5px Outfit, sans-serif';
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(20,22,27,0.85)'; ctx.beginPath(); ctx.roundRect(a.x + w / 2 - tw / 2, c.y + 10, tw, 22, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, a.x + w / 2 - tw / 2 + 7, c.y + 25);
      ctx.restore();
      void doc;
    },
  });
  void TR;
})();
