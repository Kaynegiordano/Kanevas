// Panneau Couches : couches RVB (affichage et modification limités), couches
// alpha (sélections mémorisées, modifiables au pinceau).
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd;
  const D = () => KS.state.doc;

  /* ---------------------------------------------------------------- commandes */
  C.updateAlphaOverlay = (d, r) => {
    const a = d.alphas.find(x => x.id === d.alphaEdit) || null;
    for (const ch of a ? [a] : d.alphas) {
      if (!ch.overlay || ch.overlay.width !== d.width || ch.overlay.height !== d.height) { ch.overlay = U.canvas(d.width, d.height); r = null; }
      const R = r ? U.rectIntersect(U.rectInt(r), d.rect) : d.rect;
      if (!R) continue;
      const src = U.getData(ch.canvas, R), s = src.data, out = new ImageData(R.w, R.h), o = out.data;
      for (let i = 0; i < s.length; i += 4) { o[i] = 255; o[i + 1] = 30; o[i + 2] = 40; o[i + 3] = (255 - s[i]) * 0.5; }
      ch.overlay.getContext('2d').putImageData(out, R.x, R.y);
    }
    d.changed();
  };
  // Niveaux de gris → masque alpha de sélection
  const grayToMask = (d, gray) => {
    const g = U.getData(gray), p = g.data;
    for (let i = 0; i < p.length; i += 4) { p[i + 3] = p[i]; p[i] = p[i + 1] = p[i + 2] = 0; }
    const m = U.canvas(d.width, d.height); U.putData(m, g); return m;
  };
  const selToGray = d => {
    const c = U.canvas(d.width, d.height), x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, d.width, d.height);
    if (d.selection.mask) {
      const t = U.canvas(d.width, d.height), tx = t.getContext('2d'); tx.fillStyle = '#fff'; tx.fillRect(0, 0, d.width, d.height);
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(d.selection.mask, 0, 0); x.drawImage(t, 0, 0);
    }
    return c;
  };
  const channelGray = (d, key) => {
    const comp = d.composite(), g = U.getData(comp), p = g.data;
    for (let i = 0; i < p.length; i += 4) {
      const v = key === 'r' ? p[i] : key === 'g' ? p[i + 1] : key === 'b' ? p[i + 2] : U.luma(p[i], p[i + 1], p[i + 2]);
      p[i] = p[i + 1] = p[i + 2] = v * p[i + 3] / 255; p[i + 3] = 255;
    }
    const c = U.canvas(d.width, d.height); U.putData(c, g); return c;
  };
  C.saveSelection = async () => {
    const d = D(); if (!d) return;
    if (!d.selection.active) { KS.toast('Faites d\'abord une sélection', 'err'); return; }
    const name = await KS.prompt('Mémoriser la sélection', 'Nom de la couche', 'Alpha ' + (d.alphas.length + 1));
    if (name == null) return;
    const ch = { id: U.uid(), name: name || 'Alpha ' + (d.alphas.length + 1), canvas: selToGray(d) };
    KS.Hist.structure(d, 'Mémoriser la sélection', () => d.alphas.push(ch), 'channels');
    C.updateAlphaOverlay(d);
  };
  C.loadChannel = (key, mode = 'new') => {
    const d = D(); if (!d) return;
    const ch = d.alphas.find(a => a.id === key);
    const gray = ch ? ch.canvas : channelGray(d, key);
    KS.Hist.selection(d, 'Récupérer la sélection', () => d.selection.combineCanvas(grayToMask(d, gray), mode), 'select-all');
  };
  C.loadSelectionDialog = () => {
    const d = D(); if (!d) return;
    const opts = [['rgb', 'Luminosité (RVB)'], ['r', 'Rouge'], ['g', 'Vert'], ['b', 'Bleu'], ...d.alphas.map(a => [a.id, a.name])];
    let src = d.alphas.length ? d.alphas[d.alphas.length - 1].id : 'rgb', mode = 'new', inv = false;
    const body = h('div.form-grid',
      h('label.l', { text: 'Couche' }), ui.select(opts.map(o => [String(o[0]), o[1]]), String(src), v => { src = isNaN(+v) ? v : +v; }),
      h('label.l', { text: 'Opération' }), ui.seg([['new', 'Nouvelle'], ['add', 'Ajouter'], ['sub', 'Soustraire'], ['int', 'Intersection']], mode, v => { mode = v; }),
      h('span'), ui.check('Inverser', false, v => { inv = v; }));
    KS.modal({ title: 'Récupérer la sélection', body, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }], onClose: v => {
      if (v !== 'ok') return;
      C.loadChannel(src, mode);
      if (inv) C.invertSelection();
    } });
  };
  C.newAlpha = () => {
    const d = D(); if (!d) return;
    const c = U.canvas(d.width, d.height), x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, d.width, d.height);
    const ch = { id: U.uid(), name: 'Alpha ' + (d.alphas.length + 1), canvas: c };
    KS.Hist.structure(d, 'Nouvelle couche', () => { d.alphas.push(ch); d.alphaEdit = ch.id; }, 'channels');
    C.updateAlphaOverlay(d);
  };
  C.deleteAlpha = () => {
    const d = D(); if (!d || !d.alphaEdit) return;
    const id = d.alphaEdit;
    KS.Hist.structure(d, 'Supprimer la couche', () => { d.alphas = d.alphas.filter(a => a.id !== id); d.alphaEdit = null; }, 'trash');
    d.changed();
  };
  // Couche active : 'rgb', 'r', 'g', 'b' ou l'id d'une couche alpha
  C.selectChannel = key => {
    const d = D(); if (!d) return;
    if (key === 'rgb') { d.channelView = null; d.alphaEdit = null; }
    else if (['r', 'g', 'b'].includes(key)) { d.channelView = { r: key === 'r', g: key === 'g', b: key === 'b' }; d.alphaEdit = null; }
    else { d.alphaEdit = d.alphaEdit === key ? null : key; C.updateAlphaOverlay(d); }
    KS.emit('channels', d); d.changed();
  };
  C.toggleChannelEye = key => {
    const d = D(); if (!d) return;
    const v = d.channelView || { r: true, g: true, b: true };
    v[key] = !v[key];
    if (!v.r && !v.g && !v.b) v[key] = true;
    d.channelView = v.r && v.g && v.b ? null : v;
    KS.emit('channels', d); d.changed();
  };

  /* ---------------------------------------------------------------- panneau */
  KS.panels.register('channels', {
    title: 'Couches', flush: true,
    build(el) {
      this.el = el;
      const r = U.debounce(() => this.render(), 30);
      KS.on('channels', r); KS.on('doc', r); KS.on('history', r);
      KS.on('rendered', U.throttle(() => this.thumbs(), 800));
      this.render();
    },
    render() {
      const el = this.el, d = D();
      el.innerHTML = '';
      this.rows = [];
      if (!d) { el.appendChild(h('div.empty-note', { text: 'Aucun document' })); return; }
      const list = h('div', { style: { padding: '4px' } });
      const cv = d.channelView;
      const rows = [['rgb', 'RVB', 'Ctrl+2'], ['r', 'Rouge', 'Ctrl+3'], ['g', 'Vert', 'Ctrl+4'], ['b', 'Bleu', 'Ctrl+5'], ...d.alphas.map((a, i) => [a.id, a.name, i < 4 ? 'Ctrl+' + (6 + i) : ''])];
      for (const [key, name, kb] of rows) {
        const isAlpha = typeof key === 'number';
        const active = isAlpha ? d.alphaEdit === key : key === 'rgb' ? !cv : cv && cv[key] && Object.values(cv).filter(Boolean).length === 1;
        const visible = isAlpha ? d.alphaEdit === key : key === 'rgb' ? !cv : !cv || cv[key];
        const eye = h('button.eye', { html: KS.icon(visible ? 'eye' : 'eye-off') });
        eye.addEventListener('click', e => { e.stopPropagation(); if (isAlpha) C.selectChannel(key); else if (key === 'rgb') C.selectChannel('rgb'); else C.toggleChannelEye(key); });
        const thumb = h('canvas', { width: 38, height: 34 });
        const row = h('div.layer-row' + (active ? '.active' : ''), eye, h('div.thumb', thumb), h('div.lname', { text: name }), h('span.opt-label', { text: kb }));
        row.addEventListener('click', e => { if (e.ctrlKey) { C.loadChannel(key === 'rgb' ? 'rgb' : key, e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new'); return; } C.selectChannel(key); });
        if (isAlpha) row.addEventListener('dblclick', async () => { const a = d.alphas.find(x => x.id === key); const n = await KS.prompt('Renommer la couche', 'Nom', a.name); if (n) KS.Hist.structure(d, 'Renommer la couche', () => { a.name = n; }, 'channels'); });
        row._key = key; row._thumb = thumb;
        list.appendChild(row); this.rows.push(row);
      }
      el.append(list, h('div.layers-bottom',
        ui.iconBtn('select-all', 'Récupérer la couche comme sélection (Ctrl+clic sur la couche)', () => { const k = d.alphaEdit || (cv ? Object.keys(cv).find(k2 => cv[k2]) : 'rgb'); C.loadChannel(k); }, '.sm'),
        ui.iconBtn('save', 'Mémoriser la sélection dans une couche', () => C.saveSelection(), '.sm'),
        ui.iconBtn('new-layer', 'Nouvelle couche alpha', () => C.newAlpha(), '.sm'),
        ui.iconBtn('trash', 'Supprimer la couche alpha', () => C.deleteAlpha(), '.sm')));
      this.thumbs(true);
    },
    thumbs(force) {
      const d = D(); if (!d || !this.rows || (!force && !KS.panels.isVisible('channels'))) return;
      const comp = d.composite(), s = Math.min(38 / d.width, 34 / d.height), w = Math.max(1, Math.round(d.width * s)), hh = Math.max(1, Math.round(d.height * s));
      const small = U.canvas(w, hh); small.getContext('2d').drawImage(comp, 0, 0, w, hh);
      const data = U.getData(small).data;
      for (const row of this.rows) {
        const x = row._thumb.getContext('2d'); x.clearRect(0, 0, 38, 34);
        const ox = (38 - w) / 2, oy = (34 - hh) / 2;
        if (row._key === 'rgb') { x.drawImage(small, ox, oy); continue; }
        if (typeof row._key === 'number') { const a = d.alphas.find(q => q.id === row._key); if (a) x.drawImage(a.canvas, ox, oy, w, hh); continue; }
        const img = new ImageData(w, hh), p = img.data, k = { r: 0, g: 1, b: 2 }[row._key];
        for (let i = 0; i < p.length; i += 4) { const v = data[i + k]; p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255; }
        const t = U.canvas(w, hh); U.putData(t, img); x.drawImage(t, ox, oy);
      }
    },
  });
})();
