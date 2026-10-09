// Sélection : un masque alpha à la taille du document (null = rien de sélectionné),
// le contour « fourmis » calculé à chaque changement.
'use strict';
(() => {
  const U = KS.util;

  class Selection {
    constructor(doc) {
      this.doc = doc;
      this.mask = null;
      this.edges = null;
      this.bounds = null;
      this.alpha = null;   // Uint8Array w*h (seuil > 127) pour les tests rapides
      this.last = null;    // pour « Resélectionner »
    }
    get active() { return !!this.mask; }
    get w() { return this.doc.width; }
    get h() { return this.doc.height; }

    resize() { this.mask = null; this.refresh(); }
    snapshot() { return this.mask ? U.copyCanvas(this.mask) : null; }
    restore(s) { this.mask = s ? U.copyCanvas(s) : null; this.refresh(); KS.emit('selection', this.doc); }

    // Applique une forme dessinée par fn(ctx) selon le mode : new | add | sub | int
    combine(fn, mode = 'new', feather = 0) {
      let shape = U.canvas(this.w, this.h);
      const c = shape.getContext('2d');
      c.fillStyle = '#000'; c.strokeStyle = '#000';
      fn(c);
      if (feather > 0) shape = U.blurCanvas(shape, feather / 2);
      this.combineCanvas(shape, mode);
    }
    combineCanvas(shape, mode = 'new') {
      if (mode === 'new' || (!this.mask && (mode === 'add' || mode === 'int'))) {
        this.mask = U.canvas(this.w, this.h);
        this.mask.getContext('2d').drawImage(shape, 0, 0);
      } else if (this.mask) {
        const c = this.mask.getContext('2d');
        c.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'sub' ? 'destination-out' : 'destination-in';
        c.drawImage(shape, 0, 0);
        c.globalCompositeOperation = 'source-over';
      }
      this.refresh();
    }
    rect(r, mode, feather) { this.combine(c => c.fillRect(r.x, r.y, r.w, r.h), mode, feather); }
    ellipse(r, mode, feather) {
      this.combine(c => { c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); c.fill(); }, mode, feather);
    }
    polygon(pts, mode, feather) {
      if (pts.length < 3) return;
      this.combine(c => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.fill(); }, mode, feather);
    }
    all() { this.mask = U.canvas(this.w, this.h); const c = this.mask.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, this.w, this.h); this.refresh(); }
    clear() { if (this.mask) this.last = this.mask; this.mask = null; this.refresh(); }
    reselect() { if (this.last) { this.mask = U.copyCanvas(this.last); this.refresh(); } }
    invert() {
      const m = U.canvas(this.w, this.h), c = m.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, this.w, this.h);
      if (this.mask) { c.globalCompositeOperation = 'destination-out'; c.drawImage(this.mask, 0, 0); }
      this.mask = m; this.refresh();
    }
    translate(dx, dy) {
      if (!this.mask) return;
      const m = U.canvas(this.w, this.h);
      m.getContext('2d').drawImage(this.mask, Math.round(dx), Math.round(dy));
      this.mask = m; this.refresh();
    }
    feather(r) { if (this.mask && r > 0) { this.mask = U.blurCanvas(this.mask, r / 2); this.refresh(); } }
    smooth(r) {
      if (!this.mask || r <= 0) return;
      const b = U.blurCanvas(this.mask, r), d = U.getData(b), p = d.data;
      for (let i = 3; i < p.length; i += 4) { const a = p[i]; p[i] = a < 100 ? 0 : a > 156 ? 255 : (a - 100) * 255 / 56; }
      const m = U.canvas(this.w, this.h); U.putData(m, d); this.mask = m; this.refresh();
    }
    // Dilatation / érosion exactes (transformée de distance chanfreinée 3-4)
    _distance(inside) {
      const w = this.w, h = this.h, a = U.getData(this.mask).data, INF = 1e9;
      const d = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) d[i] = (a[i * 4 + 3] > 127) === inside ? 0 : INF;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; let v = d[i]; if (!v) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + 3);
        if (y > 0) { v = Math.min(v, d[i - w] + 3); if (x > 0) v = Math.min(v, d[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4); }
        d[i] = v;
      }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x; let v = d[i]; if (!v) continue;
        if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
        if (y < h - 1) { v = Math.min(v, d[i + w] + 3); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4); if (x > 0) v = Math.min(v, d[i + w - 1] + 4); }
        d[i] = v;
      }
      return d;
    }
    _fromTest(test) {
      const w = this.w, h = this.h, img = new ImageData(w, h), p = img.data;
      for (let i = 0; i < w * h; i++) if (test(i)) p[i * 4 + 3] = 255;
      const m = U.canvas(w, h); U.putData(m, img); this.mask = m; this.refresh();
    }
    expand(r) { if (!this.mask) return; const d = this._distance(true); this._fromTest(i => d[i] <= r * 3); }
    contract(r) { if (!this.mask) return; const d = this._distance(false); this._fromTest(i => d[i] > r * 3); }
    border(r) {
      if (!this.mask) return;
      const out = this._distance(true), inn = this._distance(false), h = r * 3 / 2;
      this._fromTest(i => (out[i] > 0 && out[i] <= h) || (inn[i] > 0 && inn[i] <= h));
    }
    fromLayer(layer, mode = 'new') {
      this.combine(c => { const img = layer.image(); c.drawImage(img.canvas, img.x, img.y); }, mode);
    }

    // Recalcule bornes, tableau alpha et contour
    refresh() {
      this.edges = null; this.bounds = null; this.alpha = null;
      if (!this.mask) return;
      const w = this.w, h = this.h;
      if (this.mask.width !== w || this.mask.height !== h) { this.mask = null; return; }
      const d = U.getData(this.mask).data;
      const A = new Uint8Array(w * h);
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
        if (d[i * 4 + 3] > 127) { A[i] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
      }
      if (x1 < 0) {
        // rien d'opaque : on garde un masque très doux (contour progressif) s'il reste de l'alpha
        let any = false; for (let i = 3; i < d.length; i += 4) if (d[i]) { any = true; break; }
        if (!any) { this.mask = null; return; }
        this.alpha = A; this.bounds = { x: 0, y: 0, w, h }; this.edges = new Path2D(); return;
      }
      this.alpha = A;
      this.bounds = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      const p = new Path2D();
      const X0 = Math.max(0, x0 - 1), X1 = Math.min(w, x1 + 2), Y0 = Math.max(0, y0), Y1 = Math.min(h, y1 + 2);
      const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? A[y * w + x] : 0;
      for (let y = Y0; y <= Y1; y++) {           // bords horizontaux (entre y-1 et y)
        let run = -1;
        for (let x = X0; x <= X1; x++) {
          const e = x < X1 && at(x, y - 1) !== at(x, y);
          if (e && run < 0) run = x;
          if (!e && run >= 0) { p.moveTo(run, y); p.lineTo(x, y); run = -1; }
        }
      }
      for (let x = X0; x <= X1; x++) {           // bords verticaux (entre x-1 et x)
        let run = -1;
        for (let y = Y0; y <= Y1; y++) {
          const e = y < Y1 && at(x - 1, y) !== at(x, y);
          if (e && run < 0) run = y;
          if (!e && run >= 0) { p.moveTo(x, run); p.lineTo(x, y); run = -1; }
        }
      }
      this.edges = p;
    }
    contains(x, y) {
      if (!this.alpha) return false;
      x = Math.floor(x); y = Math.floor(y);
      return x >= 0 && y >= 0 && x < this.w && y < this.h && this.alpha[y * this.w + x] === 1;
    }
    // Garde dans `canvas` (placé en ox, oy dans le document) seulement la partie sélectionnée
    clip(canvas, ox = 0, oy = 0) {
      if (!this.mask) return;
      const c = canvas.getContext('2d');
      c.save();
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(this.mask, -ox, -oy);
      c.restore();
    }
    // Retire la partie sélectionnée de `canvas`
    cut(canvas, ox = 0, oy = 0) {
      if (!this.mask) return;
      const c = canvas.getContext('2d');
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(this.mask, -ox, -oy);
      c.restore();
    }
    drawAnts(ctx, v, phase) {
      if (!this.edges) return;
      ctx.save();
      ctx.setTransform(v.dpr * v.zoom, 0, 0, v.dpr * v.zoom, v.dpr * v.ox, v.dpr * v.oy);
      ctx.lineWidth = 1 / v.zoom;
      ctx.strokeStyle = '#fff';
      ctx.setLineDash([]);
      ctx.stroke(this.edges);
      ctx.strokeStyle = '#000';
      ctx.setLineDash([4 / v.zoom, 4 / v.zoom]);
      ctx.lineDashOffset = -phase / v.zoom;
      ctx.stroke(this.edges);
      ctx.restore();
    }
  }
  KS.Selection = Selection;
})();
