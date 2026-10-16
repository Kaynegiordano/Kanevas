// Studio IA : un espace de travail dédié (Édition ⇄ Studio IA). Colonne de réglages Forge à gauche, barre de
// modes au-dessus de l'image, galerie des résultats. Peindre ce qu'on veut changer : calque « Zone IA » (rouge,
// la zone à refaire) et calque « Croquis IA » (des couleurs que Forge transforme en image).
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd, G = KS.gen, T = KS.tools, N = KS.native;
  const D = () => KS.state.doc;
  const SD = KS.studio = { on: false, mode: KS.prefs.studioMode || 'create', gallery: [] };
  const MODES = [
    ['create', 'Créer', 'file-plus', 'Décrivez une image : elle est créée de zéro (nouveau document ou calque).'],
    ['transform', 'Transformer', 'adjust', 'Toute l\'image (ou la sélection) est refaite selon l\'invite ; la force règle l\'écart à l\'original.'],
    ['inpaint', 'Retoucher la zone peinte', 'brush', 'Peignez en rouge (calque Zone IA) ce qui doit changer, décrivez le résultat, puis Générer. Le reste ne bouge pas.'],
    ['sketch', 'Croquis', 'pencil', 'Peignez grossièrement des formes et des couleurs (calque Croquis IA) : Forge en fait une vraie image à cet endroit.'],
    ['upscale', 'Agrandir', 'upscale', 'Agrandit l\'image et y ajoute de vrais détails (ESRGAN puis MultiDiffusion par tuiles).'],
  ];
  const settings = () => G.studio();
  const pngBytes = async c => new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer());

  /* ---------------------------------------------------------------- calques Zone IA / Croquis IA */
  const roleLayer = (d, role) => d && d.layers.find(l => l.aiRole === role || (!l.aiRole && l.name === (role === 'zone' ? 'Zone IA' : 'Croquis IA')));
  const ensureRoleLayer = (d, role) => {
    let L = roleLayer(d, role);
    if (L) { L.aiRole = role; if (!L.visible) { L.visible = true; L.touch(); d.changed(); KS.emit('layers', d); } return L; }
    L = new KS.Layer({ name: role === 'zone' ? 'Zone IA' : 'Croquis IA', w: d.width, h: d.height, opacity: role === 'zone' ? 0.55 : 1 });
    L.aiRole = role;
    KS.Hist.structure(d, role === 'zone' ? 'Calque Zone IA' : 'Calque Croquis IA', () => d.addLayer(L, d.layers.length), role === 'zone' ? 'brush' : 'pencil');
    return L;
  };
  let savedFG = null;
  const paintOn = (role, erase = false) => {
    const d = D(); if (!d) return KS.toast('Ouvrez d\'abord une image', 'info');
    const L = ensureRoleLayer(d, role);
    d.activeId = L.id; L.editMask = false; KS.emit('active-layer', d); KS.emit('layers', d);
    if (role === 'zone' && !erase) { if (!savedFG) savedFG = { ...KS.state.fg }; KS.setFG({ r: 255, g: 32, b: 64 }); }
    T.select(erase ? 'eraser' : 'brush');
  };
  const restoreFG = () => { if (savedFG) { KS.setFG(savedFG); savedFG = null; } };
  const layerAlpha = (d, L) => { const c = U.canvas(d.width, d.height); c.getContext('2d').drawImage(L.canvas, L.x, L.y); return c; };
  // Image envoyée à Forge : tout sauf la zone (et le croquis selon le mode)
  const sourceFor = (d, keepSketch) => d.flatten(d.layers.filter(l => l.aiRole !== 'zone' && (keepSketch || l.aiRole !== 'sketch') && l.visible !== false));
  const clearRole = role => {
    const d = D(), L = roleLayer(d, role); if (!L) return;
    const tok = KS.Hist.begin(L); L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height); L.touch();
    KS.Hist.commitPixels(d, role === 'zone' ? 'Effacer la zone IA' : 'Effacer le croquis', tok, null, 'trash'); d.changed();
  };
  const invertZone = () => {
    const d = D(), L = roleLayer(d, 'zone'); if (!L) return;
    L.ensureCovers(d.rect);
    const tok = KS.Hist.begin(L), c = U.canvas(L.canvas.width, L.canvas.height), x = c.getContext('2d');
    x.fillStyle = 'rgb(255,32,64)'; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'destination-out'; x.drawImage(L.canvas, 0, 0);
    L.ctx.clearRect(0, 0, c.width, c.height); L.ctx.drawImage(c, 0, 0); L.touch();
    KS.Hist.commitPixels(d, 'Inverser la zone IA', tok, null, 'select-invert'); d.changed();
  };
  const selectionToZone = () => {
    const d = D(); if (!d || !d.selection.active) return KS.toast('Faites d\'abord une sélection', 'info');
    const L = ensureRoleLayer(d, 'zone'); L.ensureCovers(d.rect);
    const tok = KS.Hist.begin(L), t = U.canvas(d.width, d.height), x = t.getContext('2d');
    x.drawImage(d.selection.mask, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = 'rgb(255,32,64)'; x.fillRect(0, 0, d.width, d.height);
    L.ctx.drawImage(t, -L.x, -L.y); L.touch();
    KS.Hist.commitPixels(d, 'Sélection → zone IA', tok, null, 'brush'); d.changed();
  };

  /* ---------------------------------------------------------------- retouche de la zone / croquis */
  // Masque = alpha du calque (Zone IA ou Croquis IA), ou la sélection à défaut ; image = le reste du document
  async function paintedGenerate(kind) {
    const d = D(); if (!d) return KS.toast('Ouvrez d\'abord une image', 'info');
    const st = settings(), role = kind === 'sketch' ? 'sketch' : 'zone';
    const L = roleLayer(d, role);
    let alpha = L ? layerAlpha(d, L) : null, B = alpha && U.alphaBounds(alpha, 8);
    if (!B && d.selection.active) { alpha = U.copyCanvas(d.selection.mask); B = U.rectInt(d.selection.bounds); }
    if (!B) { KS.toast(kind === 'sketch' ? 'Peignez d\'abord votre croquis (bouton « Peindre le croquis »)' : 'Peignez d\'abord en rouge la zone à refaire (bouton « Peindre la zone »)', 'info', 4500); return; }
    B = U.rectIntersect(B, d.rect);
    const raw = (KS.state.lastPrompt || '').trim();
    if (!raw && kind === 'sketch') return KS.toast('Décrivez ce que représente votre croquis', 'info');
    const forge = await G.forge(true); if (!forge) return;
    if (kind === 'sketch') {   // un croquis compte jusque dans ses bords flous
      const g = U.blurCanvas(alpha, 6), gx = g.getContext('2d'); gx.globalCompositeOperation = 'source-over'; gx.drawImage(alpha, 0, 0); alpha = g;
    }
    const src = sourceFor(d, kind === 'sketch');
    try {
      if (!raw) {   // retouche sans invite : l'IA locale remplit avec les alentours
        const r0 = await G.task('Suppression par l\'IA locale…', () => G.inpaint(src, alpha, B));
        return finish(G.addGenLayer(d, { variants: [r0.raw], rect: r0.rect }, alpha, { name: 'Zone retouchée', hist: 'Retoucher la zone', icon: 'remove' }), L);
      }
      const pp = await G.preparePrompt(raw, forge, st);
      const o = { ...st, ...pp, strength: kind === 'sketch' ? st.sketchStrength : st.strength, fill: kind === 'sketch' ? 1 : st.inpaintFill, maskBlur: st.maskBlur, pad: st.inpaintPad, whole: st.inpaintArea === 'whole' };
      const res = await G.forgeGenerate(src, alpha, B, o, o.whole);
      if (pp.shown !== raw) KS.toast('Envoyé à Forge : « ' + pp.shown + ' »', 'info', 4000);
      finish(G.addGenLayer(d, res, alpha, { name: (kind === 'sketch' ? 'Croquis → ' : 'Retouche : ') + raw.slice(0, 32), prompt: raw, hist: kind === 'sketch' ? 'Croquis IA' : 'Retoucher la zone' }), L);
    } catch (e) { KS.toast('Génération impossible : ' + e.message, 'err', 6000); }
  }
  // Le calque de zone / croquis est masqué une fois servi (il reste là, on peut le réafficher et recommencer)
  const finish = (layer, roleL) => {
    const d = D();
    if (roleL && d && KS.prefs.hideAfterGen !== false) { roleL.visible = false; roleL.touch(); d.changed(); KS.emit('layers', d); }
    restoreFG();
    return layer;
  };

  /* ---------------------------------------------------------------- paramètres Forge supplémentaires */
  // hires fix, refiner, graine de variation, nombre de lots ; scripts : soft inpainting, Never OOM
  G.extraParams = (st, kind) => {
    const p = {};
    const bc = U.clamp(+st.batchCount || 1, 1, 16); if (bc > 1) p.n_iter = bc;
    if (st.varStrength > 0) { p.subseed = st.varSeed != null && +st.varSeed >= 0 ? +st.varSeed : -1; p.subseed_strength = +st.varStrength; }
    if (st.refiner && st.refiner.model) { p.refiner_checkpoint = st.refiner.model; p.refiner_switch_at = +st.refiner.at || 0.8; }
    if (kind === 'txt' && st.hr && st.hr.enabled) {
      Object.assign(p, { enable_hr: true, hr_scale: +st.hr.scale || 1.5, hr_upscaler: st.hr.upscaler || 'Latent', hr_second_pass_steps: +st.hr.steps || 0, denoising_strength: +st.hr.denoise || 0.4, hr_resize_x: 0, hr_resize_y: 0,
        // valeurs par défaut de l'interface de Forge : sans elles, son API plante (« NoneType is not iterable »)
        hr_additional_modules: ['Use same choices'], hr_checkpoint_name: 'Use same checkpoint' });
      if (st.hr.cfg) p.hr_cfg = +st.hr.cfg;
    }
    return p;
  };
  const scripts0 = G.scriptsFor;
  G.scriptsFor = async (st, kind, opt = {}) => {
    const s = await scripts0(st, kind, opt);
    if (st.neverOom) s['Never OOM Integrated'] = { args: [true, true] };
    if (st.softInpaint && kind === 'inpaint') s['Soft inpainting'] = { args: [true, 1, 0.5, 4, 0, 0.5, 2] };
    return s;
  };

  /* ---------------------------------------------------------------- galerie */
  // Chaque résultat de Forge : vignette, infotexte, et enregistrement automatique (C:\KaneOS\output\kanevas)
  const stamp = () => { const t = new Date(), p = n => String(n).padStart(2, '0'); return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`; };
  G.onResults = async (res, job) => {
    const kind = job.txt ? 'txt2img' : job.mask ? 'inpaint' : 'img2img';
    for (let i = 0; i < res.variants.length; i++) {
      const c = res.variants[i], info = (res.infos || [])[i] || '';
      const item = { id: U.uid(), canvas: c, info, kind, time: Date.now(), thumb: '' };
      const t = U.canvas(Math.max(1, Math.round(c.width * 220 / Math.max(c.width, c.height))), Math.max(1, Math.round(c.height * 220 / Math.max(c.width, c.height))));
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      item.thumb = t.toDataURL('image/jpeg', 0.82);
      SD.gallery.unshift(item);
      if (KS.prefs.autoSave !== false && N && N.saveOutput) {
        try {
          let bytes = await pngBytes(c);
          if (info) bytes = KS.png.writeText(bytes, 'parameters', info);
          const r = await N.saveOutput(kind, `${stamp()}-${i}.png`, bytes);
          if (r.ok) item.path = r.path;
        } catch { /* enregistrement facultatif */ }
      }
    }
    if (SD.gallery.length > 120) SD.gallery.length = 120;
    renderGallery();
  };
  let galleryRoot = null;
  function renderGallery() {
    if (!galleryRoot) return;
    galleryRoot.innerHTML = '';
    const head = h('div.ga-head', h('span', { text: SD.gallery.length ? SD.gallery.length + ' image(s) cette session' : 'Les images générées apparaîtront ici.' }), h('div.spacer'),
      ui.check('Enregistrer automatiquement', KS.prefs.autoSave !== false, v => { KS.prefs.autoSave = v; KS.prefs.save(); }, 'Dans output\\kanevas de Kane OS (à côté des sorties de Forge), avec les paramètres (PNG Info)'),
      N && N.openOutputs ? ui.iconBtn('folder-open', 'Ouvrir le dossier des images', () => N.openOutputs(), '.sm') : null);
    const grid = h('div.ga-grid');
    for (const it of SD.gallery) {
      const im = h('img', { src: it.thumb, alt: '', title: (it.info || '').split('\n')[0].slice(0, 160) });
      const cell = h('button.ga-cell', im, h('span.ga-k', { text: it.kind }));
      cell.addEventListener('click', e => {
        const r = cell.getBoundingClientRect();
        ui.menu([
          { label: 'Ouvrir dans un nouveau document', icon: 'file-plus', action: () => openItem(it) },
          { label: 'Ajouter comme calque', icon: 'layers', action: () => addItemLayer(it), disabled: !D() },
          { label: 'Transformer cette image', icon: 'adjust', action: () => { openItem(it); setMode('transform'); } },
          { label: 'Réutiliser ces réglages', icon: 'history', action: () => it.info && G.applyInfo(it.info), disabled: !it.info },
          { label: 'Copier', icon: 'copy', action: async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await U.blobFromCanvas(it.canvas) })]); KS.toast('Copié', 'ok', 900); } catch (er) { KS.toast(er.message, 'err'); } } },
          { label: 'Infos de génération…', icon: 'info', action: () => { const d = openItem(it); if (d) C.pngInfo(); }, disabled: !it.info },
        ], r.left, r.bottom + 4);
      });
      cell.draggable = true;
      grid.appendChild(cell);
    }
    galleryRoot.append(head, grid);
  }
  const openItem = it => {
    const d = new KS.Doc({ name: (it.info || 'Image IA').split('\n')[0].replace(/<[^>]+>|[\\/:*?"<>|]/g, '').replace(/^newest, year 2026, safe,\s*/i, '').slice(0, 40) || 'Image IA', width: it.canvas.width, height: it.canvas.height });
    d.addLayer(new KS.Layer({ name: 'Image IA', canvas: U.copyCanvas(it.canvas) }), 0);
    d.genInfo = it.info; d.dirty = false; KS.addDoc(d); return d;
  };
  const addItemLayer = it => { const d = D(); const c = U.canvas(d.width, d.height); c.getContext('2d').drawImage(it.canvas, 0, 0, d.width, d.height); KS.io.placeCanvas ? KS.io.placeCanvas(d, c, 'Image IA', { x: 0, y: 0 }) : null; };
  KS.panels.register('gallery', { title: 'Galerie', build(el) { galleryRoot = h('div.ga'); el.appendChild(galleryRoot); renderGallery(); } });

  /* ---------------------------------------------------------------- barre de modes */
  let bar = null;
  const setMode = m => { SD.mode = m; KS.prefs.studioMode = m; KS.prefs.save(); if (m !== 'inpaint') restoreFG(); renderBar(); };
  function modeTools() {
    const st = settings(), d = D();
    const sc = (label, value, min, max, step, unit, key, scale = 1) => ui.scrub({ label, value: Math.round(value * scale * 100) / 100, min, max, step, unit, onInput: v => G.saveSettings({ [key]: v / scale }) });
    switch (SD.mode) {
      case 'create': return [
        ui.seg([['doc', 'Nouveau document'], ['layer', 'Calque du document']], KS.prefs.createInto || 'doc', v => { KS.prefs.createInto = v; KS.prefs.save(); }),
        h('span.sb-dim', { text: `${st.size.w} × ${st.size.h}` + (st.hr.enabled ? ` → hires ×${st.hr.scale}` : '') })];
      case 'transform': return [sc('Force', st.i2iStrength, 5, 100, 1, '%', 'i2iStrength', 100)];
      case 'inpaint': return [
        ui.btn('Peindre la zone', () => paintOn('zone'), '.small.primary', 'brush'), ui.btn('Gomme', () => paintOn('zone', true), '.small', 'eraser'),
        ui.btn('Effacer', () => clearRole('zone'), '.small', 'trash'), ui.btn('Inverser', invertZone, '.small', 'select-invert'),
        d && d.selection.active ? ui.btn('Sélection → zone', selectionToZone, '.small', 'marquee-rect') : null,
        sc('Force', st.strength, 30, 100, 1, '%', 'strength', 100)];
      case 'sketch': return [
        ui.btn('Peindre le croquis', () => paintOn('sketch'), '.small.primary', 'pencil'), ui.btn('Gomme', () => paintOn('sketch', true), '.small', 'eraser'),
        ui.btn('Effacer', () => clearRole('sketch'), '.small', 'trash'),
        sc('Force', st.sketchStrength, 30, 100, 1, '%', 'sketchStrength', 100)];
      case 'upscale': return [ui.seg([['1.5', '× 1,5'], ['2', '× 2'], ['3', '× 3']], String(st.md.factor), v => G.saveSettings({ md: { ...settings().md, factor: +v } })),
        sc('Force', st.md.denoise, 5, 70, 1, '%', 'md', 100)];
    }
    return [];
  }
  function renderBar() {
    if (!bar) return;
    const st = settings();
    const modes = h('div.sb-modes', ...MODES.map(([id, label, icon]) => {
      const b = h('button.sb-mode' + (SD.mode === id ? '.on' : ''), h('span', { html: KS.icon(icon) }), h('span', { text: label }));
      b.addEventListener('click', () => setMode(id)); return b;
    }));
    const help = h('div.sb-help', { text: MODES.find(m => m[0] === SD.mode)[3] });
    const gen = h('button.sb-gen', h('span', { html: KS.icon('sparkles') }), h('span', { text: 'Générer' }));
    gen.addEventListener('click', generate);
    const count = ui.scrub({ label: 'Lots', value: st.batchCount || 1, min: 1, max: 16, onInput: v => G.saveSettings({ batchCount: v }), title: 'Nombre de lots (chaque lot = « Variantes » images)' });
    const stop = ui.iconBtn('close', 'Interrompre la génération', () => N.forgeInterrupt(G.url()), '.sm');
    const skip = N.forgeSkip ? ui.iconBtn('chevron-right', 'Passer à l\'image suivante du lot', () => N.forgeSkip(G.url()), '.sm') : null;
    bar.replaceChildren(h('div.sb-row', modes, h('div.spacer'), count, stop, skip, gen), h('div.sb-row.sb-tools', ...modeTools().filter(Boolean), h('div.spacer'), help));
  }
  async function generate() {
    const p = (KS.state.lastPrompt || '').trim();
    switch (SD.mode) {
      case 'create': return (KS.prefs.createInto || 'doc') === 'doc' || !D() ? C.newImageDoc(p) : C.generateImage(p);
      case 'transform': return C.img2imgDoc(p);
      case 'inpaint': return paintedGenerate('inpaint');
      case 'sketch': return paintedGenerate('sketch');
      case 'upscale': return C.upscaleDetail();
    }
  }
  C.studioGenerate = generate;

  /* ---------------------------------------------------------------- bascule Édition ⇄ Studio IA */
  C.toggleStudio = async (on = !SD.on) => {
    SD.on = on;
    document.body.classList.toggle('studio', on);
    const aside = KS.$('#studio');
    if (on) {
      if (!bar) { bar = h('div#studio-bar'); KS.$('#center').prepend(bar); }
      KS.genPanel.mount(aside);
      renderBar();
      KS.panels.focus('gallery');
      if (KS.engine) KS.engine.ensure({ quiet: true }).then(ok => ok && KS.genPanel.reload());
    } else {
      KS.genPanel.unmount();
      restoreFG();
    }
    KS.prefs.studio = on; KS.prefs.save();
    switchBtns.forEach(b => b.classList.toggle('on', (b.dataset.v === 'studio') === on));
    KS.emit('studio', on);
    window.dispatchEvent(new Event('resize'));
  };
  const switchBtns = [];
  KS.on('ui-ready', () => {
    const box = KS.$('#workspace-actions'); if (!box) return;
    const sw = h('div.ws-switch');
    for (const [v, label] of [['edit', 'Édition'], ['studio', 'Studio IA']]) {
      const b = h('button.ws-btn', { 'data-v': v, text: label }); b.addEventListener('click', () => C.toggleStudio(v === 'studio'));
      switchBtns.push(b); sw.appendChild(b);
    }
    switchBtns[0].classList.add('on');
    box.prepend(sw);
    if (KS.prefs.studio) setTimeout(() => C.toggleStudio(true), 300);
  });
  for (const ev of ['selection', 'doc']) KS.on(ev, U.debounce(() => { if (SD.on) renderBar(); }, 100));
  KS.on('studio-settings', () => { if (SD.on) renderBar(); });
})();
