// Espaces « ComfyUI » et « Wallpaper » : Kanevas démarre leurs serveurs locaux (ou reprend ceux que Kane OS a déjà
// lancés), les arrête en quittant, et fait le lien avec l'Édition (envoi d'images, sorties à importer).
// Wallpaper Engine Animator rebouche ses fonds avec le moteur Forge de Kanevas : il le joint par WEA_FORGE_URL, et
// demande son démarrage à un petit relais local qui parle comme le lanceur Kane OS (WEA_LANCEUR_URL).
const { ipcMain, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const RELAY_PORT = 8601;

module.exports = function services({ getWin, root, engine }) {
  const SV = {
    comfyui: {
      name: 'ComfyUI', port: 8188, ping: '/system_stats',
      dir: () => path.join(root(), 'ComfyUI'),
      check: d => fs.existsSync(path.join(d, 'main.py')) && fs.existsSync(path.join(d, 'venv', 'Scripts', 'python.exe')),
      cmd: d => [path.join(d, 'venv', 'Scripts', 'python.exe'), ['-u', path.join(d, 'main.py'), '--port', '8188', '--listen', '127.0.0.1', '--disable-auto-launch', '--enable-manager', '--output-directory', path.join(root(), 'output', 'comfyui')]],
    },
    wallpaper: {
      name: 'Wallpaper Engine Animator', port: 8780, ping: '/api/projets',
      dir: () => path.join(root(), 'wallpaper-engine-animator'),
      check: d => fs.existsSync(path.join(d, 'outils', 'peintre.py')) && fs.existsSync(path.join(d, 'venv', 'Scripts', 'python.exe')),
      cmd: d => [path.join(d, 'venv', 'Scripts', 'python.exe'), ['-u', path.join(d, 'outils', 'peintre.py'), '--port', '8780', '--sans-navigateur']],
      env: async () => ({ WEA_FORGE_URL: await engine.forgeUrl(), WEA_LANCEUR_URL: 'http://127.0.0.1:' + RELAY_PORT }),
    },
  };
  // ComfyUI refuse les requêtes « cross-site » (protection CSRF) : vue de Kanevas, sa page dans le cadre en est une.
  // Seules les requêtes de cette fenêtre vers ComfyUI local sont présentées comme venant du même site.
  require('electron').session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1:8188/*'] }, (d, cb) => {
    const hd = d.requestHeaders;
    if (hd['Sec-Fetch-Site'] === 'cross-site') hd['Sec-Fetch-Site'] = 'same-site';
    cb({ requestHeaders: hd });
  });
  const st = {};
  for (const id in SV) st[id] = { state: 'off', ours: false, pid: null, log: [], error: '', forge: '' };
  const status = id => ({ id, name: SV[id].name, url: `http://127.0.0.1:${SV[id].port}/`, state: st[id].state, ours: st[id].ours, error: st[id].error, found: SV[id].check(SV[id].dir()), dir: SV[id].dir(), forge: st[id].forge });
  const emit = id => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('svc', status(id)); };
  const ping = (id, ms = 1500) => new Promise(res => {
    const r = http.get({ host: '127.0.0.1', port: SV[id].port, path: SV[id].ping, timeout: ms }, x => { x.resume(); res(x.statusCode < 500); });
    r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
  });
  const pidOnPort = port => {
    try {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, encoding: 'utf8' });
      const m = out.split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(c => c[0] === 'TCP' && +String(c[1]).split(':').pop() === port && c[3] === 'LISTENING');
      return m ? +m[4] : null;
    } catch { return null; }
  };
  const log = (id, line) => { const L = st[id].log; L.push(line); if (L.length > 600) L.splice(0, L.length - 600); };

  async function start(id) {
    const S = st[id], D = SV[id];
    if (S.state === 'ready' || S.state === 'external' || S.state === 'starting') return status(id);
    if (await ping(id)) { S.state = 'external'; S.ours = false; emit(id); return status(id); }      // lancé par Kane OS
    const d = D.dir();
    if (!D.check(d)) { S.state = 'error'; S.error = D.name + ' introuvable ou incomplet : ' + d; emit(id); return status(id); }
    if (id === 'wallpaper') startRelay();
    const [py, args] = D.cmd(d);
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...(D.env ? await D.env() : {}) };
    S.forge = env.WEA_FORGE_URL || '';
    S.log = []; S.error = ''; S.state = 'starting'; S.ours = true; emit(id);
    log(id, '> ' + [py, ...args].join(' '));
    const child = spawn(py, args, { cwd: d, windowsHide: true, env });
    S.pid = child.pid;
    const onData = b => String(b).split(/\r?\n|\r/).forEach(l => { if (l.trim()) log(id, l.slice(0, 400)); });
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('exit', code => {
      if (S.pid !== child.pid) return;
      S.pid = null;
      if (S.state !== 'off') { S.state = code ? 'error' : 'off'; if (code) S.error = D.name + ' s\'est arrêté (code ' + code + ')'; }
      emit(id);
    });
    const t0 = Date.now();
    const wait = async () => {
      if (S.state !== 'starting') return;
      if (await ping(id)) { S.state = 'ready'; emit(id); return; }
      if (Date.now() - t0 > 600000) { S.state = 'error'; S.error = D.name + ' ne répond pas'; emit(id); return; }
      setTimeout(wait, 1500);
    };
    setTimeout(wait, 1500);
    return status(id);
  }
  function kill(id) {
    const S = st[id];
    const pid = S.pid || (S.ours ? pidOnPort(SV[id].port) : null);
    if (S.ours && pid) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* déjà arrêté */ } }
    S.pid = null; S.state = 'off'; S.ours = false; emit(id);
  }

  // Relais « lanceur Kane OS » pour Wallpaper : /api/health, /api/status, /api/webui/profiles, /api/webui/start
  let relay = null;
  function startRelay() {
    if (relay) return;
    relay = http.createServer(async (req, res) => {
      const out = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const u = req.url.split('?')[0];
      try {
        if (u === '/api/health') return out(200, { application: 'Kane OS', relais: 'Kanevas' });
        if (u === '/api/status') { const s = engine.state(); return out(200, { webui: { status: s === 'ready' || s === 'external' ? 'running' : s === 'starting' ? 'starting' : 'stopped' } }); }
        if (u === '/api/webui/profiles') return out(200, [{ id: 'kanevas', name: 'Moteur IA de Kanevas', args: '--api' }]);
        if (u === '/api/webui/start' && req.method === 'POST') { engine.start(); return out(200, { ok: true }); }
        if (u === '/api/comfyui/start' && req.method === 'POST') { start('comfyui'); return out(200, { ok: true }); }   // Geste IA de Wallpaper
        out(404, { error: 'introuvable' });
      } catch (e) { out(500, { error: String(e.message || e) }); }
    });
    relay.on('error', () => { relay = null; });           // port pris : Wallpaper gardera LaMa seul si le moteur est arrêté
    relay.listen(RELAY_PORT, '127.0.0.1');
  }

  ipcMain.handle('svc-status', async (_e, id) => {
    if (!SV[id]) throw new Error('Service inconnu');
    const S = st[id];
    if (S.state === 'off' && await ping(id, 700)) { S.state = 'external'; S.ours = false; }
    else if (S.state === 'external' && !(await ping(id, 900))) S.state = 'off';
    return status(id);
  });
  ipcMain.handle('svc-start', (_e, id) => { if (!SV[id]) throw new Error('Service inconnu'); return start(id); });
  ipcMain.handle('svc-stop', (_e, id) => { if (!SV[id]) throw new Error('Service inconnu'); kill(id); return status(id); });
  ipcMain.handle('svc-log', (_e, id) => (st[id] ? st[id].log.join('\n') : ''));
  app.on('will-quit', () => { for (const id in SV) if (st[id].ours) kill(id); if (relay) try { relay.close(); } catch { /* rien */ } });

  /* ------------------------------------------------ liens avec l'Édition */
  const post = (port, route, body, headers, timeout = 120000) => new Promise((res, rej) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers } }, x => {
      let s = ''; x.setEncoding('utf8'); x.on('data', c => { s += c; });
      x.on('end', () => { if (x.statusCode >= 400) return rej(new Error('HTTP ' + x.statusCode + ' ' + s.slice(0, 200))); try { res(JSON.parse(s)); } catch { res(s); } });
    });
    r.on('error', rej); r.on('timeout', () => { r.destroy(); rej(new Error('Pas de réponse')); });
    r.end(data);
  });
  // ComfyUI : l'image va dans son dossier input (nœud « Load Image »)
  ipcMain.handle('comfy-upload', async (_e, name, data) => {
    try {
      const fname = (path.basename(String(name)).replace(/[^\w .-]/g, '_').replace(/\.[^.]*$/, '') || 'kanevas') + '.png';
      const b = '----kanevas' + Date.now().toString(16);
      const body = Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from(data),
        Buffer.from(`\r\n--${b}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--${b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${b}--\r\n`)]);
      const r = await post(8188, '/upload/image', body, { 'Content-Type': 'multipart/form-data; boundary=' + b });
      return { ok: true, name: r.name || fname };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  // Wallpaper : nouveau projet à partir d'une image
  ipcMain.handle('wea-new', async (_e, name, data) => {
    try {
      const r = await post(8780, '/api/nouveau', { nom: String(name || 'Illustration').slice(0, 80), image: 'data:image/png;base64,' + Buffer.from(data).toString('base64') });
      return { ok: true, dossier: r.dossier };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  // Sorties à reprendre : images et vidéos de ComfyUI, vidéos exportées par Wallpaper
  const weaProjects = () => {
    const d = SV.wallpaper.dir();
    try { const c = JSON.parse(fs.readFileSync(path.join(d, 'config.json'), 'utf8')); if (c.projets && fs.existsSync(c.projets)) return c.projets; } catch { /* config absente */ }
    return d;
  };
  ipcMain.handle('wea-update', async (_e, dossier, data) => {
    try {
      if (typeof dossier !== 'string' || !dossier || /[\\/]/.test(dossier) || dossier === '.' || dossier === '..') throw new Error('Projet Animation invalide');
      const dir = path.resolve(weaProjects(), dossier), base = path.resolve(weaProjects());
      if (!dir.startsWith(base + path.sep)) throw new Error('Projet Animation invalide');
      const state = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:8780/p/${encodeURIComponent(dossier)}/etat`, { timeout: 4000 }, r => {
          let text = ''; r.on('data', b => text += b); r.on('end', () => { try { resolve(JSON.parse(text)); } catch { reject(new Error('État Animation illisible')); } });
        }).on('error', reject).on('timeout', function () { this.destroy(new Error('Animation ne répond pas')); });
      });
      if (state.etat === 'en cours') throw new Error('Attendez la fin de l’animation ou de l’export');
      const { nativeImage } = require('electron');
      let image = nativeImage.createFromBuffer(Buffer.from(data));
      if (image.isEmpty()) throw new Error('Image illisible');
      if (image.getSize().width > 3840) image = image.resize({ width: 3840 });
      const scene = path.join(dir, 'scene.png'), previous = await fs.promises.readFile(scene);
      const old = nativeImage.createFromBuffer(previous).getSize(), size = image.getSize();
      if (old.width !== size.width || old.height !== size.height) throw new Error('Dimensions différentes : créez une nouvelle animation pour conserver les zones existantes');
      const history = path.join(dir, 'work', 'sources'); await fs.promises.mkdir(history, { recursive: true });
      await fs.promises.writeFile(path.join(history, Date.now() + '.png'), previous);
      const temp = path.join(dir, 'scene.kanevas.tmp');
      await fs.promises.writeFile(temp, image.toPNG()); await fs.promises.rename(temp, scene);
      // Ces aperçus sont calculés depuis l'ancienne source ; la peinture et les profondeurs manuelles restent en place.
      for (const file of ['depth_auto.png', path.join('work', 'vignette.jpg')]) await fs.promises.rm(path.join(dir, file), { force: true });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  const MEDIA = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv)$/i;
  async function walk(dir, depth, out, filter) {
    let ents = []; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const x of ents) {
      const p = path.join(dir, x.name);
      if (x.isDirectory()) { if (depth > 0 && !/^(venv|outils|externes|models|modeles|installateur|__pycache__|work|\.git)$/i.test(x.name)) await walk(p, depth - 1, out, filter); }
      else if (MEDIA.test(x.name) && (!filter || filter(p))) { try { const s = await fs.promises.stat(p); out.push({ path: p, name: x.name, mtime: s.mtimeMs, size: s.size, video: /\.(mp4|webm|mov|mkv)$/i.test(x.name) }); } catch { /* disparu */ } }
    }
  }
  ipcMain.handle('svc-outputs', async (_e, id, limit = 60) => {
    const out = [];
    if (id === 'comfyui') await walk(path.join(root(), 'output', 'comfyui'), 3, out);
    else if (id === 'wallpaper') await walk(weaProjects(), 3, out, p => /[\\/]a poster video[\\/]/i.test(p) && /\.mp4$/i.test(p));
    out.sort((a, b) => b.mtime - a.mtime);
    return out.slice(0, limit);
  });
  ipcMain.handle('svc-open-folder', (_e, id) => {
    const d = id === 'comfyui' ? path.join(root(), 'output', 'comfyui') : id === 'wallpaper' ? weaProjects() : null;
    if (d && fs.existsSync(d)) shell.openPath(d);
  });
  return { status };
};
