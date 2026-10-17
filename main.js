// Kanevas — processus principal Electron : la fenêtre, les boîtes de dialogue
// de fichiers et l'accès disque. Toute l'application vit dans app/ (renderer).
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// Réutiliser les données existantes (préférences et modèles IA) après le changement de nom.
const legacyData = ['KaneShop', 'kaneshop'].map(n => path.join(app.getPath('appData'), n)).find(p => fs.existsSync(p));
// KANEVAS_PROFILE : dossier de données séparé (essais automatisés à côté de l'application ouverte)
if (process.env.KANEVAS_PROFILE) app.setPath('userData', process.env.KANEVAS_PROFILE);
else if (legacyData) app.setPath('userData', legacyData);
app.setName('Kanevas');
if (process.platform === 'win32') app.setAppUserModelId('com.kane.kanevas');

// Espace « Vidéo » (KaneClip intégré) : son protocole média doit être déclaré avant que l'application soit prête
const kcHost = require('./kaneclip-host.cjs');
kcHost.registerScheme();

let win = null;
let allowClose = false;
const pending = [];          // fichiers reçus avant que la page soit prête

function filesFromArgv(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter(a => {
    if (!a || a.startsWith('-')) return false;
    try { return fs.statSync(a).isFile(); } catch { return false; }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv);
    if (!win) { pending.push(...files); return; }
    if (win.isMinimized()) win.restore();
    win.focus();
    files.forEach(p => win.webContents.send('open-path', p));
  });
  pending.push(...filesFromArgv(process.argv));
  app.whenReady().then(() => {
    kcHost.setup(() => win);
    require('./suite-host.cjs')(() => win);
    require('./services.cjs')({
      getWin: () => win,
      root: () => path.dirname(engineDirs().data),
      engine: {
        url: () => engine.url,
        // Forge de Kane OS s'il tourne, sinon le moteur de Kanevas (démarré à la demande de Wallpaper)
        forgeUrl: async () => engine.url || (await ping('http://127.0.0.1:7860', 800) ? 'http://127.0.0.1:7860' : 'http://127.0.0.1:' + ENGINE_PORT),
        state: () => engine.state,
        start: () => engineStart(),
      },
    });
    createWindow();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 980, minWidth: 1024, minHeight: 640,
    backgroundColor: '#f4f6f8',
    title: 'Kanevas',
    icon: path.join(__dirname, 'app', process.platform === 'win32' ? 'kanevas.ico' : 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f4f6f8', symbolColor: '#3b4552', height: 40 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // le préchargement sert aussi les cadres des espaces intégrés (KaneClip, Wallpaper) : voir preload.js
      nodeIntegrationInSubFrames: true,
      autoplayPolicy: 'no-user-gesture-required',
      // les tâches longues (IA, filtres en parallèle) continuent quand la fenêtre est masquée
      backgroundThrottling: false,
    },
  });
  if (process.platform === 'win32') {
    win.setAppDetails({
      appId: 'com.kane.kanevas',
      appIconPath: path.join(__dirname, 'app', 'kanevas.ico'),
      appIconIndex: 0,
      relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${__dirname}"`,
      relaunchDisplayName: 'Kanevas',
    });
  }
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // Pas de navigation (un fichier lâché hors zone ne doit pas remplacer l'app)
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // un cadre intégré (Wallpaper…) qui retient la fermeture par beforeunload ne bloque pas Kanevas une fois la fermeture confirmée
  win.webContents.on('will-prevent-unload', e => { if (allowClose) e.preventDefault(); });
  win.on('close', e => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('close-request');
  });
  win.on('closed', () => { win = null; });
  updater.checkSoon();
}

const updater = require('./updater.cjs')(() => win);

app.on('window-all-closed', () => app.quit());

const readEntry = p => ({ path: p, name: path.basename(p), data: fs.readFileSync(p) });

ipcMain.handle('open-dialog', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts.title || 'Ouvrir',
    properties: ['openFile', ...(opts.multi === false ? [] : ['multiSelections'])],
    filters: opts.filters,
  });
  if (r.canceled) return [];
  return r.filePaths.map(readEntry);
});

ipcMain.handle('read-file', (_e, p) => {
  try { return readEntry(p); } catch (err) { return { error: String(err.message || err) }; }
});

ipcMain.handle('save-dialog', async (_e, opts = {}) => {
  const r = await dialog.showSaveDialog(win, {
    title: opts.title || 'Enregistrer sous',
    defaultPath: opts.defaultPath,
    filters: opts.filters,
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('write-file', (_e, p, data) => {
  try {
    const tmp = p + '.kstmp';
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, p);
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

ipcMain.handle('get-pending', () => pending.splice(0));

// Polices installées (machine + utilisateur), lues dans le registre
ipcMain.handle('list-fonts', () => new Promise(resolve => {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  ];
  const names = new Set();
  let left = keys.length;
  for (const k of keys) {
    execFile('reg', ['query', k], { windowsHide: true, maxBuffer: 8 << 20 }, (_err, out) => {
      for (const line of String(out || '').split(/\r?\n/)) {
        const m = line.match(/^\s{4}(.+?)\s+REG_SZ\s/);
        if (!m) continue;
        let n = m[1].replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, '');
        for (const part of n.split('&')) {
          let f = part.trim()
            .replace(/\b(Bold|Italic|Oblique|Light|Semilight|SemiLight|Semibold|SemiBold|Black|Medium|Thin|ExtraLight|ExtraBold|Heavy|Regular|Condensed|Narrow|Demibold|Book|Variable|Display|Text)\b/g, '')
            .replace(/\s+/g, ' ').trim();
          if (f && !/^\d/.test(f) && f.length > 1) names.add(f);
        }
      }
      if (--left === 0) resolve([...names].sort((a, b) => a.localeCompare(b)));
    });
  }
}));

ipcMain.on('confirm-close', () => { allowClose = true; if (win) win.close(); });
ipcMain.on('set-title', (_e, t) => { if (win) win.setTitle(t); });
ipcMain.on('set-titlebar', (_e, o) => { try { if (win) win.setTitleBarOverlay(o); } catch { /* ancien Windows */ } });
ipcMain.on('toggle-devtools', () => { if (win) win.webContents.toggleDevTools(); });
ipcMain.on('toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.on('show-in-folder', (_e, p) => shell.showItemInFolder(p));

/* ------------------------------------------------------------------ IA locale */
// Détourage : BiRefNet (licence MIT), copies publiées par le projet rembg.
// Suppression d'objets : LaMa (licence Apache 2.0), export ONNX 512×512 de Carve.
// Traduction des invites : Opus-MT fr-en (Helsinki-NLP, licence CC-BY 4.0), export ONNX de Xenova.
const MT = 'https://huggingface.co/Xenova/opus-mt-fr-en/resolve/main/';
const MODELS = {
  'birefnet-lite': { kind: 'segment', name: 'BiRefNet léger (détourage rapide)', file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', size: 224005088 },
  'birefnet': { kind: 'segment', name: 'BiRefNet complet (détourage, qualité maximale)', file: 'BiRefNet-general-epoch_244.onnx', size: 972666916 },
  'lama': { kind: 'inpaint', name: 'LaMa (outil Suppression, remplissage sans invite)', file: 'lama_fp32.onnx', size: 208044816, cpu: true, url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx' },
  'translate-fr-en': { kind: 'translate', name: 'Opus-MT (traduction des invites français → anglais)', dir: 'opus-mt-fr-en', size: 112739047, files: [
    { file: 'encoder_model_quantized.onnx', size: 50090398, url: MT + 'onnx/encoder_model_quantized.onnx' },
    { file: 'decoder_model_quantized.onnx', size: 57010810, url: MT + 'onnx/decoder_model_quantized.onnx' },
    { file: 'tokenizer.json', size: 5637839, url: MT + 'tokenizer.json' },
  ] },
};
const MODEL_URL = m => m.url || 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/' + m.file;
const modelDir = () => path.join(app.getPath('userData'), 'models');
const modelPath = id => path.join(modelDir(), MODELS[id].dir || MODELS[id].file);
// Fichiers d'un modèle (un seul pour la plupart, plusieurs pour la traduction)
const modelFiles = id => { const m = MODELS[id]; return m.files ? m.files.map(f => ({ ...f, path: path.join(modelPath(id), f.file) })) : [{ file: m.file, size: m.size, url: MODEL_URL(m), path: modelPath(id) }]; };
let ort = null;
const sessions = {};
function loadOrt() { if (!ort) ort = require('onnxruntime-node'); return ort; }
// Session ONNX (carte graphique via DirectML, sinon processeur), gardée en mémoire
async function session(id, cpuOnly) {
  const key = id + (cpuOnly ? ':cpu' : '');
  if (sessions[key]) return sessions[key];
  if (!MODELS[id]) throw new Error('Modèle inconnu');
  const o = loadOrt();
  let s = null;
  // LaMa : DirectML échoue sur une multiplication de matrices de son bloc de Fourier, d'où le processeur
  for (const ep of cpuOnly || MODELS[id].cpu ? [['cpu']] : [['dml'], ['cpu']]) {
    try { s = await o.InferenceSession.create(modelPath(id), { executionProviders: ep, graphOptimizationLevel: 'all' }); s._ep = ep[0]; break; } catch (err) { console.warn('ORT', ep, err.message); }
  }
  if (!s) throw new Error('Impossible de charger le modèle');
  return (sessions[key] = s);
}

ipcMain.handle('ai-status', () => Object.entries(MODELS).map(([id, m]) => {
  let installed = false; try { installed = modelFiles(id).every(f => fs.statSync(f.path).size === f.size); } catch { /* absent */ }
  return { id, kind: m.kind, name: m.name, size: m.size, installed };
}));

ipcMain.handle('ai-download', async (e, id) => {
  const m = MODELS[id]; if (!m) return { ok: false, error: 'Modèle inconnu' };
  let base = 0, part = null;
  try {
    for (const f of modelFiles(id)) {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      try { if (fs.statSync(f.path).size === f.size) { base += f.size; continue; } } catch { /* à télécharger */ }
      part = f.path + '.part';
      const res = await fetch(f.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const out = fs.createWriteStream(part);
      let got = 0, last = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
        if (got - last > 2e6) { last = got; e.sender.send('ai-progress', { id, got: base + got, total: m.size }); }
      }
      await new Promise(r => out.end(r));
      if (fs.statSync(part).size !== f.size) throw new Error('Téléchargement incomplet');
      fs.renameSync(part, f.path); part = null;
      base += f.size;
    }
    return { ok: true };
  } catch (err) {
    if (part) try { fs.unlinkSync(part); } catch { /* rien */ }
    return { ok: false, error: String(err.message || err) };
  }
});

// Traduction d'une invite (français → anglais), entièrement locale
let translator = null;
ipcMain.handle('ai-translate', async (_e, text) => {
  try {
    if (!translator) translator = require('./translate.cjs')(modelPath('translate-fr-en'), loadOrt);
    return { ok: true, text: await translator(text) };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// Entrée : tenseur NCHW 1×3×1024×1024 (normalisé côté page) ; sortie : carte 1024×1024 sur 8 bits
ipcMain.handle('ai-segment', async (_e, id, input) => {
  try {
    const o = loadOrt(), s = await session(id);
    const t = new o.Tensor('float32', new Float32Array(input.buffer, input.byteOffset, input.byteLength / 4), [1, 3, 1024, 1024]);
    const res = await s.run({ [s.inputNames[0]]: t });
    const d = res[s.outputNames[0]].data, n = 1024 * 1024, out = new Uint8ClampedArray(n);
    // sigmoïde puis normalisation min-max (la sigmoïde est monotone : min et max se lisent avant)
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const sg = v => 1 / (1 + Math.exp(-v)), a = sg(mn), k = 255 / ((sg(mx) - a) || 1);
    for (let i = 0; i < n; i++) out[i] = (sg(d[i]) - a) * k;
    return { ok: true, mask: out, ep: s._ep };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// Préchargement (le premier chargement d'un modèle prend quelques secondes)
ipcMain.handle('ai-warm', async (_e, id) => { try { await session(id); return { ok: true }; } catch (err) { return { ok: false, error: String(err.message || err) }; } });

// Suppression (LaMa) : image RGBA 512×512 (Uint8) + masque 512×512 (Uint8, >127 = à remplacer).
// Sortie : RGBA 512×512.
ipcMain.handle('ai-inpaint', async (_e, rgba, mask) => {
  const S = 512, n = S * S;
  const img = new Float32Array(3 * n), msk = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = mask[i] > 127 ? 1 : 0; msk[i] = m;
    for (let c = 0; c < 3; c++) img[c * n + i] = m ? 0 : rgba[i * 4 + c] / 255;
  }
  const run = async cpuOnly => {
    const o = loadOrt(), s = await session('lama', cpuOnly);
    const feeds = {};
    for (const name of s.inputNames) feeds[name] = /mask/i.test(name) ? new o.Tensor('float32', msk, [1, 1, S, S]) : new o.Tensor('float32', img, [1, 3, S, S]);
    const res = await s.run(feeds);
    return { d: res[s.outputNames[0]].data, ep: s._ep };
  };
  try {
    let r;
    try { r = await run(false); } catch (err) { console.warn('LaMa DML', err.message); r = await run(true); }
    const { d } = r;
    // selon l'export, la sortie est dans [0,1] ou [0,255]
    let mx = 0; for (let i = 0; i < d.length; i += 97) if (d[i] > mx) mx = d[i];
    const k = mx > 2 ? 1 : 255, out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { out[i * 4] = d[i] * k; out[i * 4 + 1] = d[n + i] * k; out[i * 4 + 2] = d[2 * n + i] * k; out[i * 4 + 3] = 255; }
    return { ok: true, rgba: out, ep: r.ep };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

/* ------------------------------------------------------------------ Forge (Stable Diffusion local) */
// Remplissage et développement génératifs, super résolution : l'API de Forge (lancé par
// Kane OS avec --api) sur cette machine. Seules les adresses locales sont acceptées.
const forgeBase = url => {
  const u = new URL(url || 'http://127.0.0.1:7860');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || !/^https?:$/.test(u.protocol)) throw new Error('Adresse de Forge non locale');
  return u.origin;
};
async function forgeCall(base, route, body, timeout = 600000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(forgeBase(base) + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal });
    const txt = await res.text();
    if (!res.ok) throw new Error('Forge HTTP ' + res.status + (txt ? ' : ' + txt.slice(0, 300) : ''));
    return txt ? JSON.parse(txt) : null;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(timeout < 10000 ? 'Forge ne répond pas' : 'Forge a mis trop de temps à répondre');
    if (err.cause && err.cause.code === 'ECONNREFUSED') throw new Error('Forge n\'est pas démarré');
    throw err;
  } finally { clearTimeout(t); }
}
const forgeHandler = fn => async (_e, ...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (err) { return { ok: false, error: String(err.message || err) }; } };
ipcMain.handle('forge-status', forgeHandler(async base => {
  const opt = await forgeCall(base, '/sdapi/v1/options', null, 2500);
  let upscalers = [];
  try { upscalers = (await forgeCall(base, '/sdapi/v1/upscalers', null, 4000) || []).map(u => u.name).filter(n => n && n !== 'None'); } catch { /* ancienne API */ }
  return { model: opt && opt.sd_model_checkpoint, upscalers, current: { model: opt && opt.sd_model_checkpoint, modules: (opt && opt.forge_additional_modules) || [] } };
}));
// Les images passent en PNG brut entre la page et ce processus ; seul l'appel HTTP est en base64.
const b64 = u8 => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
const unb64 = s => new Uint8Array(Buffer.from(String(s).replace(/^data:[^,]*,/, ''), 'base64'));
ipcMain.handle('forge-img2img', forgeHandler(async (base, payload, init, mask) => {
  const r = await forgeCall(base, '/sdapi/v1/img2img', { ...payload, init_images: [b64(init)], mask: mask ? b64(mask) : undefined });
  return { images: ((r && r.images) || []).map(unb64), info: r && r.info };
}));
ipcMain.handle('forge-upscale', forgeHandler(async (base, payload, png) => {
  const r = await forgeCall(base, '/sdapi/v1/extra-single-image', { ...payload, image: b64(png) });
  if (!r || !r.image) throw new Error('Forge n\'a renvoyé aucune image');
  return { image: unb64(r.image), info: r.html_info || '' };
}));
ipcMain.handle('forge-txt2img', forgeHandler(async (base, payload, firstpass) => {
  const r = await forgeCall(base, '/sdapi/v1/txt2img', firstpass ? { ...payload, firstpass_image: b64(firstpass) } : payload);
  return { images: ((r && r.images) || []).map(unb64), info: r && r.info };
}));

// Catalogue pour le panneau IA (« mini Forge ») : modèles, VAE / encodeurs, échantillonneurs, LoRA avec
// leurs aperçus et fiches (.png / .json posés à côté par Forge), préréglages d'échantillonnage de Forge.
const loraPreview = new Map();       // chemin → { t, jpg }
const loraPaths = new Map();         // nom du LoRA → fichier (vu au dernier catalogue)
function sidecar(file, exts) {
  const stem = file.replace(/\.[^.\\/]+$/, '');
  for (const e of exts) { const q = stem + e; if (fs.existsSync(q)) return q; }
  return null;
}
ipcMain.handle('forge-catalog', forgeHandler(async base => {
  const [models, modules, samplers, schedulers, loras, opt, flags] = await Promise.all([
    forgeCall(base, '/sdapi/v1/sd-models', null, 8000), forgeCall(base, '/sdapi/v1/sd-modules', null, 8000).catch(() => []),
    forgeCall(base, '/sdapi/v1/samplers', null, 8000), forgeCall(base, '/sdapi/v1/schedulers', null, 8000).catch(() => []),
    forgeCall(base, '/sdapi/v1/loras', null, 15000).catch(() => []), forgeCall(base, '/sdapi/v1/options', null, 8000),
    forgeCall(base, '/sdapi/v1/cmd-flags', null, 8000).catch(() => ({})),
  ]);
  const kind = f => /[\\/]vae[\\/]/i.test(f) || /vae/i.test(path.basename(f)) ? 'vae' : /[\\/](text_encoder|clip)[\\/]/i.test(f) ? 'te' : 'other';
  const outLoras = [];
  const loraRoot = (() => {
    const dirsOf = (loras || []).map(l => path.dirname(String(l.path || '')));
    if (flags && flags.lora_dir && dirsOf.every(d => insideDir(flags.lora_dir, path.join(d, 'x')))) return path.resolve(flags.lora_dir);
    let root = dirsOf[0] || '';
    for (const d of dirsOf) while (root && !insideDir(root, path.join(d, 'x'))) root = path.dirname(root) === root ? '' : path.dirname(root);
    return root;
  })();
  for (const l of loras || []) {
    let trigger = '', weight = 1, preview = null, negative = '', description = '', notes = '', sdVersion = 'Unknown';
    loraPaths.set(l.name, l.path);
    try {
      const j = sidecar(l.path, ['.json']);
      if (j) {
        const m = JSON.parse(fs.readFileSync(j, 'utf8'));
        trigger = String(m['activation text'] || '').trim(); weight = +m['preferred weight'] || 1;
        negative = String(m['negative text'] || ''); description = String(m.description || ''); notes = String(m.notes || ''); sdVersion = String(m['sd version'] || 'Unknown');
      }
    } catch { /* fiche illisible */ }
    try {
      const img = sidecar(l.path, ['.preview.png', '.png', '.preview.jpg', '.jpg', '.jpeg', '.webp']);
      if (img) {
        const t = fs.statSync(img).mtimeMs, c = loraPreview.get(img);
        if (c && c.t === t) preview = c.jpg;
        else { const ni = nativeImage.createFromPath(img); if (!ni.isEmpty()) { preview = new Uint8Array(ni.resize({ width: 128, quality: 'good' }).toJPEG(80)); loraPreview.set(img, { t, jpg: preview }); } }
      }
    } catch { /* pas d'aperçu */ }
    const md = l.metadata || {};
    let rel = '', mtime = 0;
    try { rel = loraRoot ? path.relative(loraRoot, path.dirname(l.path)) : ''; mtime = fs.statSync(l.path).mtimeMs; } catch { /* fichier disparu */ }
    outLoras.push({ name: l.name, alias: l.alias, folder: path.basename(path.dirname(l.path)), rel, mtime, base: md.ss_base_model_version || '', trigger, weight, preview, negative, description, notes, sdVersion });
  }
  let presets = {};
  try { if (flags && flags.data_dir) presets = JSON.parse(fs.readFileSync(path.join(flags.data_dir, 'style_presets.json'), 'utf8')); } catch { /* aucun */ }
  let adModels = [];
  try { const r = await forgeCall(base, '/adetailer/v1/ad_model', null, 8000); adModels = (r && r.ad_model) || []; } catch { /* ADetailer absent */ }
  let upscalers = [];
  try { upscalers = ((await forgeCall(base, '/sdapi/v1/upscalers', null, 8000)) || []).map(u => u.name).filter(n => n && n !== 'None'); } catch { /* rien */ }
  const thumb = file => {
    try {
      const img = sidecar(file, ['.preview.png', '.png', '.preview.jpg', '.jpg', '.jpeg', '.webp']); if (!img) return null;
      const t = fs.statSync(img).mtimeMs, c = loraPreview.get(img);
      if (c && c.t === t) return c.jpg;
      const ni = nativeImage.createFromPath(img); if (ni.isEmpty()) return null;
      const jpg = new Uint8Array(ni.resize({ width: 160, quality: 'good' }).toJPEG(80)); loraPreview.set(img, { t, jpg }); return jpg;
    } catch { return null; }
  };
  const [styles, scriptInfo, latent] = await Promise.all([
    forgeCall(base, '/sdapi/v1/prompt-styles', null, 8000).catch(() => []),
    forgeCall(base, '/sdapi/v1/script-info', null, 8000).catch(() => []),
    forgeCall(base, '/sdapi/v1/latent-upscale-modes', null, 8000).catch(() => []),
  ]);
  const scripts = (scriptInfo || []).filter(x => !x.is_alwayson && x.name).map(x => ({
    name: x.name, img2img: !!x.is_img2img,
    args: (x.args || []).map(a => ({ label: a.label || '', value: a.value, min: a.minimum, max: a.maximum, step: a.step, choices: a.choices || null })),
  }));
  // valeurs par défaut de l'interface de Forge (préréglage « anima » de ses réglages)
  const preset = opt.forge_preset || '';
  const pick = k => opt[preset + '_' + k];
  const defaults = preset ? {
    t2i: { sampler_name: pick('t2i_sampler'), scheduler: pick('t2i_scheduler'), steps: pick('t2i_step'), hr_second_pass_steps: pick('t2i_hr_step'), cfg_scale: pick('t2i_cfg'), hr_cfg: pick('t2i_hr_cfg'),
      distilled_cfg_scale: pick('t2i_dcfg'), hr_distilled_cfg: pick('t2i_hr_dcfg'), batch_size: pick('t2i_batch_size'), width: pick('t2i_width'), height: pick('t2i_height') },
    i2i: { sampler_name: pick('i2i_sampler'), scheduler: pick('i2i_scheduler'), steps: pick('i2i_step'), cfg_scale: pick('i2i_cfg'), distilled_cfg_scale: pick('i2i_dcfg'), batch_size: pick('i2i_batch_size'),
      width: pick('i2i_width'), height: pick('i2i_height') },
  } : {};
  const dirs = { data: flags.data_dir || '', models: flags.model_ref || '', lora: flags.lora_dir || '' };
  if (dirs.data) { forgeDirs = dirs; try { fs.writeFileSync(path.join(app.getPath('userData'), 'forge-dirs.json'), JSON.stringify(dirs)); } catch { /* rien */ } }
  return {
    adModels, upscalers, dirs,
    models: (models || []).map(m => ({ title: m.title, name: m.model_name, file: m.filename, preview: thumb(m.filename) })),
    styles: (styles || []).map(x => ({ name: x.name, prompt: x.prompt || '', negative: x.negative_prompt || '' })),
    scripts, latent: (latent || []).map(x => x.name).filter(Boolean), defaults,
    dtype: opt.forge_unet_storage_dtype || 'Automatic', resStep: +opt.res_step || 64, defaultWeight: +opt.extra_networks_default_multiplier || 1,
    modules: (modules || []).map(m => ({ name: m.model_name, path: m.filename, kind: kind(m.filename) })),
    samplers: (samplers || []).map(x => x.name), schedulers: (schedulers || []).map(x => x.label || x.name),
    loras: outLoras, presets,
    current: { model: opt.sd_model_checkpoint, modules: opt.forge_additional_modules || [] },
  };
}));
/* ------------------------------------------------------------------ atelier LoRA */
// Les dossiers de Forge viennent de son API (cmd-flags) ; la passerelle tourne avec le Python du venv de Forge
// et réutilise son extension d'entraînement (lora_bridge.py). Aucun chemin n'est accepté de la page.
let forgeDirs = null;
const loadDirs = () => { if (!forgeDirs) try { forgeDirs = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'forge-dirs.json'), 'utf8')); } catch { /* jamais vu */ } };
const bridgePath = () => path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'lora_bridge.py');
const insideDir = (root, p) => { const r = path.resolve(root) + path.sep; const q = path.resolve(p); return q.startsWith(r); };
ipcMain.handle('lora-call', async (_e, cmd, args = {}) => {
  try {
    // dossiers mémorisés au dernier contact avec Forge : l'atelier marche aussi Forge éteint (carte graphique libre)
    if (!forgeDirs) try { forgeDirs = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'forge-dirs.json'), 'utf8')); } catch { /* jamais vu */ }
    if (!forgeDirs || !forgeDirs.data) throw new Error('Démarrez Forge une fois depuis Kane OS : Kanevas y lit ses dossiers (entraîneur, modèles)');
    const py = path.join(forgeDirs.data, 'venv', 'Scripts', 'python.exe');
    if (!fs.existsSync(py)) throw new Error('Python de Forge introuvable : ' + py);
    if (!/^[a-z_]+$/.test(cmd)) throw new Error('Commande invalide');
    const input = JSON.stringify({ ...args, data_dir: forgeDirs.data, model_ref: forgeDirs.models, lora_dir: forgeDirs.lora });
    const out = await new Promise((resolve, reject) => {
      const child = require('child_process').spawn(py, [bridgePath(), cmd], { cwd: forgeDirs.data, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      let so = '', se = '';
      child.stdout.on('data', d => { so += d; });
      child.stderr.on('data', d => { se += d; if (se.length > 20000) se = se.slice(-20000); });
      child.on('error', reject);
      child.on('close', code => { try { resolve(JSON.parse(so)); } catch { reject(new Error('Passerelle : réponse illisible (' + code + ') ' + se.slice(-400))); } });
      child.stdin.end(input);
    });
    return out;
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// Miniature d'une image du dossier des entraînements ou des LoRA (aperçus, échantillons)
ipcMain.handle('lora-thumb', (_e, file, width = 256) => {
  try {
    loadDirs();
    if (!forgeDirs || !(insideDir(path.join(forgeDirs.data, 'lora_training'), file) || (forgeDirs.lora && insideDir(forgeDirs.lora, file)))) throw new Error('Chemin refusé');
    const ni = nativeImage.createFromPath(file);
    if (ni.isEmpty()) throw new Error('Image illisible');
    const sz = ni.getSize();
    return { ok: true, data: new Uint8Array((sz.width > width ? ni.resize({ width, quality: 'good' }) : ni).toJPEG(85)), w: sz.width, h: sz.height };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// Image complète (pour l'ouvrir dans Kanevas)
ipcMain.handle('lora-file', (_e, file) => {
  try {
    loadDirs();
    if (!forgeDirs || !(insideDir(path.join(forgeDirs.data, 'lora_training'), file) || (forgeDirs.lora && insideDir(forgeDirs.lora, file)))) throw new Error('Chemin refusé');
    return { ok: true, name: path.basename(file), data: fs.readFileSync(file) };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// Ajout d'une image venue de Kanevas (document, sélection) dans un projet
ipcMain.handle('lora-write', (_e, project, name, data) => {
  try {
    loadDirs();
    if (!forgeDirs) throw new Error('Forge non joint');
    const safeProj = String(project).replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 64).trim();
    const dir = path.join(forgeDirs.data, 'lora_training', safeProj);
    if (!safeProj || !fs.existsSync(path.join(dir, 'project.json'))) throw new Error('Projet introuvable');
    let base = path.basename(String(name)).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]/g, '_').replace(/\.[^.]*$/, '') || 'kanevas';
    let f = path.join(dir, base + '.png'), i = 2;
    while (fs.existsSync(f)) f = path.join(dir, `${base}_${i++}.png`);
    fs.writeFileSync(f, Buffer.from(data));
    return { ok: true, file: path.basename(f) };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('pick-image-paths', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Images pour l\'entraînement', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('pick-folder-images', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Dossier d\'images', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return [];
  const d = r.filePaths[0];
  return fs.readdirSync(d).filter(n => /\.(png|jpe?g|webp|bmp)$/i.test(n)).map(n => path.join(d, n));
});
// Export de plusieurs fichiers dans un dossier choisi (découpe pour les réseaux)
ipcMain.handle('save-files', async (_e, title, files) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Choisir le dossier', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    const dir = r.filePaths[0], written = [];
    for (const f of files) { const n = path.basename(String(f.name)); fs.writeFileSync(path.join(dir, n), Buffer.from(f.data)); written.push(n); }
    return { ok: true, dir, written };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('open-folder', (_e, p) => { if (forgeDirs && (insideDir(forgeDirs.data, p) || insideDir(forgeDirs.lora, p))) shell.openPath(p); });

ipcMain.handle('forge-progress', forgeHandler(async (base, withImage) => {
  const r = await forgeCall(base, '/sdapi/v1/progress?skip_current_image=' + (withImage ? 'false' : 'true'), null, 4000);
  const st = (r && r.state) || {};
  return { progress: r ? r.progress : 0, eta: r ? r.eta_relative : 0, step: st.sampling_step, steps: st.sampling_steps, jobs: st.job_count,
    image: withImage && r && r.current_image ? unb64(r.current_image) : null };
}));
ipcMain.handle('forge-unload', forgeHandler(async base => { await forgeCall(base, '/sdapi/v1/unload-checkpoint', {}, 60000); return {}; }));
ipcMain.handle('forge-refresh-loras', forgeHandler(async base => { await forgeCall(base, '/sdapi/v1/refresh-loras', {}, 60000); return {}; }));
ipcMain.handle('forge-pnginfo', forgeHandler(async (base, png) => { const r = await forgeCall(base, '/sdapi/v1/png-info', { image: 'data:image/png;base64,' + b64(png) }, 20000); return { info: r && r.info, items: r && r.items }; }));
const FORGE_TOP_OPTIONS = ['sd_model_checkpoint', 'forge_additional_modules', 'forge_unet_storage_dtype'];
ipcMain.handle('forge-set-options', forgeHandler(async (base, o) => {
  const body = {};
  for (const k of FORGE_TOP_OPTIONS) if (o && k in o) body[k] = o[k];
  if (!Object.keys(body).length) throw new Error('Aucune option');
  await forgeCall(base, '/sdapi/v1/options', body, 120000);
  return {};
}));
ipcMain.handle('forge-memory', forgeHandler(async base => {
  const r = await forgeCall(base, '/sdapi/v1/memory', null, 4000);
  const c = (r && r.cuda && r.cuda.system) || {};
  return { used: c.used || 0, total: c.total || 0 };
}));
ipcMain.handle('forge-refresh-checkpoints', forgeHandler(async base => { await forgeCall(base, '/sdapi/v1/refresh-checkpoints', {}, 60000); return {}; }));
// Préréglages d'échantillonnage : le même fichier que la liste « Preset » de Forge
ipcMain.handle('forge-presets-write', async (_e, presets) => {
  try {
    loadDirs();
    if (!forgeDirs || !forgeDirs.data) throw new Error('Dossier de Forge inconnu');
    if (!presets || typeof presets !== 'object' || Array.isArray(presets)) throw new Error('Préréglages invalides');
    const clean = {};
    for (const [k, v] of Object.entries(presets)) if (k && v && typeof v === 'object') clean[String(k).slice(0, 80)] = v;
    fs.writeFileSync(path.join(forgeDirs.data, 'style_presets.json'), JSON.stringify(clean, null, 4) + '\n', 'utf8');
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// Dossiers de sortie de Forge (output\txt2img-images…), là où il range les images qu'il enregistre
ipcMain.handle('open-forge-output', async (_e, sub) => {
  loadDirs();
  const data = (forgeDirs && forgeDirs.data) || 'C:\\KaneOS\\sd-webui-forge-classic';
  const allowed = ['txt2img-images', 'img2img-images', 'extras-images', 'txt2img-grids', 'img2img-grids', ''];
  let d = path.join(data, 'output', allowed.includes(sub) ? sub : '');
  if (!fs.existsSync(d)) d = path.join(data, 'output');
  if (fs.existsSync(d)) shell.openPath(d);
});
// Fiche d'un LoRA, au même format que l'éditeur de Forge (<lora>.json à côté du fichier), et son aperçu
ipcMain.handle('lora-meta-write', async (_e, name, meta, preview) => {
  try {
    const file = loraPaths.get(String(name));
    if (!file || !fs.existsSync(file)) throw new Error('LoRA introuvable : relisez la liste');
    const stem = file.replace(/\.[^.\\/]+$/, '');
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(stem + '.json', 'utf8')); } catch { /* pas encore de fiche */ }
    const m = meta || {};
    const out = { ...cur, description: String(m.description ?? cur.description ?? ''), 'sd version': String(m.sdVersion ?? cur['sd version'] ?? 'Unknown'),
      'activation text': String(m.trigger ?? cur['activation text'] ?? ''), 'preferred weight': +(m.weight ?? cur['preferred weight'] ?? 0) || 0,
      'negative text': String(m.negative ?? cur['negative text'] ?? ''), notes: String(m.notes ?? cur.notes ?? '') };
    await fs.promises.writeFile(stem + '.json', JSON.stringify(out, null, 4), 'utf8');
    if (preview) {
      const target = fs.existsSync(stem + '.preview.png') ? stem + '.preview.png' : stem + '.png';
      for (const e of ['.jpg', '.jpeg', '.webp', '.preview.jpg']) if (fs.existsSync(stem + e)) await fs.promises.rename(stem + e, stem + e + '.old').catch(() => {});
      await fs.promises.writeFile(target, Buffer.from(preview));
    }
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// « Éteindre le PC quand l'entraînement est terminé » (comme l'onglet Train LoRA de Forge) : shutdown /s différé, annulable
ipcMain.handle('lora-shutdown', async (_e, on, message) => {
  const args = on ? ['/s', '/t', '120', '/c', String(message || 'Kanevas : entraînement LoRA terminé. Le PC s\'éteint dans 2 minutes (shutdown /a pour annuler).').slice(0, 500)] : ['/a'];
  return new Promise(res => require('child_process').execFile('shutdown', args, { windowsHide: true }, err => res({ ok: !err || !on, error: err ? String(err.message) : '' })));
});
ipcMain.handle('pick-folder', async (_e, title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Dossier', properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? '' : r.filePaths[0];
});
ipcMain.handle('forge-skip', forgeHandler(async base => { await forgeCall(base, '/sdapi/v1/skip', {}, 4000); return {}; }));
ipcMain.handle('forge-interrupt', forgeHandler(async base => { await forgeCall(base, '/sdapi/v1/interrupt', {}, 4000); return {}; }));

/* ------------------------------------------------------------------ moteur IA (Forge sans interface) */
// Le Studio IA est autonome : Kanevas démarre lui-même le moteur de Forge (launch.py, --nowebui, port 7862)
// avec le profil de Kane OS (arguments --sage --highvram… --model-ref). Si le Forge de Kane OS tourne déjà
// (port 7860), il est réutilisé : jamais deux copies des modèles en mémoire vidéo.
const ENGINE_PORT = 7862;
const engine = { state: 'off', url: '', pid: null, ours: false, log: [], error: '', profile: '', startedAt: 0 };
const engineLog = line => { engine.log.push(line); if (engine.log.length > 400) engine.log.splice(0, engine.log.length - 400); };
const engineEmit = () => { if (win) win.webContents.send('engine-status', engineStatus()); };
const engineStatus = () => ({ state: engine.state, url: engine.url, ours: engine.ours, pid: engine.pid, error: engine.error, profile: engine.profile, tail: engine.log.slice(-12), uptime: engine.startedAt ? Date.now() - engine.startedAt : 0 });
const ping = async (url, ms = 1500) => { try { const r = await fetch(url + '/sdapi/v1/options', { signal: AbortSignal.timeout(ms) }); return r.ok; } catch { return false; } };
function engineDirs() {
  loadDirs();
  const data = (forgeDirs && forgeDirs.data) || 'C:\\KaneOS\\sd-webui-forge-classic';
  const root = path.dirname(data);
  let profiles = [];
  try { profiles = JSON.parse(fs.readFileSync(path.join(root, 'launcher', 'data', 'webui_profiles.json'), 'utf8')); } catch { /* pas de Kane OS */ }
  const models = (forgeDirs && forgeDirs.models) || path.join(root, 'models');
  return { data, profiles, models };
}
ipcMain.handle('engine-status', async () => {
  // Forge de Kane OS démarré entre-temps ?
  if (engine.state === 'off' && await ping('http://127.0.0.1:7860', 800)) { engine.state = 'external'; engine.url = 'http://127.0.0.1:7860'; }
  else if (engine.state === 'external' && !(await ping(engine.url, 800))) { engine.state = 'off'; engine.url = ''; }
  return engineStatus();
});
ipcMain.handle('engine-profiles', () => { const d = engineDirs(); return { data: d.data, profiles: d.profiles.map(p => ({ id: p.id, name: p.name, args: p.args })) }; });
ipcMain.handle('engine-start', (_e, profileId) => engineStart(profileId));
async function engineStart(profileId) {
  if (engine.state === 'ready' || engine.state === 'starting') return engineStatus();
  if (await ping('http://127.0.0.1:7860', 1200)) { engine.state = 'external'; engine.url = 'http://127.0.0.1:7860'; engine.ours = false; engineEmit(); return engineStatus(); }
  // moteur resté actif (Kanevas fermé brutalement) : on le reprend, il pourra être arrêté
  if (await ping('http://127.0.0.1:' + ENGINE_PORT, 1200)) { engine.state = 'ready'; engine.url = 'http://127.0.0.1:' + ENGINE_PORT; engine.ours = true; engine.pid = pidOnPort(ENGINE_PORT); engineEmit(); return engineStatus(); }
  const d = engineDirs();
  const py = path.join(d.data, 'venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(py) || !fs.existsSync(path.join(d.data, 'launch.py'))) { engine.state = 'error'; engine.error = 'Forge introuvable : ' + d.data; engineEmit(); return engineStatus(); }
  const prof = d.profiles.find(p => p.id === profileId) || d.profiles[0];
  let args = prof ? prof.args : `--api --model-ref "${d.models.replace(/\\/g, '/')}"`;
  args = args.replace(/--port\s+\d+/g, '').replace(/--nowebui/g, '').replace(/--listen/g, '').replace(/--server-name\s+\S+/g, '') + ` --nowebui --port ${ENGINE_PORT} --server-name 127.0.0.1 --skip-prepare-environment`;   // joignable seulement depuis ce PC
  engine.profile = prof ? prof.name : 'par défaut';
  engine.log = []; engine.error = ''; engine.state = 'starting'; engine.ours = true; engine.startedAt = Date.now();
  engine.url = 'http://127.0.0.1:' + ENGINE_PORT;
  engineLog('> ' + args);
  const child = require('child_process').spawn(py, ['launch.py'], {
    cwd: d.data, windowsHide: true,
    env: { ...process.env, COMMANDLINE_ARGS: args, SD_WEBUI_RESTARTING: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
  });
  engine.pid = child.pid;
  const onData = buf => String(buf).split(/\r?\n|\r/).forEach(l => { if (l.trim()) engineLog(l.slice(0, 400)); });
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('exit', code => {
    if (engine.pid !== child.pid) return;
    engine.pid = null;
    if (engine.state !== 'off') { engine.state = code ? 'error' : 'off'; if (code) engine.error = 'Le moteur s\'est arrêté (code ' + code + ')'; }
    engineEmit();
  });
  engineEmit();
  // prêt quand l'API répond
  (async () => {
    const t0 = Date.now();
    while (engine.pid === child.pid && engine.state === 'starting') {
      if (await ping(engine.url, 1500)) { engine.state = 'ready'; engineLog('Moteur prêt en ' + Math.round((Date.now() - t0) / 1000) + ' s'); engineEmit(); return; }
      if (Date.now() - t0 > 6 * 60 * 1000) { engine.state = 'error'; engine.error = 'Le moteur ne répond pas après 6 minutes'; engineEmit(); return; }
      await new Promise(r => setTimeout(r, 1000));
      if ((Date.now() - t0) % 5000 < 1000) engineEmit();
    }
  })();
  return engineStatus();
}
// Processus qui écoute sur un port (pour arrêter un moteur repris après un plantage de Kanevas)
function pidOnPort(port) {
  try {
    const out = require('child_process').execFileSync('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, encoding: 'utf8' });
    const m = out.split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(c => c[0] === 'TCP' && /:(\d+)$/.test(c[1]) && +c[1].split(':').pop() === port && c[3] === 'LISTENING');
    return m ? +m[4] : null;
  } catch { return null; }
}
function engineKill() {
  if (!engine.ours || !engine.pid) return;
  try { require('child_process').execFileSync('taskkill', ['/PID', String(engine.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* déjà arrêté */ }
  engine.pid = null;
}
ipcMain.handle('engine-stop', () => { engineKill(); engine.state = 'off'; engine.url = ''; engine.ours = false; engineEmit(); return engineStatus(); });
ipcMain.handle('engine-log', () => engine.log.join('\n'));
app.on('will-quit', () => { if (!globalThis.__kvKeepEngine) engineKill(); });

// Résultats enregistrés automatiquement (comme le dossier « outputs » de Forge), avec leurs paramètres.
// Dossier : <Kane OS>\output\kanevas (à côté des sorties de Forge), sinon le dossier de données de Kanevas.
// Jamais dans « Images » : chez beaucoup, c'est un dossier OneDrive à la demande, et la création récursive de
// dossiers de Node y boucle sans fin (dans du code natif), ce qui figeait toute l'application.
function outputsRoot() {
  loadDirs();
  const data = (forgeDirs && forgeDirs.data) || 'C:\\KaneOS\\sd-webui-forge-classic';
  const kane = path.join(path.dirname(data), 'output');
  return fs.existsSync(kane) ? path.join(kane, 'kanevas') : path.join(app.getPath('userData'), 'outputs');
}
// Crée les dossiers un par un (sans « recursive »), en tâche de fond
async function ensureDir(dir) {
  const parts = path.resolve(dir).split(path.sep);
  let cur = parts.shift() + path.sep;
  for (const p of parts) {
    cur = path.join(cur, p);
    try { await fs.promises.mkdir(cur); } catch (err) { if (err.code !== 'EEXIST') { const st = await fs.promises.stat(cur).catch(() => null); if (!st || !st.isDirectory()) throw err; } }
  }
}
ipcMain.handle('save-output', async (_e, sub, name, data) => {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(outputsRoot(), String(sub || 'images').replace(/[^\w -]/g, ''), day);
    await ensureDir(dir);
    const f = path.join(dir, path.basename(String(name)).replace(/[^\w .-]/g, '_'));
    await fs.promises.writeFile(f, Buffer.from(data));
    return { ok: true, path: f };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('open-outputs', async () => { const d = outputsRoot(); try { await ensureDir(d); } catch { /* rien */ } shell.openPath(d); });

// Le renderer n'accède qu'à des copies identifiées, jamais à un chemin arbitraire.
const recoveryStore = require('./recovery-store.cjs')(path.join(app.getPath('userData'), 'recovery'));
const recoveryCall = fn => async (_event, ...args) => {
  try { const result = await fn(...args); return { ok: true, ...result }; }
  catch (err) { return { ok: false, error: err.message || String(err) }; }
};
ipcMain.handle('recovery-write', recoveryCall((id, meta, data) => recoveryStore.write(id, meta, data)));
ipcMain.handle('recovery-list', recoveryCall(() => recoveryStore.list()));
ipcMain.handle('recovery-read', recoveryCall(id => recoveryStore.read(id)));
ipcMain.handle('recovery-remove', recoveryCall(id => recoveryStore.remove(id)));


