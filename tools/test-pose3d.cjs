// Onglet Pose 3D du Studio IA dans un vrai renderer Electron (sans moteur ni profil utilisateur).
// Lancer : node_modules/.bin/electron tools/test-pose3d.cjs [dossier où écrire les rendus de contrôle]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-pose3d-'));
app.setPath('userData', path.join(tmp, 'profile'));
const shots = process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.cjs'));
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
window.ksNative = {
  gpuMemory: async () => ({ ok: true, used: 1000, total: 16000, measuredAt: Date.now(), devices: [] }),
  setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {},
  getPending: async () => [], loraThumb: async () => ({ ok: false }), loraCall: async () => ({ ok: true, projects: [], status: null }),
  forgeStatus: async () => ({ ok: false }),
};
`);

async function scenario(withShots) {
  const results = [], images = {};
  const assert = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  const wait = async (test, label = '') => { for (let i = 0; i < 400; i++) { if (test()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('Timeout ' + label); };
  const button = label => [...document.querySelectorAll('#studio button')].find(b => b.textContent === label);
  localStorage.removeItem('kanevas.prefs');
  await KS.cmd.openStudioTab('pose3d');
  await wait(() => document.querySelector('.p3-gl'), 'vue 3D');
  const rail = [...document.querySelectorAll('.fx-rail button')].map(b => b.textContent);
  assert(rail.indexOf('Pose 3D') === rail.indexOf('Transformer') + 1, 'Pose 3D est juste sous Transformer : ' + rail.join(', '));
  const P = KS.poseTab, S = P.state;
  assert(S.bones.length === 163 && S.mesh.geometry.index.count > 80000, 'Corps MakeHuman chargé : ' + S.bones.length + ' os');
  const head = S.B.head.getWorldPosition(new S.mesh.position.constructor());
  assert(head.y > 1.35 && head.y < 1.75, 'Taille réaliste, tête à ' + head.y.toFixed(2) + ' m');
  // poses toutes faites : chacune pose le corps au sol
  const v = new S.mesh.position.constructor();
  for (const id of P.presets) {
    P.applyPreset(id);
    let minY = Infinity; for (let i = 0; i < S.mesh.geometry.attributes.position.count; i += 7) { S.mesh.getVertexPosition(i, v); if (S.model.used[i] && v.y < minY) minY = v.y; }
    assert(Math.abs(minY) < 0.02, `Pose « ${id} » posée au sol (y min ${minY.toFixed(3)})`);
    if (withShots) { P.setView(id === 'lie' ? 'high' : 'three'); images['pose-' + id] = P.renderOut('shaded', { opaque: true }).toDataURL('image/png'); }
  }
  // annuler / rétablir
  P.applyPreset('stand');
  const before = S.B['upperarm01.L'].quaternion.clone();
  P.applyPreset('cheer');
  document.querySelector('.p3-gl').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  assert(S.B['upperarm01.L'].quaternion.angleTo(before) < 1e-3, 'Ctrl+Z revient à la pose précédente (écart ' + S.B['upperarm01.L'].quaternion.angleTo(before).toFixed(4) + ', pile ' + S.undo.length + '/' + S.redo.length + ')');
  // clic sur une poignée : l'articulation est choisie
  P.applyPreset('stand'); P.setView('front'); S.renderer.render(S.scene, S.camera);
  const gl = document.querySelector('.p3-gl'), rect = gl.getBoundingClientRect();
  const click = name => {
    const q = S.B[name].getWorldPosition(new v.constructor()).project(S.camera);
    const x = rect.left + (q.x + 1) / 2 * rect.width, y = rect.top + (1 - q.y) / 2 * rect.height;
    for (const type of ['pointerdown', 'pointerup']) gl.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1, isPrimary: true }));
  };
  click('lowerarm01.L');
  assert(S.sel === 'lowerarm01.L', 'Clic sur le coude gauche : ' + S.sel);
  // cinématique inverse : la main suit la cible, le coude plie
  click('wrist.L');
  assert(S.sel === 'wrist.L', 'Clic sur la main gauche : ' + S.sel);
  button('Déplacer (G)').click();
  assert(S.gizmo.object === S.ikTarget && S.gizmo.mode === 'translate', 'Déplacer la main : flèches de déplacement sur la cible');
  const goal = S.B['wrist.L'].getWorldPosition(new v.constructor()).add(new v.constructor(-0.12, 0.35, 0.25));
  S.gizmo.dispatchEvent({ type: 'mouseDown' }); S.ikTarget.position.copy(goal); S.gizmo.dispatchEvent({ type: 'objectChange' }); S.gizmo.dispatchEvent({ type: 'mouseUp' });
  const reached = S.B['wrist.L'].getWorldPosition(new v.constructor()).distanceTo(goal);
  assert(reached < 0.01, 'La main atteint la cible (écart ' + reached.toFixed(4) + ' m)');
  const shoulder = S.B['upperarm01.L'].getWorldPosition(new v.constructor()), elbow = S.B['lowerarm01.L'].getWorldPosition(new v.constructor());
  const hand = S.B['wrist.L'].getWorldPosition(new v.constructor()), mid = shoulder.clone().add(hand).multiplyScalar(0.5);
  assert(elbow.y < mid.y && elbow.z < mid.z, 'Le coude plie vers le bas et l’arrière (coude ' + elbow.toArray().map(x => x.toFixed(2)) + ', milieu ' + mid.toArray().map(x => x.toFixed(2)) + ')');
  if (withShots) { P.setView('three'); images['ik'] = P.renderOut('shaded', { opaque: true }).toDataURL('image/png'); }
  document.querySelector('.p3-gl').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(S.sel === null && !S.handles.children.some(m => m.userData.finger && m.visible), 'Échap désélectionne ; les doigts sont masqués');
  // rendus de sortie
  P.setView('front');
  for (const mode of ['shaded', 'lines', 'silhouette', 'depth', 'normal', 'openpose']) {
    const c = P.renderOut(mode);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let painted = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0 && (mode === 'shaded' || mode === 'lines' || mode === 'silhouette' ? true : d[i - 1] + d[i - 2] + d[i - 3] > 30)) painted++;
    assert(c.width === 832 && c.height === 1216 && painted > 200, `Rendu « ${mode} » ${c.width}×${c.height}, ${painted} points dessinés`);
    if (withShots) images['out-' + mode] = c.toDataURL('image/png');
  }
  // morphologie : homme plus grand et plus large
  const width = () => { const a = S.B['upperarm01.L'].getWorldPosition(new v.constructor()), b = S.B['upperarm01.R'].getWorldPosition(new v.constructor()); return a.distanceTo(b); };
  const w0 = width();
  button('Homme').click();
  await new Promise(r => setTimeout(r, 50));
  assert(width() > w0 * 1.05, `Homme : épaules plus larges (${w0.toFixed(3)} → ${width().toFixed(3)})`);
  // calque guide dans un document ouvert
  const d = new KS.Doc({ name: 'Dessin', width: 600, height: 900 }); d.addLayer(new KS.Layer({ name: 'Fond', canvas: KS.util.canvas(600, 900) }), 0); KS.addDoc(d);
  await KS.cmd.openStudioTab('pose3d');
  await wait(() => document.querySelector('.p3-gl') && button('Depuis Retouche'), 'vue 3D (2)');
  button('Depuis Retouche').click();
  await wait(() => !document.querySelector('.p3-ref').hidden, 'référence');
  assert(S.ref && S.ref.width === 600, 'Le dessin de Retouche passe derrière le mannequin');
  [...document.querySelectorAll('.p3-chips .fx-chip')].find(b => b.textContent === 'Contours').click();
  [...document.querySelectorAll('#studio button')].find(b => b.textContent.startsWith('Calque guide')).click();
  await wait(() => d.layers.length === 2, 'calque');
  assert(d.layers[1].name === 'Pose 3D (contours)' && d.layers[1].canvas.width === 600 && d.layers[1].canvas.height === 900, 'Calque guide au format du dessin : ' + d.layers[1].name);
  assert(!document.body.classList.contains('studio'), 'Retour dans Retouche après l’envoi');
  if (withShots) { await KS.cmd.openStudioTab('pose3d'); await wait(() => document.querySelector('.p3-gl'), 'vue 3D (3)'); P.applyPreset('contra'); await new Promise(r => setTimeout(r, 200)); }
  return { results, images };
}

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', d => { if (d.level === 'error') { errors.push(d.message); console.error(d.message); } });
    await win.loadFile(path.join(__dirname, '../app/index.html'));
    const { results, images } = await win.webContents.executeJavaScript('(' + scenario.toString() + ')(' + !!shots + ')');
    if (errors.length) throw new Error(errors.join('\n'));
    for (const r of results) console.log('OK ' + r);
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      for (const [k, u] of Object.entries(images)) fs.writeFileSync(path.join(shots, k + '.png'), Buffer.from(u.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(shots, 'ui.png'), (await win.webContents.capturePage()).toPNG());
    }
    app.exit(0);
  } catch (error) {
    console.error('ÉCHEC', error.message);
    app.exit(1);
  }
});
