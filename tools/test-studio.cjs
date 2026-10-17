// Parcours Studio ↔ Édition dans un vrai renderer Electron, sans moteur ni profil utilisateur.
// Lancer : node_modules/.bin/electron tools/test-studio.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-studio-'));
app.setPath('userData', path.join(tmp, 'profile'));
const preload = path.join(tmp, 'preload.cjs');
fs.writeFileSync(preload, `
window.calls = [];
window.txtCalls = []; window.extraCalls = []; window.interrupts = 0;
window.ksNative = {
  setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {},
  getPending: async () => [],
  forgeStatus: async () => { if (window.holdStatus) await new Promise(resolve => { window.releaseStatus = resolve; }); return { ok: true }; },
  forgeCatalog: async () => ({ ok: true, models: [], loras: [], modules: [], current: { model: '', modules: [] },
    dtype: 'Automatic', samplers: ['Euler'], schedulers: ['Automatic'], scripts: [], styles: [], presets: {}, upscalers: ['Lanczos'] }),
  forgeImg2img: async (url, payload, init, mask) => {
    window.calls.push({ payload, init, mask });
    if (window.holdGeneration) await new Promise(resolve => { window.releaseGeneration = resolve; });
    return { ok: true, images: [init], info: { seed: 42, infotexts: [payload.prompt + '\\nSteps: 32, Sampler: Euler, Seed: 42, Size: 128x64'] } };
  },
  forgeTxt2img: async (url, payload) => { window.txtCalls.push(payload);
    if (window.holdGeneration) await new Promise(resolve => { window.releaseGeneration = resolve; });
    return { ok: true, images: [window.calls[0].init],
    info: { seed: 84, infotexts: [payload.prompt + '\\nSteps: 20, Seed: 84, Size: 128x64'] } }; },
  forgeUpscale: async (url, payload, init) => { window.extraCalls.push(payload);
    if (window.holdGeneration) await new Promise(resolve => { window.releaseGeneration = resolve; });
    return { ok: true, image: init }; },
  forgeInterrupt: async () => { window.interrupts++; window.releaseGeneration?.(); window.releaseGeneration = null; return { ok: true }; },
  forgeProgress: async () => ({ ok: true, progress: 0.5 }),
  openDialog: async () => window.pickFiles || []
};
`);

async function scenario() {
  const results = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); results.push(message); };
  const wait = async test => { for (let i = 0; i < 100; i++) { if (test()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('Timeout'); };
  const button = (label, scope = document) => [...scope.querySelectorAll('button')].find(b => b.textContent === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Bouton absent : ' + label); b.click(); await new Promise(r => setTimeout(r, 30)); };
  const doc = name => { const d = new KS.Doc({ name, width: 128, height: 64 }); const c = KS.util.canvas(128, 64); const x = c.getContext('2d'); x.fillStyle = '#3970bb'; x.fillRect(0, 0, 128, 64); d.addLayer(new KS.Layer({ name: 'Base', canvas: c }), 0); return d; };
  const a = doc('Source A'); KS.addDoc(a);
  assert(!KS.panels.defs.generate && !KS.panels.LAYOUT.some(g => g.tabs.includes('generate')), 'Aucun panneau Img2Img ni Studio IA dans le dock Édition');
  await KS.cmd.sendToStudio('img2img');
  await wait(() => document.querySelector('.fx-left .fx-panel .fx-slider'));
  assert(KS.studio.on && KS.prefs.fx.tab === 'img2img', 'Img2Img ouvre le Studio');
  assert(document.querySelector('.fx-source img').alt === 'Source A', 'Le document envoyé devient la source');
  a.layers[0].ctx.fillStyle = '#cc0011'; a.layers[0].ctx.fillRect(0, 0, 128, 64); a.layers[0].touch(); a.changed();
  const b = doc('Autre document'); KS.addDoc(b);
  b.layers[0].ctx.fillStyle = '#11bb44'; b.layers[0].ctx.fillRect(0, 0, 128, 64); b.layers[0].touch(); b.changed();
  await KS.cmd.toggleStudio(false); await KS.cmd.toggleStudio(true);
  assert(document.querySelector('.fx-source img').alt === 'Source A', 'Changer de document ne remplace pas la source');
  KS.prefs.fx.i2i.prompt = 'original <lora:test:0.7>'; KS.prefs.fx.translate = false;
  const before = a.layers.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === 1 && window.calls[0].payload.width === 128 && window.calls[0].payload.height === 64, 'La génération utilise la taille de la source');
  const sent = await KS.util.canvasFromBlob(new Blob([window.calls[0].init], { type: 'image/png' }));
  assert(sent.getContext('2d').getImageData(0, 0, 1, 1).data[2] === 187, 'Les pixels envoyés viennent de la source choisie, pas du document actif');
  assert(a.layers.length === before && b.layers.length === 1, 'Générer ne modifie aucun document de l’Édition');
  assert(!!document.querySelector('.fx-img2img .fx-view img'), 'Le résultat Img2Img possède un grand aperçu');
  await click('Envoyer vers Img2Img');
  assert(KS.state.docs.length === 2 && KS.studio.on, 'Reprendre un résultat ne crée pas de document dans l’Édition');
  assert(KS.prefs.fx.i2i.prompt === 'original <lora:test:0.7>' && KS.prefs.fx.i2i.seed === -1, 'L’invite suit le résultat et la graine reste aléatoire');
  await click('Inpaint');
  assert(KS.studio.on && !!document.querySelector('.fx-painter') && KS.state.docs.length === 2, 'Inpaint reste dans le Studio et affiche son propre canevas');
  const paint = (from, to = from) => {
    const canvas = document.querySelector('.fx-painter'), rect = canvas.getBoundingClientRect();
    const send = (type, p) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, bubbles: true,
      clientX: rect.left + p.x * rect.width / 128, clientY: rect.top + p.y * rect.height / 64 }));
    send('pointerdown', from); send('pointermove', to); send('pointerup', to);
  };
  KS.prefs.fx.painter.size = 16;
  paint({ x: 8, y: 8 }, { x: 12, y: 12 });
  await KS.cmd.studioGenerate();
  assert(window.calls.length === 2 && !!window.calls[1].mask, 'Le masque peint directement dans le Studio est envoyé à Forge');
  const maskSent = await KS.util.canvasFromBlob(new Blob([window.calls[1].mask], { type: 'image/png' }));
  assert(maskSent.getContext('2d').getImageData(8, 8, 1, 1).data[0] === 255 && maskSent.getContext('2d').getImageData(40, 40, 1, 1).data[0] === 0, 'Le masque envoyé est blanc dans la zone peinte et noir ailleurs');
  assert(KS.studio.on && a.layers.length === 1 && b.layers.length === 1 && KS.state.doc === b, 'Peindre dans le Studio ne change aucun document de l’Édition');
  const cancelOps = KS.cancelActiveOps; let canceledEditor = false;
  KS.cancelActiveOps = () => { canceledEditor = true; };
  await click('Annuler');
  const callsBeforeUndo = window.calls.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === callsBeforeUndo, 'Annuler efface le trait de masque dans le Studio');
  await click('Rétablir');
  document.querySelector('.fx-img2img').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  document.querySelector('.fx-img2img').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
  assert(!canceledEditor, 'Annuler et rétablir dans le Studio ne touchent pas aux opérations de l’Édition');
  KS.cancelActiveOps = cancelOps;
  await click('Inverser');
  await KS.cmd.studioGenerate();
  assert(window.calls.length === 3 && !!window.calls[2].mask, 'Les outils de masque fonctionnent depuis le Studio');
  await click('Ajouter en calque');
  assert(!KS.studio.on && b.layers.length === 2, 'Ajouter en calque revient volontairement au document actif dans l’Édition');
  await KS.cmd.sendToStudio('img2img');
  await click('Ouvrir le résultat dans l’Édition');
  assert(!KS.studio.on && KS.state.doc !== b, 'Ouvrir un résultat crée un nouveau document dans l’Édition');
  await KS.cmd.sendToStudio('extras');
  assert(KS.prefs.fx.tab === 'extras' && !!document.querySelector('.fx-dropzone img'), 'L’Édition envoie aussi vers Extras');
  await KS.cmd.sendToStudio('pnginfo');
  assert(KS.prefs.fx.tab === 'pnginfo', 'L’Édition envoie aussi vers PNG Info');
  await click('Envoyer vers Img2Img');
  assert(KS.prefs.fx.tab === 'img2img', 'PNG Info renvoie sa source vers Img2Img');
  await click('Retirer la source');
  const count = window.calls.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === count, 'Aucune génération Img2Img sans source');
  const canvas = a.composite(), bytes = new Uint8Array(await (await KS.util.blobFromCanvas(canvas)).arrayBuffer());
  window.pickFiles = [{ name: 'Import.png', data: KS.png.writeText(bytes, 'parameters', 'Imported prompt\nSteps: 18, Sampler: Euler, Seed: 123, Size: 128x64') }];
  document.querySelector('.fx-source .fx-dropzone').click();
  await wait(() => document.querySelector('.fx-source img')?.alt === 'Import.png');
  assert(KS.prefs.fx.i2i.seed === -1 && KS.prefs.fx.i2i.prompt === 'Imported prompt', 'Importer un PNG reprend l’invite sans figer sa graine');
  await click('txt2img', document.querySelector('.fx-rail'));
  assert(KS.prefs.fx.tab === 'txt2img' && !!document.querySelector('.fx-out'), 'txt2img reste accessible');
  KS.prefs.fx.t2i.prompt = 'new image <lora:test:0.8>';
  await KS.cmd.studioGenerate();
  const docsBefore = KS.state.docs.length;
  await click('Envoyer vers Img2Img');
  assert(KS.prefs.fx.i2i.seed === -1 && KS.state.docs.length === docsBefore, 'txt2img envoie vers Img2Img avec une nouvelle graine aléatoire');
  await click('Ouvrir la source dans l’Édition', document.querySelector('.fx-source'));
  await KS.cmd.sendToStudio('img2img');
  assert(KS.prefs.fx.i2i.seed === -1, 'Un aller-retour dans l’Édition conserve le mode aléatoire');
  await click('img2img', document.querySelector('.fx-modes'));
  await KS.cmd.studioGenerate();
  await click('Agrandir avec Hires');
  assert(KS.prefs.fx.tab === 'txt2img' && KS.prefs.fx.t2i.prompt === 'new image <lora:test:0.8>', 'Img2Img renvoie image et réglages vers txt2img / Hires');
  document.querySelector('button[title^="Agrandir cette image avec le hires fix"]').click();
  await wait(() => window.txtCalls.length === 2 && !!document.querySelector('.fx-generate'));
  assert(window.txtCalls.at(-1).seed === -1, 'Hires demande aussi une graine aléatoire');
  await click('img2img', document.querySelector('.fx-rail'));
  assert(document.querySelector('.fx-source img').alt.startsWith('new image'), 'La source survit au changement d’onglet');
  await click('Inpaint sketch');
  KS.prefs.fx.painter.color = '#22cc44'; KS.prefs.fx.painter.erase = false;
  const beforeSketch = window.calls.length;
  paint({ x: 8, y: 8 }); await KS.cmd.studioGenerate();
  const sketch = await KS.util.canvasFromBlob(new Blob([window.calls.at(-1).init], { type: 'image/png' }));
  assert(window.calls.length === beforeSketch + 1 && !!window.calls.at(-1).mask && sketch.getContext('2d').getImageData(8, 8, 1, 1).data[1] === 204 && KS.studio.on,
    'Inpaint sketch peint ses couleurs et son masque entièrement dans le Studio');
  await click('Gomme'); KS.prefs.fx.painter.size = 32; paint({ x: 8, y: 8 });
  const beforeErase = window.calls.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === beforeErase, 'La gomme du Studio efface la zone du croquis');
  await click('img2img', document.querySelector('.fx-modes'));
  const file = new File([bytes], 'Drop.png', { type: 'image/png' }), transfer = new DataTransfer(); transfer.items.add(file);
  document.querySelector('.fx-source .fx-dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  await wait(() => document.querySelector('.fx-source img')?.alt === 'Drop.png');
  assert(KS.state.docs.length === docsBefore + 1, 'Glisser-déposer importe dans le Studio sans ouvrir de document');
  await click('Batch');
  window.pickFiles = [{ name: 'One.png', data: bytes }, { name: 'Two.png', data: bytes }];
  await click('Choisir des images…');
  const beforeBatch = window.calls.length;
  await KS.cmd.studioGenerate();
  assert(window.calls.length === beforeBatch + 2 && document.querySelectorAll('.fx-img2img .fx-thumbs img').length === 2, 'Batch traite chaque entrée et conserve les résultats dans le Studio');
  await click('img2img', document.querySelector('.fx-modes'));
  KS.prefs.fx.i2i.seed = 1234; KS.prefs.fx.i2i.subseed = 4321; KS.prefs.fx.i2i.seedExtra = true;
  await KS.cmd.studioGenerate();
  assert(window.calls.at(-1).payload.seed === -1 && window.calls.at(-1).payload.subseed === -1, 'Une ancienne graine fixe ne bloque plus les générations suivantes');
  assert(window.calls.every(c => c.payload.seed === -1) && window.txtCalls.every(p => p.seed === -1), 'Toutes les générations txt2img, Img2Img et Batch demandent une graine aléatoire');
  const key = (target, repeat = false) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, repeat, bubbles: true, cancelable: true }));
  const beforeShortcut = window.calls.length;
  window.holdGeneration = true;
  key(document.querySelector('textarea.fx-prompt'));
  await wait(() => window.calls.length === beforeShortcut + 1 && !!window.releaseGeneration);
  assert(!!document.querySelector('.fx-interrupt'), 'Ctrl+Entrée démarre depuis l’invite et affiche Interrompre');
  key(document.querySelector('textarea.fx-prompt'), true);
  assert(window.interrupts === 0, 'Maintenir Ctrl+Entrée ne provoque pas une interruption immédiate');
  key(document.querySelector('.fx-num'));
  await wait(() => window.interrupts === 1 && !!document.querySelector('.fx-generate'));
  assert(window.calls.length === beforeShortcut + 1, 'Ctrl+Entrée depuis un réglage interrompt sans lancer une deuxième requête');
  window.holdGeneration = false; window.holdStatus = true;
  key(document.querySelector('.fx-source'));
  await wait(() => !!window.releaseStatus);
  key(document.querySelector('.fx-source'));
  window.holdStatus = false; window.releaseStatus(); window.releaseStatus = null;
  await wait(() => !!document.querySelector('.fx-generate'));
  assert(window.calls.length === beforeShortcut + 1, 'Ctrl+Entrée annule aussi une génération encore en préparation');
  const aiMenu = KS.menus.defs().find(m => m.label === 'IA').items();
  assert(aiMenu.some(i => i.label === 'Envoyer vers Img2Img — transformer l’image') && aiMenu.some(i => i.label === 'Envoyer vers Inpaint — retoucher une zone'), 'Le menu IA propose clairement Img2Img et Inpaint au même niveau');
  assert(!!button('Envoyer vers Img2Img') && !!button('Envoyer vers Inpaint'), 'Les résultats proposent les deux destinations avec des libellés explicites');
  await KS.cmd.toggleStudio(false);
  document.querySelector('.ws-to-studio').click();
  const sendItem = [...document.querySelectorAll('.menu .mi')].find(i => i.textContent.includes('Envoyer vers Img2Img'));
  assert(!!sendItem, 'Le menu d’envoi du document contient Img2Img');
  sendItem.click();
  await wait(() => KS.studio.on && KS.prefs.fx.i2iMode === 'img2img');
  await KS.cmd.sendToStudio('extras'); window.holdGeneration = true;
  key(document.querySelector('.fx-num'));
  await wait(() => window.extraCalls.length === 1 && !!window.releaseGeneration);
  key(document.querySelector('.fx-num'));
  await wait(() => window.interrupts === 2 && !!document.querySelector('.fx-generate'));
  assert(window.extraCalls.length === 1, 'Ctrl+Entrée démarre et interrompt aussi Extras');
  await KS.cmd.openStudioTab('txt2img');
  const beforeT2IShortcut = window.txtCalls.length;
  key(document.querySelector('textarea.fx-prompt'));
  await wait(() => window.txtCalls.length === beforeT2IShortcut + 1 && !!window.releaseGeneration);
  key(document.querySelector('textarea.fx-prompt'));
  await wait(() => window.interrupts === 3 && !!document.querySelector('.fx-generate'));
  assert(window.txtCalls.length === beforeT2IShortcut + 1 && window.txtCalls.at(-1).seed === -1, 'Ctrl+Entrée démarre et interrompt txt2img avec une graine aléatoire');
  window.holdGeneration = false;
  await KS.cmd.openStudioTab('img2img');
  await click('Inpaint');
  await click('Peindre le masque');
  paint({ x: 8, y: 8 }, { x: 40, y: 24 });
  document.querySelector('#toasts').replaceChildren();
  document.querySelector('.fx-body').scrollTop = 0;
  return results;
}

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
    await win.loadFile(process.env.KANEVAS_TEST_APP_PATH || path.join(__dirname, '../app/index.html'));
    const results = await win.webContents.executeJavaScript('(' + scenario.toString() + ')()');
    if (errors.length) throw new Error(errors.join('\n'));
    for (const result of results) console.log('OK ' + result);
    for (const width of [1440, 1000]) {
      win.setSize(width, 1000);
      await new Promise(r => setTimeout(r, 500));
      const overflow = await win.webContents.executeJavaScript('document.querySelector(".fx-body").scrollWidth > document.querySelector(".fx-body").clientWidth + 1');
      if (overflow) throw new Error('Débordement horizontal à ' + width + ' px');
      console.log('OK Mise en page à ' + width + ' px');
      if (process.env.KANEVAS_TEST_SCREENSHOT) fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-' + width + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    app.exit(0);
  } catch (err) { console.error(err); app.exit(1); }
});
