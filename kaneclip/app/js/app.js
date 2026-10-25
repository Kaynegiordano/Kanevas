// Démarrage : thème, disposition, projets (nouveau, ouvrir, enregistrer), sauvegarde automatique, fermeture.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, E = KC.engine, N = KC.native, C = KC.cmd;

  /* ------------------------------------------------------------ thème */
  KC.applyTheme = () => {
    const t = KC.prefs.theme || 'dark';
    document.body.className = 'theme-' + t;
    const cs = getComputedStyle(document.body);
    if (N) N.setTitleBar({ color: cs.getPropertyValue('--chrome').trim(), symbolColor: cs.getPropertyValue('--text-2').trim(), height: 36 });
    if (N) N.setZoom(KC.prefs.uiScale || 1);
    KC.emit('theme');
  };

  /* ------------------------------------------------------------ séparateurs */
  function splitters() {
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--dock-w', `clamp(280px, ${KC.prefs.dockW}px, 39vw)`);
      root.style.setProperty('--upper-h', KC.prefs.upperH ? `clamp(160px, ${KC.prefs.upperH}px, calc(100vh - 420px))` : 'min(46vh, calc(100vh - 420px))');
      root.style.setProperty('--header-w', KC.prefs.headerW + 'px');
    };
    apply();
    for (const s of KC.$$('.splitter')) {
      s.addEventListener('pointerdown', e => {
        e.preventDefault(); s.classList.add('drag');
        const which = s.dataset.split;
        const w0 = KC.$('#dock').offsetWidth, h0 = KC.$('#upper').offsetHeight;
        U.drag(e, (dx, dy) => {
          if (which === 'dock') KC.prefs.dockW = U.clamp(w0 + dx, 280, innerWidth * .39);
          else KC.prefs.upperH = U.clamp(h0 + dy, 160, innerHeight - 420);
          apply();
        }, () => { s.classList.remove('drag'); KC.prefs.save(); });
      });
    }
    // largeur des en-têtes de piste : bord droit de l'horloge
    const clock = KC.$('#tl-clock');
    const grip = h('div', { style: { position: 'absolute', right: '-3px', top: 0, bottom: 0, width: '6px', cursor: 'ew-resize', zIndex: 3 } });
    clock.appendChild(grip);
    grip.addEventListener('pointerdown', e => {
      e.preventDefault();
      const w0 = KC.prefs.headerW;
      U.drag(e, dx => { KC.prefs.headerW = U.clamp(w0 + dx, 190, 420); apply(); }, () => KC.prefs.save());
    });
  }

  /* ------------------------------------------------------------ titre et barre d'état */
  function updateTitle() {
    const p = KC.project;
    const name = p.path ? U.stripExt(U.base(p.path)) : 'Sans titre';
    const t = (p.dirty ? '● ' : '') + name + ' — KaneClip';
    KC.$('#doc-title').innerHTML = '';
    KC.$('#doc-title').append(h('b', { text: (p.dirty ? '● ' : '') + name }), document.createTextNode(p.path ? '  ·  ' + U.dir(p.path) : ''));
    if (N) N.setTitle(t);
    document.title = t;
  }
  function buildStatus() {
    const sb = KC.$('#statusbar');
    const msg = h('span', { text: 'Prêt' });
    const jobs = h('span.seg');
    const sel = h('span.seg');
    const upd = () => {
      const lp = KC.project.loop, fps = P.fps();
      sel.innerHTML = '';
      if (lp.out > lp.in) sel.append(h('span', { text: 'Sélection' }), h('b', { text: U.fmtTime(lp.in, fps) }), h('span', { text: '→' }), h('b', { text: U.fmtTime(lp.out, fps) }), h('span', { text: 'longueur' }), h('b', { text: U.fmtTime(lp.out - lp.in, fps) }));
      const n = KC.sel.ids.size;
      msg.textContent = n ? n + ' événement(s) sélectionné(s)' : KC.project.events.length + ' événement(s) · ' + KC.project.media.length + ' média(s)';
    };
    const updJobs = () => {
      jobs.innerHTML = '';
      const list = [...KC.jobs.values()].filter(j => j.label === 'proxy');
      if (list.length) jobs.append(h('span', { text: 'Création de proxys : ' + list.length }), h('span.prog', h('i', { style: { width: '40%' } })));
      for (const j of (KC.ai ? KC.ai.jobs.values() : [])) {
        const s = h('span', { text: 'IA ' + Math.floor(j.percent) + ' %', title: 'Cliquer pour afficher la progression', style: { cursor: 'pointer', color: 'var(--text-2)' } });
        s.addEventListener('click', () => KC.ai.showProgress(j));
        jobs.append(s, h('span.prog', h('i', { style: { width: j.percent.toFixed(1) + '%' } })));
      }
    };
    sb.append(msg, h('span.sp'), jobs, sel);
    KC.on('change', upd); KC.on('selection', upd); KC.on('loop', upd); KC.on('time-format', upd); KC.on('project-loaded', upd); KC.on('settings', upd);
    KC.on('jobs', updJobs);
    KC.on('ai-jobs', updJobs);
    upd();
  }

  /* ------------------------------------------------------------ projets */
  function setProject(p, path) {
    if (E.playing) E.stop();
    KC.project = p;
    p.path = path || null;
    p.dirty = false;
    KC.sel.ids.clear(); KC.sel.track = null;
    KC.resetHistory();
    E.time = p.cursor || 0;
    KC.emit('project-loaded');
    KC.emit('settings');
    KC.emit('change', { load: true });
    E.redraw();
    updateTitle();
    // préparer les médias (vignettes, ondes, proxys)
    for (const m of p.media) KC.media.prepare(m);
  }
  async function confirmDiscard() {
    if (!KC.project || !KC.project.dirty) return true;
    const r = await KC.modal({
      title: 'Enregistrer les modifications ?',
      body: h('div', { style: { width: '420px', lineHeight: '1.5' }, text: `Le projet « ${KC.project.path ? U.base(KC.project.path) : 'Sans titre'} » a des modifications non enregistrées.` }),
      buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Ne pas enregistrer', value: 'discard' }, { label: 'Enregistrer', primary: true, value: 'save' }],
      escValue: 'cancel',
    }).done;
    if (r === 'cancel') return false;
    if (r === 'save') return await C.saveProject();
    return true;
  }
  C.newProject = async () => {
    if (!(await confirmDiscard())) return;
    setProject(P.create());
    N.autosaveClear();
  };
  C.openProject = async (path) => {
    if (!path) {
      const r = await N.openDialog({ title: 'Ouvrir un projet', multi: false, filters: [{ name: 'Projet KaneClip', extensions: ['kcp'] }] });
      if (!r.length) return;
      path = r[0];
    }
    if (KC.project && KC.project.path && KC.project.path.toLowerCase() === path.toLowerCase() && !KC.project.dirty) return;
    if (!(await confirmDiscard())) return;
    const r = await N.readText(path);
    if (!r.ok) { KC.alert('Ouverture impossible', r.error); return; }
    let p;
    try { p = P.deserialize(r.text); } catch (e) { KC.alert('Ouverture impossible', e.message); return; }
    // médias déplacés : chercher à côté du projet
    for (const m of p.media) {
      if (await N.exists(m.path)) continue;
      const alt = U.dir(path) + '\\' + U.base(m.path);
      if (await N.exists(alt)) m.path = alt;
    }
    setProject(p, path);
    addRecent(path);
    const missing = [];
    for (const m of p.media) if (!(await N.exists(m.path))) missing.push(m.name);
    if (missing.length) KC.toast('Médias introuvables : ' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? '…' : '') + ' (clic droit > Remplacer)', 'err', 7000);
  };
  C.saveProject = async (saveAs = false) => {
    const p = KC.project;
    let path = p.path;
    if (!path || saveAs) {
      path = await N.saveDialog({ title: 'Enregistrer le projet', defaultPath: (p.path || ((await N.defaultDir('Projets')) + '\\' + (p.info.title || 'Sans titre') + '.kcp')), filters: [{ name: 'Projet KaneClip', extensions: ['kcp'] }] });
      if (!path) return false;
      if (!/\.kcp$/i.test(path)) path += '.kcp';
    }
    p.cursor = E.time;
    const r = await N.writeFile(path, P.serialize());
    if (!r.ok) { KC.alert('Enregistrement impossible', r.error); return false; }
    p.path = path; p.dirty = false;
    addRecent(path);
    updateTitle();
    N.autosaveClear();
    KC.toast('Projet enregistré', 'ok', 1500);
    return true;
  };
  function addRecent(path) {
    KC.prefs.recent = [path, ...KC.prefs.recent.filter(x => x.toLowerCase() !== path.toLowerCase())].slice(0, 10);
    KC.prefs.save();
  }

  /* ------------------------------------------------------------ sauvegarde automatique */
  let lastAuto = Date.now();
  setInterval(() => {
    const n = KC.prefs.autosave;
    if (!n || !KC.project || !KC.project.dirty) return;
    if (Date.now() - lastAuto < n * 60000) return;
    lastAuto = Date.now();
    KC.project.cursor = E.time;
    N.autosaveWrite(JSON.stringify({ path: KC.project.path, project: P.serialize() }));
  }, 15000);
  async function offerRecovery() {
    const a = await N.autosaveRead();
    if (!a) return false;
    let o;
    try { o = JSON.parse(a.text); } catch { N.autosaveClear(); return false; }
    const when = new Date(a.mtime).toLocaleString('fr-FR');
    const ok = await KC.confirm('Récupérer le projet ?', `KaneClip ne s'est pas fermé normalement. Une sauvegarde automatique du ${when}${o.path ? ' (' + U.base(o.path) + ')' : ''} est disponible.`, 'Récupérer');
    if (!ok) { N.autosaveClear(); return false; }
    try {
      const p = P.deserialize(o.project);
      setProject(p, o.path || null);
      p.dirty = true; updateTitle();
      return true;
    } catch (e) { KC.alert('Récupération impossible', e.message); return false; }
  }

  /* ------------------------------------------------------------ fichiers reçus (ligne de commande, glisser) */
  async function openPaths(paths) {
    const proj = paths.find(p => /\.kcp$/i.test(p));
    if (proj) { await C.openProject(proj); return; }
    const media = paths.filter(KC.media.isMedia);
    if (media.length) {
      const ms = await KC.busy(() => KC.media.import(media));
      if (ms.length) KC.timeline.placeMedias(ms, P.duration(), null);
    }
  }
  // dépôt de fichiers ailleurs que sur la timeline (fenêtre entière)
  window.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const paths = [...(e.dataTransfer.files || [])].map(f => N.pathForFile(f)).filter(Boolean);
    if (paths.length) openPaths(paths);
  });

  /* ------------------------------------------------------------ démarrage */
  let started = false;
  async function init() {
    if (started) return;
    started = true;
    if (!N) { document.body.innerHTML = '<p style="padding:40px">KaneClip doit être lancé dans son application.</p>'; return; }
    KC.project = P.create();
    KC.applyTheme();
    splitters();
    KC.menus.init();
    KC.timeline.init();
    KC.preview.init();
    KC.dock.init();
    KC.workspace.init();
    buildStatus();
    KC.on('dirty', updateTitle);
    KC.on('change', updateTitle);
    setProject(P.create());
    N.onCloseRequest(async () => {
      if (E.playing) E.stop();
      if (await confirmDiscard()) { await N.autosaveClear(); N.confirmClose(); }
    });
    N.onOpenPath(p => openPaths([p]));
    const ff = await N.ffAvailable();
    if (!ff.path) KC.alert('ffmpeg introuvable', 'KaneClip a besoin de ffmpeg pour lire les médias et faire le rendu. Installez-le (winget install Gyan.FFmpeg) puis relancez KaneClip.');
    const recovered = await offerRecovery();
    const pending = await N.getPending();
    if (pending.length && !recovered) openPaths(pending);
    KC.timeline.fit();
  }
  window.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
