// Historique (annuler / rétablir). Chaque entrée sait se défaire et se refaire.
// Types : pixels d'un calque (rectangle modifié seulement), structure (liste et
// propriétés des calques, sans pixels), complet (tout copié), sélection.
'use strict';
(() => {
  const U = KS.util;

  class History {
    constructor(doc, firstName = 'Nouveau') {
      this.doc = doc;
      this.items = [{ name: firstName, icon: 'file' }];
      this.pos = 0;
    }
    push(entry) {
      this.items.splice(this.pos + 1);
      this.items.push(entry);
      this.pos = this.items.length - 1;
      const max = Math.max(5, KS.prefs.historySize | 0);
      while (this.items.length - 1 > max) { this.items.splice(1, 1); this.pos--; }
      this.doc.dirty = true;
      this.doc.revision++;
      this.doc.changed();
      KS.emit('history', this.doc);
    }
    get canUndo() { return this.pos > 0; }
    get canRedo() { return this.pos < this.items.length - 1; }
    undo() { if (!this.canUndo) return; KS.cancelActiveOps && KS.cancelActiveOps(); this.items[this.pos].undo(); this.pos--; this._after(); }
    redo() { if (!this.canRedo) return; KS.cancelActiveOps && KS.cancelActiveOps(); this.pos++; this.items[this.pos].redo(); this._after(); }
    goto(i) {
      KS.cancelActiveOps && KS.cancelActiveOps();
      while (this.pos > i) { this.items[this.pos].undo(); this.pos--; }
      while (this.pos < i) { this.pos++; this.items[this.pos].redo(); }
      this._after();
    }
    _after() {
      const d = this.doc;
      d.dirty = true;
      d.revision++;
      if (!d.layers.some(l => l.id === d.activeId) && d.layers.length) d.activeId = d.layers[d.layers.length - 1].id;
      d.layers.forEach(l => l.touch());
      d.selection.refresh();
      d.changed();
      KS.emit('history', d);
      KS.emit('layers', d);
      KS.emit('selection', d);
      KS.emit('docsize', d);
    }
  }

  /* ------------------------------------------------ captures */
  function grab(layer, which) {
    const src = which === 'mask' ? layer.mask : layer;
    return { canvas: U.copyCanvas(src.canvas), x: src.x, y: src.y };
  }
  function put(layer, which, snap, rect) {
    const dst = which === 'mask' ? layer.mask : layer;
    if (!dst) return;
    if (rect && dst.canvas.width === snap.full.w && dst.canvas.height === snap.full.h) {
      const c = dst.canvas.getContext('2d');
      c.clearRect(rect.x, rect.y, rect.w, rect.h);
      c.drawImage(snap.canvas, rect.x, rect.y);
    } else {
      dst.canvas = U.copyCanvas(snap.canvas);
      dst.ctx = dst.canvas.getContext('2d');
    }
    dst.x = snap.x; dst.y = snap.y;
    if (which === 'mask') layer.maskChanged(); else layer.touch();
  }

  function structSnap(doc) {
    return {
      layers: doc.layers.slice(),
      props: new Map(doc.layers.map(l => [l, l.getProps()])),
      active: doc.activeId, w: doc.width, h: doc.height,
      guides: { h: doc.guides.h.slice(), v: doc.guides.v.slice() },
      paths: JSON.stringify(doc.paths), activePath: doc.activePathId,
      alphas: doc.alphas.map(a => ({ ref: a, name: a.name })),
    };
  }
  function structRestore(doc, s) {
    doc.layers = s.layers.slice();
    for (const [l, p] of s.props) l.setProps(p);
    doc.activeId = s.active;
    if (doc.width !== s.w || doc.height !== s.h) { doc.width = s.w; doc.height = s.h; doc.selection.resize(); }
    doc.guides = { h: s.guides.h.slice(), v: s.guides.v.slice() };
    if (s.paths !== undefined) { doc.paths = JSON.parse(s.paths); doc.activePathId = s.activePath; }
    if (s.alphas) { doc.alphas = s.alphas.map(a => { a.ref.name = a.name; return a.ref; }); if (doc.alphaEdit && !doc.alphas.some(a => a.id === doc.alphaEdit)) doc.alphaEdit = null; }
    doc.selectedIds = new Set(doc.activeId ? [doc.activeId] : []);
    KS.emit('paths', doc); KS.emit('channels', doc);
  }
  function fullSnap(doc) {
    return {
      struct: structSnap(doc),
      pix: doc.layers.map(l => ({ l, c: U.copyCanvas(l.canvas), m: l.mask ? U.copyCanvas(l.mask.canvas) : null })),
      sel: doc.selection.snapshot(),
    };
  }
  function fullRestore(doc, s) {
    structRestore(doc, s.struct);
    for (const p of s.pix) {
      p.l.canvas = U.copyCanvas(p.c); p.l.ctx = p.l.canvas.getContext('2d');
      if (p.m && p.l.mask) { p.l.mask.canvas = U.copyCanvas(p.m); p.l.mask.ctx = p.l.mask.canvas.getContext('2d'); p.l.maskChanged(); }
      p.l.touch();
    }
    doc.selection.restore(s.sel);
  }

  KS.Hist = {
    History,
    // Avant une retouche de pixels : renvoie un jeton à passer à commitPixels.
    begin(layer, which = 'canvas') { return { layer, which, before: grab(layer, which) }; },
    // Après : enregistre seulement le rectangle modifié si la géométrie n'a pas bougé.
    commitPixels(doc, name, token, rect, icon = 'brush', extra) {
      const { layer, which, before } = token;
      // couches limitées (panneau Couches) : les couches non actives reprennent leurs valeurs d'avant
      const cv = doc.channelView;
      if (cv && !(cv.r && cv.g && cv.b) && which === 'canvas' && before.canvas.width === layer.canvas.width && before.canvas.height === layer.canvas.height && before.x === layer.x && before.y === layer.y) {
        const r = rect ? U.rectIntersect(U.rectInt(rect), { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height }) : { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height };
        if (r) {
          const a = U.getData(layer.canvas, r), b = U.getData(before.canvas, r), pa = a.data, pb = b.data;
          for (let i = 0; i < pa.length; i += 4) { if (!cv.r) pa[i] = pb[i]; if (!cv.g) pa[i + 1] = pb[i + 1]; if (!cv.b) pa[i + 2] = pb[i + 2]; pa[i + 3] = pb[i + 3] || pa[i + 3]; }
          layer.canvas.getContext('2d').putImageData(a, r.x, r.y); layer.touch();
        }
      }
      const after = grab(layer, which);
      let entry;
      const same = before.canvas.width === after.canvas.width && before.canvas.height === after.canvas.height && before.x === after.x && before.y === after.y;
      if (same && rect) {
        let r = U.rectIntersect(U.rectInt(rect), { x: 0, y: 0, w: after.canvas.width, h: after.canvas.height });
        if (!r) { return; }
        const full = { w: after.canvas.width, h: after.canvas.height };
        const b = { canvas: U.copyCanvas(before.canvas, r), x: before.x, y: before.y, full };
        const a = { canvas: U.copyCanvas(after.canvas, r), x: after.x, y: after.y, full };
        entry = { name, icon, undo: () => put(layer, which, b, r), redo: () => put(layer, which, a, r) };
      } else {
        const full0 = { w: -1, h: -1 };
        const b = { ...before, full: full0 }, a = { ...after, full: full0 };
        entry = { name, icon, undo: () => put(layer, which, b), redo: () => put(layer, which, a) };
      }
      if (extra) entry = KS.Hist.combine(name, icon, [entry, extra]);
      doc.history.push(entry);
    },
    structure(doc, name, fn, icon = 'layers') {
      const b = structSnap(doc);
      const r = fn();
      const a = structSnap(doc);
      doc.history.push({ name, icon, undo: () => structRestore(doc, b), redo: () => structRestore(doc, a) });
      KS.emit('layers', doc);
      return r;
    },
    full(doc, name, fn, icon = 'image') {
      const b = fullSnap(doc);
      const r = fn();
      const a = fullSnap(doc);
      doc.history.push({ name, icon, undo: () => fullRestore(doc, b), redo: () => fullRestore(doc, a) });
      KS.emit('layers', doc); KS.emit('selection', doc); KS.emit('docsize', doc);
      return r;
    },
    // Entrée de sélection seule, ou partie d'une entrée composée (push=false)
    selection(doc, name, fn, icon = 'select-all', push = true) {
      const b = doc.selection.snapshot();
      fn();
      const a = doc.selection.snapshot();
      const e = { name, icon, undo: () => doc.selection.restore(b), redo: () => doc.selection.restore(a) };
      if (push) { doc.history.push(e); KS.emit('selection', doc); }
      return e;
    },
    selectionPart(doc, before) {
      const a = doc.selection.snapshot();
      return { undo: () => doc.selection.restore(before), redo: () => doc.selection.restore(a) };
    },
    structPart(doc, before) {
      const a = structSnap(doc);
      return { undo: () => structRestore(doc, before), redo: () => structRestore(doc, a) };
    },
    structSnap,
    combine(name, icon, parts) {
      return { name, icon, undo: () => { for (let i = parts.length - 1; i >= 0; i--) parts[i].undo(); }, redo: () => parts.forEach(p => p.redo()) };
    },
  };
})();
