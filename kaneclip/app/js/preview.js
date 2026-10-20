// Fenêtre d'aperçu vidéo (qualité, superpositions, clichés, plein écran) et bus maître (vu-mètres, fader).
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, E = KC.engine, FX = KC.FX;
  const PV = KC.preview = {};
  let canvas, stage, info, ovl, health, healthAt=0;
  let adapt = 1, avg = 0;
  const QUAL = {
    draft: { label: 'Brouillon (auto)', scale: 0.25 },
    preview: { label: 'Aperçu (auto)', scale: 0.5 },
    good: { label: 'Bonne (auto)', scale: 1 },
    'good-full': { label: 'Bonne (plein)', scale: 1, full: true },
    best: { label: 'Optimale (plein)', scale: 1, full: true, best: true },
  };

  function layout() {
    const s = KC.project.settings;
    const r = stage.getBoundingClientRect();
    const ar = s.width / s.height;
    let w = r.width - 16, hh = r.height - 16;
    if (w / hh > ar) w = hh * ar; else hh = w / ar;
    w = Math.max(16, Math.floor(w)); hh = Math.max(9, Math.floor(hh));
    canvas.style.width = w + 'px'; canvas.style.height = hh + 'px';
    ovl.style.width = w + 'px'; ovl.style.height = hh + 'px';
    PV.dispW = w; PV.dispH = hh;
    E.redraw();
  }

  PV.draw = (t) => {
    const s = KC.project.settings;
    const q = QUAL[KC.prefs.quality] || QUAL.preview;
    const dpr = window.devicePixelRatio || 1;
    let scale = q.scale;
    if (!q.full) scale = Math.min(scale, (PV.dispW || 640) * dpr / s.width);
    // Qualité adaptative en lecture : si l'image coûte trop cher, on réduit la résolution d'aperçu
    if (!q.full && E.playing) scale *= adapt; else adapt = 1;
    scale = Math.max(0.05, scale);
    const w = Math.max(2, Math.round(s.width * scale)), hh = Math.max(2, Math.round(s.height * scale));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; updateInfo(); }
    const t0 = performance.now();
    E.compose(t, canvas, { best: !!q.best });
    const dt = performance.now() - t0;
    avg = avg * 0.9 + dt * 0.1;
    if (health && performance.now()-healthAt>500) {
      healthAt=performance.now();health.textContent=Math.round(avg)+' ms';
      health.dataset.state=avg>1000/P.fps()?'slow':'ready';
      health.title='Calcul de l’aperçu : '+Math.round(avg)+' ms · budget à '+U.fmtFps(P.fps())+' i/s : '+Math.round(1000/P.fps())+' ms';
    }
    if (E.playing && !q.full) {
      if (avg > 20 && adapt > 0.4) { adapt = Math.max(0.4, adapt * 0.85); avg = 12; }
      else if (avg < 7 && adapt < 1) adapt = Math.min(1, adapt * 1.05);
    }
    drawOverlays();
    const fr = KC.$('#pv-frame'); if (fr) fr.textContent = String(Math.round(t * P.fps()));
  };

  function drawOverlays() {
    const o = KC.prefs.overlays || {};
    const x = ovl.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round((PV.dispW || 1) * dpr), hh = Math.round((PV.dispH || 1) * dpr);
    if (ovl.width !== w || ovl.height !== hh) { ovl.width = w; ovl.height = hh; }
    x.clearRect(0, 0, w, hh);
    // cadre de l'événement sélectionné (déplacement direct dans l'aperçu)
    const ev = PV.editable();
    if (ev) {
      const b = PV.eventBox(ev, E.time, w, hh);
      if (b) {
        x.save(); x.strokeStyle = 'rgba(61,124,240,.9)'; x.lineWidth = 1.5 * dpr; x.setLineDash([6 * dpr, 4 * dpr]);
        x.beginPath(); b.pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); x.stroke(); x.restore();
      }
    }
    if (o.grid) {
      x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1;
      x.beginPath();
      for (let i = 1; i < 3; i++) { x.moveTo(w * i / 3, 0); x.lineTo(w * i / 3, hh); x.moveTo(0, hh * i / 3); x.lineTo(w, hh * i / 3); }
      x.stroke();
    }
    if (o.safe) {
      x.strokeStyle = 'rgba(255,220,80,.7)'; x.setLineDash([5, 4]);
      x.strokeRect(w * 0.05, hh * 0.05, w * 0.9, hh * 0.9);
      x.strokeStyle = 'rgba(120,220,255,.7)';
      x.strokeRect(w * 0.1, hh * 0.1, w * 0.8, hh * 0.8);
      x.setLineDash([]);
    }
  }

  /* ------------------------------------------------------------ déplacement direct dans l'aperçu */
  PV.editable = () => {
    const sel = KC.sel.list().filter(e => P.kindOf(e) === 'video' && E.time >= e.start && E.time < e.start + e.length);
    return sel.length === 1 ? sel[0] : null;
  };
  // Coins de l'événement à l'écran (pixels de l'overlay)
  PV.eventBox = (ev, t, w, hh) => {
    const s = KC.project.settings;
    let sw, sh;
    if (ev.gen) { sw = s.width; sh = s.height; }
    else { const m = P.media(ev.media); if (!m) return null; sw = m.width || s.width; sh = m.height || s.height; }
    const tau = t - ev.start;
    const pc = FX.pcAt(ev.pc, tau);
    const k = w / s.width;
    const fit = Math.min(s.width / sw, s.height / sh) * pc.zoom;
    const a = pc.rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const pts = [[0, 0], [sw, 0], [sw, sh], [0, sh]].map(([u, v]) => {
      const dx = (u - pc.cx * sw) * fit, dy = (v - pc.cy * sh) * fit;
      return [(s.width / 2 + ca * dx - sa * dy) * k, (s.height / 2 + sa * dx + ca * dy) * k];
    });
    return { pts, pc, sw, sh, fit };
  };
  function bindDirect() {
    ovl.style.pointerEvents = 'auto';
    ovl.addEventListener('pointerdown', e => {
      const ev = PV.editable();
      if (!ev || e.button !== 0) return;
      e.preventDefault();
      const tau = P.snapFrame(E.time - ev.start);
      const pc0 = FX.pcAt(ev.pc, tau);
      const s = KC.project.settings;
      const box = PV.eventBox(ev, E.time, PV.dispW, PV.dispH);
      const k = PV.dispW / s.width;
      KC.begin();
      U.drag(e, (dx, dy) => {
        // déplacement écran -> déplacement du point source au centre
        const a = -pc0.rot * Math.PI / 180;
        const ux = (Math.cos(a) * dx - Math.sin(a) * dy) / k / box.fit, uy = (Math.sin(a) * dx + Math.cos(a) * dy) / k / box.fit;
        KC.windows.pcSet(ev, tau, { cx: pc0.cx - ux / box.sw, cy: pc0.cy - uy / box.sh });
        E.redraw();
      }, () => KC.commit('Déplacer dans l\'aperçu'));
    });
    ovl.addEventListener('wheel', e => {
      const ev = PV.editable();
      if (!ev) return;
      e.preventDefault();
      const tau = P.snapFrame(E.time - ev.start);
      const pc0 = FX.pcAt(ev.pc, tau);
      KC.edit('Zoom dans l\'aperçu', () => KC.windows.pcSet(ev, tau, { zoom: U.clamp(pc0.zoom * Math.pow(1.0015, -e.deltaY), 0.05, 20) }));
      E.redraw();
    }, { passive: false });
    ovl.addEventListener('dblclick', () => { const ev = PV.editable(); if (ev) KC.windows.panCrop(ev); });
  }

  function updateInfo() {
    const s = KC.project.settings;
    const fps = U.fmtFps(s.fps);
    info.innerHTML = '';
    const add = (l, v) => info.append(h('span', { text: l }), h('b', { text: v }));
    add('Projet :', `${s.width}×${s.height} ; ${fps}p`);
    add('Aperçu :', `${canvas.width}×${canvas.height} ; ${fps}p`);
    add('Affichage :', `${PV.dispW || 0}×${PV.dispH || 0}`);
    info.append(h('span', { text: 'Image :' }), h('b#pv-frame', { text: String(Math.round(E.time * P.fps())) }));
  }

  /* ------------------------------------------------------------ clichés */
  PV.snapshotCanvas = () => {
    const s = KC.project.settings;
    const c = U.canvas(s.width, s.height);
    E.compose(E.time, c, { best: true });
    return c;
  };
  KC.cmd.snapshotCopy = async () => {
    try {
      const b = await U.blob(PV.snapshotCanvas());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      KC.toast('Cliché copié dans le presse-papiers', 'ok');
    } catch (e) { KC.toast('Copie impossible : ' + e.message, 'err'); }
  };
  KC.cmd.snapshotSave = async () => {
    const base = KC.project.path ? U.stripExt(U.base(KC.project.path)) : 'Cliché';
    const p = await KC.native.saveDialog({ title: 'Enregistrer le cliché', defaultPath: base + ' ' + U.fmtTime(E.time, P.fps(), 'sec').replace(/[:.]/g, '-') + '.png', filters: [{ name: 'Image PNG', extensions: ['png'] }, { name: 'Image JPEG', extensions: ['jpg'] }] });
    if (!p) return;
    const jpg = /\.jpe?g$/i.test(p);
    const b = await U.blob(PV.snapshotCanvas(), jpg ? 'image/jpeg' : 'image/png', 0.95);
    const r = await KC.native.writeFile(p, new Uint8Array(await b.arrayBuffer()));
    if (r.ok) KC.toast('Cliché enregistré', 'ok'); else KC.toast(r.error, 'err');
  };
  KC.cmd.previewFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen().catch(() => {}); };

  /* ------------------------------------------------------------ construction */
  PV.init = () => {
    const pane = KC.$('#preview-pane');
    const q = KC.ui.select(Object.entries(QUAL).map(([k, v]) => [k, v.label]), KC.prefs.quality, v => { KC.prefs.quality = v; KC.prefs.save(); E.redraw(); });
    q.title = 'Qualité de l\'aperçu';
    const tb = (icon, title, fn) => { const b = h('button.tb', { title, html: KC.icon(icon) }); b.addEventListener('click', fn); return b; };
    const ovlBtn = tb('grid3', 'Superpositions', e => {
      const r = e.currentTarget.getBoundingClientRect();
      KC.menu.open([
        { label: 'Grille des tiers', checked: !!KC.prefs.overlays.grid, action: () => { KC.prefs.overlays.grid = !KC.prefs.overlays.grid; KC.prefs.save(); E.redraw(); } },
        { label: 'Zones de sécurité', checked: !!KC.prefs.overlays.safe, action: () => { KC.prefs.overlays.safe = !KC.prefs.overlays.safe; KC.prefs.save(); E.redraw(); } },
      ], r.left, r.bottom + 4);
    });
    health=h('span#preview-health',{text:'— ms',title:'Temps de calcul de l’aperçu'});
    const bypass=h('button.tb-btn#preview-bypass',{text:'FX activés',title:'Comparer sans les effets vidéo · aperçu seulement','aria-pressed':'false'});
    bypass.addEventListener('click',()=>{E.bypassEffects=!E.bypassEffects;bypass.textContent=E.bypassEffects?'FX ignorés':'FX activés';bypass.setAttribute('aria-pressed',String(E.bypassEffects));E.redraw();});
    KC.on('project-loaded',()=>{E.bypassEffects=false;bypass.textContent='FX activés';bypass.setAttribute('aria-pressed','false');});
    const bar = h('div.pv-bar', h('span.title', { text: 'Programme' }), q, health, bypass, h('div', { style: { flex: '1' } }),
      tb('props', 'Propriétés du projet…', () => KC.dialogs.projectProps()),
      ovlBtn,
      tb('fullscreen', 'Aperçu plein écran (Alt+Maj+4)', KC.cmd.previewFullscreen),
      tb('clipboard', 'Copier le cliché dans le presse-papiers', KC.cmd.snapshotCopy),
      tb('camera', 'Enregistrer le cliché dans un fichier…', KC.cmd.snapshotSave));
    canvas = h('canvas');
    ovl = h('canvas.pv-ovl', { style: { left: '0', top: '0' } });
    stage = h('div.pv-stage', h('div', { style: { position: 'relative', lineHeight: '0' } }, canvas, ovl));
    stage.addEventListener('dblclick', e => { if (e.target === stage) KC.cmd.previewFullscreen(); });
    info = h('div.pv-info');
    pane.append(bar, stage, info);
    new ResizeObserver(() => { layout(); updateInfo(); }).observe(stage);
    KC.on('settings', () => { layout(); updateInfo(); });
    KC.on('project-loaded', () => { layout(); updateInfo(); });
    KC.on('selection', () => E.redraw());
    bindDirect();
    buildMaster();
  };

  /* ------------------------------------------------------------ bus maître */
  function buildMaster() {
    const pane = KC.$('#master-pane');
    const meter = h('canvas');
    const mwrap = h('div.mb-meter', { style: { width: '46px' } }, meter);
    const dbv = h('div', { text: '0,0 dB' });
    const fader = KC.ui.vfader({
      value: KC.ui.dbToFader(KC.project ? KC.project.settings.masterGain || 0 : 0), def: 0.75,
      onInput: v => { const d = KC.ui.faderToDb(v); KC.project.settings.masterGain = isFinite(d) ? Math.round(d * 10) / 10 : -80; dbv.textContent = U.fmtDb(KC.project.settings.masterGain); },
      onEnd: () => KC.markDirty(),
    });
    const fwrap = h('div.mb-fader', fader);
    const mute = h('button.tb', { title: 'Couper le son du maître', html: KC.icon('mute') });
    mute.addEventListener('click', () => { E.masterMute = !E.masterMute; mute.classList.toggle('on', E.masterMute); });
    pane.append(h('div.mb-title', { text: 'Maître' }), h('div.mb-body', mwrap, fwrap), h('div.mb-foot', dbv, mute));
    meter.addEventListener('click', () => { E.levels.clip = false; E.levels.peakL = E.levels.peakR = 0; });
    meter.title = 'Cliquer pour réinitialiser les crêtes';
    KC.on('project-loaded', () => { fader.set(KC.ui.dbToFader(KC.project.settings.masterGain || 0)); dbv.textContent = U.fmtDb(KC.project.settings.masterGain || 0); });
    const MIN = -54;
    const pos = v => { const db = v > 0 ? 20 * Math.log10(v) : -120; return U.clamp((db - MIN) / -MIN, 0, 1); };
    KC.on('meters', lv => {
      const dpr = window.devicePixelRatio || 1;
      const r = mwrap.getBoundingClientRect();
      const w = Math.round(r.width * dpr), hh = Math.round(r.height * dpr);
      if (!w || !hh) return;
      if (meter.width !== w || meter.height !== hh) { meter.width = w; meter.height = hh; }
      const x = meter.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = r.width, H = r.height;
      x.clearRect(0, 0, W, H);
      const top = 12, bot = H - 2, mh = bot - top;
      const bw = 11, x1 = W - bw * 2 - 3, x2 = W - bw - 1;
      x.font = '9px Consolas, monospace'; x.fillStyle = '#7f8896'; x.textAlign = 'right'; x.textBaseline = 'middle';
      for (const db of [0, -6, -12, -18, -24, -36, -48]) { const y = bot - (db - MIN) / -MIN * mh; x.fillText(String(db), x1 - 3, y); x.fillRect(x1 - 2, Math.round(y), 2, 1); }
      const grad = x.createLinearGradient(0, bot, 0, top);
      grad.addColorStop(0, '#2fb27a'); grad.addColorStop(0.72, '#9ad14a'); grad.addColorStop(0.88, '#e3c13a'); grad.addColorStop(1, '#e0533d');
      for (const [xx, v, pk] of [[x1, lv.L, lv.peakL], [x2, lv.R, lv.peakR]]) {
        x.fillStyle = '#121316'; x.fillRect(xx, top, bw, mh);
        const p = pos(v);
        x.fillStyle = grad; x.fillRect(xx, bot - p * mh, bw, p * mh);
        const pp = pos(pk);
        if (pp > 0.01) { x.fillStyle = '#fff'; x.fillRect(xx, bot - pp * mh, bw, 1.5); }
      }
      x.fillStyle = lv.clip ? '#e0533d' : '#3a3d45';
      x.fillRect(x1, 2, bw * 2 + 2, 7);
    });
  }
})();
