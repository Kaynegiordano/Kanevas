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
localStorage.setItem('kanevas.prefs', JSON.stringify({ fx: { v: 1, editor: { strength: 0.85 } }, genAI: { v: 2, strength: 1, loras: [{ name: 'obsolete-girl', weight: 1 }] } }));
window.loraImages = []; window.loraPaths = [];
window.calls = [];
window.txtCalls = []; window.extraCalls = []; window.interrupts = 0;
window.ksNative = {
  setTitle() {}, setTitleBar() {}, setZoom() {}, onCloseRequest() {}, onOpenPath() {},
  getPending: async () => [],
  pathForFile: file => 'C:/selected/' + file.name,
  pickImagePaths: async () => window.loraPaths,
  loraThumb: async () => ({ ok: false }),
  loraCall: async (cmd, args = {}) => {
    if (cmd === 'info') return { ok: true, presets: { style: { label: 'Style' } }, scopes: { full: { label: 'Full', hint: '', summary: 'All' } },
      resolutions: [512,1024], optimizers: { adamw8bit: 'AdamW' }, dits: [], fewshot_resolutions: [512,1024], sd_scripts: 'C:/training', tagger: true };
    if (cmd === 'list') return { ok: true, projects: window.loraImages.length ? [{ name: 'Import-test', count: window.loraImages.length }] : [] };
    if (cmd === 'import') { window.loraImages.push(...args.paths.map(p => ({file: p.split('/').pop(),path:p}))); return {ok:true,name:'Import-test',added:args.paths.length,count:window.loraImages.length}; }
    if (cmd === 'load') return { ok:true,manifest:{},images:window.loraImages,runs:[] };
    return {ok:true,status:null};
  },
  forgeStatus: async () => { if (window.holdStatus) await new Promise(resolve => { window.releaseStatus = resolve; }); return { ok: true }; },
  forgeCatalog: async () => ({ ok: true, models: [{ title: 'Studio-model', name: 'Studio-model' }],
    loras: [{ name: 'test', alias: 'Illustration', weight: 0.7, trigger: 'painted', negative: 'bad lines', rel: 'Art', mtime: 1 }],
    modules: [], current: { model: 'Studio-model', modules: [] },
    dtype: 'Automatic', samplers: ['Euler'], schedulers: ['Automatic'], scripts: [], styles: [], presets: {}, upscalers: ['Lanczos'] }),
  forgeImg2img: async (url, payload, init, mask) => {
    window.calls.push({ url, payload, init, mask });
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
  openDialog: async () => window.pickFiles || [],
  saveFiles: async (title, files) => { window.cutFiles = files; return { ok: true, written: files.map(f => f.name) }; }
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
  const navTabs = KS.panels.LAYOUT.find(g => g.id === 'g-nav').tabs;
  assert(navTabs.indexOf('aidraw') === navTabs.indexOf('histogram') + 1 && navTabs.indexOf('info') === navTabs.indexOf('aidraw') + 1 && !KS.panels.isVisible('aidraw'), 'Dessin IA est optionnel entre Histogramme et Infos');
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
  const sourceZoom = document.querySelector('.fx-source .iv-viewport');
  await new Promise(r => setTimeout(r, 60));
  const sourceScale = +sourceZoom.dataset.scale, zr = sourceZoom.getBoundingClientRect();
  sourceZoom.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: zr.left + zr.width / 2, clientY: zr.top + zr.height / 2, bubbles: true, cancelable: true }));
  assert(+sourceZoom.dataset.scale > sourceScale, 'La molette zoome dans la source Img2Img');
  await click('100 %', document.querySelector('.fx-source'));
  assert(+sourceZoom.dataset.scale === 1, 'Le bouton 100 % affiche la taille réelle');
  const outputZoom = document.querySelector('.fx-view .iv-viewport'), oldScale = +outputZoom.dataset.scale;
  await click('+', document.querySelector('.fx-view'));
  assert(+outputZoom.dataset.scale > oldScale, 'Le résultat possède des commandes de zoom indépendantes de la source');
  const zoomedMedia = outputZoom.querySelector('img');
  outputZoom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 50, button: 0, clientX: 30, clientY: 30, bubbles: true }));
  outputZoom.dispatchEvent(new PointerEvent('pointermove', { pointerId: 50, clientX: 65, clientY: 50, bubbles: true }));
  outputZoom.dispatchEvent(new PointerEvent('pointerup', { pointerId: 50, button: 0, bubbles: true }));
  assert(zoomedMedia.style.transform.includes('translate(35px, 20px)'), 'Glisser déplace l’image dans son aperçu');
  await click('Image entière', document.querySelector('.fx-view'));
  assert(+outputZoom.dataset.scale === oldScale && zoomedMedia.style.transform.includes('translate(0px, 0px)'), 'Image entière réinitialise le zoom et le déplacement du cadre');
  document.querySelector('.fx-view .iv-scale').click();
  await wait(() => !!document.querySelector('.iv-lightbox .iv-media'));
  assert(KS.modalOpen() && document.querySelector('.iv-lightbox img').src === zoomedMedia.src, 'Cliquer sur la barre au-dessus ouvre la même image en plein écran');
  document.querySelector('.iv-fullscreen .iv-viewport').click();
  assert(!KS.modalOpen(), 'Cliquer autour de l’image ferme le plein écran');
  await click('⛶', document.querySelector('.fx-source'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!KS.modalOpen() && +sourceZoom.dataset.scale === 1, 'Échap ferme le plein écran sans changer le zoom de la source');
  const dropData = new DataTransfer(); dropData.items.add(new File(['test'], 'test.png', { type: 'image/png' }));
  await KS.cmd.toggleStudio(false);
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dropData, bubbles: true, cancelable: true }));
  assert(document.querySelector('#viewport').classList.contains('drop-active'), 'L’indicateur d’import apparaît seulement pendant un dépôt de fichier');
  const child = document.createElement('div'); document.body.append(child);
  child.addEventListener('drop', e => e.stopPropagation()); child.dispatchEvent(new DragEvent('drop', { dataTransfer: dropData, bubbles: true, cancelable: true })); child.remove();
  assert(!document.querySelector('#viewport').classList.contains('drop-active'), 'Un dépôt capturé par un panneau efface aussi le voile global');
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dropData, bubbles: true, cancelable: true }));
  window.dispatchEvent(new Event('blur'));
  assert(!document.querySelector('#viewport').classList.contains('drop-active'), 'Une sortie de fenêtre efface le faux filigrane');
  await KS.cmd.toggleStudio(true);
  await click('Envoyer vers Img2Img');
  assert(KS.state.docs.length === 2 && KS.studio.on, 'Reprendre un résultat ne crée pas de document dans l’Édition');
  assert(KS.prefs.fx.i2i.prompt === 'original <lora:test:0.7>' && KS.prefs.fx.i2i.seed === -1, 'L’invite suit le résultat et la graine reste aléatoire');
  await click('Inpaint');
  const paintPreview = document.querySelector('.fx-source .iv-viewport'), paintedBeforePan = document.querySelector('.fx-painter').toDataURL();
  paintPreview.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 71, button: 1, clientX: 40, clientY: 40, bubbles: true }));
  paintPreview.dispatchEvent(new PointerEvent('pointermove', { pointerId: 71, clientX: 70, clientY: 80, bubbles: true }));
  paintPreview.dispatchEvent(new PointerEvent('pointerup', { pointerId: 71, button: 1, bubbles: true }));
  assert(document.querySelector('.fx-painter').toDataURL() === paintedBeforePan, 'Déplacer l’aperçu au bouton central ne peint pas le masque');
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
  await click('Créer', document.querySelector('.fx-rail'));
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
  await click('Transformer', document.querySelector('.fx-rail'));
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
  assert(document.querySelectorAll('.fx-output-actions > .fx-actiongroup').length === 4, 'Les actions du résultat sont organisées en quatre groupes');
  assert(![...document.querySelectorAll('.fx-output-actions button')].some(b => /^[📂💾🗃️✨]+$/u.test(b.textContent)), 'Les actions du résultat utilisent des libellés explicites');
  for (const theme of ['dark', 'graphite', 'light']) {
    KS.prefs.theme = theme; KS.prefs.accent = '#8c60d0'; KS.applyPrefs();
    const style = getComputedStyle(document.querySelector('#studio'));
    assert(style.getPropertyValue('--fx-accent').trim() === getComputedStyle(document.body).getPropertyValue('--accent').trim(), 'Le Studio suit la couleur d’accent du thème ' + theme);
  }
  const drawDoc = doc('Dessin à la demande'); KS.addDoc(drawDoc);
  drawDoc.selection.rect({ x: 20, y: 10, w: 30, h: 25 }, 'new', 0); KS.emit('selection', drawDoc);
  KS.prefs.fx.t2i.prompt = 'golden star <lora:test:0.6>'; KS.prefs.fx.t2i.negative_prompt = 'noise';
  KS.prefs.fx.t2i.styles = ['Shared style']; KS.prefs.fx.t2i.sampler_name = 'Euler'; KS.prefs.fx.t2i.scheduler = 'Automatic'; KS.prefs.fx.t2i.steps = 19; KS.prefs.fx.t2i.cfg_scale = 5;
  KS.prefs.fx.t2i.ad.enabled = true; KS.prefs.fx.t2i.ad.units[0].ad_prompt = 'a woman';
  drawDoc.genParams = { prompt: 'initial landscape', styles: [] }; drawDoc.genInfo = 'initial landscape\nSteps: 19';
  const beforePanel = window.calls.length + window.txtCalls.length;
  await KS.cmd.openEditorDraw();
  await wait(() => drawDoc.view.init && KS.view.w > 0);
  assert(!!KS.util.rectIntersect({ x: drawDoc.view.x, y: drawDoc.view.y, w: drawDoc.width * drawDoc.view.zoom, h: drawDoc.height * drawDoc.view.zoom }, { x: 0, y: 0, w: KS.view.w, h: KS.view.h }), 'Le document créé depuis le Studio reste visible au retour dans l’Édition');
  assert(!KS.studio.on && KS.panels.isVisible('aidraw') && window.calls.length + window.txtCalls.length === beforePanel, 'Ouvrir Dessin IA ne lance aucune génération et conserve l’Édition');
  const drawRoot = document.querySelector('.edraw');
  const panelBox = drawRoot.closest('.pbody').getBoundingClientRect(), addBox = drawRoot.querySelector('.fx-generate').getBoundingClientRect();
  assert(addBox.top >= panelBox.top && addBox.bottom <= panelBox.bottom, 'Le bouton Ajouter le dessin est visible sans faire défiler le panneau');
  assert(drawRoot.querySelector('textarea').value === '' && drawRoot.textContent.includes('Studio-model'), 'La demande locale démarre vide et garde le modèle du Studio');
  assert(KS.prefs.fx.editor.strength === 0.5, 'L’ancienne force de 85 % est migrée à 50 %');
  const expectedPrompt = KS.prefs.fx.t2i.prompt;
  const localPrompt = drawRoot.querySelector('textarea'); localPrompt.value = 'a small wooden bridge'; localPrompt.dispatchEvent(new Event('input'));
  await KS.cmd.editorDraw();
  const request = window.calls.at(-1);
  assert(request.payload.prompt === 'a small wooden bridge <lora:test:0.6>' && request.payload.styles[0] === 'Shared style' && request.payload.sampler_name === 'Euler' && request.payload.steps === 19 && request.payload.cfg_scale === 5 && request.payload.negative_prompt === 'noise' && request.url === KS.gen.url(), 'La demande remplace la scène du Studio et conserve LoRA, styles, échantillonnage et moteur');
  assert(request.payload.denoising_strength === 0.5 && request.payload.seed === -1 && request.mask && !request.payload.enable_hr && !request.payload.alwayson_scripts.ADetailer, 'Le remplissage est un inpaint à 50 %, avec masque, graine aléatoire et sans retouche automatique des visages');
  assert(KS.prefs.fx.t2i.prompt === expectedPrompt, 'La demande locale ne modifie pas la description du Studio');
  assert(drawDoc.genParams.prompt === 'initial landscape' && drawDoc.genInfo.startsWith('initial landscape'), 'La retouche préserve le prompt initial et les métadonnées du document');
  await KS.cmd.sendToStudio('params');
  assert(KS.prefs.fx.t2i.prompt === 'initial landscape', 'Renvoyer les paramètres du document au Studio retrouve le prompt initial');
  KS.prefs.fx.t2i.prompt = expectedPrompt; KS.prefs.fx.t2i.styles = ['Shared style']; await KS.cmd.openEditorDraw();

  const generated = drawDoc.layers.at(-1), maskData = generated.mask.canvas.getContext('2d');
  assert(drawDoc.layers.length === 2 && generated.mask && maskData.getImageData(30, 20, 1, 1).data[0] > 200 && maskData.getImageData(100, 50, 1, 1).data[0] === 0 && !KS.studio.on, 'Le dessin dans la sélection crée un calque masqué et reste dans l’Édition');
  assert(drawDoc.layers[0].ctx.getImageData(0, 0, 1, 1).data[2] === 187, 'Le dessin IA préserve les pixels du calque original');
  assert(generated._gen.params.prompt === 'a small wooden bridge <lora:test:0.6>', 'La retouche conserve ses propres paramètres sur son calque');
  KS.gen.setVariant(drawDoc, generated, 0);
  assert(drawDoc.genInfo.startsWith('initial landscape'), 'Changer de variante préserve aussi le prompt initial');
  KS.cmd.undo(); KS.cmd.undo(); assert(drawDoc.layers.length === 1, 'L’ajout du dessin peut être annulé en une seule étape');
  drawDoc.selection.clear(); KS.emit('selection', drawDoc);
  assert(drawRoot.querySelector('.fx-generate').disabled, 'Le mode sélection attend une zone avant de générer');
  const destination = drawRoot.querySelector('select'); destination.value = 'layer'; destination.dispatchEvent(new Event('change'));
  await KS.cmd.openStudioTab('txt2img');
  assert(document.querySelector('#studio textarea').value === expectedPrompt, 'Les modifications du panneau se retrouvent dans le Studio');
  const studioPrompt = document.querySelector('#studio textarea'); studioPrompt.value = 'a silver moon <lora:test:0.4>'; studioPrompt.dispatchEvent(new Event('input'));
  await KS.cmd.openEditorDraw();
  assert(document.querySelector('.edraw textarea').value === 'a small wooden bridge', 'Changer la scène du Studio ne remplace pas la demande locale');
  const beforeDrawT2I = window.txtCalls.length; await KS.cmd.editorDraw();
  assert(window.txtCalls.length === beforeDrawT2I + 1 && drawDoc.layers.length === 2 && !drawDoc.layers.at(-1).mask && !KS.studio.on, 'Le mode nouveau calque dessine sans sélection avec txt2img');
  assert(window.txtCalls.at(-1).prompt === 'a small wooden bridge <lora:test:0.4>', 'Les poids LoRA modifiés dans le Studio sont relus à la génération suivante');
  drawDoc.selection.rect({ x: 20, y: 10, w: 30, h: 25 }, 'new', 0);
  await KS.cmd.generativeFill();
  for (const force of [0.4, 0.6]) {
    const forceSelect = document.querySelectorAll('.edraw select')[1];
    forceSelect.value = String(force); forceSelect.dispatchEvent(new Event('change'));
    await KS.cmd.generativeFill('a stone path');
    assert(window.calls.at(-1).payload.denoising_strength === force && window.calls.at(-1).payload.prompt === 'a stone path <lora:test:0.4>', 'Le remplissage depuis le menu partage la force ' + force + ' et les LoRA actifs');
  }
  const beforeEmpty = window.calls.length;
  await KS.cmd.generativeFill('');
  assert(window.calls.length === beforeEmpty && document.querySelector('.edraw .fx-generate').disabled && !KS.modalOpen(), 'Une demande vide ouvre le panneau sans génération ni ancien dialogue avancé');
  await KS.cmd.generativeFill();
  assert(!KS.modalOpen() && KS.panels.isVisible('aidraw'), 'Le menu Remplissage ouvre le même panneau simple');
  KS.prefs.fx.editor.prompt = 'une petite maison'; KS.prefs.fx.translate = true;
  const oldEnglish = KS.gen.toEnglish; KS.gen.toEnglish = async () => null;
  await KS.cmd.editorDraw();
  assert(window.calls.length === beforeEmpty, 'Une traduction indisponible ne lance pas une génération française incomprise');
  KS.gen.toEnglish = async () => 'a small house';
  await KS.cmd.editorDraw();
  assert(window.calls.at(-1).payload.prompt === 'a small house <lora:test:0.4>', 'La traduction conserve les balises LoRA et traduit uniquement la demande locale');
  KS.gen.toEnglish = oldEnglish; KS.prefs.fx.translate = false;
  const interruptsBeforeDraw = window.interrupts, layersBeforeCancel = drawDoc.layers.length;
  window.holdGeneration = true; key(document.querySelector('.edraw textarea'));
  await wait(() => !!window.releaseGeneration);
  key(document.querySelector('.edraw textarea'));
  await wait(() => window.interrupts === interruptsBeforeDraw + 1 && !!document.querySelector('.edraw .fx-generate'));
  assert(drawDoc.layers.length === layersBeforeCancel, 'Ctrl+Entrée interrompt le dessin IA sans ajouter un calque incomplet');
  window.holdGeneration = false;
  assert(KS.menus.defs().find(m => m.label === 'IA').items().some(i => i.label === 'Ajouter un dessin IA…'), 'Le panneau Dessin IA est également accessible dans le menu IA');
  KS.prefs.theme = 'dark'; KS.prefs.accent = '#2f6fdb'; KS.applyPrefs();
  await KS.cmd.openStudioTab('txt2img');
  document.querySelector('#toasts').replaceChildren();
  document.querySelector('.fx-body').scrollTop = 0;
  assert([...document.querySelectorAll('.fx-rail button')].some(b => b.textContent === 'Lora'), 'Le volet LoRA porte le nom Lora');
  const priorDoc = KS.state.doc; KS.state.doc = null;
  await click('Découper', document.querySelector('.fx-rail'));
  await wait(() => !!document.querySelector('.sc-prev'));
  assert(!!document.querySelector('.sc-prev'), 'Découper ouvre le résultat du Studio sans document dans Édition');
  await click('Exporter les panneaux…', document.querySelector('.modal'));
  await wait(() => !!window.cutFiles?.length);
  assert(window.cutFiles.every(f => f.data.length > 100 && /_\d+\.jpg$/.test(f.name)), 'La découpe exporte les panneaux de l’image du Studio');
  KS.state.doc = priorDoc;
  await KS.cmd.openStudioTab('train'); await wait(() => !!document.querySelector('.lt-drop'));
  const beforeLoraDocs = KS.state.docs.length, loraDrop = new DataTransfer();
  loraDrop.items.add(new File([bytes], 'training-a.png', {type:'image/png'}));
  loraDrop.items.add(new File([bytes], 'training-b.png', {type:'image/png'}));
  document.querySelector('.lt-drop').dispatchEvent(new DragEvent('drop', { dataTransfer:loraDrop, bubbles:true, cancelable:true }));
  await wait(() => window.loraImages.length === 2 && document.querySelectorAll('.lt-cell').length === 2);
  await new Promise(r => setTimeout(r,100));
  assert(KS.state.docs.length === beforeLoraDocs && KS.prefs.fx.tab === 'train', 'Importer plusieurs images par dépôt dans Lora ne crée aucun document dans Edition');
  window.loraPaths = ['C:/selected/picked.png']; document.querySelector('.lt-drop').click();
  await wait(() => window.loraImages.length === 3);
  assert(KS.state.docs.length === beforeLoraDocs, 'Choisir les images dans Lora les garde aussi dans cet atelier');
  window.dispatchEvent(new DragEvent('drop', { dataTransfer:loraDrop, bubbles:true, cancelable:true }));
  await new Promise(r => setTimeout(r,100));
  assert(KS.state.docs.length === beforeLoraDocs, 'Un dépôt ailleurs dans le Studio ne passe pas implicitement dans Edition');
  await KS.cmd.openStudioTab('txt2img');
  return results;
}

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload, contextIsolation: false, sandbox: false, backgroundThrottling: false, offscreen: true } });
    const errors = [];
    win.webContents.on('console-message', details => { if (details.level === 'error') { errors.push(details.message); console.error(details.message); } });
    await win.loadFile(process.env.KANEVAS_TEST_APP_PATH || path.join(__dirname, '../app/index.html'));
    const results = await win.webContents.executeJavaScript('(' + scenario.toString() + ')()');
    if (errors.length) throw new Error(errors.join('\n'));
    for (const result of results) console.log('OK ' + result);
    if (process.env.KANEVAS_TEST_SCREENSHOT) {
      win.setSize(1430, 1000);
      await win.webContents.executeJavaScript('KS.cmd.openEditorDraw()');
      await new Promise(r => setTimeout(r, 500));
      await win.webContents.executeJavaScript('KS.view.resize(); KS.view.render(); document.querySelector("#toasts").replaceChildren()');
      fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-edition.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('KS.cmd.openStudioTab("txt2img")');
    }
    for (const width of [1440, 1000]) {
      win.setSize(width, 1000);
      await new Promise(r => setTimeout(r, 500));
      const overflow = await win.webContents.executeJavaScript('document.querySelector(".fx-body").scrollWidth > document.querySelector(".fx-body").clientWidth + 1');
      if (overflow) throw new Error('Débordement horizontal à ' + width + ' px');
      console.log('OK Mise en page à ' + width + ' px');
      if (process.env.KANEVAS_TEST_SCREENSHOT) fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-' + width + '.png'), (await win.webContents.capturePage()).toPNG());
      if (process.env.KANEVAS_TEST_SCREENSHOT && width === 1440) {
        await win.webContents.executeJavaScript('document.querySelector(".fx-view .iv-scale").click()');
        await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT.replace('.png', '-fullscreen.png'), (await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('document.querySelector(".iv-fullscreen .iv-viewport").click()');
      }

    }
    app.exit(0);
  } catch (err) { console.error(err); app.exit(1); }
});
