// Kanevas — processus principal Electron : la fenêtre, les boîtes de dialogue
// de fichiers et l'accès disque. Toute l'application vit dans app/ (renderer).
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
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
  app.whenReady().then(createWindow);
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
  return { model: opt && opt.sd_model_checkpoint, upscalers };
}));
// Les images passent en PNG brut entre la page et ce processus ; seul l'appel HTTP est en base64.
const b64 = u8 => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
const unb64 = s => new Uint8Array(Buffer.from(String(s).replace(/^data:[^,]*,/, ''), 'base64'));
ipcMain.handle('forge-img2img', forgeHandler(async (base, payload, init, mask) => {
  const r = await forgeCall(base, '/sdapi/v1/img2img', { ...payload, init_images: [b64(init)], mask: mask ? b64(mask) : undefined });
  return { images: ((r && r.images) || []).map(unb64) };
}));
ipcMain.handle('forge-upscale', forgeHandler(async (base, payload, png) => {
  const r = await forgeCall(base, '/sdapi/v1/extra-single-image', { ...payload, image: b64(png) });
  if (!r || !r.image) throw new Error('Forge n\'a renvoyé aucune image');
  return { image: unb64(r.image) };
}));
ipcMain.handle('forge-progress', forgeHandler(async base => {
  const r = await forgeCall(base, '/sdapi/v1/progress?skip_current_image=true', null, 3000);
  return { progress: r ? r.progress : 0 };
}));
ipcMain.handle('forge-interrupt', forgeHandler(async base => { await forgeCall(base, '/sdapi/v1/interrupt', {}, 4000); return {}; }));

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


