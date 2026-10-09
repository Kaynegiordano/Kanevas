// Calques : pixels (canevas + décalage x/y, sans perte au déplacement), masque de
// fusion, texte modifiable, calque de réglage, styles (ombre, lueur, contour...).
'use strict';
(() => {
  const U = KS.util;
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));

  class Layer {
    constructor(o = {}) {
      this.id = U.uid();
      this.name = o.name || 'Calque';
      this.kind = o.kind || 'raster';           // raster | text | adjust | group | shape
      this.parent = o.parent;                    // id du groupe parent (undefined = à déduire à l'insertion)
      this.collapsed = !!o.collapsed;            // groupes : replié dans le panneau
      this.shape = o.shape || null;              // calque de forme vectorielle
      this.canvas = o.canvas || U.canvas(o.w || 1, o.h || 1);
      this.ctx = this.canvas.getContext('2d');
      this.x = o.x || 0; this.y = o.y || 0;
      this.opacity = o.opacity ?? 1;
      this.blend = o.blend || 'normal';
      this.visible = o.visible ?? true;
      this.lockAll = !!o.lockAll;
      this.lockAlpha = !!o.lockAlpha;
      this.clip = !!o.clip;
      this.mask = null;                          // { canvas, ctx, x, y, enabled, linked, alpha }
      this.text = o.text || null;
      this.adjust = o.adjust || null;            // { type, params }
      this.effects = o.effects || null;
      this.editMask = false;
      this.override = null;                      // aperçu temporaire { canvas, x, y }
      this.version = 0;
      this._img = null;
      if (this.kind === 'text' && this.text) this.renderText();
      if (this.kind === 'shape' && this.shape) this.renderShape();
      if (this.kind === 'group' && !o.blend) this.blend = 'pass';
    }

    get w() { return this.canvas.width; }
    get h() { return this.canvas.height; }
    bounds() { return { x: this.x, y: this.y, w: this.canvas.width, h: this.canvas.height }; }
    touch() { this.version++; this._img = null; this._cb = null; }

    // Boîte des pixels visibles, en coordonnées document (mise en cache)
    contentBounds() {
      if (this._cb && this._cb.v === this.version) return this._cb.r;
      const b = this.kind === 'adjust' || this.kind === 'group' ? null : U.alphaBounds(this.canvas, 8);
      const r = b ? { x: b.x + this.x, y: b.y + this.y, w: b.w, h: b.h } : null;
      this._cb = { v: this.version, r };
      return r;
    }

    getProps() {
      return {
        name: this.name, kind: this.kind, x: this.x, y: this.y, opacity: this.opacity, blend: this.blend,
        visible: this.visible, lockAll: this.lockAll, lockAlpha: this.lockAlpha, clip: this.clip,
        mask: this.mask, maskState: this.mask ? { x: this.mask.x, y: this.mask.y, enabled: this.mask.enabled, linked: this.mask.linked } : null,
        text: clone(this.text), adjust: clone(this.adjust), effects: clone(this.effects), editMask: this.editMask,
        parent: this.parent ?? null, collapsed: this.collapsed, shape: clone(this.shape),
      };
    }
    setProps(p) {
      const textChanged = JSON.stringify(p.text) !== JSON.stringify(this.text);
      const shapeChanged = JSON.stringify(p.shape) !== JSON.stringify(this.shape);
      Object.assign(this, {
        name: p.name, kind: p.kind, x: p.x, y: p.y, opacity: p.opacity, blend: p.blend, visible: p.visible,
        lockAll: p.lockAll, lockAlpha: p.lockAlpha, clip: p.clip, mask: p.mask,
        text: clone(p.text), adjust: clone(p.adjust), effects: clone(p.effects), editMask: p.editMask && !!p.mask,
        parent: p.parent ?? null, collapsed: !!p.collapsed, shape: clone(p.shape),
      });
      if (this.mask && p.maskState) Object.assign(this.mask, p.maskState);
      if (this.kind === 'text' && this.text && textChanged) this.renderText();
      if (this.kind === 'shape' && this.shape && shapeChanged) this.renderShape();
      this.touch();
    }

    // Agrandit le canevas pour couvrir r (coordonnées document), sans rien perdre.
    ensureCovers(r) {
      const b = this.bounds();
      if (r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h) return false;
      const u = U.rectUnion(b, r);
      const c = U.canvas(u.w, u.h);
      c.getContext('2d').drawImage(this.canvas, b.x - u.x, b.y - u.y);
      this.canvas = c; this.ctx = c.getContext('2d');
      this.x = u.x; this.y = u.y;
      this.touch();
      return true;
    }
    // Recadre le canevas sur son contenu (ou sur r)
    trimTo(r) {
      const b = this.bounds();
      const c = U.canvas(r.w, r.h);
      c.getContext('2d').drawImage(this.canvas, b.x - r.x, b.y - r.y);
      this.canvas = c; this.ctx = c.getContext('2d'); this.x = r.x; this.y = r.y; this.touch();
    }

    /* ------------------------------------------------ masque de fusion */
    addMask(doc, mode = 'reveal') {
      const r = U.rectUnion({ x: 0, y: 0, w: doc.width, h: doc.height }, this.kind === 'adjust' ? null : this.bounds());
      const c = U.canvas(r.w, r.h), x = c.getContext('2d');
      x.fillStyle = mode === 'hide' ? '#000' : '#fff';
      x.fillRect(0, 0, r.w, r.h);
      if ((mode === 'selection' || mode === 'hide-selection') && doc.selection.mask) {
        x.fillStyle = mode === 'selection' ? '#000' : '#fff';
        x.fillRect(0, 0, r.w, r.h);
        const t = U.canvas(r.w, r.h), tx = t.getContext('2d');
        tx.fillStyle = mode === 'selection' ? '#fff' : '#000';
        tx.fillRect(0, 0, r.w, r.h);
        tx.globalCompositeOperation = 'destination-in';
        tx.drawImage(doc.selection.mask, -r.x, -r.y);
        x.drawImage(t, 0, 0);
      }
      this.mask = { canvas: c, ctx: x, x: r.x, y: r.y, enabled: true, linked: true, alpha: null, outside: mode === 'hide' || mode === 'selection' ? 0 : 255 };
      this.maskChanged();
    }
    maskChanged(rect) {
      const m = this.mask;
      if (!m) return;
      const w = m.canvas.width, h = m.canvas.height;
      if (!m.alpha || m.alpha.width !== w || m.alpha.height !== h) { m.alpha = U.canvas(w, h); rect = null; }
      const r = rect ? U.rectIntersect(U.rectInt(rect), { x: 0, y: 0, w, h }) : { x: 0, y: 0, w, h };
      if (r) {
        const d = U.getData(m.canvas, r), px = d.data;
        for (let i = 0; i < px.length; i += 4) { px[i + 3] = px[i]; px[i] = px[i + 1] = px[i + 2] = 0; }
        m.alpha.getContext('2d').putImageData(d, r.x, r.y);
      }
      this.touch();
    }
    ensureMaskCovers(r) {
      const m = this.mask;
      const b = { x: m.x, y: m.y, w: m.canvas.width, h: m.canvas.height };
      if (r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h) return;
      const u = U.rectUnion(b, r), c = U.canvas(u.w, u.h), x = c.getContext('2d');
      const o = m.outside ?? 255;
      x.fillStyle = `rgb(${o},${o},${o})`; x.fillRect(0, 0, u.w, u.h);
      x.drawImage(m.canvas, b.x - u.x, b.y - u.y);
      m.canvas = c; m.ctx = x; m.x = u.x; m.y = u.y;
      this.maskChanged();
    }

    /* ------------------------------------------------ texte */
    static fontString(t, scale = 1) {
      return `${t.italic ? 'italic ' : ''}${t.bold ? 700 : (t.weight || 400)} ${t.size * scale}px "${t.family}", sans-serif`;
    }
    renderText() {
      const t = this.text;
      const pad = Math.ceil(t.size * 0.35 + (t.tracking || 0));
      const bx = this.x + (t._pad ?? 0), by = this.y + (t._pad ?? 0);
      const m = U.canvas(4, 4).getContext('2d');
      m.font = Layer.fontString(t);
      if ('letterSpacing' in m) m.letterSpacing = (t.tracking || 0) + 'px';
      const lines = String(t.text || '').split('\n');
      const lh = t.size * (t.leading || 1.2);
      const widths = lines.map(l => m.measureText(l).width);
      const tw = Math.max(1, ...widths);
      const th = Math.max(lh, lines.length * lh);
      const c = U.canvas(Math.ceil(tw + pad * 2), Math.ceil(th + pad * 2)), x = c.getContext('2d');
      x.font = Layer.fontString(t);
      if ('letterSpacing' in x) x.letterSpacing = (t.tracking || 0) + 'px';
      x.fillStyle = t.color || '#000';
      x.textBaseline = 'alphabetic';
      // ligne de base façon CSS (demi-interligne + jambage supérieur) : le curseur d'édition tombe juste
      const mt = x.measureText('Hg');
      const fa = mt.fontBoundingBoxAscent ?? t.size * 0.8, fd = mt.fontBoundingBoxDescent ?? t.size * 0.2;
      const asc = (lh - (fa + fd)) / 2 + fa;
      lines.forEach((l, i) => {
        const w = widths[i];
        const ox = t.align === 'center' ? (tw - w) / 2 : t.align === 'right' ? tw - w : 0;
        const ly = pad + i * lh + asc;
        x.fillText(l, pad + ox, ly);
        if (t.underline) { x.fillRect(pad + ox, ly + t.size * 0.12, w, Math.max(1, t.size / 14)); }
      });
      this.canvas = c; this.ctx = x;
      t._pad = pad; t._w = tw; t._h = th;
      this.x = Math.round(bx - pad); this.y = Math.round(by - pad);
      this.touch();
    }
    textBox() {
      const t = this.text;
      return { x: this.x + t._pad, y: this.y + t._pad, w: t._w, h: t._h };
    }
    rasterize() {
      this.kind = 'raster'; this.text = null; this.shape = null; this.touch();
    }

    /* ------------------------------------------------ forme vectorielle */
    // Les points du tracé sont en coordonnées document ; un déplacement du calque (x, y)
    // est reporté sur les points au rendu suivant.
    renderShape() {
      const s = this.shape;
      if (s._x !== undefined && (s._x !== this.x || s._y !== this.y)) KS.translateSubpaths(s.subpaths, this.x - s._x, this.y - s._y);
      const b = KS.subpathBounds(s.subpaths);
      const pad = Math.ceil((s.stroke ? s.strokeWidth : 0) / 2 + 2);
      const r = b ? { x: Math.floor(b.x) - pad, y: Math.floor(b.y) - pad, w: Math.ceil(b.w) + pad * 2 + 1, h: Math.ceil(b.h) + pad * 2 + 1 } : { x: 0, y: 0, w: 1, h: 1 };
      const c = U.canvas(r.w, r.h), x = c.getContext('2d');
      if (b) {
        const p = KS.subpathsToPath2D(s.subpaths, -r.x, -r.y);
        if (s.fill) { x.fillStyle = s.fillColor; x.fill(p, 'nonzero'); }
        if (s.stroke && s.strokeWidth > 0) { x.lineWidth = s.strokeWidth; x.strokeStyle = s.strokeColor; x.lineJoin = 'round'; x.lineCap = 'round'; x.stroke(p); }
      }
      this.canvas = c; this.ctx = x; this.x = r.x; this.y = r.y;
      s._x = r.x; s._y = r.y;
      this.touch();
    }

    /* ------------------------------------------------ rendu (masque + styles) */
    image() {
      if (this.override) return this._decorate(this.override, false);
      if (this._img && this._img.v === this.version) return this._img.r;
      const r = this._decorate({ canvas: this.canvas, x: this.x, y: this.y }, true);
      this._img = { v: this.version, r };
      return r;
    }
    _decorate(base, cacheable) {
      let img = base;
      const m = this.mask;
      if (m && m.enabled && m.alpha) {
        const c = U.canvas(img.canvas.width, img.canvas.height), x = c.getContext('2d');
        x.drawImage(img.canvas, 0, 0);
        const mk = U.canvas(c.width, c.height), mx = mk.getContext('2d');
        if ((m.outside ?? 255) > 0) { mx.globalAlpha = (m.outside ?? 255) / 255; mx.fillRect(0, 0, c.width, c.height); mx.globalAlpha = 1; }
        mx.clearRect(m.x - img.x, m.y - img.y, m.canvas.width, m.canvas.height);
        mx.drawImage(m.alpha, m.x - img.x, m.y - img.y);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(mk, 0, 0);
        img = { canvas: c, x: img.x, y: img.y };
      }
      const fx = this.effects;
      if (fx && (fx.shadow?.on || fx.glow?.on || fx.stroke?.on || fx.overlay?.on || fx.innerGlow?.on)) img = renderEffects(img, fx);
      return img;
    }

    drawThumb(cv, doc, which = 'canvas') {
      const tw = cv.width, th = cv.height, x = cv.getContext('2d');
      x.clearRect(0, 0, tw, th);
      const s = Math.min(tw / doc.width, th / doc.height);
      const ox = (tw - doc.width * s) / 2, oy = (th - doc.height * s) / 2;
      x.save();
      if (which === 'mask' && this.mask) {
        x.fillStyle = `rgb(${this.mask.outside},${this.mask.outside},${this.mask.outside})`;
        x.fillRect(ox, oy, doc.width * s, doc.height * s);
        x.beginPath(); x.rect(ox, oy, doc.width * s, doc.height * s); x.clip();
        x.drawImage(this.mask.canvas, ox + this.mask.x * s, oy + this.mask.y * s, this.mask.canvas.width * s, this.mask.canvas.height * s);
      } else {
        x.fillStyle = KS.thumbChecker || (KS.thumbChecker = U.checkerPattern(x, 3));
        x.fillRect(ox, oy, doc.width * s, doc.height * s);
        x.beginPath(); x.rect(ox, oy, doc.width * s, doc.height * s); x.clip();
        x.imageSmoothingQuality = 'medium';
        x.drawImage(this.canvas, ox + this.x * s, oy + this.y * s, this.canvas.width * s, this.canvas.height * s);
      }
      x.restore();
    }

    clone(name) {
      const L = new Layer({
        name: name || this.name + ' copie', kind: this.kind, canvas: U.copyCanvas(this.canvas), x: this.x, y: this.y,
        opacity: this.opacity, blend: this.blend, visible: this.visible, lockAlpha: this.lockAlpha, clip: this.clip,
        adjust: clone(this.adjust), effects: clone(this.effects), parent: this.parent ?? null, collapsed: this.collapsed,
      });
      if (this.text) { L.text = clone(this.text); }
      if (this.shape) { L.shape = clone(this.shape); }
      if (this.mask) {
        L.mask = { ...this.mask, canvas: U.copyCanvas(this.mask.canvas), alpha: null };
        L.mask.ctx = L.mask.canvas.getContext('2d');
        L.maskChanged();
      }
      return L;
    }
  }

  /* ------------------------------------------------ styles de calque */
  function silhouette(img, color, w, h, ox, oy) {
    const c = U.canvas(w, h), x = c.getContext('2d');
    x.drawImage(img.canvas, ox, oy);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, w, h);
    return c;
  }
  function renderEffects(img, fx) {
    const sh = fx.shadow?.on ? fx.shadow : null, gl = fx.glow?.on ? fx.glow : null, st = fx.stroke?.on ? fx.stroke : null;
    let pad = 2;
    if (sh) pad = Math.max(pad, sh.distance + sh.size * 1.5 + 2);
    if (gl) pad = Math.max(pad, gl.size * 1.6 + 2);
    if (st) pad = Math.max(pad, st.size + 2);
    pad = Math.ceil(pad);
    const W = img.canvas.width + pad * 2, H = img.canvas.height + pad * 2;
    const out = U.canvas(W, H), o = out.getContext('2d');
    if (sh) {
      const a = (sh.angle || 120) * Math.PI / 180;
      const dx = -Math.cos(a) * sh.distance, dy = Math.sin(a) * sh.distance;
      const s = silhouette(img, sh.color, W, H, pad, pad);
      o.globalAlpha = sh.opacity;
      o.filter = sh.size > 0 ? `blur(${sh.size / 2}px)` : 'none';
      o.drawImage(s, dx, dy);
      o.filter = 'none'; o.globalAlpha = 1;
    }
    if (gl) {
      const s = silhouette(img, gl.color, W, H, pad, pad);
      o.globalAlpha = gl.opacity;
      o.filter = `blur(${Math.max(0.5, gl.size / 2)}px)`;
      o.drawImage(s, 0, 0); o.drawImage(s, 0, 0);
      o.filter = 'none'; o.globalAlpha = 1;
    }
    if (st && st.position !== 'inside') {
      const s = silhouette(img, st.color, W, H, pad, pad);
      const t = U.canvas(W, H), tx = t.getContext('2d');
      const r = st.position === 'center' ? st.size / 2 : st.size;
      const n = Math.max(12, Math.min(64, Math.round(r * 6)));
      for (let ring = r; ring > 0; ring -= Math.max(1, r / 3)) {
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; tx.drawImage(s, Math.cos(a) * ring, Math.sin(a) * ring); }
      }
      tx.drawImage(s, 0, 0);
      o.globalAlpha = st.opacity ?? 1;
      o.drawImage(t, 0, 0);
      o.globalAlpha = 1;
    }
    o.drawImage(img.canvas, pad, pad);
    if (fx.overlay?.on) {
      const s = silhouette(img, fx.overlay.color, W, H, pad, pad);
      o.globalAlpha = fx.overlay.opacity;
      o.globalCompositeOperation = KS.blendOp(fx.overlay.blend || 'normal');
      o.drawImage(s, 0, 0);
      o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
    }
    if (fx.innerGlow?.on) {
      const ig = fx.innerGlow;
      // halo intérieur : silhouette inversée floutée, gardée dans la forme
      const inv = U.canvas(W, H), ix = inv.getContext('2d');
      ix.fillStyle = ig.color; ix.fillRect(0, 0, W, H);
      ix.globalCompositeOperation = 'destination-out'; ix.drawImage(img.canvas, pad, pad);
      const t = U.canvas(W, H), tx = t.getContext('2d');
      tx.filter = `blur(${Math.max(0.5, ig.size / 2)}px)`; tx.drawImage(inv, 0, 0); tx.drawImage(inv, 0, 0); tx.filter = 'none';
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(img.canvas, pad, pad);
      o.globalAlpha = ig.opacity; o.drawImage(t, 0, 0); o.globalAlpha = 1;
    }
    if (st && st.position === 'inside') {
      const inv = U.canvas(W, H), ix = inv.getContext('2d');
      ix.fillStyle = '#000'; ix.fillRect(0, 0, W, H);
      ix.globalCompositeOperation = 'destination-out'; ix.drawImage(img.canvas, pad, pad);
      const t = U.canvas(W, H), tx = t.getContext('2d');
      const n = Math.max(12, Math.min(64, Math.round(st.size * 6)));
      for (let ring = st.size; ring > 0; ring -= Math.max(1, st.size / 3))
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; tx.drawImage(inv, Math.cos(a) * ring, Math.sin(a) * ring); }
      tx.globalCompositeOperation = 'source-in'; tx.fillStyle = st.color; tx.fillRect(0, 0, W, H);
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(img.canvas, pad, pad);
      o.globalAlpha = st.opacity ?? 1; o.drawImage(t, 0, 0); o.globalAlpha = 1;
    }
    return { canvas: out, x: img.x - pad, y: img.y - pad };
  }

  KS.Layer = Layer;
  KS.defaultEffects = () => ({
    shadow: { on: false, color: '#000000', opacity: 0.6, angle: 120, distance: 10, size: 14 },
    glow: { on: false, color: '#ffe680', opacity: 0.75, size: 18 },
    innerGlow: { on: false, color: '#ffffff', opacity: 0.6, size: 12 },
    stroke: { on: false, color: '#000000', size: 3, opacity: 1, position: 'outside' },
    overlay: { on: false, color: '#3d7cf0', opacity: 1, blend: 'normal' },
  });
})();
