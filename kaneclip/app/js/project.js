// Modèle du projet (pistes, événements, médias, marqueurs), historique et opérations d'édition.
'use strict';
(() => {
  const U = KC.util;
  const P = KC.P = {};

  P.TRACK_COLORS = ['#e0675a', '#e3a24a', '#c8cf4a', '#56c28a', '#47c2d4', '#5b8ff0', '#9a72ee', '#d86fc4', '#9aa3b2'];
  P.TEMPLATES = [
    { id: 'hd1080-30', name: 'HD 1080-30p (1920×1080, 30 i/s)', width: 1920, height: 1080, fps: 30 },
    { id: 'hd1080-2997', name: 'HD 1080-29,97p (1920×1080, 29,970 i/s)', width: 1920, height: 1080, fps: 30000 / 1001 },
    { id: 'hd1080-25', name: 'HD 1080-25p (1920×1080, 25 i/s)', width: 1920, height: 1080, fps: 25 },
    { id: 'hd1080-24', name: 'HD 1080-24p (1920×1080, 24 i/s)', width: 1920, height: 1080, fps: 24 },
    { id: 'hd1080-60', name: 'HD 1080-60p (1920×1080, 60 i/s)', width: 1920, height: 1080, fps: 60 },
    { id: 'hd1080-50', name: 'HD 1080-50p (1920×1080, 50 i/s)', width: 1920, height: 1080, fps: 50 },
    { id: 'uhd-30', name: 'UHD 4K-30p (3840×2160, 30 i/s)', width: 3840, height: 2160, fps: 30 },
    { id: 'uhd-60', name: 'UHD 4K-60p (3840×2160, 60 i/s)', width: 3840, height: 2160, fps: 60 },
    { id: 'uhd-25', name: 'UHD 4K-25p (3840×2160, 25 i/s)', width: 3840, height: 2160, fps: 25 },
    { id: 'qhd-60', name: 'QHD 1440-60p (2560×1440, 60 i/s)', width: 2560, height: 1440, fps: 60 },
    { id: 'hd720-30', name: 'HD 720-30p (1280×720, 30 i/s)', width: 1280, height: 720, fps: 30 },
    { id: 'vert-30', name: 'Vertical 1080×1920 (Shorts, TikTok), 30 i/s', width: 1080, height: 1920, fps: 30 },
    { id: 'vert-60', name: 'Vertical 1080×1920, 60 i/s', width: 1080, height: 1920, fps: 60 },
    { id: 'square-30', name: 'Carré 1080×1080, 30 i/s', width: 1080, height: 1080, fps: 30 },
  ];
  P.FPS_LIST = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120];
  P.normFps = f => {
    const map = { 23.976: 24000 / 1001, 29.97: 30000 / 1001, 59.94: 60000 / 1001, 119.88: 120000 / 1001 };
    for (const k in map) if (Math.abs(f - k) < 0.01) return map[k];
    return f;
  };

  P.create = (settings) => ({
    version: 1,
    settings: Object.assign({ width: 1920, height: 1080, fps: 30, sampleRate: 48000, bg: '#000000', masterGain: 0 }, KC.prefs.projectDefaults || {}, settings || {}),
    media: [], tracks: [], events: [], markers: [],
    loop: { in: 0, out: 0 },
    cursor: 0,
    view: { zoom: 60, scroll: 0, scrollY: 0 },
    info: { title: '', author: '', created: Date.now() },
  });

  /* ------------------------------------------------------------ accès */
  const pr = () => KC.project;
  P.fps = () => pr().settings.fps;
  P.frame = () => 1 / P.fps();
  P.snapFrame = t => Math.round(t * P.fps()) / P.fps();
  P.track = id => pr().tracks.find(t => t.id === id);
  P.event = id => pr().events.find(e => e.id === id);
  P.media = id => pr().media.find(m => m.id === id);
  P.trackIndex = id => pr().tracks.findIndex(t => t.id === id);
  P.eventsOn = id => pr().events.filter(e => e.track === id).sort((a, b) => a.start - b.start);
  P.kindOf = ev => { const t = P.track(ev.track); return t ? t.kind : 'video'; };
  P.end = ev => ev.start + ev.length;
  P.duration = () => pr().events.reduce((m, e) => Math.max(m, e.start + e.length), 0);
  P.groupOf = ev => ev.group ? pr().events.filter(e => e.group === ev.group) : [ev];
  P.sourceLength = ev => {
    if (ev.gen) return Infinity;
    const m = P.media(ev.media);
    if (!m || m.kind === 'image') return Infinity;
    return m.duration || Infinity;
  };
  P.eventName = ev => ev.name || (ev.gen ? KC.FX.genName(ev.gen) : (P.media(ev.media) || {}).name || 'Événement');

  /* ------------------------------------------------------------ pistes */
  P.newTrack = (kind, at) => {
    const p = pr();
    const same = p.tracks.filter(t => t.kind === kind).length;
    const t = {
      id: U.uid(), kind, name: '', color: p.tracks.length % P.TRACK_COLORS.length,
      mute: false, solo: false, height: kind === 'video' ? 78 : 62,
      level: 1, volume: 0, pan: 0, fx: [],
    };
    void same;
    if (at == null) {
      // Vegas : pistes vidéo en haut, pistes audio en bas
      if (kind === 'video') {
        const firstAudio = p.tracks.findIndex(x => x.kind === 'audio');
        const lastVideo = p.tracks.map(x => x.kind).lastIndexOf('video');
        at = lastVideo >= 0 ? lastVideo + 1 : firstAudio >= 0 ? firstAudio : p.tracks.length;
      } else at = p.tracks.length;
    }
    p.tracks.splice(at, 0, t);
    return t;
  };
  P.trackLabel = t => {
    const idx = pr().tracks.indexOf(t) + 1;
    return t.name || (t.kind === 'video' ? 'Vidéo ' : 'Audio ') + idx;
  };

  /* ------------------------------------------------------------ événements */
  P.newEvent = (o) => Object.assign({
    id: U.uid(), track: null, media: null, gen: null, name: '', start: 0, length: 5, offset: 0, speed: 1,
    fadeIn: 0, fadeOut: 0, xIn: false, xOut: false, opacity: 1, gain: 0, norm: 0, pan: 0, mute: false,
    fx: [], pc: null, transition: 'dissolve', group: null, color: null, loop: true,
  }, o);

  // Piste libre (sans chevauchement) du type voulu sur [t0, t1], à partir de l'index donné
  P.freeTrack = (kind, t0, t1, fromIndex = 0, exclude = []) => {
    const p = pr();
    for (let i = fromIndex; i < p.tracks.length; i++) {
      const t = p.tracks[i];
      if (t.kind !== kind) continue;
      const clash = p.events.some(e => e.track === t.id && !exclude.includes(e.id) && e.start < t1 - 1e-6 && e.start + e.length > t0 + 1e-6);
      if (!clash) return t;
    }
    return null;
  };

  // Place un média sur la timeline ; crée les pistes au besoin. Retourne les événements créés.
  P.placeMedia = (m, t, opts = {}) => {
    const p = pr();
    const fps = P.fps();
    t = Math.max(0, Math.round(t * fps) / fps);
    const inP = opts.in || 0;
    let len = m.kind === 'image' ? (opts.length || KC.prefs.imageLength) : Math.max(P.frame(), (opts.out || m.duration) - inP);
    len = Math.round(len * fps) / fps || P.frame();
    const out = [];
    const group = (m.hasVideo && m.hasAudio && opts.audio !== false && opts.video !== false) ? U.uid() : null;
    let vTrack = null;
    if (m.hasVideo && opts.video !== false) {
      vTrack = (opts.track && P.track(opts.track) && P.track(opts.track).kind === 'video') ? P.track(opts.track) : null;
      if (!vTrack) vTrack = P.freeTrack('video', t, t + len) || P.newTrack('video');
      out.push(P.newEvent({ track: vTrack.id, media: m.id, start: t, length: len, offset: inP, group }));
    }
    if (m.hasAudio && opts.audio !== false) {
      let aTrack = (opts.track && P.track(opts.track) && P.track(opts.track).kind === 'audio') ? P.track(opts.track) : null;
      if (!aTrack) {
        const from = vTrack ? 0 : 0;
        aTrack = P.freeTrack('audio', t, t + len, from) || P.newTrack('audio');
      }
      out.push(P.newEvent({ track: aTrack.id, media: m.id, start: t, length: len, offset: inP, group }));
    }
    p.events.push(...out);
    return out;
  };

  P.placeGenerator = (gen, t, trackId, length) => {
    let tr = trackId && P.track(trackId);
    const len = length || KC.prefs.genLength;
    if (!tr || tr.kind !== 'video') tr = P.freeTrack('video', t, t + len) || P.newTrack('video', 0);
    const ev = P.newEvent({ track: tr.id, gen: U.deep(gen), start: P.snapFrame(Math.max(0, t)), length: len });
    pr().events.push(ev);
    return ev;
  };

  // Fondus enchaînés automatiques : un chevauchement sur une même piste devient un fondu
  P.recalcCrossfades = (trackIds) => {
    if (!KC.prefs.autoCrossfade) return;
    const ids = trackIds ? [...new Set(trackIds)] : pr().tracks.map(t => t.id);
    for (const tid of ids) {
      const evs = P.eventsOn(tid);
      for (const e of evs) {
        if (e.xIn) { e.fadeIn = 0; e.xIn = false; }
        if (e.xOut) { e.fadeOut = 0; e.xOut = false; }
      }
      for (let j = 1; j < evs.length; j++) {
        const B = evs[j];
        let A = null;
        for (let i = 0; i < j; i++) {
          const a = evs[i];
          if (a.start < B.start - 1e-6 && P.end(a) > B.start + 1e-6 && P.end(a) < P.end(B) - 1e-6 && (!A || P.end(a) > P.end(A))) A = a;
        }
        if (!A) continue;
        const d = P.end(A) - B.start;
        B.fadeIn = d; B.xIn = true;
        A.fadeOut = d; A.xOut = true;
      }
    }
  };

  // Événement A dont la sortie est couverte par B (B entre pendant la fin de A, même piste)
  P.incoming = (A) => {
    let best = null;
    const candidates = KC.eventIndex ? KC.eventIndex.between(A.start,P.end(A),A.track) : pr().events;
    for (const e of candidates) {
      if (e === A || e.track !== A.track) continue;
      if (e.start > A.start + 1e-6 && e.start < P.end(A) - 1e-6 && P.end(e) > P.end(A) - 1e-6) {
        if (!best || e.start < best.start) best = e;
      }
    }
    return best;
  };
  P.outgoing = (B) => {
    let best = null;
    for (const e of pr().events) {
      if (e === B || e.track !== B.track) continue;
      if (e.start < B.start - 1e-6 && P.end(e) > B.start + 1e-6 && P.end(e) < P.end(B) + 1e-6) {
        if (!best || P.end(e) > P.end(best)) best = e;
      }
    }
    return best;
  };

  // Diviser au temps t
  P.split = (ev, t) => {
    if (t <= ev.start + 1e-6 || t >= P.end(ev) - 1e-6) return null;
    const cut = t - ev.start;
    const b = U.deep(ev);
    b.id = U.uid();
    b.start = t; b.length = ev.length - cut; b.offset = ev.offset + cut * ev.speed;
    b.fadeIn = 0; b.xIn = false;
    ev.length = cut; ev.fadeOut = 0; ev.xOut = false;
    if (b.fadeOut > b.length) b.fadeOut = b.length;
    if (ev.fadeIn > ev.length) ev.fadeIn = ev.length;
    if (b.pc && b.pc.kf && b.pc.kf.length > 1) {
      // Les images-clés suivent le contenu ; on garde la valeur au point de coupe
      const at = KC.FX.pcAt(ev.pc, cut);
      b.pc.kf = [{ ...at, t: 0 }, ...b.pc.kf.filter(k => k.t > cut + 1e-6).map(k => ({ ...k, t: k.t - cut }))];
      ev.pc.kf = [...ev.pc.kf.filter(k => k.t < cut - 1e-6), { ...at, t: cut }];
    }
    pr().events.push(b);
    return b;
  };

  // Ondulation : décale ce qui suit `t` de `dt` sur les pistes concernées
  P.ripple = (t, dt, trackIds, exclude = []) => {
    const all = KC.prefs.ripple === 'all';
    for (const e of pr().events) {
      if (exclude.includes(e.id)) continue;
      if (!all && trackIds && !trackIds.includes(e.track)) continue;
      if (e.start >= t - 1e-6) e.start = Math.max(0, e.start + dt);
    }
    if (all) for (const m of pr().markers) if (m.t >= t - 1e-6) m.t = Math.max(0, m.t + dt);
  };

  P.deleteEvents = (ids, ripple = KC.prefs.ripple !== 'off') => {
    const p = pr();
    const evs = p.events.filter(e => ids.includes(e.id));
    const tracks = [...new Set(evs.map(e => e.track))];
    p.events = p.events.filter(e => !ids.includes(e.id));
    if (ripple && evs.length) {
      // Union des plages supprimées : un groupe A/V n'est jamais retranché deux fois.
      const merge = ranges => ranges.sort((a,b) => a[0]-b[0]).reduce((out, range) => {
        const last = out[out.length-1];
        if (last && range[0] <= last[1]+1e-6) last[1] = Math.max(last[1], range[1]); else out.push(range.slice());
        return out;
      }, []);
      for (const scope of KC.prefs.ripple === 'all' ? [null] : tracks) {
        const removed = merge(evs.filter(e => !scope || e.track === scope).map(e => [e.start, P.end(e)]));
        const covered = merge(p.events.filter(e => !scope || e.track === scope).map(e => [e.start, P.end(e)]));
        const holes = [];
        for (const [start, end] of removed) {
          let cursor = start;
          for (const [a,b] of covered) {
            if (b <= cursor || a >= end) continue;
            if (a > cursor) holes.push([cursor, Math.min(a,end)]);
            cursor = Math.max(cursor,b);
            if (cursor >= end) break;
          }
          if (cursor < end-1e-6) holes.push([cursor,end]);
        }
        for (const [a,b] of holes.reverse()) P.ripple(b, a-b, scope ? [scope] : null);
      }
    }
    P.recalcCrossfades(tracks);
  };

  P.removeTrack = (id) => {
    const p = pr();
    p.events = p.events.filter(e => e.track !== id);
    p.tracks = p.tracks.filter(t => t.id !== id);
  };

  /* ------------------------------------------------------------ marqueurs */
  P.addMarker = (t, name) => {
    const p = pr();
    const n = p.markers.length + 1;
    const m = { id: U.uid(), t: P.snapFrame(t), name: name || '' , num: Math.max(0, ...p.markers.map(x => x.num || 0)) + 1 };
    void n;
    p.markers.push(m);
    p.markers.sort((a, b) => a.t - b.t);
    return m;
  };

  /* ------------------------------------------------------------ historique */
  const H = KC.history = { undo: [], redo: [], max: 250, pending: null };
  const snap = () => {
    const p = pr();
    return JSON.stringify({ settings: p.settings, media: p.media, tracks: p.tracks, events: p.events, markers: p.markers, loop: p.loop });
  };
  const restore = (s) => {
    const o = JSON.parse(s);
    Object.assign(KC.project, o);
    KC.sel.clean();
    markDirty();
    KC.emit('change', { restore: true });
    KC.emit('settings');
  };
  const markDirty = () => { if (!KC.project.dirty) { KC.project.dirty = true; KC.emit('dirty'); } };
  KC.markDirty = markDirty;

  // Modification atomique : KC.edit('Libellé', () => { ... })
  KC.edit = (label, fn) => {
    const before = snap();
    let r;
    try { r = fn(); } catch (e) { restore(before); throw e; }
    if (snap() !== before) {
      H.undo.push({ label, state: before }); if (H.undo.length > H.max) H.undo.shift();
      H.redo = [];
      markDirty();
      KC.emit('change', { label });
    }
    return r;
  };
  // Pour les glisser : début, puis validation (une seule entrée d'historique)
  KC.begin = () => { H.pending = snap(); };
  KC.commit = (label) => {
    if (H.pending == null) return false;
    const before = H.pending; H.pending = null;
    if (snap() === before) { KC.emit('change', { label, silent: true }); return false; }
    H.undo.push({ label, state: before }); if (H.undo.length > H.max) H.undo.shift();
    H.redo = [];
    markDirty();
    KC.emit('change', { label });
    return true;
  };
  KC.cancel = () => { if (H.pending != null) { const s = H.pending; H.pending = null; restore(s); } };
  KC.undo = () => {
    if (!H.undo.length) return;
    const cur = snap(); const e = H.undo.pop();
    H.redo.push({ label: e.label, state: cur });
    restore(e.state);
    KC.toast('Annuler : ' + e.label, 'info', 1200);
  };
  KC.redo = () => {
    if (!H.redo.length) return;
    const cur = snap(); const e = H.redo.pop();
    H.undo.push({ label: e.label, state: cur });
    restore(e.state);
    KC.toast('Rétablir : ' + e.label, 'info', 1200);
  };
  KC.resetHistory = () => { H.undo = []; H.redo = []; H.pending = null; };

  /* ------------------------------------------------------------ sélection */
  const S = KC.sel = { ids: new Set(), track: null };
  S.has = id => S.ids.has(id);
  S.list = () => KC.project.events.filter(e => S.ids.has(e.id));
  S.set = (ids, add = false) => {
    if (!add) S.ids.clear();
    for (const id of ids) S.ids.add(id);
    KC.emit('selection');
  };
  S.toggle = id => { if (S.ids.has(id)) S.ids.delete(id); else S.ids.add(id); KC.emit('selection'); };
  S.clear = () => { if (S.ids.size) { S.ids.clear(); KC.emit('selection'); } };
  S.clean = () => { for (const id of [...S.ids]) if (!P.event(id)) S.ids.delete(id); };
  // Développe une liste d'événements à leurs groupes (sauf si le groupement est ignoré)
  S.expand = (evs) => {
    if (KC.prefs.ignoreGroups) return evs;
    const out = new Set(evs);
    for (const e of evs) if (e.group) for (const g of KC.project.events) if (g.group === e.group) out.add(g);
    return [...out];
  };

  /* ------------------------------------------------------------ sérialisation */
  P.serialize = () => {
    const p = pr();
    return JSON.stringify({
      app: 'KaneClip', version: p.version, settings: p.settings, info: p.info,
      media: p.media.map(m => ({ ...m, missing: undefined })), tracks: p.tracks, events: p.events, markers: p.markers,
      loop: p.loop, cursor: p.cursor, view: p.view,
    }, null, 1);
  };
  P.deserialize = (text) => {
    const o = JSON.parse(text);
    if (!o || o.app !== 'KaneClip') throw new Error("Ce fichier n'est pas un projet KaneClip");
    const p = P.create(o.settings);
    Object.assign(p, {
      settings: Object.assign(p.settings, o.settings || {}), info: o.info || p.info, media: o.media || [], tracks: o.tracks || [],
      events: (o.events || []).map(e => P.newEvent(e)), markers: o.markers || [], loop: o.loop || p.loop, cursor: o.cursor || 0,
      view: Object.assign(p.view, o.view || {}),
    });
    for (const t of p.tracks) { if (!t.fx) t.fx = []; if (t.level == null) t.level = 1; if (t.volume == null) t.volume = 0; }
    return p;
  };
})();
