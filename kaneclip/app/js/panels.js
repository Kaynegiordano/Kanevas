// Fenêtres ancrées : Médias du projet, Explorateur, Transitions, Effets, Générateurs, Découpage.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, FX = KC.FX, M = KC.media, N = KC.native;
  const D = KC.dock = { pages: {}, current: null };

  const TABS = [
    { id: 'media', label: 'Médias du projet', icon: 'film', build: buildMedia },
    { id: 'explorer', label: 'Explorateur', icon: 'folder', build: buildExplorer },
    { id: 'transitions', label: 'Transitions', icon: 'transition', build: buildTransitions },
    { id: 'fx', label: 'Effets', icon: 'fx', build: buildFx },
    { id: 'generators', label: 'Générateurs de médias', icon: 'text', build: buildGenerators },
    { id: 'trimmer', label: 'Découpage', icon: 'trim', build: buildTrimmer },
    { id: 'markers', label: 'Marqueurs', icon: 'marker', build: buildMarkers },
    { id: 'creative', label: 'Atelier', icon: 'wand', build: page=>KC.creative.build(page) },
    { id: 'captions', label: 'Sous-titres', icon: 'text', build: page=>KC.captions.build(page) },
  ];

  D.show = (id) => {
    if (!D.pages[id]) {
      const tab = TABS.find(t => t.id === id); if (!tab) return;
      const page = h('div.dock-page');
      KC.$('#dock-body').appendChild(page);
      D.pages[id] = page;
      tab.build(page);
    }
    for (const k in D.pages) D.pages[k].hidden = k !== id;
    KC.$$('.dock-tab').forEach(t => t.classList.toggle('active', t.dataset.id === id));
    D.current = id;
    const selected = TABS.find(t => t.id === id);
    KC.$('#dock-caption').textContent = selected.label;
    for (const tab of KC.$$('.dock-tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset.id === id));
      tab.tabIndex = tab.dataset.id === id ? 0 : -1;
    }
    KC.prefs.dockTab = id; KC.prefs.save();
    KC.emit('dock-tab', id);
  };
  D.init = () => {
    const tabs = KC.$('#dock-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Fenêtres de médias et effets');
    for (const t of TABS) {
      const el = h('button.dock-tab', { type: 'button', role: 'tab', 'aria-controls': 'dock-body', title: t.label, html: KC.icon(t.icon) + '<span>' + t.label + '</span>' });
      el.dataset.id = t.id;
      el.addEventListener('click', () => D.show(t.id));
      tabs.appendChild(el);
    }
    tabs.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const i = TABS.findIndex(t => t.id === D.current);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      D.show(TABS[next].id);
      KC.$$('.dock-tab')[next].focus();
    });
    D.show(TABS.some(t => t.id === KC.prefs.dockTab) ? KC.prefs.dockTab : 'media');
  };
  const startDrag = (e, payload, label) => {
    KC.dnd = payload;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', label || 'kaneclip');
  };
  document.addEventListener('dragend', () => { KC.dnd = null; KC.timeline && (KC.timeline.ghost = null, KC.timeline.redraw()); });
  const tb = (icon, title, fn) => { const b = h('button.tb', { title, html: KC.icon(icon) }); b.addEventListener('click', fn); return b; };

  /* ============================================================ médias du projet */
  const mediaSel = new Set();
  function buildMedia(page) {
    const search = h('input.field', { placeholder: 'Rechercher…', style: { width: '140px', height: '26px' } });
    search.addEventListener('input', () => render());
    search.addEventListener('keydown', e => e.stopPropagation());
    const viewBtn = tb(KC.prefs.mediaView === 'grid' ? 'list' : 'grid', 'Changer d\'affichage', () => { KC.prefs.mediaView = KC.prefs.mediaView === 'grid' ? 'list' : 'grid'; KC.prefs.save(); viewBtn.innerHTML = KC.icon(KC.prefs.mediaView === 'grid' ? 'list' : 'grid'); render(); });
    const bar = h('div.page-bar',
      tb('import', 'Importer des médias (Ctrl+I)', KC.cmd.importMedia),
      tb('trash', 'Supprimer les médias inutilisés', () => M.removeUnused()),
      tb('bolt', 'Créer des proxys pour les médias sélectionnés', () => { const ms = [...mediaSel].map(P.media).filter(m => m && m.kind !== 'image'); if (!ms.length) KC.toast('Sélectionnez des médias vidéo ou audio', 'info'); ms.forEach(m => M.makeProxy(m)); }),
      h('div.sp'), search, viewBtn);
    const body = h('div.page-body');
    let filter = 'all';
    const bins = h('div.media-bins', { role: 'group', 'aria-label': 'Filtrer les médias par type' });
    for (const [kind, label, icon] of [['all', 'Tous', 'film'], ['video', 'Vidéo', 'video'], ['audio', 'Audio', 'audio'], ['image', 'Images', 'image']]) {
      const btn = h('button.media-bin', { type: 'button', 'aria-pressed': String(kind === filter), dataset: { kind } }, h('span', { html: KC.icon(icon) }), h('span', { text: label }), h('span.count', { text: '0' }));
      btn.addEventListener('click', () => { filter = kind; render(); });
      bins.append(btn);
    }
    const count = h('div.media-count');
    const content = h('div.media-content', body, count);
    page.append(bar, h('div.media-browser', bins, content));
    // dépôt de fichiers Windows dans le panneau
    body.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files') || (KC.dnd && KC.dnd.kind === 'path')) { e.preventDefault(); body.classList.add('drop'); } });
    body.addEventListener('drop', async e => {
      e.preventDefault();
      const paths = KC.dnd && KC.dnd.kind === 'path' ? KC.dnd.paths : [...e.dataTransfer.files].map(f => N.pathForFile(f)).filter(Boolean);
      KC.dnd = null;
      const ok = paths.filter(M.isMedia);
      if (ok.length) await KC.busy(() => M.import(ok));
    });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const list = KC.project.media.filter(m => (filter === 'all' || m.kind === filter) && (!q || m.name.toLowerCase().includes(q)));
      for (const btn of KC.$$('.media-bin', bins)) {
        btn.setAttribute('aria-pressed', String(btn.dataset.kind === filter));
        btn.querySelector('.count').textContent = KC.project.media.filter(m => btn.dataset.kind === 'all' || m.kind === btn.dataset.kind).length;
      }
      count.textContent = list.length + ' média' + (list.length > 1 ? 's' : '') + ' · Double-clic : découpage';
      body.innerHTML = '';
      if (!KC.project.media.length) {
        body.appendChild(h('div.page-empty.media-empty', h('span.empty-symbol', { html: KC.icon('film') }), h('b', { text: 'Votre montage commence ici' }), h('span', { text: 'Importez vos vidéos, images et fichiers audio, puis glissez-les sur une piste.' })));
        const b = h('button.btn.primary', { html: KC.icon('import') + 'Importer des médias', style: { marginTop: '10px' } });
        b.addEventListener('click', KC.cmd.importMedia);
        body.firstChild.appendChild(h('div', b));
        return;
      }
      if (!list.length) { body.append(h('div.page-empty', { text: 'Aucun média ne correspond à ce filtre.' })); return; }
      const grid = h('div' + (KC.prefs.mediaView === 'grid' ? '.media-grid' : '.media-list'));
      for (const m of list) grid.appendChild(item(m));
      body.appendChild(grid);
    };
    const item = (m) => {
      const r = M.get(m);
      const poster = M.posterUrl(m);
      const icon = m.kind === 'video' ? 'video' : m.kind === 'audio' ? 'music' : 'image';
      const thumb = h('div.media-thumb', { style: poster ? { backgroundImage: `url("${poster}")` } : null, html: poster ? '' : KC.icon(icon) });
      if (m.kind !== 'image') thumb.appendChild(h('span.dur', { text: U.fmtDur(m.duration) }));
      if (r.missing) thumb.appendChild(h('span.badge.warn', { text: 'Introuvable' }));
      else if (r.busy.proxy) thumb.appendChild(h('span.badge.prog', { text: 'Proxy ' + Math.round(r.busy.proxy) + ' %' }));
      else if (r.proxy) thumb.appendChild(h('span.badge', { text: 'Proxy' }));
      const meta = m.kind === 'audio' ? `${m.acodec.toUpperCase()} · ${(m.rate / 1000).toFixed(1)} kHz` : m.kind === 'image' ? `Image ${m.width}×${m.height}` : `${m.width}×${m.height} · ${U.fmtFps(m.fps)} i/s · ${m.vcodec.toUpperCase()}`;
      const el = h('div.media-item' + (mediaSel.has(m.id) ? '.sel' : ''), { draggable: true, title: m.path },
        thumb, h('div.media-txt', h('div.media-name', { text: m.name }), h('div.media-meta', { text: meta })));
      el.addEventListener('click', e => {
        if (!e.ctrlKey) mediaSel.clear();
        if (mediaSel.has(m.id) && e.ctrlKey) mediaSel.delete(m.id); else mediaSel.add(m.id);
        KC.$$('.media-item', body).forEach(x => x.classList.toggle('sel', mediaSel.has(x.dataset.id)));
      });
      el.dataset.id = m.id;
      el.addEventListener('dblclick', () => KC.trimmer.open(m));
      el.addEventListener('dragstart', e => {
        if (!mediaSel.has(m.id)) { mediaSel.clear(); mediaSel.add(m.id); }
        startDrag(e, { kind: 'media', ids: KC.project.media.filter(x => mediaSel.has(x.id)).map(x => x.id) }, m.name);
      });
      el.addEventListener('contextmenu', e => {
        if (!mediaSel.has(m.id)) { mediaSel.clear(); mediaSel.add(m.id); render(); }
        KC.context(e, [
          { label: 'Ajouter à la timeline au curseur', icon: 'plus', action: () => KC.timeline.placeMedias([...mediaSel].map(P.media).filter(Boolean), KC.engine.time, KC.sel.track) },
          { label: 'Ouvrir dans le découpage', icon: 'trim', action: () => KC.trimmer.open(m) },
          '-',
          m.kind !== 'image' ? { label: r.proxy ? 'Recréer le proxy vidéo' : 'Créer un proxy vidéo', icon: 'bolt', action: () => { r.proxy = null; M.makeProxy(m); } } : null,
          r.proxy ? { label: 'Ne plus utiliser le proxy', action: () => { r.proxy = null; KC.emit('media-source-changed', m); KC.emit('media-updated', m); } } : null,
          m.kind === 'video' ? { label: 'Agrandir avec l\'IA…', icon: 'wand', action: () => KC.ai.dialog(m) } : null,
          m.origPath ? { label: 'Revenir au fichier original', icon: 'reset', action: () => M.restoreOriginal(m) } : null,
          { label: 'Remplacer / retrouver le fichier…', icon: 'link', action: () => M.relink(m) },
          { label: 'Afficher dans l\'explorateur Windows', icon: 'folder', action: () => N.showInFolder(m.path) },
          { label: 'Propriétés…', icon: 'props', action: () => KC.dialogs.mediaProps(m) },
          '-',
          { label: 'Supprimer du projet', icon: 'trash', action: () => removeMedia([...mediaSel]) },
        ]);
      });
      return el;
    };
    const removeMedia = async (ids) => {
      const used = ids.filter(id => KC.project.events.some(e => e.media === id));
      if (used.length && !(await KC.confirm('Supprimer des médias', 'Certains médias sont utilisés sur la timeline : leurs événements seront aussi supprimés.', 'Supprimer', true))) return;
      KC.edit('Supprimer des médias', () => {
        KC.project.events = KC.project.events.filter(e => !ids.includes(e.media));
        KC.project.media = KC.project.media.filter(m => !ids.includes(m.id));
      });
      mediaSel.clear();
    };
    const rerender = U.debounce(render, 80);
    KC.on('change', rerender); KC.on('media-updated', rerender); KC.on('project-loaded', render);
    render();
  }

  /* ============================================================ explorateur */
  function buildExplorer(page) {
    const places = h('div.ex-places');
    const pathIn = h('input.ex-path');
    const list = h('div.ex-list');
    let cur = '', entries = [], sel = new Set();
    const up = tb('up', 'Dossier parent', () => { const p = U.dir(cur.replace(/\\$/, '')); if (p && p !== cur && !/^[A-Z]:$/i.test(cur.replace(/\\$/, ''))) go(/^[A-Z]:$/i.test(p) ? p + '\\' : p); });
    const imp = tb('import', 'Importer la sélection dans le projet', async () => { const ps = [...sel].filter(M.isMedia); if (ps.length) await KC.busy(() => M.import(ps)); });
    const ref = tb('refresh', 'Actualiser', () => go(cur));
    pathIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') go(pathIn.value.trim()); });
    const bar = h('div.page-bar', up, pathIn, ref, imp);
    page.append(h('div.explorer', places, h('div.ex-main', bar, list)));
    async function go(dir) {
      if (!dir) return;
      const r = await N.listDir(dir);
      if (!r.ok) { KC.toast('Dossier inaccessible', 'err'); return; }
      cur = dir; pathIn.value = dir; sel.clear();
      KC.prefs.explorerDir = dir; KC.prefs.save();
      entries = r.entries.filter(e => e.dir || M.isMedia(e.name) || /\.kcp$/i.test(e.name))
        .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'fr', { numeric: true }));
      KC.$$('.ex-place', places).forEach(p => p.classList.toggle('active', p.dataset.path === dir));
      render();
    }
    function render() {
      list.innerHTML = '';
      if (!entries.length) { list.appendChild(h('div.page-empty', { text: 'Aucun média dans ce dossier' })); return; }
      for (const e of entries) {
        const icon = e.dir ? 'folder' : /\.kcp$/i.test(e.name) ? 'film' : /\.(mp3|wav|flac|aac|m4a|ogg|opus|wma|aiff?|ac3)$/i.test(e.name) ? 'music' : /\.(png|jpe?g|bmp|gif|webp|tiff?|tga|avif|jfif)$/i.test(e.name) ? 'image' : 'video';
        const row = h('div.ex-row' + (sel.has(e.path) ? '.sel' : ''), { draggable: !e.dir },
          h('span', { html: KC.icon(icon) }), h('span.nm', { text: e.name }), h('span.sz', { text: e.dir ? '' : U.fmtBytes(e.size) }));
        row.addEventListener('click', ev => {
          if (!ev.ctrlKey) sel.clear();
          if (sel.has(e.path) && ev.ctrlKey) sel.delete(e.path); else sel.add(e.path);
          render();
        });
        row.addEventListener('dblclick', async () => {
          if (e.dir) go(e.path);
          else if (/\.kcp$/i.test(e.name)) KC.cmd.openProject(e.path);
          else { const [m] = await M.import([e.path]); if (m) KC.trimmer.open(m); }
        });
        row.addEventListener('dragstart', ev => {
          if (!sel.has(e.path)) { sel.clear(); sel.add(e.path); }
          startDrag(ev, { kind: 'path', paths: [...sel].filter(M.isMedia) }, e.name);
        });
        list.appendChild(row);
      }
    }
    N.places().then(pl => {
      const add = (label, path, icon) => {
        const el = h('div.ex-place', { html: KC.icon(icon) + '<span>' + U.esc(label) + '</span>', title: path });
        el.dataset.path = path;
        el.addEventListener('click', () => go(path));
        places.appendChild(el);
      };
      for (const [l, p] of pl.special) add(l, p, l === 'Bureau' ? 'home' : 'folder');
      for (const d of pl.drives) add('Disque ' + d.slice(0, 2), d, 'drive');
      go(KC.prefs.explorerDir || (pl.special.find(s => s[0] === 'Vidéos') || pl.special[0] || [0, pl.home])[1]);
    });
  }

  /* ============================================================ transitions */
  function buildTransitions(page) {
    const body = h('div.page-body');
    page.append(h('div.page-bar', h('span', { style: { color: 'var(--muted)', fontSize: '12px', padding: '0 4px' }, text: 'Glissez une transition sur un événement vidéo, ou cliquez pour l\'appliquer à la sélection' })), body);
    const grid = h('div.fx-grid');
    for (const [k, d] of Object.entries(FX.TRANSITIONS)) {
      const prev = h('div.fx-prev', h('div.tp-a'), h('div.tp-b.anim-' + d.anim));
      const card = h('div.fx-card', { draggable: true, title: d.desc }, prev, h('div.fx-name', { text: d.name }), h('div.fx-desc', { text: d.desc }));
      card.addEventListener('dragstart', e => startDrag(e, { kind: 'trans', type: k }, d.name));
      card.addEventListener('click', () => {
        const evs = KC.sel.list().filter(e => P.kindOf(e) === 'video');
        if (!evs.length) { KC.toast('Sélectionnez un événement vidéo (ou glissez la transition dessus)', 'info'); return; }
        KC.cmd.setTransition(k, evs);
      });
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  /* ============================================================ effets */
  function buildFx(page) {
    const body = h('div.page-body');
    page.append(h('div.page-bar', h('span', { style: { color: 'var(--muted)', fontSize: '12px', padding: '0 4px' }, text: 'Effets vidéo : sur un événement · Effets audio : sur un en-tête de piste audio' })), body);
    const cats = {};
    for (const [k, d] of Object.entries(FX.VIDEO)) (cats[d.cat] = cats[d.cat] || []).push([k, d]);
    for (const [cat, list] of Object.entries(cats)) {
      body.appendChild(h('div.fx-section', { text: 'Vidéo — ' + cat }));
      const grid = h('div.fx-grid');
      for (const [k, d] of list) grid.appendChild(fxCard(k, d, false));
      body.appendChild(grid);
    }
    body.appendChild(h('div.fx-section', { text: 'Audio (pistes)' }));
    const ag = h('div.fx-grid');
    for (const [k, d] of Object.entries(FX.AUDIO)) ag.appendChild(fxCard(k, d, true));
    body.appendChild(ag);
  }
  const SWATCH = {
    enhance: 'linear-gradient(135deg,#5a3f2a,#e0a43d 40%,#47c2d4 75%,#2fb27a)',
    bc: 'linear-gradient(90deg,#111,#888 50%,#fff)', levels: 'linear-gradient(90deg,#000,#555,#ddd)', color: 'linear-gradient(90deg,#e0533d,#e0a43d,#c8cf4a,#2fb27a,#3d7cf0,#9a72ee)',
    balance: 'linear-gradient(90deg,#c33,#3c3,#33c)', bw: 'linear-gradient(135deg,#222,#ddd)', sepia: 'linear-gradient(135deg,#3b2a1a,#d9b98a)',
    invert: 'linear-gradient(90deg,#fff 50%,#000 50%)', blur: 'radial-gradient(circle,#6aa0ff,#1b2a6b)', sharpen: 'repeating-linear-gradient(90deg,#222 0 3px,#ddd 3px 6px)',
    glow: 'radial-gradient(circle,#fff6c7,#e0a43d 40%,#2a1a0a)', vignette: 'radial-gradient(circle,#c9d6ef 30%,#111 90%)', mosaic: 'conic-gradient(#3d7cf0 25%,#2fb27a 0 50%,#e0a43d 0 75%,#e0533d 0)',
    grain: 'repeating-radial-gradient(circle,#555 0 1px,#888 1px 2px)', mirror: 'linear-gradient(90deg,#3d7cf0,#2fb27a 50%,#3d7cf0)', crop: 'linear-gradient(90deg,#111 15%,#5b8ff0 15% 85%,#111 85%)',
    chroma: 'linear-gradient(135deg,#00d84a 50%,#5b8ff0 50%)',
    eq: 'linear-gradient(0deg,#2fb27a,#c8cf4a)', comp: 'linear-gradient(0deg,#3d7cf0,#9a72ee)', echo: 'repeating-linear-gradient(90deg,#3d7cf0 0 4px,transparent 4px 14px)',
    hp: 'linear-gradient(90deg,#111,#3d7cf0)', lp: 'linear-gradient(90deg,#3d7cf0,#111)',
  };
  function fxCard(k, d, audio) {
    const prev = h('div.fx-prev', h('div.fx-swatch', { style: { background: SWATCH[k] || '#333' } }));
    prev.style.height = '42px';
    const card = h('div.fx-card', { draggable: true, title: d.name }, prev, h('div.fx-name', { text: d.name }));
    card.addEventListener('dragstart', e => startDrag(e, { kind: audio ? 'afx' : 'vfx', type: k }, d.name));
    card.addEventListener('click', () => {
      if (audio) {
        const tr = KC.sel.track && P.track(KC.sel.track);
        if (!tr || tr.kind !== 'audio') { KC.toast('Sélectionnez une piste audio (cliquez sur son en-tête)', 'info'); return; }
        KC.edit('Ajouter un effet de piste', () => tr.fx.push(FX.make(k, true)));
        KC.windows.trackFx(tr);
      } else {
        const evs = KC.sel.list().filter(e => P.kindOf(e) === 'video');
        if (!evs.length) { KC.toast('Sélectionnez un événement vidéo (ou glissez l\'effet dessus)', 'info'); return; }
        KC.edit('Ajouter un effet', () => evs.forEach(ev => ev.fx.push(FX.make(k))));
        KC.windows.eventFx(evs[0]);
      }
    });
    return card;
  }

  /* ============================================================ générateurs */
  function buildGenerators(page) {
    const body = h('div.page-body');
    page.append(h('div.page-bar', h('span', { style: { color: 'var(--muted)', fontSize: '12px', padding: '0 4px' }, text: 'Glissez sur la timeline, ou cliquez pour insérer au curseur' })), body);
    const grid = h('div.fx-grid');
    const prevs = {
      text: '<div style="position:absolute;inset:0;display:grid;place-items:center;font:700 20px Outfit;color:#fff;background:linear-gradient(135deg,#1b2a6b,#3d7cf0)">Titre</div>',
      lower: '<div style="position:absolute;inset:0;background:linear-gradient(135deg,#2a2d38,#454a5a)"><div style="position:absolute;left:8px;bottom:9px;background:#1d2a44;color:#fff;font:600 10px Outfit;padding:3px 7px;border-radius:3px">Prénom Nom</div></div>',
      solid: '<div style="position:absolute;inset:0;background:#3d7cf0"></div>',
      gradient: '<div style="position:absolute;inset:0;background:linear-gradient(135deg,#1b2a6b,#d8487c)"></div>',
      checker: '<div style="position:absolute;inset:0;background:repeating-conic-gradient(#fff 0 25%,#ccc 0 50%) 0 0/16px 16px"></div>',
    };
    for (const [k, d] of Object.entries(FX.GENERATORS)) {
      const card = h('div.fx-card', { draggable: true }, h('div.fx-prev', { html: prevs[k] || '' }), h('div.fx-name', { text: d.name }));
      card.addEventListener('dragstart', e => startDrag(e, { kind: 'gen', type: k }, d.name));
      card.addEventListener('click', () => KC.cmd.insertGenerator(k));
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  /* ============================================================ découpage (Trimmer) */
  const TR = KC.trimmer = { media: null, in: 0, out: 0 };
  function buildMarkers(page) {
    const search = h('input.field#marker-search', { placeholder: 'Rechercher un marqueur…', 'aria-label': 'Rechercher un marqueur' });
    const list = h('div.marker-list');
    const add = h('button.btn.small', { text: '+ Marqueur au curseur' });
    add.addEventListener('click', KC.cmd.addMarker);
    page.append(h('div.page-bar', search, add), list);
    const render = () => {
      if (list.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      const query = search.value.toLocaleLowerCase();
      const markers = KC.project.markers.slice().sort((a,b) => a.t-b.t).filter(m => (m.name || '').toLocaleLowerCase().includes(query) || String(m.num).includes(query));
      list.replaceChildren();
      if (!markers.length) list.append(h('div.page-empty', { text: KC.project.markers.length ? 'Aucun marqueur correspondant.' : 'M ajoute un marqueur au curseur. Nommez vos prises, coupes et passages à revoir ici.' }));
      for (const marker of markers) {
        const go = h('button.marker-time', { text: U.fmtTime(marker.t, P.fps()), title: 'Aller au marqueur ' + marker.num });
        go.addEventListener('click', () => { KC.engine.seek(marker.t); KC.timeline.ensureVisible(marker.t); });
        const name = h('input.field', { value: marker.name || '', placeholder: 'Marqueur ' + marker.num, 'aria-label': 'Nom du marqueur ' + marker.num });
        name.addEventListener('change', () => KC.edit('Renommer le marqueur', () => { marker.name = name.value.trim(); }));
        const remove = h('button.tb', { html: KC.icon('trash'), title: 'Supprimer le marqueur ' + marker.num, 'aria-label': 'Supprimer le marqueur ' + marker.num });
        remove.addEventListener('click', () => KC.edit('Supprimer le marqueur', () => { KC.project.markers = KC.project.markers.filter(m => m.id !== marker.id); }));
        list.append(h('div.marker-row', h('span.marker-number', { text: String(marker.num) }), go, name, remove));
      }
    };
    search.addEventListener('input', render);
    KC.on('change', render); KC.on('project-loaded', render); render();
  }
  function buildTrimmer(page) { KC.sourceMonitor.build(page); }
  // L'ouverture passe par l'onglet (le contenu est construit à la demande)
  const lazyOpen = (m) => { D.show('trimmer'); if (TR.open !== lazyOpen) TR.open(m); };
  TR.open = lazyOpen;
})();
