// Médias du projet : import (analyse ffmpeg), vignettes, formes d'onde, proxys et travaux en arrière-plan.
'use strict';
(() => {
  const U = KC.util, N = KC.native, P = KC.P;
  const M = KC.media = { rt: new Map() };

  /* ------------------------------------------------------------ travaux ffmpeg (proxy, rendu) */
  const jobs = KC.jobs = new Map();
  if (N) {
    N.onJobProgress(p => { const j = jobs.get(p.id); if (j && j.onProgress) j.onProgress(p); KC.emit('jobs'); });
    N.onJobDone(p => { const j = jobs.get(p.id); jobs.delete(p.id); if (j && j.onDone) j.onDone(p); KC.emit('jobs'); });
  }
  KC.runJob = async (job) => {
    const r = await N.jobStart({ args: job.args, cwd: job.cwd, duration: job.duration, label: job.label });
    if (!r.ok) throw new Error(r.error || 'Impossible de lancer ffmpeg');
    jobs.set(r.id, { label: job.label, title: job.title, onProgress: job.onProgress, onDone: job.onDone, percent: 0 });
    KC.emit('jobs');
    return r.id;
  };

  /* ------------------------------------------------------------ données d'exécution */
  M.get = (m) => {
    if (!m) return null;
    let r = M.rt.get(m.id);
    if (!r) { r = { thumbs: null, thumbImgs: new Map(), peaks: null, peakRate: 100, proxy: null, img: null, playable: null, missing: false, busy: {} }; M.rt.set(m.id, r); }
    return r;
  };
  M.url = (m, preview = true) => {
    const r = M.get(m);
    return U.mediaUrl(preview && r.proxy ? r.proxy : m.path);
  };

  const VIDEO_OK = /^(h264|hevc|vp8|vp9|av1|theora)$/;
  const AUDIO_OK = /^(aac|mp3|opus|vorbis|flac|pcm_s16le|pcm_s24le|pcm_f32le|pcm_u8|pcm_s32le|alac)$/;
  const CONT_OK = /^(mp4|m4v|mov|webm|mkv|ogv|ogg|mp3|wav|flac|opus|m4a|aac|oga)$/;
  M.needsProxy = (info) => {
    const ext = U.ext(info.path);
    if (info.kind === 'image') return false;
    if (!CONT_OK.test(ext)) return true;
    if (info.video && !VIDEO_OK.test(info.video.codec)) return true;
    if (info.audio && !AUDIO_OK.test(info.audio.codec)) return true;
    if (info.video && /^(yuv422|yuv444|yuv420p10|yuv422p10)/.test(info.video.pix) && info.video.codec === 'h264') return true;
    return false;
  };

  /* ------------------------------------------------------------ import */
  const MEDIA_RE = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mts|m2ts|ts|mpg|mpeg|3gp|ogv|mxf|dv|mp3|wav|flac|aac|m4a|ogg|opus|wma|aiff?|ac3|png|jpe?g|bmp|gif|webp|tiff?|tga|avif|jfif)$/i;
  M.isMedia = p => MEDIA_RE.test(p || '');
  M.FILTERS = [
    { name: 'Tous les médias', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', '3gp', 'ogv', 'mxf', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aif', 'aiff', 'ac3', 'png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'tif', 'tiff', 'tga', 'avif'] },
    { name: 'Vidéo', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', '3gp', 'ogv', 'mxf'] },
    { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aif', 'aiff', 'ac3'] },
    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'tif', 'tiff', 'tga', 'avif'] },
  ];

  M.findByPath = p => KC.project.media.find(m => m.path.toLowerCase() === String(p).toLowerCase());

  // Importe une liste de chemins ; retourne les médias (existants ou nouveaux), dans l'ordre
  M.import = async (paths, { silent = false } = {}) => {
    const out = [];
    const errors = [];
    const fresh = [];
    for (const p of paths) {
      const known = M.findByPath(p);
      if (known) { out.push(known); continue; }
      const info = await N.probe(p);
      if (!info || !info.ok) { errors.push(U.base(p) + ' : ' + ((info && info.error) || 'illisible')); continue; }
      const m = {
        id: U.uid(), path: p, name: info.name, kind: info.kind, duration: info.duration || 0, size: info.size,
        width: info.video ? info.video.width : 0, height: info.video ? info.video.height : 0, fps: info.video ? info.video.fps : 0,
        vcodec: info.video ? info.video.codec : '', acodec: info.audio ? info.audio.codec : '', rate: info.audio ? info.audio.rate : 0,
        layout: info.audio ? info.audio.layout : '', bitrate: info.bitrate || 0,
        hasVideo: info.kind !== 'audio' && !!info.video, hasAudio: info.kind !== 'image' && !!info.audio,
        colorspace: info.video ? info.video.colorspace || '' : '',
      };
      out.push(m); fresh.push([m, info]);
    }
    if (fresh.length) {
      KC.edit(fresh.length > 1 ? 'Importer des médias' : 'Importer un média', () => { for (const [m] of fresh) KC.project.media.push(m); });
      for (const [m, info] of fresh) M.prepare(m, info);
    }
    if (errors.length && !silent) KC.toast('Non importé : ' + errors.slice(0, 3).join(' · '), 'err', 6000);
    return out;
  };

  // Prépare un média (vignettes, forme d'onde, proxy) en arrière-plan
  M.prepare = async (m, info) => {
    const r = M.get(m);
    if (!(await N.exists(m.path))) { r.missing = true; KC.emit('media-updated', m); return; }
    r.missing = false;
    const proxy = await N.proxyPath(m.path);
    if (proxy) r.proxy = proxy;
    if (m.kind === 'image') {
      U.loadImage(U.mediaUrl(m.path)).then(img => { r.img = img; if (!m.width) { m.width = img.naturalWidth; m.height = img.naturalHeight; } KC.emit('media-updated', m); }).catch(() => { r.missing = true; KC.emit('media-updated', m); });
    }
    if (m.hasVideo && m.kind === 'video' && !r.busy.thumbs) {
      r.busy.thumbs = true;
      N.thumbs(m.path, m.duration).then(t => { r.busy.thumbs = false; if (t && t.ok) { r.thumbs = t; KC.emit('media-updated', m); } });
    }
    if (m.hasAudio && !r.busy.peaks) {
      r.busy.peaks = true;
      N.waveform(m.path).then(w => { r.busy.peaks = false; if (w && w.ok) { r.peaks = new Uint8Array(w.data); r.peakRate = w.rate; KC.emit('media-updated', m); } });
    }
    if (!r.proxy && KC.prefs.autoProxy) {
      let need = info ? M.needsProxy(info) : M.needsProxy({ path: m.path, kind: m.kind, video: m.hasVideo ? { codec: m.vcodec, pix: '' } : null, audio: m.hasAudio ? { codec: m.acodec } : null });
      if (!need && m.kind !== 'image') need = !(await M.canPlay(m));
      // Proxy intelligent : vidéos lourdes ou à images-clés espacées (navigation lente dans l'original)
      if (!need && m.kind === 'video' && KC.prefs.smartProxy !== false) {
        if (m.height > 1080 || (m.bitrate && m.bitrate > 40000)) need = true;
        else if (m.duration > 3) {
          const ki = await N.keyInterval(m.path).catch(() => 0);
          m.keyint = ki;
          if (ki > 1.1) need = true;
        }
      }
      if (need) M.makeProxy(m, info);
    }
  };

  // Vérifie que Chromium sait lire le fichier
  M.canPlay = (m) => new Promise(resolve => {
    const el = document.createElement(m.hasVideo ? 'video' : 'audio');
    el.preload = 'metadata'; el.muted = true; el.crossOrigin = 'anonymous';
    let done = false;
    const fin = ok => { if (done) return; done = true; el.removeAttribute('src'); el.load(); resolve(ok); };
    el.onloadeddata = () => fin(!m.hasVideo || el.videoWidth > 0);
    el.onloadedmetadata = () => { if (!m.hasVideo) fin(true); };
    el.onerror = () => fin(false);
    setTimeout(() => fin(el.readyState >= 1), 6000);
    el.src = U.mediaUrl(m.path);
  });

  M.makeProxy = async (m, info) => {
    const r = M.get(m);
    if (r.busy.proxy) return;
    r.busy.proxy = 0.001;
    KC.emit('media-updated', m);
    try {
      const res = await N.proxyStart(m.path, info || { video: m.hasVideo ? {} : null, audio: m.hasAudio ? {} : null, duration: m.duration });
      if (!res.ok) throw new Error(res.error);
      jobs.set(res.id, {
        label: 'proxy', title: 'Proxy : ' + m.name,
        onProgress: p => { r.busy.proxy = Math.max(0.001, p.percent); KC.emit('media-updated', m); },
        onDone: d => {
          r.busy.proxy = 0;
          if (d.ok) { r.proxy = res.out; KC.toast('Proxy prêt : ' + m.name, 'ok'); KC.emit('media-source-changed', m); }
          else if (!d.canceled) KC.toast('Proxy impossible pour ' + m.name + ' : ' + (d.error || ''), 'err', 6000);
          KC.emit('media-updated', m);
        },
      });
      KC.emit('jobs');
    } catch (e) {
      r.busy.proxy = 0;
      KC.toast('Proxy impossible : ' + e.message, 'err');
      KC.emit('media-updated', m);
    }
  };

  /* ------------------------------------------------------------ vignettes et ondes pour la timeline */
  const thumbCache = new Map();
  let thumbRedraw = null;
  M.thumbAt = (m, t) => {
    const r = M.get(m);
    if (m.kind === 'image') return r.img;
    if (!r.thumbs) return null;
    const i = U.clamp(Math.floor(t / r.thumbs.step), 0, r.thumbs.count - 1);
    const url = U.mediaUrl(r.thumbs.dir + '\\thumbs\\t_' + String(i + 1).padStart(5, '0') + '.jpg');
    let img = thumbCache.get(url);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';   // sinon le canevas d'aperçu serait « contaminé » (clichés impossibles)
      img.onload = () => { KC.engine.redraw(); clearTimeout(thumbRedraw); thumbRedraw = setTimeout(() => KC.emit('redraw-timeline'), 30); };
      img.src = url;
      thumbCache.set(url, img);
      if (thumbCache.size > 4000) { const k = thumbCache.keys().next().value; thumbCache.delete(k); }
    }
    return img.complete && img.naturalWidth ? img : null;
  };
  M.thumbUrl = (m, t) => {
    const r = M.get(m);
    if (!r.thumbs) return null;
    const i = U.clamp(Math.floor(t / r.thumbs.step), 0, r.thumbs.count - 1);
    return U.mediaUrl(r.thumbs.dir + '\\thumbs\\t_' + String(i + 1).padStart(5, '0') + '.jpg');
  };
  M.posterUrl = (m) => {
    const r = M.get(m);
    if (m.kind === 'image') return U.mediaUrl(m.path);
    if (!r.thumbs) return null;
    const i = Math.min(r.thumbs.count - 1, Math.max(0, Math.floor(r.thumbs.count * 0.1)));
    return U.mediaUrl(r.thumbs.dir + '\\thumbs\\t_' + String(i + 1).padStart(5, '0') + '.jpg');
  };

  // Crête maximale (0-1) d'un média entre deux temps source
  M.peakRange = (m, t0, t1) => {
    const r = M.get(m);
    if (!r.peaks) return null;
    const a = Math.max(0, Math.floor(t0 * r.peakRate)), b = Math.min(r.peaks.length, Math.ceil(t1 * r.peakRate));
    let mx = 0;
    for (let i = a; i < b; i++) if (r.peaks[i] > mx) mx = r.peaks[i];
    const v = mx / 255;
    return v * v;
  };

  // Réparer les liens vers les médias déplacés : recherche par nom dans un dossier
  M.relink = async (m) => {
    const files = await N.openDialog({ title: 'Rechercher « ' + m.name + ' »', multi: false, filters: M.FILTERS });
    if (!files.length) return;
    const p = files[0];
    const info = await N.probe(p);
    if (!info.ok) { KC.toast('Fichier illisible', 'err'); return; }
    KC.edit('Remplacer le média', () => { m.path = p; m.name = info.name; });
    const r = M.get(m); r.thumbs = null; r.peaks = null; r.proxy = null; r.img = null; r.missing = false;
    thumbCache.clear();
    M.prepare(m, info);
    KC.emit('media-source-changed', m);
  };

  M.isUsed = (m) => KC.project.events.some(e => e.media === m.id);
  M.removeUnused = () => {
    const unused = KC.project.media.filter(m => !M.isUsed(m));
    if (!unused.length) { KC.toast('Tous les médias sont utilisés', 'info'); return; }
    KC.edit('Supprimer les médias inutilisés', () => { KC.project.media = KC.project.media.filter(m => M.isUsed(m)); });
    KC.toast(unused.length + ' média(s) retiré(s) du projet', 'ok');
  };

  // Remplace le fichier d'un média (même cadrage relatif) ; l'original est mémorisé pour pouvoir revenir
  M.replaceSource = async (m, p) => {
    const info = await N.probe(p);
    if (!info.ok) { KC.toast('Fichier illisible : ' + info.error, 'err'); return false; }
    KC.edit('Remplacer par la version agrandie', () => {
      if (!m.origPath) m.origPath = m.path;
      m.path = p; m.name = info.name; m.size = info.size;
      if (info.video) { m.width = info.video.width; m.height = info.video.height; m.vcodec = info.video.codec; m.colorspace = info.video.colorspace || ''; }
    });
    const r = M.get(m); r.thumbs = null; r.peaks = null; r.proxy = null; r.img = null; r.missing = false;
    M.prepare(m, info);
    KC.emit('media-source-changed', m);
    KC.emit('media-updated', m);
    return true;
  };
  M.restoreOriginal = async (m) => {
    const orig = m.origPath;
    if (orig && await M.replaceSource(m, orig)) KC.edit('Revenir à l\'original', () => { delete m.origPath; });
  };

  // Importe en demandant à l'utilisateur
  KC.cmd.importMedia = async () => {
    const files = await N.openDialog({ title: 'Importer des médias', filters: M.FILTERS });
    if (files.length) await M.import(files);
  };
})();
