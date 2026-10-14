// Moteur de pinceau. Un tracé accumule ses empreintes (au « flux ») dans un tampon,
// puis le tampon est appliqué au calque à l'« opacité » : même comportement que
// Photoshop. Les cibles en niveaux de gris (masque, masque rapide) sont peintes
// directement, empreinte par empreinte.
'use strict';
(() => {
  const U = KS.util;
  const tipCache = new Map();

  // Empreinte ronde : diamètre d, dureté h (0..1), couleur css
  function tip(d, h, color, aliased) {
    d = Math.max(1, d);
    const key = `${Math.round(d * 4)}|${Math.round(h * 100)}|${color}|${aliased ? 1 : 0}`;
    let c = tipCache.get(key);
    if (c) return c;
    if (tipCache.size > 64) tipCache.clear();
    const S = Math.ceil(d) + 2;
    c = U.canvas(S, S);
    const x = c.getContext('2d'), r = d / 2, cx = S / 2;
    if (aliased) {
      const img = x.createImageData(S, S), p = img.data, rgb = U.parseHex(color) || { r: 0, g: 0, b: 0 };
      for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
        if (Math.hypot(xx + 0.5 - cx, yy + 0.5 - cx) <= r + 0.01) { const i = (yy * S + xx) * 4; p[i] = rgb.r; p[i + 1] = rgb.g; p[i + 2] = rgb.b; p[i + 3] = 255; }
      }
      x.putImageData(img, 0, 0);
    } else if (h >= 0.99) {
      x.fillStyle = color; x.beginPath(); x.arc(cx, cx, r, 0, Math.PI * 2); x.fill();
    } else {
      const g = x.createRadialGradient(cx, cx, 0, cx, cx, r);
      const rgb = U.parseHex(color) || { r: 0, g: 0, b: 0 }, col = a => `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
      g.addColorStop(0, col(1));
      g.addColorStop(Math.max(0, h * 0.98), col(1));
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, pos = h + (1 - h) * t, a = 1 - t, sm = a * a * (3 - 2 * a);
        g.addColorStop(Math.min(1, pos), col(sm));
      }
      x.fillStyle = g; x.beginPath(); x.arc(cx, cx, r, 0, Math.PI * 2); x.fill();
    }
    tipCache.set(key, c);
    return c;
  }

  // Poids du pinceau (0..1) à la distance relative t = d / r
  function weight(t, h) {
    if (t >= 1) return 0;
    if (t <= h) return 1;
    const a = 1 - (t - h) / (1 - h);
    return a * a * (3 - 2 * a);
  }

  // Tampons réutilisés d'un coup de pinceau à l'autre : allouer deux canevas de la taille du
  // calque (des dizaines de mégapixels) à chaque trait coûtait plus que le trait lui-même.
  const pool = { buffer: null, tmp: null, sbuf: null, last: null };
  function takeBuffers(W, H, needSel) {
    if (!pool.buffer || pool.buffer.width !== W || pool.buffer.height !== H) {
      pool.buffer = U.canvas(W, H); pool.tmp = U.canvas(1, 1); pool.sbuf = null;
    } else if (pool.last && pool.last.rect) {
      const r = pool.last.rect, x = pool.buffer.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      x.clearRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    }
    if (needSel && (!pool.sbuf || pool.sbuf.width !== W || pool.sbuf.height !== H)) pool.sbuf = U.canvas(W, H);
    return pool;
  }

  class Stroke {
    // o : { doc, target, size, hardness, opacity, flow, spacing, color, mode, aliased,
    //       pressureSize, pressureOpacity, direct, cloneSource, cloneOffset, lockAlpha }
    constructor(o) {
      Object.assign(this, o);
      this.t = o.target;
      this.rect = null;
      this.last = null;
      this.rest = 0;
      this.sel = o.doc.selection.mask && !o.ignoreSelection ? o.doc.selection.mask : null;
      if (!this.direct) {
        const P = takeBuffers(this.t.canvas.width, this.t.canvas.height, !!this.sel);
        P.last = this;
        this.buffer = P.buffer; this.bctx = this.buffer.getContext('2d');
        this.tmp = P.tmp;
        this.sbuf = this.sel ? P.sbuf : null;
      }
      this.css = this.mode === 'erase' ? '#000000' : U.hex(this.color || { r: 0, g: 0, b: 0 });
    }
    // p : { x, y, pressure } en coordonnées document
    start(p) { this.last = p; this.rest = 0; this.dab(p.x, p.y, p.pressure); }
    move(p) {
      const a = this.last;
      if (!a) return this.start(p);
      const dx = p.x - a.x, dy = p.y - a.y, dist = Math.hypot(dx, dy);
      const step = () => Math.max(0.5, this.size * (this.pressureSize ? Math.max(0.1, p.pressure) : 1) * this.spacing);
      let s = step(), t = s - this.rest;
      if (dist < t) { this.rest += dist; this.last = p; return; }
      while (t <= dist) {
        const k = t / dist;
        this.dab(a.x + dx * k, a.y + dy * k, a.pressure + (p.pressure - a.pressure) * k);
        s = step(); t += s;
      }
      this.rest = dist - (t - s);
      this.last = p;
    }
    dab(x, y, pr) {
      const size = this.size * (this.pressureSize ? Math.max(0.05, pr) : 1);
      const alpha = this.flow * (this.pressureOpacity ? pr : 1);
      const tx = x - this.t.ox, ty = y - this.t.oy;
      const r = size / 2;
      let dx = tx - r, dy = ty - r;
      if (this.aliased) { dx = Math.round(dx); dy = Math.round(dy); }
      const box = { x: Math.floor(dx) - 1, y: Math.floor(dy) - 1, w: Math.ceil(size) + 3, h: Math.ceil(size) + 3 };
      this.rect = U.rectUnion(this.rect, box);
      // zones touchées depuis le dernier aperçu / la dernière recomposition (coordonnées du calque)
      this.dirtyPreview = U.rectUnion(this.dirtyPreview, box);
      this.dirtyChange = U.rectUnion(this.dirtyChange, box);
      if (this.mode === 'clone') return this._dabClone(tx, ty, size, alpha, dx, dy);
      const tp = tip(this.aliased ? Math.round(size) : size, this.hardness, this.css, this.aliased);
      const ctx = this.direct ? this.t.canvas.getContext('2d') : this.bctx;
      if (this.direct) {
        // directement sur la cible (masques) : on rogne l'empreinte à la sélection
        const S = tp.width, small = U.canvas(S, S), sx = small.getContext('2d');
        sx.drawImage(tp, 0, 0);
        if (this.sel) { sx.globalCompositeOperation = 'destination-in'; sx.drawImage(this.sel, -(dx - (tp.width - size) / 2 + this.t.ox), -(dy - (tp.width - size) / 2 + this.t.oy)); }
        ctx.globalAlpha = alpha * this.opacity;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(small, dx - (tp.width - size) / 2, dy - (tp.width - size) / 2);
        ctx.globalAlpha = 1;
        this.dirtyMove = U.rectUnion(this.dirtyMove, box);
        return;
      }
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = !this.aliased;
      if (this.aliased) ctx.drawImage(tp, dx - 1, dy - 1);
      else ctx.drawImage(tp, dx - (tp.width - size) / 2, dy - (tp.width - size) / 2, tp.width * (size / Math.max(1, size)), tp.height * (size / Math.max(1, size)));
      ctx.globalAlpha = 1;
    }
    _dabClone(tx, ty, size, alpha, dx, dy) {
      const src = this.cloneSource, off = this.cloneOffset;
      const S = Math.ceil(size) + 2;
      if (!this._cs || this._cs.width !== S) this._cs = U.canvas(S, S);
      const small = this._cs, sx = small.getContext('2d');
      sx.globalCompositeOperation = 'source-over'; sx.clearRect(0, 0, S, S);
      // position source en coordonnées du canevas source
      const docX = tx + this.t.ox + off.dx, docY = ty + this.t.oy + off.dy;
      sx.drawImage(src.canvas, -(docX - src.ox - S / 2), -(docY - src.oy - S / 2));
      sx.globalCompositeOperation = 'destination-in';
      const tp = tip(size, this.hardness, '#000000');
      sx.drawImage(tp, (S - tp.width) / 2, (S - tp.height) / 2);
      this.bctx.globalAlpha = alpha;
      this.bctx.drawImage(small, tx - S / 2, ty - S / 2);
      this.bctx.globalAlpha = 1;
      void dx; void dy;
    }
    // Zone modifiée depuis le dernier appel, en coordonnées document (null : rien)
    takeDirty() {
      const r = this.direct ? this.dirtyMove : this.dirtyChange;
      this.dirtyChange = null;
      return r ? { x: r.x + this.t.ox, y: r.y + this.t.oy, w: r.w, h: r.h } : null;
    }
    // Tampon rogné à la sélection (sur la zone r seulement, si donnée)
    _clippedBuffer(r) {
      if (!this.sel) return this.buffer;
      const s = this.sbuf, x = s.getContext('2d');
      if (s.width !== this.buffer.width || s.height !== this.buffer.height) { s.width = this.buffer.width; s.height = this.buffer.height; }
      const z = r || { x: 0, y: 0, w: s.width, h: s.height };
      x.save(); x.beginPath(); x.rect(z.x, z.y, z.w, z.h); x.clip();
      x.clearRect(z.x, z.y, z.w, z.h);
      x.drawImage(this.buffer, 0, 0);
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(this.sel, -this.t.ox, -this.t.oy);
      x.restore();
      return s;
    }
    _applyTo(ctx, r) {
      ctx.globalAlpha = this.opacity;
      ctx.globalCompositeOperation = this.mode === 'erase' ? 'destination-out' : this.lockAlpha ? 'source-atop' : 'source-over';
      ctx.drawImage(this._clippedBuffer(r), 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // Aperçu : copie du calque + tampon. La copie est faite une fois ; ensuite seules les
    // zones touchées depuis le dernier aperçu sont refaites (calque d'origine + tampon).
    preview() {
      if (this.direct) return null;
      const W = this.t.canvas.width, H = this.t.canvas.height, c = this.tmp, x = c.getContext('2d');
      if (!this._pv || c.width !== W || c.height !== H) {
        U.fitCanvas(c, W, H);
        x.drawImage(this.t.canvas, 0, 0);
        this._applyTo(x);
        this._pv = true;
      } else {
        const r = this.dirtyPreview && U.rectIntersect(this.dirtyPreview, { x: 0, y: 0, w: W, h: H });
        if (r) {
          x.save(); x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip();
          x.clearRect(r.x, r.y, r.w, r.h);
          x.drawImage(this.t.canvas, 0, 0);
          this._applyTo(x, r);
          x.restore();
        }
      }
      this.dirtyPreview = null;
      return { canvas: c, x: this.t.ox, y: this.t.oy };
    }
    commit() {
      // seul le rectangle du coup de pinceau est reporté sur le calque
      const r = this.rect && U.rectIntersect(this.rect, { x: 0, y: 0, w: this.t.canvas.width, h: this.t.canvas.height });
      if (!this.direct && r) {
        const x = this.t.canvas.getContext('2d');
        x.save(); x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip();
        this._applyTo(x, r);
        x.restore();
      }
      return this.rect;
    }
  }

  KS.Brush = { tip, weight, Stroke };
})();
