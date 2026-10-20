// Fenêtres flottantes : effets d'événement / de piste, panoramique-recadrage (images-clés), titres et générateurs.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, FX = KC.FX, E = KC.engine;
  const Wn = KC.windows = { open: new Map() };

  /* ------------------------------------------------------------ fenêtre flottante générique */
  Wn.float = ({ key, title, sub, width = 560, height = 420, body, onClose }) => {
    if (Wn.open.has(key)) { const w = Wn.open.get(key); w.close(); }
    const t = h('div.t', { text: title }, sub ? h('small', { text: sub }) : null);
    const x = h('button.tb', { title: 'Fermer', html: KC.icon('x') });
    const head = h('div.fwin-head', t, x);
    const content = h('div.fwin-body');
    const rz = h('div.fwin-resize');
    const el = h('div.fwin', head, content, rz);
    const saved = KC.prefs['win_' + key.split(':')[0]] || {};
    const W0 = saved.w || width, H0 = saved.h || height;
    el.style.width = W0 + 'px'; el.style.height = H0 + 'px';
    el.style.left = U.clamp(saved.x != null ? saved.x : 30 + Wn.open.size * 24, 0, innerWidth - 120) + 'px';
    el.style.top = U.clamp(saved.y != null ? saved.y : 90 + Wn.open.size * 24, 0, innerHeight - 60) + 'px';
    KC.$('#windows').appendChild(el);
    const front = () => { KC.$$('.fwin').forEach(f => f.classList.remove('front')); el.classList.add('front'); };
    front();
    el.addEventListener('pointerdown', front);
    const save = () => { const r = el.getBoundingClientRect(); KC.prefs['win_' + key.split(':')[0]] = { x: r.left, y: r.top, w: r.width, h: r.height }; KC.prefs.save(); };
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect();
      U.drag(e, (dx, dy) => { el.style.left = U.clamp(r.left + dx, -r.width + 80, innerWidth - 80) + 'px'; el.style.top = U.clamp(r.top + dy, 0, innerHeight - 40) + 'px'; }, save);
    });
    rz.addEventListener('pointerdown', e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      U.drag(e, (dx, dy) => { el.style.width = Math.max(320, r.width + dx) + 'px'; el.style.height = Math.max(200, r.height + dy) + 'px'; if (w.onResize) w.onResize(); }, save);
    });
    const w = {
      el, content, setTitle: (s, sb) => { t.firstChild.textContent = s; if (t.querySelector('small')) t.querySelector('small').textContent = sb || ''; },
      close: () => { el.remove(); Wn.open.delete(key); KC.off('change', w._onChange); if (onClose) onClose(); },
    };
    x.addEventListener('click', () => w.close());
    if (body) content.appendChild(body);
    Wn.open.set(key, w);
    return w;
  };
  // Ferme les fenêtres dont l'objet a disparu (annuler, suppression)
  KC.on('change', () => {
    for (const [k, w] of [...Wn.open]) {
      const [kind, id] = k.split(':');
      if ((kind === 'efx' || kind === 'pc' || kind === 'gen') && !P.event(id)) w.close();
      if (kind === 'tfx' && !P.track(id)) w.close();
    }
  });
  KC.on('project-loaded', () => { for (const w of [...Wn.open.values()]) w.close(); });

  /* ------------------------------------------------------------ analyse de l'amélioration des couleurs */
  // Images représentatives d'un événement : 7 vignettes réparties sur sa durée (ou l'image fixe)
  async function eventSamples(ev) {
    const m = ev.media && P.media(ev.media);
    if (!m) return [];
    const r = KC.media.get(m);
    if (m.kind === 'image') return r.img ? [r.img] : [];
    const out = [];
    if (r.thumbs) {
      for (let k = 0; k < 7; k++) {
        const t = E.srcTime(ev, ev.start + ev.length * (k + 0.5) / 7);
        try { out.push(await U.loadImage(KC.media.thumbUrl(m, t))); } catch { /* vignette absente */ }
      }
    }
    if (!out.length) { const s = E.slots().get(ev.id + ':v'); if (s && s.hasFrame) out.push(s.el); }
    return out;
  }
  Wn.analyzeEnhance = async (ev, fx, notify = false) => {
    const imgs = await eventSamples(ev);
    const lv = FX.analyzeLevels(imgs);
    if (!lv) { if (notify) KC.toast('Analyse impossible : vignettes pas encore prêtes, réessayez dans un instant', 'info'); return false; }
    const e = P.event(ev.id); if (!e) return false;
    const f = e.fx.find(x => x.id === fx.id); if (!f) return false;
    f.params = Object.assign({}, f.params, lv, { analyzed: true });
    KC.markDirty(); E.redraw();
    KC.emit('change', { label: 'analyse' });
    if (notify) KC.toast('Couleurs analysées', 'ok', 1500);
    return true;
  };
  // Tout effet « amélioration » ajouté est analysé automatiquement
  const pendingAnalyze = new Set();
  KC.on('change', () => {
    if (!KC.project) return;
    for (const ev of KC.project.events) for (const f of ev.fx || []) {
      if (f.type !== 'enhance' || (f.params && f.params.analyzed) || pendingAnalyze.has(f.id)) continue;
      pendingAnalyze.add(f.id);
      Wn.analyzeEnhance(ev, f).then(ok => { if (!ok) setTimeout(() => pendingAnalyze.delete(f.id), 3000); });
    }
  });

  /* ------------------------------------------------------------ chaîne d'effets (événement ou piste) */
  function fxWindow({ key, title, sub, owner, audio }) {
    const getOwner = () => audio ? P.track(owner.id) : P.event(owner.id);
    const w = Wn.float({ key, title, sub, width: 560, height: 430 });
    let active = 0;
    const chain = h('div.chain'), params = h('div.fx-params');
    w.content.append(chain, params);
    const LIB = audio ? FX.AUDIO : FX.VIDEO;
    const render = () => {
      const o = getOwner(); if (!o) return w.close();
      const list = o.fx || [];
      chain.innerHTML = '';
      chain.appendChild(h('span', { text: audio ? 'Piste' : 'Événement', style: { color: 'var(--muted)', fontSize: '12px', marginRight: '2px' } }));
      list.forEach((f, i) => {
        const d = LIB[f.type];
        const cb = h('input', { type: 'checkbox', checked: f.on !== false, title: 'Activer / désactiver' });
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => KC.edit('Activer un effet', () => { f.on = cb.checked; }));
        const x = h('span.x', { html: KC.icon('x'), title: 'Retirer l\'effet' });
        x.addEventListener('click', e => { e.stopPropagation(); KC.edit('Retirer un effet', () => { o.fx.splice(i, 1); }); active = Math.max(0, Math.min(active, o.fx.length - 1)); });
        const it = h('div.chain-item' + (i === active ? '.active' : ''), { draggable: true }, cb, h('span', { text: d ? d.name : f.type }), x);
        it.addEventListener('click', () => { active = i; render(); });
        it.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'fx'); it._from = i; KC.dndFx = i; });
        it.addEventListener('dragover', e => { if (KC.dndFx != null) e.preventDefault(); });
        it.addEventListener('drop', e => { e.preventDefault(); const from = KC.dndFx; KC.dndFx = null; if (from == null || from === i) return; KC.edit('Réordonner les effets', () => { const [m] = o.fx.splice(from, 1); o.fx.splice(i, 0, m); }); active = i; });
        chain.appendChild(it);
        if (i < list.length - 1) chain.appendChild(h('span.chain-arrow', { text: '→' }));
      });
      const add = h('button.btn.small', { html: KC.icon('plus') + 'Ajouter' });
      add.addEventListener('click', e => {
        const r = e.currentTarget.getBoundingClientRect();
        const items = [];
        let cat = null;
        for (const [k, d] of Object.entries(LIB)) {
          if (!audio && d.cat !== cat) { cat = d.cat; items.push({ header: cat }); }
          items.push({ label: d.name, action: () => { KC.edit('Ajouter un effet', () => o.fx.push(FX.make(k, audio))); active = o.fx.length - 1; } });
        }
        KC.menu.open(items, r.left, r.bottom + 4);
      });
      chain.appendChild(add);
      // paramètres
      params.innerHTML = '';
      const f = list[active];
      if (!f) { params.appendChild(h('div.page-empty', { html: '<b>Aucun effet</b><br>Ajoutez un effet avec le bouton « Ajouter », ou glissez-en un depuis l\'onglet Effets.' })); return; }
      const d = LIB[f.type];
      const reset = h('button.btn.small', { html: KC.icon('reset') + 'Par défaut' });
      reset.addEventListener('click', () => KC.edit('Réinitialiser l\'effet', () => { f.params = FX.defaults(d); }));
      params.appendChild(h('h4', h('span', { text: d.name }), h('span.sp'), reset));
      const pv = FX.params(f, audio);
      let began = false;
      for (const pd of d.params) {
        if (pd.hidden) continue;
        params.appendChild(KC.ui.param(pd, pv[pd.k], v => {
          if (!began) { KC.begin(); began = true; }
          f.params = Object.assign({}, f.params, { [pd.k]: v });
          E.redraw();
          if (audio) KC.emit('track-fx-live');
        }, () => { if (began) { began = false; KC.commit('Modifier un effet'); } }));
      }
      if (f.type === 'enhance') {
        const an = h('button.btn.small', { html: KC.icon('wand') + 'Analyser à nouveau', style: { marginTop: '10px' } });
        an.addEventListener('click', () => { KC.begin(); Wn.analyzeEnhance(getOwner(), f, true).then(() => KC.commit('Analyser les couleurs')); });
        const lv = pv.analyzed ? `Niveaux mesurés — R ${Math.round(pv.lr * 255)}→${Math.round(pv.hr * 255)}, V ${Math.round(pv.lg * 255)}→${Math.round(pv.hg * 255)}, B ${Math.round(pv.lb * 255)}→${Math.round(pv.hb * 255)}.` : 'Analyse en cours…';
        params.append(h('div.note', { style: { marginTop: '10px' }, text: 'Corrige automatiquement l\'exposition et la balance des blancs, puis ravive les couleurs ternes (vibrance) sans saturer les tons chair. ' + lv }), an);
      }
      if (f.type === 'chroma') params.appendChild(h('div.note', { style: { marginTop: '10px' }, text: 'Astuce : placez l\'événement incrusté sur une piste au-dessus de l\'arrière-plan.' }));
    };
    w._onChange = (info) => { if (!info || !info.silent) render(); };
    KC.on('change', w._onChange);
    render();
    return w;
  }
  /* ------------------------------------------------------------ mouvement de piste (zoom / position / rotation de toute la piste) */
  Wn.trackMotion = (tr) => {
    const w = Wn.float({ key: 'tm:' + tr.id, title: 'Mouvement de la piste', sub: P.trackLabel(tr), width: 460, height: 340 });
    const getTr = () => P.track(tr.id);
    const body = h('div.form', { style: { padding: '14px', gap: '10px', display: 'flex', flexDirection: 'column' } });
    const rows = {};
    const FIELDS = [
      ['zoom', 'Zoom (%)', 10, 400, 1, v => v * 100, v => v / 100, 1],
      ['x', 'Position X (%)', -100, 100, 0.5, v => v * 100, v => v / 100, 0],
      ['y', 'Position Y (%)', -100, 100, 0.5, v => v * 100, v => v / 100, 0],
      ['rot', 'Rotation (°)', -180, 180, 0.5, v => v, v => v, 0],
    ];
    const live = () => E.redraw();
    for (const [k, label, min, max, step, toUi, fromUi, def] of FIELDS) {
      const rng = h('input', { type: 'range', min, max, step, style: { flex: 1 } });
      const num = h('input.field', { type: 'number', step, style: { width: '76px' } });
      const rst = h('button.tb', { title: 'Valeur par défaut', html: KC.icon('x') });
      const put = () => { const v = FX.tmOf(getTr())[k]; const u = Math.round(toUi(v) * 10) / 10; rng.value = u; num.value = u; };
      rng.addEventListener('pointerdown', () => KC.begin());
      rng.addEventListener('input', () => { const t = getTr(); t.tm = { ...FX.tmOf(t), [k]: fromUi(parseFloat(rng.value)) }; num.value = rng.value; live(); });
      rng.addEventListener('change', () => KC.commit('Mouvement de la piste'));
      num.addEventListener('change', () => {
        if (num.value === '') return;
        let u = parseFloat(num.value); if (!isFinite(u)) return;
        if (k === 'zoom') u = U.clamp(u, 5, 2000);
        KC.edit('Mouvement de la piste', () => { const t = getTr(); t.tm = { ...FX.tmOf(t), [k]: fromUi(u) }; });
        put(); live();
      });
      rst.addEventListener('click', () => { KC.edit('Mouvement de la piste', () => { const t = getTr(); t.tm = { ...FX.tmOf(t), [k]: def }; }); put(); live(); });
      rows[k] = put; put();
      body.append(h('div.row', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { text: label, style: { width: '110px' } }), rng, num, rst));
    }
    const setAll = (label, tm) => { KC.edit(label, () => { getTr().tm = tm; }); Object.values(rows).forEach(f => f()); live(); };
    const preset = (label, z) => { const b = h('button.btn.small', { text: label }); b.addEventListener('click', () => setAll('Zoom de la piste', { ...FX.tmOf(getTr()), zoom: z })); return b; };
    const fillB = h('button.btn.small', { html: KC.icon('fit') + 'Remplir le cadre' });
    fillB.addEventListener('click', () => KC.dialogs.fillTrack(getTr()));
    const resetB = h('button.btn.small', { text: 'Tout réinitialiser' });
    resetB.addEventListener('click', () => setAll('Réinitialiser le mouvement de la piste', { zoom: 1, x: 0, y: 0, rot: 0 }));
    const evB = h('button.btn.small', { text: 'Transformer les événements…' });
    evB.addEventListener('click', () => { KC.sel.set(KC.project.events.filter(e => e.track === tr.id).map(e => e.id)); KC.dialogs.batchTransform(); });
    body.append(h('div.row', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, preset('110 %', 1.1), preset('125 %', 1.25), preset('150 %', 1.5), preset('200 %', 2), fillB),
      h('div.row', { style: { display: 'flex', gap: '6px' } }, resetB, evB),
      h('div.note', { text: 'Le mouvement s\'applique à tous les événements de la piste, en plus de leur propre panoramique. Double-clic sur le curseur « Zoom » de l\'en-tête de piste pour revenir à 100 %.' }));
    w.content.append(body);
    w._onChange = () => Object.values(rows).forEach(f => f());
    KC.on('change', w._onChange);
    return w;
  };
  Wn.eventFx = (ev) => fxWindow({ key: 'efx:' + ev.id, title: 'Effets d\'événement vidéo', sub: P.eventName(ev), owner: ev, audio: false });
  Wn.trackFx = (tr) => fxWindow({ key: 'tfx:' + tr.id, title: 'Effets de piste audio', sub: P.trackLabel(tr), owner: tr, audio: true });

  /* ------------------------------------------------------------ images-clés de panoramique */
  // Modifie le panoramique au temps local tau : met à jour l'image-clé existante ou en crée une
  Wn.pcSet = (ev, tau, props) => {
    if (!ev.pc || !ev.pc.kf || !ev.pc.kf.length) ev.pc = { kf: [FX.pcDefault()] };
    const kf = ev.pc.kf;
    const fr = 0.5 / P.fps();
    let k = kf.find(x => Math.abs(x.t - tau) < fr);
    if (!k) {
      if (kf.length === 1 && Math.abs(kf[0].t) < fr && !Wn.animate) k = kf[0];
      else { const at = FX.pcAt(ev.pc, tau); k = { ...at, t: Math.max(0, tau), ease: at.ease || 'linear' }; kf.push(k); kf.sort((a, b) => a.t - b.t); }
    }
    Object.assign(k, props);
  };
  Wn.animate = false;

  Wn.panCrop = (ev) => {
    const key = 'pc:' + ev.id;
    const w = Wn.float({ key, title: 'Panoramique/Recadrage de l\'événement', sub: P.eventName(ev), width: 860, height: 560 });
    const stage = h('div.pc-stage'), cvs = h('canvas');
    stage.appendChild(cvs);
    const side = h('div.pc-side');
    const kfBar = h('div.pc-kf'), kfC = h('canvas');
    kfBar.appendChild(kfC);
    const tc = h('span.tc');
    const tbtn = (icon, title, fn) => { const b = h('button.tb', { title, html: KC.icon(icon) }); b.addEventListener('click', fn); return b; };
    const animChk = KC.ui.check('Animer (créer des images-clés)', Wn.animate, v => { Wn.animate = v; });
    const tools = h('div.pc-tools',
      tbtn('kf-prev', 'Image-clé précédente', () => jumpKf(-1)),
      tbtn('kf-add', 'Ajouter une image-clé au curseur', () => { const tau = localT(); KC.edit('Ajouter une image-clé', () => { const at = FX.pcAt(getEv().pc, tau); if (!getEv().pc) getEv().pc = { kf: [FX.pcDefault()] }; if (!getEv().pc.kf.some(k => Math.abs(k.t - tau) < 0.5 / P.fps())) { getEv().pc.kf.push({ ...at, t: tau }); getEv().pc.kf.sort((a, b) => a.t - b.t); } }); }),
      tbtn('kf-del', 'Supprimer l\'image-clé au curseur', () => { const tau = localT(); const e = getEv(); if (!e.pc || e.pc.kf.length < 2) return; KC.edit('Supprimer une image-clé', () => { e.pc.kf = e.pc.kf.filter(k => Math.abs(k.t - tau) >= 0.5 / P.fps()); if (!e.pc.kf.length) e.pc.kf = [FX.pcDefault()]; }); }),
      tbtn('kf-next', 'Image-clé suivante', () => jumpKf(1)),
      tc, h('span.sp'), animChk);
    w.content.append(h('div.pc-wrap', stage, side), kfBar, tools);
    const getEv = () => P.event(ev.id);
    const localT = () => { const e = getEv(); return U.clamp(P.snapFrame(E.time - e.start), 0, e.length); };
    const srcDims = () => {
      const e = getEv(), s = KC.project.settings;
      if (e.gen) return [s.width, s.height];
      const m = P.media(e.media); return [m.width || s.width, m.height || s.height];
    };
    function jumpKf(dir) {
      const e = getEv(); if (!e.pc) return;
      const tau = localT();
      const ks = e.pc.kf.map(k => k.t);
      const t = dir < 0 ? ks.filter(x => x < tau - 1e-6).pop() : ks.find(x => x > tau + 1e-6);
      if (t != null) E.seek(e.start + t);
    }
    // vue : source entière + cadre (ce qui sera visible)
    let geo = null;
    function draw() {
      const e = getEv(); if (!e) return;
      const dpr = window.devicePixelRatio || 1;
      const r = stage.getBoundingClientRect();
      cvs.width = Math.max(1, r.width * dpr); cvs.height = Math.max(1, r.height * dpr);
      const x = cvs.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = '#0b0c0e'; x.fillRect(0, 0, r.width, r.height);
      const [sw, sh] = srcDims(), s = KC.project.settings;
      const tau = localT(), pc = FX.pcAt(e.pc, tau);
      // le cadre de sortie exprimé dans la source : largeur = W / (fit*zoom)
      const fit = Math.min(s.width / sw, s.height / sh);
      const fw = s.width / (fit * pc.zoom), fh = s.height / (fit * pc.zoom);
      const span = Math.max(sw, sh, fw * 1.15, fh * 1.15) * 1.25;
      const k = Math.min(r.width / span, r.height / span * (sw / sh > 1 ? 1 : 1));
      const ox = r.width / 2 - sw * k / 2, oy = r.height / 2 - sh * k / 2;
      geo = { k, ox, oy, sw, sh, fw, fh, pc, fit };
      // source
      x.save();
      x.fillStyle = '#20232b'; x.fillRect(ox, oy, sw * k, sh * k);
      const src = sourceImage(e);
      if (src) { try { x.drawImage(src, ox, oy, sw * k, sh * k); } catch { /* source pas prête */ } }
      x.restore();
      // cadre
      const cxp = ox + pc.cx * sw * k, cyp = oy + pc.cy * sh * k;
      x.save();
      x.translate(cxp, cyp); x.rotate(-pc.rot * Math.PI / 180);
      x.fillStyle = 'rgba(0,0,0,.0)';
      x.strokeStyle = '#ffffff'; x.lineWidth = 1.5; x.setLineDash([6, 4]);
      x.strokeRect(-fw * k / 2, -fh * k / 2, fw * k, fh * k);
      x.setLineDash([]);
      // grand « F » de Vegas pour l'orientation
      x.fillStyle = 'rgba(255,255,255,.18)'; x.font = `700 ${Math.max(12, fh * k * 0.5)}px Outfit, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('F', 0, 0);
      // poignées
      x.fillStyle = '#fff';
      for (const [px, py] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]) x.fillRect(px * fw * k / 2 - 4, py * fh * k / 2 - 4, 8, 8);
      x.beginPath(); x.arc(0, -fh * k / 2 - 18, 5, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(0, -fh * k / 2); x.lineTo(0, -fh * k / 2 - 13); x.stroke();
      x.restore();
      drawKf();
      tc.textContent = U.fmtTime(tau, P.fps());
    }
    function sourceImage(e) {
      if (e.gen) { const c = U.canvas(640, 640 * KC.project.settings.height / KC.project.settings.width); FX.renderGen(e.gen, c); return c; }
      const m = P.media(e.media); if (!m) return null;
      if (m.kind === 'image') return KC.media.get(m).img;
      return KC.media.thumbAt(m, E.srcTime(e, U.clamp(E.time, e.start, e.start + e.length - 0.001)));
    }
    function drawKf() {
      const e = getEv();
      const dpr = window.devicePixelRatio || 1;
      const r = kfBar.getBoundingClientRect();
      kfC.width = Math.max(1, r.width * dpr); kfC.height = Math.max(1, r.height * dpr);
      const x = kfC.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, r.width, r.height);
      const pad = 14, ww = r.width - pad * 2;
      x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect(pad, 18, ww, 14);
      const tx = t => pad + t / e.length * ww;
      const kf = e.pc && e.pc.kf ? e.pc.kf : [FX.pcDefault()];
      x.strokeStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.moveTo(pad, 25); x.lineTo(pad + ww, 25); x.stroke();
      for (const k of kf) {
        const px = tx(k.t);
        x.fillStyle = '#e8a33a';
        x.beginPath(); x.moveTo(px, 18); x.lineTo(px + 6, 25); x.lineTo(px, 32); x.lineTo(px - 6, 25); x.closePath(); x.fill();
      }
      const cpx = tx(localT());
      x.fillStyle = '#fff'; x.fillRect(cpx, 4, 1.5, r.height - 8);
      x.font = '10px Consolas, monospace'; x.fillStyle = '#8a93a3'; x.textBaseline = 'top';
      x.fillText('0', pad, 34); x.textAlign = 'right'; x.fillText(U.fmtTime(e.length, P.fps()), pad + ww, 34); x.textAlign = 'left';
    }
    kfC.addEventListener('pointerdown', e => {
      const ev0 = getEv();
      const r = kfBar.getBoundingClientRect(); const pad = 14, ww = r.width - pad * 2;
      const tAt = cx => U.clamp((cx - r.left - pad) / ww, 0, 1) * ev0.length;
      const kf = ev0.pc && ev0.pc.kf ? ev0.pc.kf : null;
      const near = kf && kf.find(k => Math.abs(pad + k.t / ev0.length * ww - (e.clientX - r.left)) < 7);
      if (e.button === 2 && near) {
        KC.context(e, [
          ...Object.entries(FX.EASES).map(([k, l]) => ({ label: 'Interpolation : ' + l, checked: (near.ease || 'linear') === k, action: () => KC.edit('Interpolation', () => { near.ease = k; }) })),
          '-',
          { label: 'Supprimer l\'image-clé', icon: 'trash', disabled: kf.length < 2, action: () => KC.edit('Supprimer une image-clé', () => { ev0.pc.kf = kf.filter(k => k !== near); }) },
        ]);
        return;
      }
      if (near && near.t > 0) {
        KC.begin();
        U.drag(e, (dx, dy, mv) => { near.t = P.snapFrame(U.clamp(tAt(mv.clientX), 1 / P.fps(), ev0.length)); ev0.pc.kf.sort((a, b) => a.t - b.t); E.seek(ev0.start + near.t); }, () => KC.commit('Déplacer une image-clé'));
        return;
      }
      E.seek(ev0.start + tAt(e.clientX));
      U.drag(e, (dx, dy, mv) => E.seek(ev0.start + tAt(mv.clientX)));
    });
    kfC.addEventListener('contextmenu', e => e.preventDefault());
    // manipulation du cadre
    cvs.addEventListener('pointerdown', e => {
      if (!geo || e.button !== 0) return;
      const ev0 = getEv();
      const r = stage.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const { k, ox, oy, sw, sh, fw, fh, pc } = geo;
      const cxp = ox + pc.cx * sw * k, cyp = oy + pc.cy * sh * k;
      const a = pc.rot * Math.PI / 180;
      // coordonnées dans le repère du cadre
      const lx = Math.cos(a) * (mx - cxp) - Math.sin(a) * (my - cyp) * -1;
      const ly0 = (mx - cxp) * Math.sin(a) + (my - cyp) * Math.cos(a);
      const rx = (mx - cxp) * Math.cos(-a) - (my - cyp) * Math.sin(-a), ry = (mx - cxp) * Math.sin(-a) + (my - cyp) * Math.cos(-a);
      void lx; void ly0;
      const hw = fw * k / 2, hh = fh * k / 2;
      const tau = localT();
      let mode = 'move';
      if (Math.hypot(rx, ry + hh + 18) < 9) mode = 'rot';
      else if (Math.abs(Math.abs(rx) - hw) < 8 || Math.abs(Math.abs(ry) - hh) < 8) { if (Math.abs(rx) <= hw + 8 && Math.abs(ry) <= hh + 8) mode = 'size'; }
      const p0 = { ...pc };
      KC.begin();
      U.drag(e, (dx, dy, mv) => {
        const e2 = getEv();
        if (mode === 'move') {
          Wn.pcSet(e2, tau, { cx: p0.cx + dx / k / sw, cy: p0.cy + dy / k / sh });
        } else if (mode === 'size') {
          const nx = mv.clientX - r.left - cxp, ny = mv.clientY - r.top - cyp;
          const d0 = Math.hypot(mx - cxp, my - cyp), d1 = Math.hypot(nx, ny);
          Wn.pcSet(e2, tau, { zoom: U.clamp(p0.zoom * d0 / Math.max(1, d1), 0.05, 40) });
        } else {
          const ang0 = Math.atan2(my - cyp, mx - cxp), ang1 = Math.atan2(mv.clientY - r.top - cyp, mv.clientX - r.left - cxp);
          let rot = p0.rot - (ang1 - ang0) * 180 / Math.PI;
          if (mv.shiftKey) rot = Math.round(rot / 15) * 15;
          Wn.pcSet(e2, tau, { rot: Math.round(rot * 10) / 10 });
        }
        E.redraw(); draw(); renderSide();
      }, () => KC.commit('Panoramique/Recadrage'));
    });
    cvs.addEventListener('wheel', e => {
      e.preventDefault();
      const tau = localT(), pc = FX.pcAt(getEv().pc, tau);
      KC.edit('Panoramique/Recadrage', () => Wn.pcSet(getEv(), tau, { zoom: U.clamp(pc.zoom * Math.pow(1.0015, -e.deltaY), 0.05, 40) }));
    }, { passive: false });
    // panneau latéral
    function renderSide() {
      const e = getEv(); if (!e) return;
      const tau = localT(), pc = FX.pcAt(e.pc, tau);
      side.innerHTML = '';
      const s = KC.project.settings;
      side.appendChild(h('div', { style: { fontWeight: 600, marginBottom: '6px' }, text: 'Position et cadrage' }));
      const defs = [
        { k: 'cx', label: 'Centre X', min: -1, max: 2, step: 0.001, def: 0.5 },
        { k: 'cy', label: 'Centre Y', min: -1, max: 2, step: 0.001, def: 0.5 },
        { k: 'zoom', label: 'Zoom', min: 0.05, max: 8, step: 0.01, def: 1 },
        { k: 'rot', label: 'Rotation', min: -360, max: 360, step: 0.5, def: 0 },
      ];
      let began = false;
      for (const d of defs) side.appendChild(KC.ui.param(d, pc[d.k], v => { if (!began) { KC.begin(); began = true; } Wn.pcSet(getEv(), tau, { [d.k]: v }); E.redraw(); draw(); }, () => { if (began) { began = false; KC.commit('Panoramique/Recadrage'); } }));
      const btn = (label, fn) => { const b = h('button.btn.small', { text: label, style: { width: '100%', marginTop: '6px' } }); b.addEventListener('click', fn); return b; };
      const [sw, sh] = srcDims();
      const fillZoom = Math.max(s.width / sw, s.height / sh) / Math.min(s.width / sw, s.height / sh);
      side.append(
        h('div', { style: { height: '8px' } }),
        btn('Centrer', () => KC.edit('Centrer', () => Wn.pcSet(getEv(), tau, { cx: 0.5, cy: 0.5 }))),
        btn('Ajuster au cadre (bandes noires)', () => KC.edit('Ajuster au cadre', () => Wn.pcSet(getEv(), tau, { zoom: 1, cx: 0.5, cy: 0.5 }))),
        btn('Remplir le cadre (recadrer)', () => KC.edit('Remplir le cadre', () => Wn.pcSet(getEv(), tau, { zoom: fillZoom, cx: 0.5, cy: 0.5 }))),
        btn('Effet Ken Burns (zoom lent)', () => KC.edit('Effet Ken Burns', () => { const e2 = getEv(); e2.pc = { kf: [{ ...FX.pcDefault(), zoom: fillZoom, ease: 'linear' }, { ...FX.pcDefault(), t: e2.length, zoom: fillZoom * 1.18, cx: 0.53, cy: 0.47 }] }; })),
        btn('Réinitialiser tout', () => KC.edit('Réinitialiser le panoramique', () => { getEv().pc = null; })),
        h('div.note', { style: { marginTop: '12px' }, text: 'Le cadre pointillé montre la zone visible. Glissez-le pour déplacer, tirez un bord pour zoomer, la pastille du haut pour tourner (Maj = pas de 15°). Molette = zoom.' }),
      );
      const kfCount = e.pc && e.pc.kf ? e.pc.kf.length : 1;
      side.appendChild(h('div.note', { style: { marginTop: '8px' }, text: kfCount > 1 ? kfCount + ' images-clés : le cadre est animé.' : 'Cochez « Animer » ou ajoutez une image-clé pour créer un mouvement.' }));
    }
    w.onResize = draw;
    w._onChange = () => { if (!getEv()) return w.close(); w.setTitle('Panoramique/Recadrage de l\'événement', P.eventName(getEv())); draw(); renderSide(); };
    KC.on('change', w._onChange);
    const onTime = () => { draw(); renderSide(); };
    KC.on('time', onTime);
    KC.on('media-updated', draw);
    const oldClose = w.close;
    w.close = () => { KC.off('time', onTime); KC.off('media-updated', draw); oldClose(); };
    // placer le curseur dans l'événement
    const e0 = getEv();
    if (E.time < e0.start || E.time >= e0.start + e0.length) E.seek(e0.start);
    new ResizeObserver(draw).observe(stage);
    setTimeout(() => { draw(); renderSide(); }, 30);
    return w;
  };

  /* ------------------------------------------------------------ titres et générateurs */
  let fontList = null;
  const loadFonts = async () => { if (!fontList) fontList = await KC.native.listFonts().catch(() => []); return fontList; };
  Wn.generator = async (ev) => {
    const key = 'gen:' + ev.id;
    const g0 = ev.gen;
    const isText = g0.type === 'text';
    const w = Wn.float({ key, title: isText ? 'Titres et texte' : 'Générateur de médias', sub: isText ? '' : (FX.GENERATORS[g0.type] ? FX.GENERATORS[g0.type].name : ''), width: isText ? 520 : 420, height: isText ? 640 : 330 });
    const body = h('div.fx-params');
    w.content.appendChild(body);
    const getEv = () => P.event(ev.id);
    let began = false;
    const live = (fn) => { if (!began) { KC.begin(); began = true; } fn(getEv().gen); E.redraw(); KC.timeline.redraw(); };
    const commit = () => { if (began) { began = false; KC.commit('Modifier le générateur'); } };
    const fonts = isText ? await loadFonts() : [];
    const render = () => {
      const e = getEv(); if (!e) return w.close();
      const g = e.gen;
      body.innerHTML = '';
      const f = h('div.form', { style: { gridTemplateColumns: '120px 1fr' } });
      const add = (label, ctl) => { f.append(h('label', { text: label }), ctl); };
      const color = (k) => { const c = h('input', { type: 'color', value: g[k] }); c.addEventListener('input', () => live(gg => { gg[k] = c.value; })); c.addEventListener('change', commit); return c; };
      const rng = (k, min, max, step) => { const d = { k, label: '', min, max, step, def: g[k] }; const r = KC.ui.param(d, g[k], v => live(gg => { gg[k] = v; }), commit); r.style.gridTemplateColumns = '1fr 64px'; r.firstChild.remove(); return r; };
      if (g.type === 'text') {
        const ta = h('textarea.field', { rows: 3, value: g.text, style: { width: '100%', fontSize: '14px' } });
        ta.addEventListener('input', () => live(gg => { gg.text = ta.value; }));
        ta.addEventListener('change', commit);
        ta.addEventListener('keydown', e2 => e2.stopPropagation());
        f.appendChild(h('div.full', ta));
        const fsel = KC.ui.select([...new Set(['Outfit', 'Segoe UI', 'Arial', 'Impact', 'Georgia', 'Consolas', ...fonts])], g.font, v => { live(gg => { gg.font = v; }); commit(); });
        add('Police', fsel);
        const st = h('div.row');
        const b = KC.ui.check('Gras', g.bold, v => { live(gg => { gg.bold = v; }); commit(); });
        const it = KC.ui.check('Italique', g.italic, v => { live(gg => { gg.italic = v; }); commit(); });
        const al = KC.ui.select([['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite']], g.align, v => { live(gg => { gg.align = v; }); commit(); });
        st.append(b, it, al);
        add('Style', st);
        add('Taille', rng('size', 0.01, 0.4, 0.001));
        add('Couleur', color('color'));
        add('Position X', rng('x', 0, 1, 0.001));
        add('Position Y', rng('y', 0, 1, 0.001));
        add('Interligne', rng('lineHeight', 0.7, 2.5, 0.01));
        add('Espacement', rng('spacing', -0.1, 0.5, 0.005));
        f.appendChild(h('div.group-title', { text: 'Contour et ombre' }));
        add('Contour', rng('outline', 0, 0.02, 0.0005));
        add('Couleur contour', color('outlineColor'));
        add('Ombre', KC.ui.check('Ombre portée', g.shadow, v => { live(gg => { gg.shadow = v; }); commit(); }));
        add('Couleur ombre', color('shadowColor'));
        add('Flou ombre', rng('shadowBlur', 0, 0.05, 0.001));
        f.appendChild(h('div.group-title', { text: 'Fond' }));
        add('Fond', KC.ui.check('Afficher un bandeau', g.box, v => { live(gg => { gg.box = v; }); commit(); }));
        add('Couleur fond', color('boxColor'));
        add('Opacité fond', rng('boxAlpha', 0, 1, 0.01));
        add('Marge', rng('boxPad', 0, 0.1, 0.001));
        f.appendChild(h('div.group-title', { text: 'Animation' }));
        add('Animation', KC.ui.select(Object.entries(FX.textAnims), g.anim || 'none', v => KC.edit('Animation du texte', () => FX.applyTextAnim(getEv(), v))));
        f.appendChild(h('div.note.full', { text: 'Les animations utilisent le panoramique et les fondus de l\'événement : vous pouvez les retoucher ensuite.' }));
      } else if (g.type === 'solid') {
        add('Couleur', color('color'));
      } else if (g.type === 'gradient') {
        add('Couleur 1', color('c1'));
        add('Couleur 2', color('c2'));
        add('Angle', rng('angle', 0, 360, 1));
        add('Radial', KC.ui.check('Dégradé circulaire', g.radial, v => { live(gg => { gg.radial = v; }); commit(); }));
      } else if (g.type === 'checker') {
        add('Couleur 1', color('c1'));
        add('Couleur 2', color('c2'));
        add('Taille', rng('size', 0.01, 0.3, 0.001));
      }
      body.appendChild(f);
    };
    w._onChange = (info) => { if (info && info.silent) return; if (!getEv()) return w.close(); if (!began) render(); };
    KC.on('change', w._onChange);
    render();
    const e0 = getEv();
    if (E.time < e0.start || E.time >= e0.start + e0.length) E.seek(e0.start + Math.min(e0.length / 2, 1));
    return w;
  };
})();
