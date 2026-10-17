// KaneClip — agrandissement par IA (Real-ESRGAN, ncnn/Vulkan sur la carte graphique).
// Traitement par blocs d'images pour limiter l'espace disque : extraction (ffmpeg) -> IA -> segment vidéo,
// puis assemblage des segments et remise du son d'origine.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ZIP_URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip';
const ZIP_SIZE = 45474481;
const CHUNK = 240;

module.exports = function aiUpscale({ app, send, tools }) {
  const toolDir = () => path.join(app.getPath('userData'), 'tools', 'realesrgan');
  const exePath = () => path.join(toolDir(), 'realesrgan-ncnn-vulkan.exe');
  const installed = () => { try { return fs.statSync(exePath()).size > 0 && fs.existsSync(path.join(toolDir(), 'models')); } catch { return false; } };

  function run(exe, args, opts = {}, onErr) {
    return new Promise(resolve => {
      const p = spawn(exe, args, { windowsHide: true, ...opts });
      let err = '';
      p.stderr.on('data', d => { const s = d.toString(); err = (err + s).slice(-8000); if (onErr) onErr(s); });
      p.stdout.on('data', () => {});
      p.on('error', e => resolve({ code: -1, err: String(e.message || e), p }));
      p.on('close', code => resolve({ code, err, p }));
      if (opts.onSpawn) opts.onSpawn(p);
    });
  }

  /* ------------------------------------------------------------ installation */
  async function install(e) {
    const dir = toolDir();
    fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(dir, 'realesrgan.zip.part');
    try {
      const res = await fetch(ZIP_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const out = fs.createWriteStream(zip);
      let got = 0, last = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
        if (got - last > 1e6) { last = got; e.sender.send('ai-install-progress', { got, total: ZIP_SIZE }); }
      }
      await new Promise(r => out.end(r));
      if (fs.statSync(zip).size !== ZIP_SIZE) throw new Error('Téléchargement incomplet');
      // tar (intégré à Windows 10+) sait extraire les .zip
      const r = await run('tar', ['-xf', zip, '-C', dir]);
      if (r.code !== 0) throw new Error('Extraction impossible : ' + r.err.slice(-300));
      fs.unlinkSync(zip);
      // l'archive peut contenir un sous-dossier : on remonte son contenu
      if (!fs.existsSync(exePath())) {
        for (const d of fs.readdirSync(dir)) {
          const sub = path.join(dir, d);
          if (fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, 'realesrgan-ncnn-vulkan.exe'))) {
            for (const f of fs.readdirSync(sub)) fs.renameSync(path.join(sub, f), path.join(dir, f));
            fs.rmdirSync(sub);
          }
        }
      }
      if (!installed()) throw new Error('Programme introuvable après extraction');
      return { ok: true };
    } catch (err) {
      try { fs.unlinkSync(zip); } catch { /* absent */ }
      return { ok: false, error: String(err.message || err) };
    }
  }

  /* ------------------------------------------------------------ traitement */
  const jobs = new Map();
  let seq = 0;

  async function start(o) {
    if (!installed()) return { ok: false, error: 'Real-ESRGAN n\'est pas installé' };
    const ff = tools.findFfmpeg();
    if (!ff) return { ok: false, error: 'ffmpeg introuvable' };
    const id = 'ai' + (++seq);
    const job = { id, canceled: false, procs: new Set() };
    jobs.set(id, job);
    processJob(job, o, ff).catch(err => {
      send('ai-done', { id, ok: false, error: String(err.message || err) });
    }).finally(() => jobs.delete(id));
    return { ok: true, id };
  }
  function cancel(id) {
    const j = jobs.get(id); if (!j) return false;
    j.canceled = true;
    for (const p of j.procs) { try { p.kill(); } catch { /* fini */ } }
    return true;
  }

  async function processJob(job, o, ff) {
    const t0 = Date.now();
    const work = path.join(app.getPath('temp'), 'KaneClip', 'ia-' + Date.now().toString(36));
    const inDir = path.join(work, 'in'), outDir = path.join(work, 'out');
    fs.mkdirSync(inDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
    const fps = o.fps || 30;
    const total = Math.max(1, Math.round(o.duration * fps));
    const chunks = Math.ceil(total / CHUNK);
    const segs = [];
    const track = p => { job.procs.add(p); };
    const cm = o.colorspace ? 'auto' : (o.height >= 720 ? 'bt709' : 'bt601');
    let done = 0;
    const progress = (extra) => {
      const el = (Date.now() - t0) / 1000;
      send('ai-progress', { id: job.id, done, total, percent: Math.min(100, done / total * 100), elapsed: el, fps: done / Math.max(0.1, el), ...extra });
    };
    try {
      for (let k = 0; k < chunks; k++) {
        if (job.canceled) throw new Error('canceled');
        const a = k * CHUNK, b = Math.min(total, a + CHUNK);
        const T0 = a / fps, T1 = b / fps;
        // 1. extraction exacte des images [a, b) (sélection par horodatage)
        for (const d of [inDir, outDir]) for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
        const eps = 0.25 / fps;
        let r = await run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, T0 - 2)), '-copyts', '-i', o.input,
          '-map', '0:v:0', '-vf', `select='gte(t\\,${(T0 - eps).toFixed(5)})*lt(t\\,${(T1 - eps).toFixed(5)})',scale=in_color_matrix=${cm}:flags=bicubic,format=rgb24`,
          '-fps_mode', 'passthrough', path.join(inDir, '%06d.png')], { onSpawn: track });
        if (job.canceled) throw new Error('canceled');
        if (r.code !== 0) throw new Error('Extraction des images : ' + r.err.slice(-300));
        const n = fs.readdirSync(inDir).length;
        if (!n) { done = b; continue; }
        // 2. Real-ESRGAN (le dossier de sortie se remplit au fil de l'eau : progression par comptage)
        const base = done;
        const timer = setInterval(() => { try { done = base + fs.readdirSync(outDir).length; progress({ chunk: k + 1, chunks }); } catch { /* lecture */ } }, 700);
        r = await run(exePath(), ['-i', inDir, '-o', outDir, '-n', o.model, '-s', String(o.modelScale), '-f', 'png', '-j', '2:2:2'], { cwd: toolDir(), onSpawn: track });
        clearInterval(timer);
        if (job.canceled) throw new Error('canceled');
        if (r.code !== 0 || fs.readdirSync(outDir).length < n) throw new Error('Real-ESRGAN : ' + (r.err.split('\n').filter(l => /error|fail|vk/i.test(l)).slice(-3).join(' ') || 'échec (carte graphique Vulkan requise)'));
        done = base + n;
        progress({ chunk: k + 1, chunks });
        // 3. segment vidéo (taille finale exacte)
        const seg = path.join(work, `seg_${String(k).padStart(4, '0')}.mkv`);
        r = await run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(outDir, '%06d.png'),
          '-vf', `scale=${o.width}:${o.height}:flags=lanczos:out_color_matrix=bt709,format=yuv420p`,
          ...o.vcodec, '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', seg], { onSpawn: track });
        if (job.canceled) throw new Error('canceled');
        if (r.code !== 0) throw new Error('Encodage : ' + r.err.slice(-300));
        segs.push(seg);
      }
      // 4. assemblage + son d'origine
      progress({ stage: 'assemblage' });
      const list = path.join(work, 'segments.txt');
      fs.writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
      const tmpOut = o.output + '.part.mp4';
      const r = await run(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', o.input,
        '-map', '0:v:0', '-map', '1:a?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', tmpOut], { onSpawn: track });
      if (job.canceled) throw new Error('canceled');
      if (r.code !== 0) throw new Error('Assemblage : ' + r.err.slice(-300));
      fs.renameSync(tmpOut, o.output);
      send('ai-done', { id: job.id, ok: true, output: o.output, elapsed: (Date.now() - t0) / 1000 });
    } catch (err) {
      try { fs.unlinkSync(o.output + '.part.mp4'); } catch { /* absent */ }
      if (String(err.message) === 'canceled') send('ai-done', { id: job.id, ok: false, canceled: true });
      else throw err;
    } finally {
      try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* occupé */ }
    }
  }

  return { installed, install, start, cancel, size: ZIP_SIZE, toolDir };
};
