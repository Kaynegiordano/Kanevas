// Espaces intégrés : ComfyUI, Wallpaper (Wallpaper Engine Animator) et Vidéo (KaneClip), à côté de l'Édition et du
// Studio IA. Chaque espace garde sa page (son propre cadre, jamais rechargé en changeant d'espace) ; Kanevas démarre
// les serveurs (ou reprend ceux de Kane OS) et fait passer les images d'un espace à l'autre.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd, N = KS.native;
  if (!N || !N.svcStatus) return;
  const D = () => KS.state.doc;
  const WS = {
    comfyui: { label: 'ComfyUI', icon: 'grid', svc: true, auto: false,
      help: 'Graphes de ComfyUI (vidéo Wan, workflows…). Les modèles sont ceux de Kane OS ; les sorties vont dans output\\comfyui.' },
    wallpaper: { label: 'Wallpaper', icon: 'sparkles', svc: true, auto: true,
      help: 'Wallpaper Engine Animator : peignez ce qui bouge, Animer, puis Vidéo. Le fond sous les découpes est redessiné par le moteur Forge de Kanevas.' },
    video: { label: 'Vidéo', icon: 'play', svc: false,
      help: 'KaneClip : montage vidéo (ffmpeg). Les images et vidéos des autres espaces s\'ajoutent sur la timeline.' },
  };
  const WX = KS.ws = { cur: null, el: {}, st: {}, next: {} };
  let host = null;
  const pngBytes = async c => new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer());
  const kcm = p => 'kcm://f/' + encodeURIComponent(p);
  const fileBytes = async p => new Uint8Array(await (await fetch(kcm(p))).arrayBuffer());
  const base = p => String(p).split(/[\\/]/).pop();

  /* ---------------------------------------------------------------- page de chaque espace */
  function build(id) {
    if (WX.el[id]) return WX.el[id];
    const W = WS[id];
    const bar = h('div.wx-bar'), frameBox = h('div.wx-frame'), side = h('aside.wx-side', { hidden: true });
    const sec = h('section.wx-ws', { 'data-ws': id }, bar, h('div.wx-body', frameBox, side));
    host.appendChild(sec);
    WX.el[id] = { sec, bar, frameBox, side, frame: null };
    renderBar(id); renderFrame(id);
    return WX.el[id];
  }
  const stateText = s => !s ? '…' : s.state === 'ready' ? 'Démarré par Kanevas' : s.state === 'external' ? 'Lancé par Kane OS' : s.state === 'starting' ? 'Démarrage…' : s.state === 'error' ? 'Erreur' : s.found === false ? 'Introuvable' : 'Arrêté';
  const isUp = s => s && (s.state === 'ready' || s.state === 'external');
  function renderBar(id) {
    const E = WX.el[id]; if (!E) return;
    const W = WS[id], s = WX.st[id];
    const items = [h('span.wx-title', h('span', { html: KS.icon(W.icon) }), h('b', { text: W.label }), E.title ? h('span.wx-sub', { text: E.title }) : null)];
    if (W.svc) {
      items.push(h('span.wx-state', h('span.fx-dot' + (isUp(s) ? '.ok' : s && s.state === 'starting' ? '.busy' : '')), h('span', { text: stateText(s) })));
      if (!isUp(s) && !(s && s.state === 'starting')) items.push(ui.btn('Démarrer', () => startSvc(id), '.small.primary', 'play'));
      if (s && s.ours && (isUp(s) || s.state === 'starting')) items.push(ui.btn('Arrêter', () => stopSvc(id), '.small', 'close'));
      items.push(ui.iconBtn('history', 'Journal', () => showLog(id), '.sm'));
    }
    items.push(h('span.wx-sep'));
    if (id === 'comfyui') items.push(ui.btn('Envoyer l\'image du document', () => C.toComfy(), '.small', 'image'));
    if (id === 'wallpaper') items.push(ui.btn('Animer l\'image du document', () => C.toWallpaper(), '.small', 'image'));
    if (id === 'video') items.push(ui.btn('Ajouter l\'image du document', () => C.toVideo(), '.small', 'image'));
    items.push(h('div.spacer'));
    if (id === 'wallpaper' && s && s.forge) items.push(h('span.wx-note', { text: 'Rebouchage : ' + (s.forge.includes(':7860') ? 'Forge de Kane OS' : 'moteur Forge de Kanevas') }));
    if (id !== 'video') items.push(ui.btn(id === 'wallpaper' ? 'Vidéos exportées' : 'Sorties', () => toggleSide(id), '.small' + (E.side.hidden ? '' : '.on'), 'folder-open'));
    if (id !== 'video') items.push(ui.iconBtn('folder-open', 'Ouvrir le dossier', () => N.svcOpenFolder(id), '.sm'));
    if (id !== 'video' && isUp(s)) items.push(ui.iconBtn('history', 'Recharger la page', () => { if (E.frame) E.frame.src = E.frame.src; }, '.sm'));
    E.bar.replaceChildren(...items);
  }
  async function frameUrl(id) {
    if (id === 'video') return N.kcUrl();
    const s = WX.st[id];
    if (WX.next[id]) { const u = WX.next[id]; delete WX.next[id]; return u; }
    return s ? s.url : '';
  }
  async function renderFrame(id) {
    const E = WX.el[id], W = WS[id], s = WX.st[id];
    if (W.svc && !isUp(s)) {
      if (E.frame) { E.frame.remove(); E.frame = null; }
      const msg = !s ? 'Lecture…' : s.state === 'starting' ? W.label + ' démarre…' : s.state === 'error' ? s.error : s.found === false ? W.label + ' est introuvable : ' + s.dir : W.label + ' n\'est pas démarré.';
      E.frameBox.replaceChildren(h('div.wx-empty', h('div.wx-icon', { html: KS.icon(W.icon) }), h('b', { text: W.label }), h('p', { text: W.help }), h('p.wx-msg', { text: msg }),
        s && s.state !== 'starting' && s.found !== false ? ui.btn('Démarrer ' + W.label, () => startSvc(id), '.primary', 'play') : null,
        s && s.state === 'starting' ? h('div.spin') : null));
      return;
    }
    if (E.frame) return;
    const url = await frameUrl(id);
    const f = h('iframe.wx-iframe', { src: url, allow: 'clipboard-read; clipboard-write; autoplay; fullscreen', title: W.label });
    E.frame = f;
    E.frameBox.replaceChildren(f);
  }

  /* ---------------------------------------------------------------- serveurs */
  async function refresh(id) { if (!WS[id].svc) return null; try { WX.st[id] = await N.svcStatus(id); } catch { /* rien */ } renderBar(id); if (WX.el[id]) renderFrame(id); return WX.st[id]; }
  async function startSvc(id) {
    WX.st[id] = await N.svcStart(id);
    renderBar(id); if (WX.el[id]) renderFrame(id);
    return waitUp(id);
  }
  function waitUp(id, ms = 600000) {
    return new Promise(res => {
      const t0 = Date.now();
      const tick = async () => {
        const s = WX.st[id];
        if (isUp(s)) return res(true);
        if (s && (s.state === 'error' || s.state === 'off') && Date.now() - t0 > 3000) return res(false);
        if (Date.now() - t0 > ms) return res(false);
        setTimeout(tick, 800);
      };
      tick();
    });
  }
  async function stopSvc(id) { WX.st[id] = await N.svcStop(id); renderBar(id); if (WX.el[id]) renderFrame(id); }
  async function showLog(id) {
    const pre = h('pre.eg-log', { text: await N.svcLog(id) || '(vide)' });
    KS.modal({ title: 'Journal : ' + WS[id].label, width: 820, body: pre, buttons: [{ label: 'Fermer', primary: true }] });
    setTimeout(() => { pre.scrollTop = pre.scrollHeight; }, 30);
  }
  N.onSvc(s => { WX.st[s.id] = s; renderBar(s.id); if (WX.el[s.id]) renderFrame(s.id); });

  /* ---------------------------------------------------------------- sorties à reprendre */
  async function toggleSide(id) {
    const E = WX.el[id];
    E.side.hidden = !E.side.hidden;
    renderBar(id);
    if (!E.side.hidden) fillSide(id);
  }
  async function fillSide(id) {
    const E = WX.el[id];
    E.side.replaceChildren(h('div.wx-side-h', h('b', { text: id === 'wallpaper' ? 'Vidéos exportées' : 'Sorties récentes' }), h('div.spacer'), ui.iconBtn('history', 'Actualiser', () => fillSide(id), '.sm')), h('div.note', { text: 'Lecture…' }));
    const list = await N.svcOutputs(id, 80);
    const grid = h('div.wx-grid');
    for (const it of list) {
      const thumb = it.video ? h('video', { src: kcm(it.path), muted: true, preload: 'metadata' }) : h('img', { src: kcm(it.path), alt: '', loading: 'lazy' });
      const cell = h('button.wx-cell', { title: it.name + '\n' + new Date(it.mtime).toLocaleString() }, thumb, it.video ? h('span.wx-badge', { text: '▶' }) : null);
      if (it.video) { cell.addEventListener('mouseenter', () => thumb.play().catch(() => {})); cell.addEventListener('mouseleave', () => thumb.pause()); }
      cell.addEventListener('click', () => { const r = cell.getBoundingClientRect(); ui.menu(outputMenu(it), r.left, r.bottom + 4); });
      grid.appendChild(cell);
    }
    E.side.replaceChildren(E.side.firstChild, list.length ? grid : h('div.note', { text: id === 'wallpaper' ? 'Aucune vidéo exportée (bouton « Vidéo » d\'un projet animé).' : 'Aucune sortie dans output\\comfyui.' }));
  }
  function outputMenu(it) {
    const img = !it.video;
    return [
      { head: it.name },
      { label: 'Ouvrir dans l\'Édition', icon: 'file-plus', disabled: !img, action: () => openImage(it) },
      { label: 'Ajouter en calque au document', icon: 'layers', disabled: !img || !D(), action: () => addLayer(it) },
      { label: 'Envoyer au Studio IA (Img2Img)', icon: 'adjust', disabled: !img || !KS.studioApi, action: () => toStudio(it, 'img2img') },
      { label: 'Envoyer au Studio IA (Extras)', icon: 'upscale', disabled: !img || !KS.studioApi, action: () => toStudio(it, 'extras') },
      { label: 'Ajouter à la Vidéo', icon: 'play', action: () => toVideoFiles([it.path]) },
      { sep: true },
      { label: 'Afficher dans l\'Explorateur', icon: 'folder-open', action: () => N.showInFolder(it.path) },
    ];
  }
  const canvasOf = async it => KS.io.canvasFromEntry({ name: it.name, data: await fileBytes(it.path) });
  async function openImage(it) { await KS.io.openEntry({ name: it.name, data: await fileBytes(it.path), path: null }); go(null); }
  async function addLayer(it) {
    const d = D(); if (!d) return;
    const c = await canvasOf(it);
    KS.io.placeCanvas(d, c, it.name.replace(/\.[^.]+$/, ''), c.width <= d.width && c.height <= d.height ? { x: Math.round((d.width - c.width) / 2), y: Math.round((d.height - c.height) / 2) } : null);
    go(null);
  }
  async function toStudio(it, target) {
    const data = await fileBytes(it.path);
    let info = '';
    try { info = (await KS.png.readText(data)).parameters || ''; } catch { /* pas un PNG */ }
    const c = await KS.io.canvasFromEntry({ name: it.name, data });
    go(null);
    KS.studioApi.sendCanvas(c, info, target);
  }

  /* ---------------------------------------------------------------- envois depuis l'Édition */
  const docImage = async () => {
    const d = D(); if (!d) { KS.toast('Ouvrez d\'abord une image', 'info'); return null; }
    let bytes = await pngBytes(d.composite());
    if (d.genInfo && KS.png) bytes = KS.png.writeText(bytes, 'parameters', d.genInfo);
    return { name: d.name.replace(/\.[^.]+$/, ''), bytes };
  };
  const ensureUp = async id => {
    const s = await refresh(id);
    if (isUp(s)) return true;
    if (s && s.found === false) { KS.toast(WS[id].label + ' est introuvable : ' + s.dir, 'err', 6000); return false; }
    const ok = await KS.gen.task('Démarrage de ' + WS[id].label + '…', () => startSvc(id));
    if (!ok) KS.toast(WS[id].label + ' n\'a pas démarré : ' + ((WX.st[id] && WX.st[id].error) || 'voir le journal'), 'err', 7000);
    return ok;
  };
  C.toComfy = async () => {
    const im = await docImage(); if (!im) return;
    if (!(await ensureUp('comfyui'))) return;
    const r = await N.comfyUpload(im.name, im.bytes);
    if (!r.ok) return KS.toast('ComfyUI : ' + r.error, 'err', 6000);
    try { await navigator.clipboard.writeText(r.name); } catch { /* presse-papiers indisponible */ }
    go('comfyui');
    KS.toast('Image envoyée à ComfyUI : « ' + r.name + ' » (choisissez-la dans un nœud Load Image ; nom copié)', 'ok', 6000);
  };
  C.toWallpaper = async () => {
    const im = await docImage(); if (!im) return;
    if (!(await ensureUp('wallpaper'))) return;
    const r = await N.weaNew(im.name, im.bytes);
    if (!r.ok) return KS.toast('Wallpaper : ' + r.error, 'err', 6000);
    const u = WX.st.wallpaper.url + '?kv_projet=' + encodeURIComponent(r.dossier);
    if (WX.el.wallpaper && WX.el.wallpaper.frame) WX.el.wallpaper.frame.src = u;
    else { WX.next.wallpaper = u; build('wallpaper'); }
    go('wallpaper');
    KS.toast('Projet « ' + r.dossier + ' » créé : peignez ce qui doit bouger, puis « 2. Animer »', 'ok', 5000);
  };
  async function toVideoFiles(paths) {
    const r = await N.kcOpen(paths);
    go('video');
    if (r.ok && r.count) KS.toast(r.count + ' média(s) ajouté(s) à la timeline', 'ok', 2500);
  }
  C.toVideo = async () => {
    const im = await docImage(); if (!im) return;
    const p = await N.kcStage(im.name, im.bytes);
    toVideoFiles([p]);
  };

  /* ---------------------------------------------------------------- bascule entre les espaces */
  function go(id) {
    if (id && !WS[id]) return;
    if (id && KS.studio && KS.studio.on) C.toggleStudio(false);
    WX.cur = id;
    document.body.classList.toggle('ws-ext', !!id);
    if (id) {
      build(id);
      for (const k in WX.el) WX.el[k].sec.hidden = k !== id;
      refresh(id).then(s => { if (WS[id].svc && WS[id].auto && s && !isUp(s) && s.state !== 'starting' && s.state !== 'error' && s.found !== false) startSvc(id); });
    }
    KS.prefs.workspace = id || ''; KS.prefs.save();
    syncButtons();
    window.dispatchEvent(new Event('resize'));
  }
  C.workspace = go;
  const btns = [];
  function syncButtons() {
    const cur = WX.cur || (KS.studio && KS.studio.on ? 'studio' : 'edit');
    document.querySelectorAll('.ws-switch .ws-btn[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === cur));
  }
  // les boutons Édition / Studio IA quittent aussi l'espace intégré
  const toggle0 = C.toggleStudio;
  C.toggleStudio = async (on) => {
    if (WX.cur) { WX.cur = null; document.body.classList.remove('ws-ext'); KS.prefs.workspace = ''; }
    const r = await toggle0(on);
    syncButtons();
    return r;
  };
  KS.on('studio', () => setTimeout(syncButtons, 0));
  KS.on('ui-ready', () => setTimeout(() => {
    host = h('section#ws-ext');
    KS.$('#main').appendChild(host);
    const sw = document.querySelector('.ws-switch'); if (!sw) return;
    for (const [id, W] of Object.entries(WS)) {
      const b = h('button.ws-btn', { 'data-v': id, text: W.label, title: W.help });
      b.addEventListener('click', () => go(id));
      btns.push(b); sw.appendChild(b);
    }
    window.addEventListener('message', e => {
      if (!e.data || typeof e.data !== 'object') return;
      const E = WX.el.video;
      if (e.data.kv === 'kc-title' && E && e.source === (E.frame && E.frame.contentWindow)) { E.title = e.data.title.replace(/\s*[—-]\s*KaneClip\s*$/, ''); renderBar('video'); }
    });
    for (const id of Object.keys(WS)) if (WS[id].svc) N.svcStatus(id).then(s => { WX.st[id] = s; });
    if (KS.prefs.workspace && WS[KS.prefs.workspace]) setTimeout(() => go(KS.prefs.workspace), 400);
    syncButtons();
  }, 0));
  // Fermeture de Kanevas : le montage peut demander d'enregistrer ; Wallpaper enregistre sa peinture
  KS.beforeClose = async () => {
    const W = WX.el.wallpaper;
    if (W && W.frame) { W.frame.remove(); W.frame = null; await new Promise(r => setTimeout(r, 600)); }
    const V = WX.el.video;
    if (!V || !V.frame || !V.frame.contentWindow) return true;
    go('video');
    return new Promise(res => {
      const on = e => { if (e.source === V.frame.contentWindow && e.data && e.data.kv === 'kc-close-ok') { window.removeEventListener('message', on); res(true); } };
      window.addEventListener('message', on);
      V.frame.contentWindow.postMessage({ kv: 'close-request' }, '*');
    });
  };
})();
