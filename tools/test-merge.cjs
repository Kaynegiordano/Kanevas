// Onglet Merge du Studio IA dans un vrai renderer Electron (passerelle simulée, sans moteur ni profil utilisateur).
// Lancer : node_modules/.bin/electron tools/test-merge.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-merge-'));
app.setPath('userData', path.join(tmp, 'profile'));
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
window.merges = []; window.inspected = []; window.cancelled = 0; window.progressFn = null;
window.ksNative = {
  gpuMemory: async () => ({ ok: true, used: 1000, total: 16000, measuredAt: Date.now(), devices: [{ name: 'test', used: 1000, total: 16000 }] }),
  setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {},
  getPending: async () => [],
  loraThumb: async () => ({ ok: false }),
  loraCall: async () => ({ ok: true, projects: [], status: null }),
  forgeStatus: async () => ({ ok: true }),
  forgeCatalog: async () => ({ ok: true, models: [{ title: 'Studio-model', name: 'Studio-model' }], loras: [], modules: [], current: { model: 'Studio-model', modules: [] },
    dtype: 'Automatic', samplers: ['Euler'], schedulers: ['Automatic'], scripts: [], styles: [], presets: {}, upscalers: ['Lanczos'] }),
  forgeRefreshCheckpoints: async () => ({ ok: true }), forgeRefreshLoras: async () => ({ ok: true }), forgeSetOptions: async () => ({ ok: true }),
  mergeList: async () => ({ ok: true,
    checkpoints: [{ id: 'ckpt:anima_a.safetensors', name: 'anima_a', size: 4e9 }, { id: 'ckpt:anima_b.safetensors', name: 'anima_b', size: 4e9 }, { id: 'ckpt:anima_base.safetensors', name: 'anima_base', size: 4e9 }, { id: 'ckpt:sdxl_x.safetensors', name: 'sdxl_x', size: 6e9 }],
    loras: [{ id: 'lora:Anima/one.safetensors', name: 'Anima/one', size: 6e7 }, { id: 'lora:Anima/two.safetensors', name: 'Anima/two', size: 9e7 }, { id: 'lora:sd/other.safetensors', name: 'sd/other', size: 9e7 }] }),
  mergeInspect: async ids => { window.inspected.push(...ids); return { ok: true, files: ids.map(id => ({ path: id, arch: /sdxl|sd\\//.test(id) ? 'sdxl' : 'anima', kind: id.startsWith('lora') ? 'lora' : 'checkpoint', dtype: 'bf16', size: 6e7, rank: 24, modules: 280 })) }; },
  mergeRun: async job => { window.merges.push(job); window.progressFn && window.progressFn({ progress: 40, text: 'Couche 5 / 10' });
    if (window.mergeFails) return { ok: false, error: 'Architectures incompatibles' };
    return { ok: true, name: job.name, id: (job.kind === 'loras' ? 'lora:KaneApp/' : 'ckpt:KaneApp/') + job.name + '.safetensors', size: 1e8, seconds: 3.2, layers: 10, merged: 10, kept: 0, rank: job.kind === 'loras' ? 56 : undefined, modules: 280, report: [] }; },
  mergeCancel: async () => { window.cancelled++; return { ok: true }; },
  onMergeProgress: fn => { window.progressFn = fn; return () => { window.progressFn = null; }; },
};
`);

async function scenario() {
  const results = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  const wait = async (test, label = '') => { for (let i = 0; i < 150; i++) { if (test()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timeout ' + label); };
  const pick = async (sel, value) => { sel.value = value; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 30)); };
  const button = label => [...document.querySelectorAll('#studio button')].find(b => b.textContent === label);
  await KS.cmd.openStudioTab('merge');
  await wait(() => document.querySelector('.mg-col'), 'page Merge');
  const rail = [...document.querySelectorAll('.fx-rail button')].map(b => b.textContent);
  assert(rail.indexOf('Merge') === rail.indexOf('Lora') + 1, 'Merge est juste sous Lora dans le Studio : ' + rail.join(', '));
  assert(document.querySelector('.fx-rail button.on').textContent === 'Merge', 'L’onglet Merge est actif');
  assert([...document.querySelectorAll('.fx-tabs button')].map(b => b.textContent).join('|') === 'LoRA + LoRA|Checkpoints|LoRA → Checkpoint', 'Trois modes');
  // --- LoRA + LoRA
  let go = button('Fusionner');
  assert(go.disabled, 'Fusionner est inactif sans deux LoRA');
  let sels = [...document.querySelectorAll('.mg-row select')];
  assert(sels.length === 2 && sels[0].options.length === 4, 'Deux emplacements de LoRA, trois LoRA proposés');
  await pick(sels[0], 'lora:Anima/one.safetensors'); sels = [...document.querySelectorAll('.mg-row select')]; await pick(sels[1], 'lora:Anima/two.safetensors');
  await wait(() => document.querySelector('.mg-note').textContent.includes('rang 24'), 'note');
  assert(document.querySelector('.mg-name').value === 'mix_one_two', 'Nom proposé : ' + document.querySelector('.mg-name').value);
  go = button('Fusionner'); assert(!go.disabled, 'Fusionner devient actif avec deux LoRA');
  sels = [...document.querySelectorAll('.mg-row select')]; await pick(sels[1], 'lora:sd/other.safetensors');
  await wait(() => document.querySelector('.mg-warn').textContent.includes('Architectures différentes'), 'avertissement');
  assert(button('Fusionner').disabled, 'Deux architectures différentes bloquent la fusion');
  sels = [...document.querySelectorAll('.mg-row select')]; await pick(sels[1], 'lora:Anima/two.safetensors');
  assert(!button('Fusionner').disabled && !document.querySelector('.mg-warn').textContent, 'L’avertissement disparaît');
  [...document.querySelectorAll('.fx-ropt')].find(l => l.textContent.includes('Recompressé')).click();
  await wait(() => [...document.querySelectorAll('.fx-lbl')].some(l => l.textContent === 'Rang final'), 'rang');
  await button('Fusionner').click();
  await wait(() => document.querySelector('.mg-result'), 'résultat');
  let job = window.merges.at(-1);
  assert(job.kind === 'loras' && job.method === 'svd' && job.rank === 32 && job.loras.length === 2 && job.loras[0].id === 'lora:Anima/one.safetensors' && job.name === 'mix_one_two', 'Le job LoRA + LoRA est complet : ' + JSON.stringify(job));
  assert(document.querySelector('.mg-result').textContent.includes('mix_one_two.safetensors') && button('Actualiser les LoRA du Studio'), 'Résultat affiché avec son action');
  // --- checkpoints
  [...document.querySelectorAll('.fx-tabs button')].find(b => b.textContent === 'Checkpoints').click();
  await wait(() => document.querySelector('.lt-grid3 select'), 'checkpoints');
  assert(button('Fusionner').disabled, 'Checkpoints : inactif sans A et B');
  let cs = [...document.querySelectorAll('.lt-grid3 select')];
  await pick(cs[0], 'ckpt:anima_a.safetensors'); cs = [...document.querySelectorAll('.lt-grid3 select')]; await pick(cs[1], 'ckpt:anima_b.safetensors');
  assert(!button('Fusionner').disabled, 'Checkpoints : actif avec A et B');
  [...document.querySelectorAll('.fx-check')].find(l => l.textContent.includes('Dégradé')).querySelector('input').click();
  await wait(() => [...document.querySelectorAll('.fx-lbl')].some(l => l.textContent === 'α au dernier bloc'), 'dégradé');
  [...document.querySelectorAll('.fx-ropt')].find(l => l.textContent.includes('Différence ajoutée')).click();
  await wait(() => document.querySelectorAll('.lt-grid3 select').length === 3, 'sélecteur C');
  assert(button('Fusionner').disabled, 'Différence ajoutée demande un modèle C');
  cs = [...document.querySelectorAll('.lt-grid3 select')]; await pick(cs[2], 'ckpt:anima_base.safetensors');
  await button('Fusionner').click();
  await wait(() => window.merges.length === 2, 'job 2');
  job = window.merges[1];
  assert(job.kind === 'checkpoints' && job.mode === 'diff' && job.models.length === 3 && job.alpha_end !== null && job.models[2] === 'ckpt:anima_base.safetensors', 'Le job checkpoints est complet : ' + JSON.stringify(job));
  // --- LoRA → checkpoint
  [...document.querySelectorAll('.fx-tabs button')].find(b => b.textContent === 'LoRA → Checkpoint').click();
  await wait(() => document.querySelector('.lt-grid3 select') && document.querySelector('.mg-row'), 'inject');
  await pick(document.querySelector('.lt-grid3 select'), 'ckpt:anima_a.safetensors');
  await pick(document.querySelector('.mg-row select'), 'lora:Anima/one.safetensors');
  assert(!button('Fusionner').disabled, 'LoRA → Checkpoint : actif');
  window.mergeFails = true; await button('Fusionner').click();
  await wait(() => document.querySelector('.mg-err'), 'erreur');
  assert(document.querySelector('.mg-err').textContent.includes('incompatibles'), 'Une erreur de fusion est affichée');
  window.mergeFails = false; await button('Fusionner').click(); await wait(() => document.querySelector('.mg-result'), 'résultat 3');
  job = window.merges.at(-1);
  assert(job.kind === 'lora_into_checkpoint' && job.model === 'ckpt:anima_a.safetensors' && job.loras.length === 1 && job.loras[0].weight === 1, 'Le job LoRA → checkpoint est complet : ' + JSON.stringify(job));
  assert(!!button('Utiliser dans le Studio'), 'Le checkpoint obtenu peut être utilisé');
  return results;
}

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
    const errors = [];
    win.webContents.on('console-message', d => { if (d.level === 'error') { errors.push(d.message); console.error(d.message); } });
    await win.loadFile(path.join(__dirname, '../app/index.html'));
    const results = await win.webContents.executeJavaScript('(' + scenario.toString() + ')()');
    if (errors.length) throw new Error(errors.join('\n'));
    for (const r of results) console.log('OK ' + r);
    if (process.env.KANEVAS_TEST_SCREENSHOT) {
      await new Promise(r => setTimeout(r, 300));
      fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    }
    app.exit(0);
  } catch (error) {
    console.error('ÉCHEC', error.message);
    app.exit(1);
  }
});
