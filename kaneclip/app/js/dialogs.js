// Boîtes de dialogue : propriétés du projet / de l'événement / du média, préférences, raccourcis, à propos.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, FX = KC.FX, M = KC.media;
  const Dg = KC.dialogs = {};

  /* ------------------------------------------------------------ propriétés du projet */
  Dg.projectProps = () => {
    const s = { ...KC.project.settings };
    const info = { ...KC.project.info };
    const tpl = KC.ui.select([['', 'Personnalisé'], ...P.TEMPLATES.map(t => [t.id, t.name])], '', v => {
      const t = P.TEMPLATES.find(x => x.id === v); if (!t) return;
      w.value = t.width; hh.value = t.height; fps.value = fpsKey(t.fps);
    });
    const match = P.TEMPLATES.find(t => t.width === s.width && t.height === s.height && Math.abs(t.fps - s.fps) < 0.001);
    if (match) tpl.value = match.id;
    const w = h('input.field', { value: s.width, style: { width: '90px' } });
    const hh = h('input.field', { value: s.height, style: { width: '90px' } });
    const fpsKey = f => String(P.FPS_LIST.find(x => Math.abs(P.normFps(x) - f) < 0.001) || Math.round(f * 1000) / 1000);
    const fps = KC.ui.select(P.FPS_LIST.map(f => [String(f), U.fmtFps(f) + ' i/s']), fpsKey(s.fps));
    const sr = KC.ui.select([['48000', '48 000 Hz'], ['44100', '44 100 Hz'], ['96000', '96 000 Hz']], String(s.sampleRate));
    const bg = h('input', { type: 'color', value: s.bg || '#000000' });
    const title = h('input.field', { value: info.title || '', style: { width: '100%' } });
    const author = h('input.field', { value: info.author || '', style: { width: '100%' } });
    const swap = h('button.btn.small', { text: '⇄ Vertical/horizontal' });
    swap.addEventListener('click', () => { const a = w.value; w.value = hh.value; hh.value = a; tpl.value = ''; });
    const firstV = KC.project.media.find(m => m.kind === 'video' && m.width);
    const matchBtn = h('button.btn.small', { text: 'Adapter au premier média vidéo', disabled: !firstV });
    matchBtn.addEventListener('click', () => { if (!firstV) return; w.value = firstV.width; hh.value = firstV.height; fps.value = fpsKey(P.normFps(firstV.fps || 30)); tpl.value = ''; });
    const asDefault = KC.ui.check('Utiliser ces paramètres pour les nouveaux projets', false);
    const body = h('div.form', { style: { width: '560px' } },
      h('div.group-title', { text: 'Vidéo' }),
      h('label', { text: 'Modèle' }), tpl,
      h('label', { text: 'Taille de l\'image' }), h('div.row', w, h('span', { text: '×' }), hh, swap),
      h('label', { text: 'Fréquence d\'images' }), fps,
      h('label', { text: 'Couleur de fond' }), h('div.row', bg, h('span.hint', { text: 'visible là où aucune vidéo ne couvre l\'image' })),
      h('label'), matchBtn,
      h('div.group-title', { text: 'Audio' }),
      h('label', { text: 'Échantillonnage' }), sr,
      h('div.group-title', { text: 'Résumé' }),
      h('label', { text: 'Titre' }), title,
      h('label', { text: 'Auteur' }), author,
      h('div.full', asDefault),
    );
    KC.modal({
      title: 'Propriétés du projet', body,
      buttons: [{ label: 'Annuler' }, {
        label: 'OK', primary: true, action: () => {
          const nw = Math.round(parseInt(w.value, 10) / 2) * 2, nh = Math.round(parseInt(hh.value, 10) / 2) * 2;
          if (!(nw >= 16 && nh >= 16 && nw <= 8192 && nh <= 8192)) { KC.toast('Taille d\'image invalide (16 à 8192, nombres pairs)', 'err'); return false; }
          KC.edit('Propriétés du projet', () => {
            Object.assign(KC.project.settings, { width: nw, height: nh, fps: P.normFps(parseFloat(fps.value)), sampleRate: parseInt(sr.value, 10), bg: bg.value });
            KC.project.info.title = title.value; KC.project.info.author = author.value;
          });
          if (asDefault.input.checked) { KC.prefs.projectDefaults = { width: nw, height: nh, fps: P.normFps(parseFloat(fps.value)), sampleRate: parseInt(sr.value, 10) }; KC.prefs.save(); }
          KC.emit('settings');
        },
      }],
    });
  };

  // Comme Vegas : proposer d'adapter le projet au premier média
  Dg.matchMedia = async (m) => {
    const s = KC.project.settings;
    const fps = P.normFps(m.fps || s.fps);
    if (m.width === s.width && m.height === s.height && Math.abs(fps - s.fps) < 0.01) return;
    const ok = await KC.confirm('Paramètres du projet',
      `Le média « ${m.name} » est en ${m.width}×${m.height} à ${U.fmtFps(fps)} i/s, le projet en ${s.width}×${s.height} à ${U.fmtFps(s.fps)} i/s.\n\nVoulez-vous adapter les paramètres vidéo du projet à ce média ?`, 'Adapter le projet');
    if (!ok) return;
    KC.edit('Adapter le projet au média', () => { Object.assign(KC.project.settings, { width: m.width - (m.width % 2), height: m.height - (m.height % 2), fps }); });
    KC.emit('settings');
  };

  /* ------------------------------------------------------------ propriétés d'un événement */
  Dg.eventProps = (ev) => {
    const isV = P.kindOf(ev) === 'video';
    const m = ev.media ? P.media(ev.media) : null;
    const name = h('input.field', { value: ev.name || '', placeholder: P.eventName(ev), style: { width: '100%' } });
    const start = KC.ui.time(ev.start);
    const len = KC.ui.time(ev.length);
    const off = KC.ui.time(ev.offset);
    const speed = KC.ui.num(ev.speed * 100, { min: 10, max: 1000, width: 90, dec: 1 });
    const keepLen = KC.ui.check('Conserver la durée de la source (ajuster la longueur)', true);
    const fi = KC.ui.time(ev.fadeIn), fo = KC.ui.time(ev.fadeOut);
    const lvl = isV ? KC.ui.num(Math.round((ev.opacity == null ? 1 : ev.opacity) * 100), { min: 0, max: 100, width: 80, dec: 0 }) : KC.ui.num(ev.gain, { min: -60, max: 12, width: 80, dec: 1 });
    const pan = !isV ? KC.ui.num(Math.round((ev.pan || 0) * 100), { min: -100, max: 100, width: 80, dec: 0 }) : null;
    const loop = KC.ui.check('Boucle (répéter la source si l\'événement est plus long)', ev.loop !== false);
    const mute = KC.ui.check('Muet', !!ev.mute);
    const trans = isV ? KC.ui.select(Object.entries(FX.TRANSITIONS).map(([k, d]) => [k, d.name]), ev.transition || 'dissolve') : null;
    const body = h('div.form', { style: { width: '560px' } },
      h('label', { text: 'Nom' }), name,
      m ? h('label', { text: 'Média' }) : null, m ? h('div.hint', { text: m.path, style: { userSelect: 'text', wordBreak: 'break-all' } }) : null,
      h('div.group-title', { text: 'Temps' }),
      h('label', { text: 'Début' }), start,
      h('label', { text: 'Longueur' }), len,
      m && m.kind !== 'image' ? h('label', { text: 'Décalage source' }) : null, m && m.kind !== 'image' ? off : null,
      h('label', { text: 'Vitesse de lecture' }), h('div.row', speed, h('span', { text: '%' })),
      h('label'), keepLen,
      h('div.group-title', { text: 'Fondus et niveau' }),
      h('label', { text: 'Fondu d\'entrée' }), fi,
      h('label', { text: 'Fondu de sortie' }), fo,
      isV ? h('label', { text: 'Transition d\'entrée' }) : null, trans,
      h('label', { text: isV ? 'Opacité' : 'Gain' }), h('div.row', lvl, h('span', { text: isV ? '%' : 'dB' })),
      pan ? h('label', { text: 'Panoramique' }) : null, pan ? h('div.row', pan, h('span.hint', { text: '-100 = gauche, 100 = droite' })) : null,
      h('div.group-title', { text: 'Commutateurs' }),
      h('div.full', h('div.row', loop, mute)),
    );
    KC.modal({
      title: 'Propriétés de l\'événement', body,
      buttons: [{ label: 'Annuler' }, {
        label: 'OK', primary: true, action: () => {
          KC.edit('Propriétés de l\'événement', () => {
            ev.name = name.value.trim();
            const newSpeed = U.clamp(parseFloat(String(speed.value).replace(',', '.')) / 100 || 1, 0.1, 10);
            let L = Math.max(P.frame(), len.get());
            if (Math.abs(newSpeed - ev.speed) > 1e-6 && keepLen.input.checked) L = Math.max(P.frame(), P.snapFrame(ev.length * ev.speed / newSpeed));
            ev.speed = newSpeed;
            ev.start = P.snapFrame(start.get()); ev.length = L; ev.offset = off.get();
            ev.fadeIn = Math.min(fi.get(), ev.length); ev.fadeOut = Math.min(fo.get(), ev.length - ev.fadeIn);
            ev.xIn = false; ev.xOut = false;
            if (isV) { ev.opacity = U.clamp(parseFloat(lvl.value) / 100, 0, 1); ev.transition = trans.value; }
            else { ev.gain = U.clamp(parseFloat(String(lvl.value).replace(',', '.')) || 0, -60, 12); ev.pan = U.clamp((parseFloat(pan.value) || 0) / 100, -1, 1); }
            ev.loop = loop.input.checked; ev.mute = mute.input.checked;
            P.recalcCrossfades([ev.track]);
          });
        },
      }],
    });
  };

  Dg.mediaProps = (m) => {
    const r = M.get(m);
    const rows = [
      ['Fichier', m.path], ['Type', m.kind === 'video' ? 'Vidéo' : m.kind === 'audio' ? 'Audio' : 'Image'],
      ['Taille', U.fmtBytes(m.size || 0)], m.kind !== 'image' ? ['Durée', U.fmtTime(m.duration, m.fps || P.fps())] : null,
      m.hasVideo ? ['Vidéo', `${m.width}×${m.height}${m.fps ? ', ' + U.fmtFps(m.fps) + ' i/s' : ''}${m.vcodec ? ', ' + m.vcodec.toUpperCase() : ''}`] : null,
      m.hasAudio ? ['Audio', `${m.acodec.toUpperCase()}, ${m.rate} Hz${m.layout ? ', ' + m.layout : ''}`] : null,
      m.bitrate ? ['Débit', m.bitrate + ' kbit/s'] : null,
      ['Proxy', r.proxy ? 'Oui (aperçu allégé, le rendu utilise l\'original)' : 'Non'],
      ['Utilisations', String(KC.project.events.filter(e => e.media === m.id).length)],
    ].filter(Boolean);
    const body = h('div.form', { style: { width: '560px', gridTemplateColumns: '120px 1fr' } }, ...rows.flatMap(([a, b]) => [h('label', { text: a }), h('div', { text: b, style: { userSelect: 'text', wordBreak: 'break-all' } })]));
    KC.modal({ title: 'Propriétés du média', body });
  };

  /* ------------------------------------------------------------ préférences */
  Dg.prefs = async () => {
    const p = KC.prefs;
    const theme = KC.ui.select([['dark', 'Sombre (Vegas)'], ['graphite', 'Graphite'], ['light', 'Clair']], p.theme);
    const tf = KC.ui.select([['smpte', 'Temps et images (HH:MM:SS;II)'], ['sec', 'Heures, minutes, secondes'], ['frames', 'Images']], p.timeFormat);
    const scale = KC.ui.select([['0.9', '90 %'], ['1', '100 %'], ['1.1', '110 %'], ['1.25', '125 %']], String(p.uiScale));
    const imgLen = h('input.field', { value: p.imageLength, style: { width: '80px' } });
    const genLen = h('input.field', { value: p.genLength, style: { width: '80px' } });
    const trLen = h('input.field', { value: p.transitionLength, style: { width: '80px' } });
    const xf = KC.ui.check('Fondu enchaîné automatique quand des événements se chevauchent', p.autoCrossfade);
    const follow = KC.ui.check('Faire défiler la timeline pendant la lecture', p.followCursor);
    const autoProxy = KC.ui.check('Créer automatiquement un proxy pour les formats non lisibles', p.autoProxy);
    const smartProxy = KC.ui.check('Proxys intelligents : vidéos 4K, très lourdes ou lentes à parcourir (recommandé)', p.smartProxy !== false);
    const autosave = KC.ui.select([['0', 'Jamais'], ['1', 'Toutes les minutes'], ['2', 'Toutes les 2 minutes'], ['5', 'Toutes les 5 minutes']], String(p.autosave));
    const cacheInfo = h('span.hint', { text: 'calcul…' });
    KC.native.cacheSize().then(n => { cacheInfo.textContent = U.fmtBytes(n); });
    const clear = h('button.btn.small', { text: 'Vider le cache' });
    clear.addEventListener('click', async () => {
      if (!(await KC.confirm('Vider le cache', 'Les vignettes, formes d\'onde et proxys seront recalculés à la demande.', 'Vider'))) return;
      await KC.native.cacheClear(); cacheInfo.textContent = '0 o';
      for (const m of KC.project.media) { const r = M.get(m); r.thumbs = null; r.peaks = null; r.proxy = null; M.prepare(m); }
    });
    const ff = await KC.native.ffAvailable();
    const body = h('div.form', { style: { width: '620px', gridTemplateColumns: '210px 1fr' } },
      h('div.group-title', { text: 'Affichage' }),
      h('label', { text: 'Thème' }), theme,
      h('label', { text: 'Taille de l\'interface' }), scale,
      h('label', { text: 'Format du temps' }), tf,
      h('label'), follow,
      h('div.group-title', { text: 'Édition' }),
      h('label', { text: 'Durée des images fixes (s)' }), imgLen,
      h('label', { text: 'Durée des générateurs (s)' }), genLen,
      h('label', { text: 'Durée des transitions (s)' }), trLen,
      h('label'), xf,
      h('div.group-title', { text: 'Médias' }),
      h('label'), autoProxy,
      h('label'), smartProxy,
      h('label', { text: 'Cache (vignettes, proxys)' }), h('div.row', cacheInfo, clear),
      h('label', { text: 'ffmpeg' }), h('div.hint', { text: ff.path ? ff.version + '\n' + ff.path : 'Introuvable : l\'analyse et le rendu sont indisponibles', style: { whiteSpace: 'pre-wrap', userSelect: 'text' } }),
      h('div.group-title', { text: 'Sécurité' }),
      h('label', { text: 'Sauvegarde automatique' }), autosave,
    );
    KC.modal({
      title: 'Préférences', body,
      buttons: [{ label: 'Annuler' }, {
        label: 'OK', primary: true, action: () => {
          const num = (i, d, min, max) => U.clamp(parseFloat(String(i.value).replace(',', '.')) || d, min, max);
          p.theme = theme.value; p.timeFormat = tf.value; p.uiScale = parseFloat(scale.value);
          p.imageLength = num(imgLen, 5, 0.1, 600); p.genLength = num(genLen, 5, 0.1, 600); p.transitionLength = num(trLen, 1, 0.04, 30);
          p.autoCrossfade = xf.input.checked; p.followCursor = follow.input.checked; p.autoProxy = autoProxy.input.checked; p.smartProxy = smartProxy.input.checked;
          p.autosave = parseInt(autosave.value, 10);
          p.save();
          KC.applyTheme();
          KC.emit('prefs'); KC.emit('time-format'); KC.timeline.redraw();
        },
      }],
    });
  };

  /* ------------------------------------------------------------ raccourcis */
  Dg.shortcuts = () => {
    const groups = [
      ['Lecture', [['Lire / arrêter (retour au départ)', 'Espace'], ['Lire / pause', 'Entrée'], ['Arrêt', 'Échap'], ['Navette arrière / pause / avant', 'J  K  L'], ['Image précédente / suivante', '← →'], ['Bord d\'événement précédent / suivant', 'Ctrl+← Ctrl+→'], ['Début / fin du projet', 'Ctrl+Origine  Ctrl+Fin'], ['Lecture en boucle', 'Q'], ['Aller au marqueur 1 à 9', '1 … 9']]],
      ['Édition', [['Diviser au curseur', 'S'], ['Supprimer', 'Suppr'], ['Couper / copier / coller', 'Ctrl+X / C / V'], ['Annuler / rétablir', 'Ctrl+Z / Ctrl+Y'], ['Tout sélectionner', 'Ctrl+A'], ['Grouper / dissocier', 'G / U'], ['Déplacer d\'une image', 'Pavé num. 4 / 6'], ['Découper à la sélection', 'Ctrl+T'], ['Ajouter un marqueur', 'M'], ['Point d\'entrée / sortie de la sélection', 'I / O'], ['Magnétisme', 'F8'], ['Ignorer le groupement', 'Ctrl+Maj+U'], ['Ondulation automatique', 'Ctrl+L']]],
      ['Souris sur la timeline', [['Zoom', 'Molette'], ['Défiler horizontalement', 'Ctrl+molette'], ['Défiler les pistes', 'Maj+molette'], ['Sélection temporelle', 'Glisser dans le vide'], ['Copier un événement', 'Ctrl+glisser'], ['Glisser le contenu (slip)', 'Alt+glisser'], ['Changer la vitesse', 'Ctrl+glisser un bord'], ['Sans magnétisme', 'Maj pendant le glisser']]],
      ['Projet', [['Nouveau / ouvrir / enregistrer', 'Ctrl+N / O / S'], ['Importer des médias', 'Ctrl+I'], ['Rendre en tant que…', 'Ctrl+M'], ['Propriétés du projet', 'Alt+Entrée'], ['Insérer piste audio / vidéo', 'Ctrl+Q / Ctrl+Maj+Q'], ['Insérer un texte', 'Ctrl+Maj+T']]],
    ];
    const body = h('div.keys-table', { style: { width: '560px' } });
    for (const [g, list] of groups) { body.appendChild(h('div.h', { text: g })); for (const [a, k] of list) body.append(h('span', { text: a }), h('span', h('span.kbd', { text: k }))); }
    KC.modal({ title: 'Raccourcis clavier', body });
  };

  Dg.about = async () => {
    const v = await KC.native.appVersion().catch(() => ({ version: '1.0.0' }));
    const ff = await KC.native.ffAvailable();
    const body = h('div', { style: { width: '440px', lineHeight: '1.55' } },
      h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '10px' } },
        h('img', { src: 'icon.png', style: { width: '56px', height: '56px' } }),
        h('div', h('div', { style: { fontSize: '20px', fontWeight: 700 }, text: 'KaneClip' }), h('div', { style: { color: 'var(--muted)' }, text: 'Version ' + v.version }))),
      h('div', { text: 'Éditeur vidéo multipiste inspiré de Vegas Pro : timeline à événements, fondus enchaînés automatiques, panoramique/recadrage avec images-clés, effets, titres et rendu via ffmpeg.' }),
      h('div.note', { style: { marginTop: '10px' }, text: 'Rendu et analyse : ' + (ff.version || 'ffmpeg introuvable') + '. ffmpeg est distribué sous licence GPL.' }),
    );
    KC.modal({ title: 'À propos de KaneClip', body });
  };
})();
