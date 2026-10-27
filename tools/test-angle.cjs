// Onglet Angle du Studio IA dans un vrai renderer Electron : relief simulé (un disque en avant d'un fond),
// Forge simulé (renvoie l'image reçue). Lancer : node_modules/.bin/electron tools/test-angle.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-angle-'));
app.setPath('userData', path.join(tmp, 'profile'));
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
window.calls = []; window.depthCalls = [];
window.ksNative = {
  gpuMemory: async () => ({ ok: true, used: 1000, total: 16000, measuredAt: Date.now(), devices: [] }),
  setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {},
  getPending: async () => [], loraThumb: async () => ({ ok: false }), loraCall: async () => ({ ok: true, projects: [], status: null }),
  aiStatus: async () => [{ id: 'depth', kind: 'depth', name: 'Depth', size: 1, installed: true }],
  aiDepth: async (input, w, h) => {
    window.depthCalls.push([w, h]);
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = Math.hypot(x - w / 2, y - h / 2) < Math.min(w, h) * 0.25 ? 10 : 1 + y / h;
    return { ok: true, depth: d, dims: [1, h, w], ep: 'test' };
  },
  forgeStatus: async () => ({ ok: true }),
  forgeCatalog: async () => ({ ok: true, models: [{ title: 'anima', name: 'anima' }], loras: [], modules: [], current: { model: 'anima', modules: [] },
    dtype: 'Automatic', samplers: ['Euler'], schedulers: ['Automatic'], scripts: [], styles: [], presets: {}, upscalers: ['Lanczos'] }),
  forgeImg2img: async (url, payload, init, mask) => { window.calls.push({ payload, init, mask }); return { ok: true, images: Array(payload.batch_size || 1).fill(init), info: { seed: 1, infotexts: [payload.prompt + '\\nSteps: 30'] } }; },
  forgeProgress: async () => ({ ok: true, progress: 0.5 }), forgeInterrupt: async () => ({ ok: true }),
  aiTranslate: async t => ({ ok: true, text: t }), onAiProgress() {},
};
`);

async function scenario() {
  const results = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  const wait = async (test, label = '') => { for (let i = 0; i < 300; i++) { if (test()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('Timeout ' + label); };
  const button = label => [...document.querySelectorAll('#studio button')].find(b => b.textContent === label);
  localStorage.removeItem('kanevas.prefs');
  // un dessin : fond dégradé, disque coloré au centre
  const W = 320, H = 480, d = new KS.Doc({ name: 'Dessin', width: W, height: H }), c = KS.util.canvas(W, H), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2a6f9e'); g.addColorStop(1, '#e6c27a'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = '#c0392b'; x.beginPath(); x.arc(W / 2, H / 2, Math.min(W, H) * 0.25, 0, Math.PI * 2); x.fill();
  for (let i = 0; i < W; i += 16) { x.fillStyle = i % 32 ? '#fff' : '#111'; x.fillRect(i, H / 2 - 4, 8, 8); }
  d.addLayer(new KS.Layer({ name: 'Fond', canvas: c }), 0); d.genInfo = '1girl, red ball\nNegative prompt: lowres\nSteps: 30'; KS.addDoc(d);
  await KS.cmd.openStudioTab('angle');
  await wait(() => document.querySelector('.ag-gl') && button('Depuis Retouche'), 'onglet Angle');
  const rail = [...document.querySelectorAll('.fx-rail button')].map(b => b.textContent);
  assert(rail.indexOf('Angle') === rail.indexOf('Transformer') + 1 && !rail.includes('Pose 3D'), 'Angle remplace Pose 3D, sous Transformer : ' + rail.join(', '));
  button('Depuis Retouche').click();
  const A = KS.angleTab, S = A.state;
  await wait(() => S.mesh && !S.busy, 'relief');
  assert(window.depthCalls.length === 1 && window.depthCalls[0].every(v => v % 14 === 0), 'Relief demandé une fois, côtés multiples de 14 : ' + window.depthCalls[0]);
  assert(A.prefs.prompt === '1girl, red ball', 'L’invite est reprise des paramètres de l’image : ' + A.prefs.prompt);
  // vue de face : l'image d'origine, presque rien à repeindre
  let v = A.renderView();
  const a = KS.util.getData(v.color).data, b = KS.util.getData(c).data; let diff = 0;
  for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  diff /= a.length / 4 * 3;
  assert(diff < 3 && v.holes < 0.05, `De face, le rendu redonne l’image (écart ${diff.toFixed(2)}, ${(v.holes * 100).toFixed(1)} % à repeindre)`);
  // nouvel angle : des zones découvertes autour du disque et au bord du cadre
  [...document.querySelectorAll('.ag-sec .fx-chip')].find(b => b.textContent === '¾ droite').click();
  assert(A.prefs.yaw === 30, 'Le bouton ¾ droite tourne de 30° : ' + A.prefs.yaw);
  v = A.renderView();
  assert(v.holes > 0.05 && v.holes < 0.7, `À 30°, ${(v.holes * 100).toFixed(1)} % de l’image à repeindre`);
  // génération : un appel de remplissage puis un d'unification, à la taille de l'image
  button('Générer le nouvel angle').click();
  await wait(() => S.result && !S.busy, 'génération');
  assert(window.calls.length === 3, 'Une passe pour repeindre, puis une passe d’unification par variante : ' + window.calls.length);
  const p0 = window.calls[0].payload, p1 = window.calls[1].payload;
  assert(p0.denoising_strength === 1 && p0.batch_size === 2 && p0.inpainting_fill === 1, 'Repeindre : force 1, 2 variantes, remplissage depuis l’image');
  assert(p0.width * p0.height >= W * H * 0.6 * 0.9 || p0.width * p0.height >= 0.6 * 1048576 * 0.9, `Forge travaille à la taille de l’image (${p0.width}×${p0.height})`);
  assert(Math.abs(p1.denoising_strength - 0.2) < 1e-6, 'Unifier : passe légère à 0,2 sur toute l’image');
  assert(S.result.variants.length === 2 && S.result.variants[0].width === W, 'Deux variantes au format de l’image');
  // les pixels hors des zones repeintes sont ceux du rendu
  assert(button('Ouvrir dans Retouche') && button('Vers Transformer (img2img, inpaint)'), 'Actions du résultat présentes');
  const n0 = KS.state.docs.length;
  button('Ouvrir dans Retouche').click();
  await wait(() => KS.state.docs.length === n0 + 1, 'nouveau document');
  assert(KS.state.doc.width === W && KS.state.doc.height === H, 'Le résultat s’ouvre dans Retouche');
  return results;
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', d => { if (d.level === 'error') { errors.push(d.message); console.error(d.message); } });
    await win.loadFile(path.join(__dirname, '../app/index.html'));
    const results = await win.webContents.executeJavaScript('(' + scenario.toString() + ')()');
    if (errors.length) throw new Error(errors.join('\n'));
    for (const r of results) console.log('OK ' + r);
    app.exit(0);
  } catch (error) {
    console.error('ÉCHEC', error.message);
    app.exit(1);
  }
});
