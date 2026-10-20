// Moteur de lecture : horloge, éléments <video>/<audio> synchronisés, mixage Web Audio,
// compositeur d'image (même géométrie que le rendu ffmpeg) et vu-mètres.
'use strict';
(() => {
  const U = KC.util, P = KC.P, FX = KC.FX, M = KC.media;
  const E = KC.engine = { time: 0, playing: false, scrubbing: false, rate: 1, playbackRate: 1, startTime: 0, needsDraw: true, levels: { L: 0, R: 0, peakL: 0, peakR: 0, clip: false }, masterMute: false };

  /* ------------------------------------------------------------ audio */
  let ac = null, master = null, analL = null, analR = null;
  const buses = new Map();      // trackId -> {input, fxIn, out, pan, gain, anal, sig}
  E.audio = () => {
    if (ac) return ac;
    ac = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    master = ac.createGain();
    const split = ac.createChannelSplitter(2);
    analL = ac.createAnalyser(); analR = ac.createAnalyser();
    analL.fftSize = analR.fftSize = 1024;
    master.connect(split); split.connect(analL, 0); split.connect(analR, 1);
    master.connect(ac.destination);
    return ac;
  };
  function bus(track) {
    E.audio();
    let b = buses.get(track.id);
    const sig = JSON.stringify(track.fx || []);
    if (b && b.sig === sig) return b;
    if (!b) {
      b = { input: ac.createGain(), pan: ac.createStereoPanner(), gain: ac.createGain(), anal: ac.createAnalyser(), chain: [] };
      b.anal.fftSize = 512;
      b.pan.connect(b.gain); b.gain.connect(master); b.gain.connect(b.anal);
      buses.set(track.id, b);
    }
    // (Re)construit la chaîne d'effets de piste : input -> fx... -> pan
    try { b.input.disconnect(); } catch { /* rien */ }
    for (const n of b.chain) { try { n.output.disconnect(); } catch { /* rien */ } }
    b.chain = [];
    let last = b.input;
    for (const f of (track.fx || [])) {
      const d = FX.AUDIO[f.type];
      if (!d || f.on === false) continue;
      const node = d.web(ac, FX.params(f, true));
      last.connect(node.input); last = node.output;
      b.chain.push(node);
    }
    last.connect(b.pan);
    b.sig = sig;
    return b;
  }
  E.trackLevel = (trackId) => {
    const b = buses.get(trackId);
    if (!b || !E.playing) return 0;
    const d = new Float32Array(b.anal.fftSize);
    b.anal.getFloatTimeDomainData(d);
    let m = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
    return m;
  };

  /* ------------------------------------------------------------ éléments médias */
  const slots = new Map();   // ev.id + ':' + kind -> slot
  E.slots = () => slots;
  function slotFor(ev, kind) {
    const key = ev.id + ':' + kind;
    let s = slots.get(key);
    const m = P.media(ev.media);
    if (!m) return null;
    const url = M.url(m, true);
    if (s && s.url !== url) { dispose(s); s = null; }
    if (s) { s.used = performance.now(); return s; }
    const el = document.createElement(kind === 'v' ? 'video' : 'audio');
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.playsInline = true;
    el.preservesPitch = true;
    if (kind === 'v') el.muted = true;
    el.addEventListener('seeked', () => {
      // Si le pointeur a bougé pendant le décodage, chercher la dernière position.
      const current = KC.project && P.event(ev.id);
      if (!E.playing && current && slots.get(key)?.el === el && kind === 'v') {
        const target = E.srcTime(current, U.clamp(E.previewTime(E.time), current.start, current.start + current.length - 0.001));
        if (Math.abs(el.currentTime - target) > 0.5 / P.fps()) el.currentTime = target;
      }
      E.needsDraw = true;
    });
    el.addEventListener('loadeddata', () => { E.needsDraw = true; });
    if (kind === 'v' && el.requestVideoFrameCallback) {
      const decoded = () => { E.needsDraw = true; if (slots.get(key)?.el === el) el.requestVideoFrameCallback(decoded); };
      el.requestVideoFrameCallback(decoded);
    }
    el.src = url;
    s = { key, kind, el, url, used: performance.now(), mediaId: m.id, hasFrame: false };
    const slot = s;
    el.addEventListener('loadeddata', () => { slot.hasFrame = true; });
    if (kind === 'a') {
      E.audio();
      s.src = ac.createMediaElementSource(el);
      s.gain = ac.createGain(); s.gain.gain.value = 0;
      s.pan = ac.createStereoPanner();
      s.src.connect(s.gain); s.gain.connect(s.pan);
      s.track = null;
    }
    slots.set(key, s);
    return s;
  }
  function dispose(s) {
    try { s.el.pause(); } catch { /* rien */ }
    s.el.removeAttribute('src'); try { s.el.load(); } catch { /* rien */ }
    if (s.src) { try { s.src.disconnect(); s.gain.disconnect(); s.pan.disconnect(); } catch { /* rien */ } }
    slots.delete(s.key);
  }
  KC.on('media-source-changed', m => { for (const s of [...slots.values()]) if (s.mediaId === m.id) dispose(s); E.needsDraw = true; });
  KC.on('project-loaded', () => { for (const s of [...slots.values()]) dispose(s); for (const b of buses.values()) { try { b.gain.disconnect(); } catch { /* rien */ } } buses.clear(); genCache.clear(); });

  // Temps source d'un événement au temps timeline t
  E.srcTime = (ev, t) => {
    let st = ev.offset + (t - ev.start) * ev.speed;
    const m = P.media(ev.media);
    const d = m && m.duration;
    if (d && st >= d - 0.001) st = ev.loop !== false ? (st % d) : d - 0.04;
    return Math.max(0, st);
  };

  /* ------------------------------------------------------------ niveaux (fondus) */
  E.fade = (ev, t) => {
    const tau = t - ev.start;
    let a = 1;
    if (ev.fadeIn > 0 && tau < ev.fadeIn) a *= U.clamp(tau / ev.fadeIn, 0, 1);
    if (ev.fadeOut > 0 && tau > ev.length - ev.fadeOut) a *= U.clamp((ev.length - tau) / ev.fadeOut, 0, 1);
    return a;
  };
  const active = (ev, t) => t >= ev.start - 1e-9 && t < ev.start + ev.length - 1e-9;

  /* ------------------------------------------------------------ synchronisation */
  function sync(t) {
    t = E.previewTime(t);
    const p = KC.project;
    const now = performance.now();
    const fps = P.fps();
    const anySoloV = p.tracks.some(tr => tr.kind === 'video' && tr.solo);
    const anySoloA = p.tracks.some(tr => tr.kind === 'audio' && tr.solo);
    const want = new Set(), activeKeys = new Set();
    for (const ev of p.events) {
      if (!ev.media) continue;
      const tr = P.track(ev.track); if (!tr) continue;
      const m = P.media(ev.media); if (!m || m.kind === 'image') continue;
      const kind = tr.kind === 'video' ? 'v' : 'a';
      if (kind === 'v' && (!m.hasVideo || ev.mute || tr.mute || (anySoloV && !tr.solo))) continue;
      if (kind === 'a' && !m.hasAudio) continue;
      const isActive = active(ev, t);
      // Préchargement : en lecture, ce qui arrive dans les 2 s ; à l'arrêt, ce qui est proche du curseur
      const soon = E.playing ? (ev.start > t && ev.start - t < 2) : (kind === 'v' && ev.start - t < 6 && ev.start + ev.length - t > -3);
      if (!isActive && (E.scrubbing || !soon)) continue;
      if (kind === 'a' && !(E.playing && E.rate > 0)) continue;   // l'audio ne joue qu'en lecture avant
      const s = slotFor(ev, kind);
      if (!s) continue;
      want.add(s.key);
      if (isActive) activeKeys.add(s.key);
      const el = s.el;
      if (!isActive && !E.playing) {
        // élément préchargé : prêt sur l'image la plus proche du curseur
        const pre = E.srcTime(ev, U.clamp(t, ev.start, ev.start + ev.length - 0.001));
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - pre) > 0.5 / fps) el.currentTime = pre;
        continue;
      }
      if (kind === 'a') {
        const b = bus(tr);
        if (s.track !== tr.id) { try { s.pan.disconnect(); } catch { /* rien */ } s.pan.connect(b.input); s.track = tr.id; }
        const muted = ev.mute || tr.mute || (anySoloA && !tr.solo);
        const g = muted || !isActive ? 0 : U.dbToGain(ev.gain + (ev.norm || 0)) * E.fade(ev, t);
        s.gain.gain.setTargetAtTime(g, ac.currentTime, 0.006);
        s.pan.pan.value = U.clamp(ev.pan || 0, -1, 1);
        b.gain.gain.setTargetAtTime(tr.mute || (anySoloA && !tr.solo) ? 0 : U.dbToGain(tr.volume), ac.currentTime, 0.01);
        b.pan.pan.value = U.clamp(tr.pan || 0, -1, 1);
      }
      void anySoloV;
      const target = isActive ? E.srcTime(ev, t) : ev.offset;
      if (E.playing && isActive && E.rate > 0 && !E.waiting) {
        const base = U.clamp(ev.speed * E.rate, 0.0625, 16);
        const diff = el.currentTime - target;          // > 0 : l'élément est en avance
        if (el.seeking) continue;                      // jamais de nouvelle recherche pendant une recherche
        if (el.paused) {
          if (Math.abs(diff) > 0.06) { el.currentTime = target; E.wait(); continue; }
          el.playbackRate = base;
          const pr = el.play(); if (pr) pr.catch(() => {});
        } else if (Math.abs(diff) > 0.6) {
          // grand écart : on se recale et l'horloge attend que l'image soit prête
          el.currentTime = target; E.wait();
        } else {
          // petit écart : rattrapage en douceur par la vitesse, sans recherche (pas d'image noire)
          const k = Math.abs(diff) < 0.02 ? 1 : U.clamp(1 - diff * 0.8, 0.85, 1.15);
          const r = base * k;
          if (Math.abs(el.playbackRate - r) > 0.004) el.playbackRate = r;
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.5 / fps && !el.seeking) el.currentTime = target;
      }
    }
    // Après une recherche en lecture : reprendre quand toutes les vidéos actives sont prêtes
    if (E.playing && E.waiting) {
      let ready = true;
      for (const key of activeKeys) { const s = slots.get(key); if (s && (s.el.seeking || s.el.readyState < 3)) { ready = false; break; } }
      if (ready || now - E.waitStart > 1500) E.resume();
    }
    for (const s of slots.values()) {
      if (want.has(s.key)) continue;
      if (!s.el.paused) s.el.pause();
      if (s.gain) s.gain.gain.value = 0;
      if (now - s.used > 30000 || slots.size > 24 && now - s.used > 4000) dispose(s);
    }
  }

  /* ------------------------------------------------------------ compositeur */
  const genCache = new Map();   // ev.id -> {sig, canvas}
  function genCanvas(ev, W, H) {
    const sig = JSON.stringify(ev.gen) + '|' + W + 'x' + H;
    let c = genCache.get(ev.id);
    if (c && c.sig === sig) return c.canvas;
    const cv = c ? c.canvas : document.createElement('canvas');
    cv.width = W; cv.height = H;
    FX.renderGen(ev.gen, cv);
    genCache.set(ev.id, { sig, canvas: cv });
    if (genCache.size > 300) genCache.delete(genCache.keys().next().value);
    return cv;
  }
  KC.on('fonts-loaded', () => { genCache.clear(); E.needsDraw = true; });
  const work = document.createElement('canvas');
  let tmZoom = 1;

  // Dessine l'image du temps t sur cv (taille déjà fixée). opts.best = lissage haute qualité.
  E.compose = (t, cv, opts = {}) => {
    const p = KC.project, st = p.settings;
    const W = cv.width, H = cv.height;
    const x = cv.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none';
    x.fillStyle = st.bg || '#000'; x.fillRect(0, 0, W, H);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = opts.best ? 'high' : 'medium';
    const vt = p.tracks.filter(tr => tr.kind === 'video');
    const anySolo = vt.some(tr => tr.solo);
    for (let i = vt.length - 1; i >= 0; i--) {
      const tr = vt[i];
      if (tr.mute || (anySolo && !tr.solo)) continue;
      const evs = p.events.filter(e => e.track === tr.id && active(e, t) && !e.mute).sort((a, b) => a.start - b.start);
      let flash = 0;
      const tm = FX.tmOf(tr), moved = !FX.tmIsIdentity(tr);
      tmZoom = tm.zoom;
      for (const ev of evs) {
        x.setTransform(1, 0, 0, 1, 0, 0);
        if (moved) { x.translate(W / 2 + tm.x * W, H / 2 + tm.y * H); x.rotate(tm.rot * Math.PI / 180); x.scale(tm.zoom, tm.zoom); x.translate(-W / 2, -H / 2); }
        drawEvent(x, ev, t, W, H, tr, opts);
        if (ev.transition === 'flash' && ev.fadeIn > 0 && t - ev.start < ev.fadeIn) flash = Math.max(flash, FX.flashAlpha((t - ev.start) / ev.fadeIn));
      }
      if (flash > 0) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = flash * tr.level; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.globalAlpha = 1; }
    }
  };

  // Calcul commun (aperçu et rendu) de l'état d'un événement vidéo au temps t
  E.videoState = (ev, t) => {
    const tau = t - ev.start;
    let alpha = ev.opacity == null ? 1 : ev.opacity, dx = 0, dy = 0, scale = 1;
    if (ev.fadeIn > 0 && tau < ev.fadeIn) {
      const s = FX.transIn(ev.transition || 'dissolve', tau / ev.fadeIn);
      alpha *= s.alpha; dx += s.dx; dy += s.dy; scale *= s.scale;
    }
    const inc = P.incoming(ev);
    if (inc && t >= inc.start && inc.fadeIn > 0) {
      const so = FX.transOut(inc.transition || 'dissolve', (t - inc.start) / inc.fadeIn);
      alpha *= so.alpha; dx += so.dx;
    } else if (!inc && ev.fadeOut > 0 && tau > ev.length - ev.fadeOut) {
      alpha *= U.clamp((ev.length - tau) / ev.fadeOut, 0, 1);
    }
    return { alpha, dx, dy, scale, tau };
  };

  function drawEvent(x, ev, t, W, H, tr, opts) {
    const vs = E.videoState(ev, t);
    const alpha = vs.alpha * (tr.level == null ? 1 : tr.level);
    if (alpha <= 0.001) return;
    let src = null, sw = 0, sh = 0;
    if (ev.gen) { src = genCanvas(ev, W, H); sw = W; sh = H; }
    else {
      const m = P.media(ev.media); if (!m) return;
      if (m.kind === 'image') { const r = M.get(m); src = r.img; if (!src) return; sw = src.naturalWidth; sh = src.naturalHeight; }
      else {
        const s = slots.get(ev.id + ':v');
        const target = E.srcTime(ev, t);
        const stale = s && !E.playing && (s.el.seeking || Math.abs(s.el.currentTime - target) > 0.5 / P.fps());
        const thumb = stale ? M.thumbAt(m, target) : null;
        if (thumb) { src = thumb; sw = m.width || thumb.naturalWidth; sh = m.height || thumb.naturalHeight; }
        else if (s && s.hasFrame && s.el.videoWidth) {
          // Pendant une recherche, la vidéo garde sa dernière image : on la dessine (pas de noir)
          src = s.el; sw = s.el.videoWidth; sh = s.el.videoHeight;
        } else {
          // Pas encore d'image décodée : vignette en attendant
          const th = M.thumbAt(m, E.srcTime(ev, t));
          if (!th) return;
          src = th; sw = m.width || th.naturalWidth; sh = m.height || th.naturalHeight;
        }
      }
    }
    if (!sw || !sh) return;
    const pc = FX.pcAt(ev.pc, vs.tau);
    const fit = Math.min(W / sw, H / sh);
    const s = fit * pc.zoom * vs.scale;
    const sEff = s * tmZoom;
    let img = src, iw = sw, ih = sh;
    if (ev.fx && ev.fx.some(f => f.on !== false)) {
      // Effets appliqués à la source, à la taille où elle sera affichée (au plus sa taille réelle)
      const k = Math.min(1, sEff);
      const ww = Math.max(2, Math.round(sw * k)), hh = Math.max(2, Math.round(sh * k));
      if (work.width !== ww || work.height !== hh) { work.width = ww; work.height = hh; }
      const wx = work.getContext('2d');
      wx.setTransform(1, 0, 0, 1, 0, 0); wx.globalAlpha = 1; wx.globalCompositeOperation = 'copy'; wx.filter = 'none';
      wx.drawImage(src, 0, 0, ww, hh);
      wx.globalCompositeOperation = 'source-over';
      img = FX.applyPreview(work, ev.fx);
    }
    x.save();
    x.globalAlpha = alpha;
    x.translate(W / 2 + vs.dx * W, H / 2 + vs.dy * H);
    if (pc.rot) x.rotate(pc.rot * Math.PI / 180);
    x.scale(s, s);
    if (img === src) x.drawImage(src, -pc.cx * sw, -pc.cy * sh, sw, sh);
    else x.drawImage(img, 0, 0, img.width, img.height, -pc.cx * sw, -pc.cy * sh, iw, ih);
    x.restore();
  }

  /* ------------------------------------------------------------ boucle principale */
  let lastFrameT = 0, playT0 = 0, playP0 = 0;
  E.loopOn = () => KC.prefs.loop && KC.project.loop.out > KC.project.loop.in + 1e-6;
  // Au bout du projet, conserver la dernière image au lieu d'un cadre noir.
  E.previewTime = t => {
    const end = P.duration();
    return !E.playing && end > 0 && Math.abs(t - end) < 1e-6 ? Math.max(0, end - P.frame()) : t;
  };
  function tick(now) {
    requestAnimationFrame(tick);
    if (!KC.project) return;
    if (E.playing) {
      // en attente (recherche en cours) : l'horloge est figée
      let t = E.waiting ? E.time : playT0 + (now - playP0) / 1000 * E.rate;
      const lp = KC.project.loop;
      if (E.loopOn() && E.rate > 0 && t >= lp.out) { t = lp.in; playT0 = t; playP0 = now; E.time = t; E.wait(); }
      if (E.loopOn() && E.rate < 0 && t < lp.in) { t = Math.max(lp.in, lp.out - P.frame()); playT0 = t; playP0 = now; E.time = t; }
      const end = P.duration();
      if (E.rate > 0 && !E.loopOn() && t >= end + 0.25) { t = end; E.pause(); }
      if (t < 0) { t = 0; E.pause(); }
      E.time = t;
      E.needsDraw = true;
      KC.emit('time', t);
    }
    if (E.needsDraw || E.playing || E.scrubbing) {
      const draw = E.needsDraw || E.playing;
      E.needsDraw = false;
      sync(E.time);
      if (draw && KC.preview && KC.preview.draw) KC.preview.draw(E.previewTime(E.time));
    }
    meters(now);
    lastFrameT = now;
  }
  void lastFrameT;
  requestAnimationFrame(tick);

  let lastMeter = -Infinity;
  const meterData = new Float32Array(1024);
  function meters(now = performance.now()) {
    if (now - lastMeter < (E.playing ? 33 : 100)) return;
    lastMeter = now;
    const lv = E.levels;
    let l = 0, r = 0;
    if (ac && E.playing) {
      const d = meterData;
      analL.getFloatTimeDomainData(d); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > l) l = v; }
      analR.getFloatTimeDomainData(d); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > r) r = v; }
    }
    lv.L = Math.max(l, lv.L * 0.88); lv.R = Math.max(r, lv.R * 0.88);
    if (l >= lv.peakL) { lv.peakL = l; lv.holdL = performance.now(); } else if (performance.now() - (lv.holdL || 0) > 1500) lv.peakL *= 0.95;
    if (r >= lv.peakR) { lv.peakR = r; lv.holdR = performance.now(); } else if (performance.now() - (lv.holdR || 0) > 1500) lv.peakR *= 0.95;
    if (l >= 1 || r >= 1) lv.clip = true;
    if (master) master.gain.value = E.masterMute ? 0 : U.dbToGain(KC.project.settings.masterGain || 0);
    KC.emit('meters', lv);
  }

  /* ------------------------------------------------------------ commandes de transport */
  E.play = (from) => {
    E.audio(); if (ac.state === 'suspended') ac.resume();
    if (from != null) E.time = Math.max(0, from);
    if (E.loopOn()) { const lp = KC.project.loop; if (E.time >= lp.out || E.time < lp.in - 1e-6) E.time = lp.in; }
    else if (E.time >= P.duration() - 0.01 && P.duration() > 0) E.time = 0;
    if (!E.playing) E.startTime = E.time;
    E.rate = E.playbackRate;
    playT0 = E.time; playP0 = performance.now();
    E.playing = true;
    E.wait();
    KC.emit('play-state', true);
  };
  E.wait = () => { if (!E.waiting) { E.waiting = true; E.waitStart = performance.now(); } };
  E.resume = () => { E.waiting = false; playT0 = E.time; playP0 = performance.now(); };
  E.setRate = rate => {
    E.rate = E.playbackRate = U.clamp(rate, 0.25, 2);
    playT0 = E.time; playP0 = performance.now();
    KC.emit('rate', E.rate);
  };
  E.shuttle = (rate) => {
    E.audio(); if (ac.state === 'suspended') ac.resume();
    if (!E.playing) E.startTime = E.time;
    E.rate = rate; playT0 = E.time; playP0 = performance.now(); E.playing = true;
    KC.emit('play-state', true);
  };
  E.pause = () => {
    if (!E.playing) return;
    E.playing = false; E.rate = E.playbackRate; E.waiting = false;
    E.time = P.snapFrame(E.time);
    for (const s of slots.values()) { try { s.el.pause(); } catch { /* rien */ } if (s.gain) s.gain.gain.value = 0; }
    E.needsDraw = true;
    KC.project.cursor = E.time;
    KC.emit('play-state', false);
    KC.emit('time', E.time);
  };
  // Arrêt « à la Vegas » : retour à la position de départ
  E.stop = () => { const back = E.playing; E.pause(); if (back) E.seek(E.startTime); };
  E.toggle = () => { if (E.playing) E.stop(); else E.play(); };
  E.togglePause = () => { if (E.playing) E.pause(); else E.play(); };
  E.seek = (t, { keep = true } = {}) => {
    t = Math.max(0, t);
    E.time = E.playing ? t : P.snapFrame(t);
    if (E.playing && keep) { playT0 = E.time; playP0 = performance.now(); E.wait(); }
    KC.project.cursor = E.time;
    E.needsDraw = true;
    KC.emit('time', E.time);
  };
  E.beginScrub = () => {
    const resume = E.playing;
    E.pause(); E.scrubbing = true; E.needsDraw = true;
    return resume;
  };
  E.endScrub = resume => {
    E.scrubbing = false; E.needsDraw = true;
    if (resume) E.play();
  };
  E.step = (n) => { if (E.playing) E.pause(); E.seek(P.snapFrame(E.time) + n / P.fps()); };
  E.redraw = () => { E.needsDraw = true; };
  KC.on('change', () => { E.needsDraw = true; });
  KC.on('media-updated', () => { E.needsDraw = true; });
})();
