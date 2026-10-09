// Document : calques (du bas vers le haut), sélection, historique, vue, repères,
// tracés et couches alpha.
//
// Groupes : la liste reste plate. Un calque de groupe (kind 'group') est placé
// juste au-dessus de ses descendants, qui sont contigus sous lui ; chaque calque
// connaît son groupe parent par `parent` (id ou null).
'use strict';
(() => {
  const U = KS.util;

  class Doc {
    constructor({ name = 'Sans titre', width = 1920, height = 1080 } = {}) {
      this.id = U.uid();
      this.name = name;
      this.width = width; this.height = height;
      this.layers = [];
      this.activeId = null;
      this.selectedIds = new Set();   // sélection multiple de calques (inclut l'actif)
      this.selection = new KS.Selection(this);
      this.history = new KS.Hist.History(this);
      this.view = { zoom: 1, x: 0, y: 0, fitted: false };
      this.guides = { h: [], v: [] };
      this.paths = [];                // tracés : { id, name, subpaths: [{ closed, pts: [{x,y,ix,iy,ox,oy}] }] }
      this.activePathId = null;
      this.alphas = [];               // couches alpha : { id, name, canvas (gris) }
      this.channelView = null;        // null = RVB ; sinon { r, g, b } visibles
      this.alphaEdit = null;          // couche alpha en cours de modification (id)
      this.path = null;
      this.format = null;
      this.dirty = false;
      this.revision = 0;
      this.compositeCanvas = U.canvas(width, height);
      this.compositeDirty = true;
      this.quickMask = null;
      this.stamp = 0;
    }

    get active() { return this.layers.find(l => l.id === this.activeId) || null; }
    get activeIndex() { return this.layers.findIndex(l => l.id === this.activeId); }
    layerById(id) { return this.layers.find(l => l.id === id) || null; }
    setActive(layer, keepSelection = false) {
      if (!layer) return;
      if (!keepSelection) this.selectedIds = new Set([layer.id]);
      else this.selectedIds.add(layer.id);
      if (this.activeId !== layer.id || !keepSelection) { this.activeId = layer.id; }
      if (layer.kind === 'shape') this.activePathId = null;
      KS.emit('layers', this); KS.emit('active-layer', this);
    }
    // Calques sélectionnés (ordre du document), sans les descendants d'un groupe déjà pris
    get selected() {
      const ids = this.selectedIds.size ? this.selectedIds : new Set(this.activeId ? [this.activeId] : []);
      if (this.activeId) ids.add(this.activeId);
      const list = this.layers.filter(l => ids.has(l.id));
      return list.filter(l => !list.some(g => g !== l && g.kind === 'group' && this.isDescendant(l, g)));
    }

    /* ------------------------------------------------ arbre des groupes */
    parentOf(L) { return L && L.parent ? this.layerById(L.parent) : null; }
    isDescendant(L, G) { let p = this.parentOf(L); while (p) { if (p === G) return true; p = this.parentOf(p); } return false; }
    descendants(G) { return this.layers.filter(l => this.isDescendant(l, G)); }
    children(G) { const id = G ? G.id : null; return this.layers.filter(l => (l.parent || null) === id); }
    depth(L) { let d = 0, p = this.parentOf(L); while (p) { d++; p = this.parentOf(p); } return d; }
    // Bloc [début, fin] (indices) d'un calque et de ses descendants
    block(L) {
      const i = this.layers.indexOf(L);
      if (L.kind !== 'group') return [i, i];
      return [i - this.descendants(L).length, i];
    }
    takeBlock(L) { const [a, b] = this.block(L); return this.layers.splice(a, b - a + 1); }
    // Visible si lui et tous ses groupes sont visibles
    shown(L) { let p = L; while (p) { if (!p.visible) return false; p = this.parentOf(p); } return true; }
    // Déplace le bloc de L : au-dessus (above=true) ou en dessous de la cible ; inside = dans le groupe cible (en haut)
    moveBlock(L, target, { above = true, inside = false } = {}) {
      if (target === L || (target && this.isDescendant(target, L))) return false;
      const blk = this.takeBlock(L);
      if (inside && target && target.kind === 'group') {
        L.parent = target.id;
        this.layers.splice(this.layers.indexOf(target), 0, ...blk);
      } else if (target) {
        L.parent = target.parent || null;
        const [a, b] = this.block(target);
        this.layers.splice(above ? b + 1 : a, 0, ...blk);
      } else { L.parent = null; this.layers.push(...blk); }
      this.changed();
      return true;
    }

    // Insère à l'indice donné ; sans parent explicite, le calque prend le groupe de son voisin du dessous
    addLayer(layer, index = this.activeIndex + 1, select = true) {
      if (index < 0 || index > this.layers.length) index = this.layers.length;
      if (layer.parent === undefined) {
        const below = this.layers[index - 1], above = this.layers[index];
        layer.parent = below ? (below.parent || null) : (above ? above.parent || null : null);
      }
      this.layers.splice(index, 0, layer);
      if (select) { this.activeId = layer.id; this.selectedIds = new Set([layer.id]); }
      this.changed();
      return layer;
    }
    removeLayer(layer) {
      if (this.layers.indexOf(layer) < 0) return;
      const start = this.block(layer)[0];
      const blk = this.takeBlock(layer);
      if (blk.some(l => l.id === this.activeId)) {
        const n = this.layers[start - 1] || this.layers[start] || null;
        this.activeId = n ? n.id : null;
      }
      this.selectedIds = new Set(this.activeId ? [this.activeId] : []);
      this.changed();
    }
    newLayerName(base = 'Calque') {
      let n = 1;
      const names = new Set(this.layers.map(l => l.name));
      while (names.has(`${base} ${n}`)) n++;
      return `${base} ${n}`;
    }

    changed() { this.compositeDirty = true; this.stamp++; KS.requestRender && KS.requestRender(); }

    /* ------------------------------------------------ composition */
    composite() {
      if (!this.compositeDirty && this.compositeCanvas.width === this.width && this.compositeCanvas.height === this.height) return this.compositeCanvas;
      const c = U.fitCanvas(this.compositeCanvas, this.width, this.height);
      this.composeInto(c.getContext('2d'), this.layers);
      this.compositeDirty = false;
      return c;
    }
    flatten(layers = this.layers) {
      const c = U.canvas(this.width, this.height);
      this.composeInto(c.getContext('2d'), layers);
      return c;
    }
    // Compose une sous-liste (ordre conservé) : les calques dont le groupe n'y figure pas sont à la racine
    composeInto(ctx, layers) {
      const set = new Set(layers);
      const kids = new Map();
      for (const L of layers) {
        let p = this.parentOf(L);
        while (p && !set.has(p)) p = this.parentOf(p);
        const key = p ? p.id : null;
        if (!kids.has(key)) kids.set(key, []);
        kids.get(key).push(L);
      }
      this._level(ctx, kids.get(null) || [], kids);
    }
    _level(ctx, items, kids) {
      const W = this.width, H = this.height;
      for (let i = 0; i < items.length; i++) {
        const L = items[i];
        if (L.clip && i > 0) continue;               // dessiné avec sa base
        const clipped = [];
        for (let j = i + 1; j < items.length && items[j].clip; j++) clipped.push(items[j]);
        if (!L.visible) continue;
        if (L.kind === 'adjust') { this.applyAdjustLayer(ctx, L); continue; }
        if (L.kind === 'group') { this._group(ctx, L, kids.get(L.id) || [], kids); continue; }
        let img = L.image();
        const vis = clipped.filter(c => c.visible);
        if (vis.length) {
          const t = U.canvas(W, H), tx = t.getContext('2d');
          tx.drawImage(img.canvas, img.x, img.y);
          for (const c of vis) {
            if (c.kind === 'adjust') {
              const t2 = U.copyCanvas(t);
              this.applyAdjustLayer(t2.getContext('2d'), c);
              // Le réglage conserve déjà l'alpha de sa base : ne pas l'appliquer deux fois.
              tx.clearRect(0, 0, W, H); tx.drawImage(t2, 0, 0);
              continue;
            }
            if (c.kind === 'group') continue;
            const ci = c.image();
            const t2 = U.canvas(W, H), k = t2.getContext('2d');
            k.drawImage(ci.canvas, ci.x, ci.y);
            k.globalCompositeOperation = 'destination-in';
            k.drawImage(img.canvas, img.x, img.y);
            tx.globalAlpha = c.opacity;
            tx.globalCompositeOperation = KS.blendOp(c.blend);
            tx.drawImage(t2, 0, 0);
            tx.globalAlpha = 1; tx.globalCompositeOperation = 'source-over';
          }
          img = { canvas: t, x: 0, y: 0 };
        }
        ctx.globalAlpha = L.opacity;
        ctx.globalCompositeOperation = KS.blendOp(L.blend);
        ctx.drawImage(img.canvas, img.x, img.y);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    _groupMask(G) {
      const m = G.mask;
      if (!m || !m.enabled || !m.alpha) return null;
      const mk = U.canvas(this.width, this.height), mx = mk.getContext('2d');
      if ((m.outside ?? 255) > 0) { mx.globalAlpha = m.outside / 255; mx.fillRect(0, 0, this.width, this.height); mx.globalAlpha = 1; }
      mx.clearRect(m.x, m.y, m.canvas.width, m.canvas.height);
      mx.drawImage(m.alpha, m.x, m.y);
      return mk;
    }
    _group(ctx, G, children, kids) {
      const W = this.width, H = this.height, mask = this._groupMask(G);
      if (G.blend === 'pass') {
        if (G.opacity >= 1 && !mask) { this._level(ctx, children, kids); return; }
        // passage : composer sur une copie du fond, puis fondre selon opacité et masque
        const t = U.copyCanvas(ctx.canvas), tx = t.getContext('2d');
        this._level(tx, children, kids);
        if (mask) { tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mask, 0, 0); }
        ctx.globalAlpha = G.opacity; ctx.drawImage(t, 0, 0); ctx.globalAlpha = 1;
        return;
      }
      const t = U.canvas(W, H), tx = t.getContext('2d');
      this._level(tx, children, kids);
      if (mask) { tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mask, 0, 0); tx.globalCompositeOperation = 'source-over'; }
      ctx.globalAlpha = G.opacity;
      ctx.globalCompositeOperation = KS.blendOp(G.blend);
      ctx.drawImage(t, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    applyAdjustLayer(ctx, L) {
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const original = ctx.getImageData(0, 0, W, H);
      const src = new ImageData(new Uint8ClampedArray(original.data), W, H);
      const params = L.adjustPreview || L.adjust.params;
      KS.Adjust.apply(L.adjust.type, src, params, this);
      const op = KS.blendOp(L.blend);
      let adjusted = src.data;
      if (op !== 'source-over') {
        const t = U.canvas(W, H), tx = t.getContext('2d');
        const bottom = new ImageData(new Uint8ClampedArray(original.data), W, H);
        const top = new ImageData(new Uint8ClampedArray(src.data), W, H);
        for (let i = 3; i < top.data.length; i += 4) { bottom.data[i] = top.data[i] = 255; }
        tx.putImageData(bottom, 0, 0);
        const tc = U.canvas(W, H); U.putData(tc, top);
        tx.globalCompositeOperation = op; tx.drawImage(tc, 0, 0);
        adjusted = tx.getImageData(0, 0, W, H).data;
      }
      const mk = this._groupMask(L);
      const mask = mk ? U.getData(mk).data : null, pixels = original.data;
      for (let i = 0; i < pixels.length; i += 4) {
        const strength = L.opacity * (mask ? mask[i + 3] / 255 : 1);
        for (let ch = 0; ch < 3; ch++) pixels[i + ch] += (adjusted[i + ch] - pixels[i + ch]) * strength;
      }
      // Un réglage de couleur change les couleurs, sans épaissir les bords transparents.
      ctx.putImageData(original, 0, 0);
    }

    // Image affichée (filtre de couches : rouge seul en niveaux de gris, etc.)
    display() {
      const c = this.composite(), v = this.channelView;
      if (!v || (v.r && v.g && v.b)) return c;
      if (this._disp && this._disp.stamp === this.stamp && this._disp.key === JSON.stringify(v)) return this._disp.canvas;
      const d = U.getData(c), p = d.data, n = (v.r ? 1 : 0) + (v.g ? 1 : 0) + (v.b ? 1 : 0);
      for (let i = 0; i < p.length; i += 4) {
        if (n === 1) { const g = v.r ? p[i] : v.g ? p[i + 1] : p[i + 2]; p[i] = p[i + 1] = p[i + 2] = g; }
        else { if (!v.r) p[i] = 0; if (!v.g) p[i + 1] = 0; if (!v.b) p[i + 2] = 0; }
      }
      const out = this._disp?.canvas && this._disp.canvas.width === c.width && this._disp.canvas.height === c.height ? this._disp.canvas : U.canvas(c.width, c.height);
      U.putData(out, d);
      this._disp = { stamp: this.stamp, key: JSON.stringify(v), canvas: out };
      return out;
    }

    sample(x, y, size = 1, source = 'all') {
      x = Math.floor(x); y = Math.floor(y);
      const r = Math.floor(size / 2);
      let c, ox = 0, oy = 0;
      const A = this.active;
      if (source === 'layer' && A && A.kind !== 'adjust' && A.kind !== 'group') { c = A.canvas; ox = A.x; oy = A.y; }
      else c = this.composite();
      const rx = x - r - ox, ry = y - r - oy;
      const box = U.rectIntersect({ x: rx, y: ry, w: size, h: size }, { x: 0, y: 0, w: c.width, h: c.height });
      if (!box) return null;
      const d = U.getData(c, box).data;
      let R = 0, G = 0, B = 0, Al = 0;
      for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; R += d[i] * a; G += d[i + 1] * a; B += d[i + 2] * a; Al += a; }
      if (!Al) return null;
      return { r: Math.round(R / Al), g: Math.round(G / Al), b: Math.round(B / Al), a: Al / (d.length / 4) / 255 };
    }

    get rect() { return { x: 0, y: 0, w: this.width, h: this.height }; }
    get workRect() { return this.selection.bounds ? { ...this.selection.bounds } : this.rect; }
    get activePath() { return this.paths.find(p => p.id === this.activePathId) || null; }
  }

  KS.Doc = Doc;

  KS.createDoc = ({ name, width, height, background = 'white', color }) => {
    const d = new Doc({ name, width, height });
    const L = new KS.Layer({ name: background === 'transparent' ? 'Calque 1' : 'Arrière-plan', w: width, h: height });
    if (background !== 'transparent') {
      L.ctx.fillStyle = background === 'black' ? '#000' : background === 'custom' ? U.hex(color || KS.state.bg) : background === 'bg' ? U.hex(KS.state.bg) : '#fff';
      L.ctx.fillRect(0, 0, width, height);
    }
    d.addLayer(L, 0);
    d.dirty = false;
    return d;
  };
})();
