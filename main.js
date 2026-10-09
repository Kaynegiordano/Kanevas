// Kanevas — processus principal Electron : la fenêtre, les boîtes de dialogue
// de fichiers et l'accès disque. Toute l'application vit dans app/ (renderer).
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// Réutiliser les données existantes (préférences et modèles IA) après le changement de nom.
const legacyData = ['KaneShop', 'kaneshop'].map(n => path.join(app.getPath('appData'), n)).find(p => fs.existsSync(p));
if (legacyData) app.setPath('userData', legacyData);
app.setName('Kanevas');
if (process.platform === 'win32') app.setAppUserModelId('Kanevas');

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
    },
  });
  if (process.platform === 'win32') {
    win.setAppDetails({
      appId: 'Kanevas',
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

/* ------------------------------------------------------------------ IA (détourage) */
// Modèles BiRefNet (licence MIT), copies publiées par le projet rembg.
const MODELS = {
  'birefnet-lite': { name: 'BiRefNet léger (rapide)', file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', size: 224005088 },
  'birefnet': { name: 'BiRefNet complet (qualité maximale)', file: 'BiRefNet-general-epoch_244.onnx', size: 972666916 },
};
const MODEL_URL = f => 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/' + f;
const modelDir = () => path.join(app.getPath('userData'), 'models');
const modelPath = id => path.join(modelDir(), MODELS[id].file);
let ort = null;
const sessions = {};
function loadOrt() { if (!ort) ort = require('onnxruntime-node'); return ort; }

ipcMain.handle('ai-status', () => Object.entries(MODELS).map(([id, m]) => {
  let installed = false; try { installed = fs.statSync(modelPath(id)).size === m.size; } catch { /* absent */ }
  return { id, name: m.name, size: m.size, installed };
}));

ipcMain.handle('ai-download', async (e, id) => {
  const m = MODELS[id]; if (!m) return { ok: false, error: 'Modèle inconnu' };
  fs.mkdirSync(modelDir(), { recursive: true });
  const part = modelPath(id) + '.part';
  try {
    const res = await fetch(MODEL_URL(m.file));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const out = fs.createWriteStream(part);
    let got = 0, last = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      if (got - last > 2e6) { last = got; e.sender.send('ai-progress', { id, got, total: m.size }); }
    }
    await new Promise(r => out.end(r));
    if (fs.statSync(part).size !== m.size) throw new Error('Téléchargement incomplet');
    fs.renameSync(part, modelPath(id));
    return { ok: true };
  } catch (err) {
    try { fs.unlinkSync(part); } catch { /* rien */ }
    return { ok: false, error: String(err.message || err) };
  }
});

// Entrée : tenseur NCHW 1×3×1024×1024 (normalisé côté page) ; sortie : carte 1024×1024 dans [0,1]
ipcMain.handle('ai-segment', async (_e, id, input) => {
  try {
    const o = loadOrt();
    if (!sessions[id]) {
      let s = null;
      for (const ep of [['dml'], ['cpu']]) { try { s = await o.InferenceSession.create(modelPath(id), { executionProviders: ep, graphOptimizationLevel: 'all' }); s._ep = ep[0]; break; } catch (err) { console.warn('ORT', ep, err.message); } }
      if (!s) throw new Error('Impossible de charger le modèle');
      sessions[id] = s;
    }
    const s = sessions[id];
    const t = new o.Tensor('float32', new Float32Array(input.buffer, input.byteOffset, input.byteLength / 4), [1, 3, 1024, 1024]);
    const res = await s.run({ [s.inputNames[0]]: t });
    const outT = res[s.outputNames[0]];
    const d = outT.data, n = 1024 * 1024, out = new Float32Array(n);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { const v = 1 / (1 + Math.exp(-d[i])); out[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
    const k = mx - mn || 1;
    for (let i = 0; i < n; i++) out[i] = (out[i] - mn) / k;
    return { ok: true, mask: out, ep: s._ep };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

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


