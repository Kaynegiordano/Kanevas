// KaneClip — outils médias du processus principal : ffmpeg (analyse, formes d'onde,
// vignettes, proxys, rendu). Tout passe par des processus ffmpeg lancés sans console.
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

module.exports = function mediaTools({ app, send }) {
  /* ------------------------------------------------------------ binaire ffmpeg */
  let ffmpeg = null;
  function findFfmpeg() {
    if (ffmpeg) return ffmpeg;
    const cands = [
      process.resourcesPath && path.join(process.resourcesPath, 'bin', 'ffmpeg.exe'),
      path.join(__dirname, 'bin', 'ffmpeg.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    ].filter(Boolean);
    for (const c of cands) { try { if (fs.statSync(c).size > 0) return (ffmpeg = c); } catch { /* absent */ } }
    // Dernier recours : le PATH
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
      const c = path.join(dir, 'ffmpeg.exe');
      try { if (fs.statSync(c).isFile()) return (ffmpeg = c); } catch { /* absent */ }
    }
    return null;
  }

  const run = (args, opts = {}) => new Promise(resolve => {
    const exe = findFfmpeg();
    if (!exe) return resolve({ code: -1, stdout: Buffer.alloc(0), stderr: 'ffmpeg introuvable' });
    const p = spawn(exe, args, { windowsHide: true, ...opts });
    const out = [], err = [];
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => err.push(d));
    p.on('error', e => resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(e.message || e) }));
    p.on('close', code => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }));
  });

  /* ------------------------------------------------------------ cache par fichier */
  const cacheRoot = () => path.join(app.getPath('userData'), 'cache');
  function cacheDir(file) {
    const st = fs.statSync(file);
    const key = crypto.createHash('sha1').update(path.resolve(file).toLowerCase() + '|' + st.size + '|' + Math.round(st.mtimeMs)).digest('hex').slice(0, 20);
    const dir = path.join(cacheRoot(), key);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /* ------------------------------------------------------------ analyse */
  const IMAGE_EXT = /\.(png|jpe?g|bmp|gif|webp|tiff?|tga|avif|heic|jfif)$/i;
  const AUDIO_EXT = /\.(mp3|wav|flac|aac|m4a|ogg|opus|wma|aiff?|ac3)$/i;

  async function probe(file) {
    if (!fs.existsSync(file)) return { ok: false, error: 'Fichier introuvable' };
    const r = await run(['-hide_banner', '-i', file]);
    const s = r.stderr;
    if (/Invalid data found|No such file|could not find codec/i.test(s) && !/Stream #/.test(s)) return { ok: false, error: 'Format non reconnu' };
    const info = { ok: true, path: file, name: path.basename(file), size: fs.statSync(file).size };
    const dm = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    info.duration = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0;
    const br = s.match(/bitrate:\s*(\d+)\s*kb\/s/); if (br) info.bitrate = +br[1];
    const streams = s.split(/\n/).filter(l => /Stream #\d+:\d+/.test(l));
    const vLine = streams.find(l => /Video:/.test(l) && !/attached pic/i.test(l));
    const aLine = streams.find(l => /Audio:/.test(l));
    if (vLine) {
      const codec = (vLine.match(/Video:\s*([\w-]+)/) || [])[1] || '';
      const wh = vLine.match(/,\s*(\d{2,5})x(\d{2,5})/);
      const fps = vLine.match(/([\d.]+)\s*fps/) || vLine.match(/([\d.]+)\s*tbr/);
      info.video = { codec, width: wh ? +wh[1] : 0, height: wh ? +wh[2] : 0, fps: fps ? parseFloat(fps[1]) : 0, pix: (vLine.match(/Video:[^,]*,\s*([\w]+)/) || [])[1] || '' };
      // matrice de couleurs déclarée (sinon : vide, l'aperçu Chromium suppose BT.709 en HD)
      const cs = vLine.match(/\b(bt709|bt470bg|smpte170m|bt2020nc|bt2020c|smpte240m|fcc|bt601)\b/);
      info.video.colorspace = cs ? cs[1] : '';
      // Rotation des vidéos de téléphone : Chromium et ffmpeg la corrigent tous deux.
      const rot = s.match(/rotation of (-?[\d.]+) degrees/) || s.match(/rotate\s*:\s*(-?\d+)/);
      if (rot && Math.abs(Math.round(parseFloat(rot[1]))) % 180 === 90) {
        info.video.rotated = true;
        [info.video.width, info.video.height] = [info.video.height, info.video.width];
      }
    }
    if (aLine) {
      const codec = (aLine.match(/Audio:\s*([\w-]+)/) || [])[1] || '';
      const sr = aLine.match(/(\d+)\s*Hz/);
      const ch = aLine.match(/Hz,\s*([^,]+)/);
      info.audio = { codec, rate: sr ? +sr[1] : 48000, layout: ch ? ch[1].trim() : '' };
    }
    if (IMAGE_EXT.test(file) || (vLine && !info.duration && !aLine) || (info.video && /^(png|mjpeg|bmp|webp|tiff|gif)$/.test(info.video.codec) && info.duration <= 0.05)) {
      if (!/\.gif$/i.test(file) || info.duration <= 0.05) { info.kind = 'image'; info.duration = 0; }
    }
    if (!info.kind) info.kind = info.video ? 'video' : info.audio ? 'audio' : null;
    if (!info.kind) return { ok: false, error: 'Aucun flux audio ou vidéo' };
    if (info.kind === 'audio' && !AUDIO_EXT.test(file) && !info.audio) return { ok: false, error: 'Aucun flux audio' };
    try { info.cache = cacheDir(file); } catch { /* lecture seule */ }
    return info;
  }

  /* ------------------------------------------------------------ forme d'onde */
  // 100 crêtes par seconde (0-255), mixage mono. Mise en cache sur disque.
  const PEAKS_PER_SEC = 100;
  async function waveform(file) {
    let dir = null;
    try { dir = cacheDir(file); } catch { /* pas de cache */ }
    const cached = dir && path.join(dir, 'peaks.u8');
    if (cached && fs.existsSync(cached)) return { ok: true, rate: PEAKS_PER_SEC, data: fs.readFileSync(cached) };
    const exe = findFfmpeg();
    if (!exe) return { ok: false, error: 'ffmpeg introuvable' };
    const SR = 8000, per = SR / PEAKS_PER_SEC;
    return new Promise(resolve => {
      const p = spawn(exe, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { windowsHide: true });
      const peaks = [];
      let carry = Buffer.alloc(0), acc = 0, n = 0;
      p.stdout.on('data', chunk => {
        const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        const usable = buf.length - (buf.length % 4);
        for (let i = 0; i < usable; i += 4) {
          const v = Math.abs(buf.readFloatLE(i));
          if (v > acc) acc = v;
          if (++n >= per) { peaks.push(Math.min(255, Math.round(Math.sqrt(Math.min(1, acc)) * 255))); acc = 0; n = 0; }
        }
        carry = buf.subarray(usable);
      });
      p.on('error', e => resolve({ ok: false, error: String(e.message || e) }));
      p.on('close', () => {
        if (n) peaks.push(Math.min(255, Math.round(Math.sqrt(Math.min(1, acc)) * 255)));
        const data = Buffer.from(peaks);
        if (cached && data.length) { try { fs.writeFileSync(cached, data); } catch { /* ignore */ } }
        resolve({ ok: data.length > 0, rate: PEAKS_PER_SEC, data, error: data.length ? null : 'Pas de piste audio' });
      });
    });
  }

  /* ------------------------------------------------------------ vignettes */
  async function thumbs(file, duration) {
    let dir;
    try { dir = cacheDir(file); } catch (e) { return { ok: false, error: String(e.message || e) }; }
    const meta = path.join(dir, 'thumbs.json');
    if (fs.existsSync(meta)) { try { return { ok: true, dir, ...JSON.parse(fs.readFileSync(meta, 'utf8')) }; } catch { /* refaire */ } }
    const tdir = path.join(dir, 'thumbs');
    fs.mkdirSync(tdir, { recursive: true });
    const d = Math.max(0.1, duration || 1);
    const step = Math.max(0.5, Math.min(10, d / 240));
    const r = await run(['-hide_banner', '-loglevel', 'error', '-y', '-skip_frame', 'nokey', '-i', file,
      '-vf', `fps=1/${step},scale=-2:72:flags=fast_bilinear`, '-fps_mode', 'vfr', '-q:v', '6', path.join(tdir, 't_%05d.jpg')]);
    let count = fs.readdirSync(tdir).filter(f => f.endsWith('.jpg')).length;
    if (!count) {
      // Les images-clés seules ne suffisent pas pour certains fichiers : décodage complet
      await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', `fps=1/${step},scale=-2:72`, '-q:v', '6', path.join(tdir, 't_%05d.jpg')]);
      count = fs.readdirSync(tdir).filter(f => f.endsWith('.jpg')).length;
    }
    if (!count) return { ok: false, error: r.stderr.slice(-300) };
    const res = { step, count };
    fs.writeFileSync(meta, JSON.stringify(res));
    return { ok: true, dir, ...res };
  }

  /* ------------------------------------------------------------ travaux longs (proxy, rendu) */
  const jobs = new Map();
  let jobSeq = 0;

  function jobStart({ args, duration, label, onClose, cwd }) {
    const exe = findFfmpeg();
    if (!exe) return { ok: false, error: 'ffmpeg introuvable' };
    const id = ++jobSeq;
    const full = ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args];
    const p = spawn(exe, full, { windowsHide: true, ...(cwd && fs.existsSync(cwd) ? { cwd } : {}) });
    const job = { id, p, log: '', canceled: false, start: Date.now(), label };
    jobs.set(id, job);
    let buf = '';
    p.stdout.on('data', d => {
      buf += d.toString();
      let i;
      const st = {};
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const m = line.match(/^(\w+)=(.*)$/);
        if (!m) continue;
        st[m[1]] = m[2];
        if (m[1] === 'progress') {
          const us = parseInt(st.out_time_us || st.out_time_ms || '0', 10);
          const t = isFinite(us) ? us / 1e6 : 0;
          send('job-progress', { id, time: t, percent: duration ? Math.max(0, Math.min(100, t / duration * 100)) : 0, fps: parseFloat(st.fps) || 0, speed: st.speed || '', elapsed: (Date.now() - job.start) / 1000 });
        }
      }
    });
    p.stderr.on('data', d => { job.log = (job.log + d.toString()).slice(-20000); });
    p.on('error', e => { job.log += '\n' + e.message; });
    p.on('close', code => {
      jobs.delete(id);
      const ok = code === 0 && !job.canceled;
      if (onClose) { try { onClose(ok); } catch { /* ignore */ } }
      send('job-done', { id, ok, canceled: job.canceled, code, error: ok ? null : lastError(job.log), log: job.log, elapsed: (Date.now() - job.start) / 1000 });
    });
    return { ok: true, id };
  }
  function lastError(log) {
    const lines = String(log || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const errs = lines.filter(l => /error|invalid|cannot|failed|unable|not found|no such/i.test(l));
    return (errs.slice(-3).join('\n') || lines.slice(-3).join('\n') || 'Erreur ffmpeg').slice(0, 900);
  }
  function jobCancel(id) {
    const j = jobs.get(id);
    if (!j) return false;
    j.canceled = true;
    try { j.p.stdin.write('q'); } catch { /* fermé */ }
    setTimeout(() => { try { j.p.kill(); } catch { /* déjà fini */ } }, 1500);
    return true;
  }

  /* ------------------------------------------------------------ proxys */
  function proxyPath(file) { try { return path.join(cacheDir(file), 'proxy-v2.mp4'); } catch { return null; } }
  // Proxy d'édition : 720p, image-clé toutes les 10 images (navigation quasi instantanée), encodé sur GPU si possible
  async function proxyStart(file, info) {
    const out = proxyPath(file);
    if (!out) return { ok: false, error: 'Cache indisponible' };
    const tmp = out.replace(/\.mp4$/, '.part.mp4');
    const enc = await encoders().catch(() => ({ hw: {} }));
    const args = ['-y', '-hwaccel', 'auto', '-i', file];
    if (info && info.video) {
      const v = info.video || {};
      const cm = v.colorspace ? 'auto' : (v.height >= 720 || !v.height ? 'bt709' : 'bt601');
      args.push('-map', '0:v:0', '-vf', `scale=-2:min(ih\\,720):flags=bicubic:in_color_matrix=${cm}:out_color_matrix=bt709,format=yuv420p`, '-g', '10', '-bf', '0',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');
      if (enc.hw && enc.hw.h264_nvenc) args.push('-c:v', 'h264_nvenc', '-preset', 'p2', '-rc', 'vbr', '-cq', '26', '-b:v', '0');
      else if (enc.hw && enc.hw.h264_qsv) args.push('-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '26');
      else if (enc.hw && enc.hw.h264_amf) args.push('-c:v', 'h264_amf', '-quality', 'speed');
      else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'fastdecode', '-crf', '24');
    } else args.push('-vn');
    if (info && info.audio) args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k', '-ac', '2');
    args.push('-movflags', '+faststart', tmp);
    const r = jobStart({
      args, duration: info && info.duration, label: 'proxy',
      onClose: ok => { if (ok) fs.renameSync(tmp, out); else { try { fs.unlinkSync(tmp); } catch { /* absent */ } } },
    });
    return { ...r, out };
  }

  // Intervalle moyen entre images-clés (s) sur les 40 premières secondes : plus il est long, plus la navigation est lente
  async function keyInterval(file) {
    const r = await run(['-hide_banner', '-skip_frame', 'nokey', '-t', '40', '-i', file, '-map', '0:v:0', '-vf', 'showinfo', '-f', 'null', '-']);
    const ts = [...r.stderr.matchAll(/pts_time:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
    if (ts.length < 2) return ts.length === 1 ? 40 : 0;
    return (ts[ts.length - 1] - ts[0]) / (ts.length - 1);
  }

  /* ------------------------------------------------------------ encodeurs */
  let encCache = null;
  async function encoders() {
    if (encCache) return encCache;
    const r = await run(['-hide_banner', '-encoders']);
    const list = new Set((r.stderr + r.stdout.toString()).split(/\n/).map(l => (l.match(/^\s*[VAS][\w.]{5}\s+(\S+)/) || [])[1]).filter(Boolean));
    const res = { list: [...list], hw: {} };
    // Un encodeur matériel n'est utilisable que si le GPU répond vraiment
    for (const enc of ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_qsv', 'hevc_qsv', 'h264_amf', 'hevc_amf']) {
      if (!list.has(enc)) continue;
      const t = await run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x144:d=0.1', '-frames:v', '2', '-c:v', enc, '-f', 'null', '-']);
      res.hw[enc] = t.code === 0;
    }
    // Filtres d'agrandissement : libplacebo (GPU Vulkan) seulement s'il s'initialise vraiment
    const fl = await run(['-hide_banner', '-filters']);
    const ftext = fl.stdout.toString() + fl.stderr;
    res.filters = { cas: /\scas\s/.test(ftext), libplacebo: false, hqdn3d: /\shqdn3d\s/.test(ftext) };
    if (/\slibplacebo\s/.test(ftext)) {
      const t = await run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:d=0.1', '-vf', 'format=rgba,libplacebo=w=640:h=360:upscaler=ewa_lanczossharp:format=rgba', '-frames:v', '1', '-f', 'null', '-']);
      res.filters.libplacebo = t.code === 0;
    }
    encCache = res;
    return res;
  }

  return {
    findFfmpeg, probe, waveform, thumbs, jobStart, keyInterval, jobCancel, proxyPath, proxyStart, encoders,
    cancelAll: () => { for (const id of jobs.keys()) jobCancel(id); },
    version: async () => { const r = await run(['-version']); return (r.stdout.toString().split('\n')[0] || '').trim(); },
    cacheRoot,
  };
};
