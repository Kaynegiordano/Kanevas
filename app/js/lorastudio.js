// Atelier LoRA : fabriquer un LoRA sans quitter Kanevas. Projets, images (fichiers, dossier, document,
// sélection, documents ouverts), légendes (WD14 automatique, édition, ajout / retrait de tags en lot),
// préréglages et recette de l'entraîneur de Forge (forge_lora_trainer, via lora_bridge.py), lancement,
// suivi en direct (progression, échantillons, sauvegardes) et essai d'une sauvegarde dans le panneau IA.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd, G = KS.gen, N = KS.native;
  const S = { root: null, info: null, projects: [], cur: null, data: null, thumbs: new Map(), poll: null, status: null, sel: new Set() };
  const call = async (cmd, args) => { const r = await N.loraCall(cmd, args); if (!r.ok) throw new Error(r.error); return r; };
  const label = p => p.trigger || (p.name.length > 24 ? p.name.slice(0, 10) + '…' : p.name);
  const fmtDur = s => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), mm = Math.round((s % 3600) / 60); return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm} min`; };
  const thumb = async (file, w = 256) => {
    const key = file + '|' + w;
    if (S.thumbs.has(key)) return S.thumbs.get(key);
    const r = await N.loraThumb(file, w);
    const url = r.ok ? URL.createObjectURL(new Blob([r.data], { type: 'image/jpeg' })) : '';
    S.thumbs.set(key, url); return url;
  };
  const busy = (msg, fn) => KS.gen.task(msg, fn);
  const toast = (m, t = 'ok', ms) => KS.toast(m, t, ms);

  async function ensureForge() {
    if (!N || !N.loraCall) throw new Error('L\'atelier LoRA n\'est disponible que dans l\'application de bureau');
    const cat = await N.forgeCatalog(G.url());
    S.cat = cat.ok ? cat : null;
    S.forgeOff = !cat.ok;                 // Forge éteint : l'atelier marche quand même (dossiers mémorisés)
    return cat.ok ? cat : { current: { modules: [] } };
  }
  async function refreshProjects() { S.projects = (await call('list', {})).projects; }
  async function openProject(name) {
    S.cur = name; S.sel.clear();
    S.data = await call('load', { name });
    const run = S.data.runs.find(r => r.running);
    S.status = run || (S.data.runs[0] || null);
    render();
    if (run) startPoll();
  }

  /* ---------------------------------------------------------------- rendu */
  function render() {
    if (!S.root) return;
    const body = S.root.querySelector('.ls-body');
    body.replaceChildren(left(), center(), right());
  }
  function left() {
    const list = h('div.ls-projects');
    for (const p of S.projects) {
      const st = p.last && p.last.running ? 'running' : p.last ? p.last.state : '';
      const row = h('button.ls-proj' + (p.name === S.cur ? '.on' : ''), h('span.ls-pn', { text: label(p) }), h('span.ls-pc', { text: `${p.count} img · ${p.lora_type}` }),
        st ? h('span.ls-badge.' + st, { text: st === 'running' ? `en cours ${p.last.pct} %` : st === 'done' ? 'terminé' : st === 'error' ? 'échec' : st === 'stopped' ? 'arrêté' : st }) : null);
      row.addEventListener('click', () => openProject(p.name).catch(e => toast(e.message, 'err', 5000)));
      list.appendChild(row);
    }
    const add = ui.btn('Nouveau projet', async () => {
      const trig = await KS.prompt('Nouveau LoRA', 'Mot déclencheur (ex. monstyle, sans espace)', '');
      if (!trig) return;
      try { const r = await call('create', { name: trig, trigger: trig }); await refreshProjects(); await openProject(r.name); } catch (e) { toast(e.message, 'err', 5000); }
    }, '.primary', 'plus');
    const run = S.info && S.info.running;
    return h('div.ls-left', h('div.ls-h', { text: 'Projets' }), add,
      run ? h('div.ls-runbar', { text: 'Entraînement actif : ' + (S.projects.find(p => p.name === run.project)?.trigger || run.project) }) : null, list,
      h('div.note', { text: 'Les projets sont ceux de l\'onglet d\'entraînement de Forge (mêmes dossiers).' }));
  }

  function center() {
    if (!S.data) return h('div.ls-center.ls-empty', h('div', h('h3', { text: 'Atelier LoRA' }), h('p.note', { text: 'Choisissez un projet ou créez-en un. Ajoutez 15 à 50 images du style, du personnage ou de l\'objet, vérifiez les légendes, choisissez le type, puis lancez l\'entraînement.' })));
    const m = S.data.manifest, caps = m.captions || {};
    const trig = h('input.field.ls-trig', { type: 'text', value: m.trigger || '', spellcheck: false, placeholder: 'mot déclencheur' });
    trig.addEventListener('change', () => save({ trigger: trig.value })); trig.addEventListener('keydown', e => e.stopPropagation());
    const presets = Object.entries(S.info.presets).map(([k, v]) => [k, v.label]);
    const kind = ui.select(presets, m.lora_type || 'style', v => { m.lora_type = v; hint.textContent = S.info.presets[v]?.hint || ''; });
    const hint = h('div.note.ls-hint', { text: S.info.presets[m.lora_type || 'style']?.hint || '' });
    const apply = ui.btn('Appliquer le préréglage', () => withBusy('Préréglage (légendes automatiques au besoin)…', async () => {
      const r = await call('preset', { name: S.cur, kind: m.lora_type || 'style', threshold: m.threshold ?? 0.35 });
      S.data.manifest = r.manifest;
      toast(`Préréglage appliqué : ${r.passes} passages par image` + (r.removed_tags.length ? ` · ${r.removed_tags.length} tags retirés des légendes` : ''), 'ok', 4500);
      if (r.note) toast(r.note.replace(/\*\*/g, ''), 'info', 8000);
    }), '.small', 'settings');
    const tools = h('div.ls-tools',
      ui.btn('Images…', () => addPaths(N.pickImagePaths()), '.small', 'image'),
      ui.btn('Dossier…', () => addPaths(N.pickFolderImages()), '.small', 'folder-open'),
      ui.btn('Image en cours', () => addDocs([KS.state.doc], false), '.small', 'file-plus'),
      ui.btn('Sélection', () => addDocs([KS.state.doc], true), '.small', 'marquee-rect'),
      ui.btn('Documents ouverts', () => addDocs(KS.state.docs, false), '.small', 'duplicate'),
      h('div.spacer'),
      ui.btn('Légendes auto (WD14)', () => caption(false), '.small', 'sparkles'),
      ui.btn('Compléter', () => caption(true), '.small'),
      S.sel.size ? ui.btn(`Retirer ${S.sel.size}`, removeSelected, '.small', 'trash') : null);
    const tagIn = h('input.field.ls-tag', { type: 'text', placeholder: 'tag', spellcheck: false });
    tagIn.addEventListener('keydown', e => e.stopPropagation());
    const bulk = h('div.ls-tools', h('span.note', { text: 'Toutes les légendes :' }), tagIn,
      ui.btn('Ajouter', () => bulkTag(tagIn.value, true), '.small'), ui.btn('Retirer', () => bulkTag(tagIn.value, false), '.small'),
      h('span.note', { text: `${S.data.images.length} images · ${Object.values(caps).filter(Boolean).length} légendées` }));
    const grid = h('div.ls-grid');
    for (const im of S.data.images) {
      const img = h('img', { alt: '', loading: 'lazy' });
      thumb(im.preview || im.path, 256).then(u => { img.src = u; });
      const ta = h('textarea.field.ls-cap', { rows: 3, spellcheck: false, placeholder: 'légende (tags séparés par des virgules)' });
      ta.value = caps[im.file] || '';
      ta.addEventListener('keydown', e => e.stopPropagation());
      ta.addEventListener('change', () => { S.data.manifest.captions = { ...(S.data.manifest.captions || {}), [im.file]: ta.value.trim() }; save({ captions: S.data.manifest.captions }, true); });
      const pick = h('input', { type: 'checkbox', checked: S.sel.has(im.file) });
      pick.addEventListener('change', () => { if (pick.checked) S.sel.add(im.file); else S.sel.delete(im.file); render(); });
      const open = ui.iconBtn('folder-open', 'Ouvrir dans Kanevas', async () => { const f = await N.loraFile(im.path); if (f.ok) KS.io.openEntry({ name: f.name, data: new Uint8Array(f.data), path: null }); }, '.sm');
      grid.appendChild(h('div.ls-card' + (S.sel.has(im.file) ? '.on' : ''), h('div.ls-imgw', img, h('label.ls-pick', pick)), h('div.ls-fn', h('span', { text: im.file }), open), ta));
    }
    if (!S.data.images.length) grid.appendChild(h('div.note', { text: 'Aucune image : ajoutez-en avec les boutons ci-dessus.' }));
    return h('div.ls-center',
      h('div.ls-row', h('label.l', { text: 'Déclencheur' }), trig, h('label.l', { text: 'Type' }), kind, apply), hint, tools, bulk, grid);
  }

  function right() {
    if (!S.data) return h('div.ls-right');
    const m = S.data.manifest, inf = S.info;
    const num = (k, min, max, step = 1, unit) => ui.scrub({ value: m[k] ?? 0, min, max, step, unit, onInput: v => { m[k] = v; dirty(); } });
    const dits = inf.dits.map(d => [d.path, d.name + (d.kind === 'base' ? ' (Base, conseillé)' : d.kind === 'refined' ? ' (affiné)' : '')]);
    const dit = m.base_model && inf.dits.some(d => d.path === m.base_model) ? m.base_model : inf.dit;
    const ditNote = h('div.note', { text: (inf.dits.find(d => d.path === dit)?.note || '').replace(/\*\*|`/g, '') });
    const ditSel = ui.select(dits, dit, v => { m.base_model = v; ditNote.textContent = (inf.dits.find(d => d.path === v)?.note || '').replace(/\*\*|`/g, ''); dirty(); });
    const sp = h('textarea.field', { rows: 2, spellcheck: false, placeholder: 'invite d\'échantillon (vide = le déclencheur)' });
    sp.value = m.sample_prompt || ''; sp.addEventListener('change', () => { m.sample_prompt = sp.value; dirty(); }); sp.addEventListener('keydown', e => e.stopPropagation());
    const running = S.status && S.status.running;
    const busyElsewhere = inf.running && inf.running.project !== S.cur;
    const start = ui.btn(running ? 'Entraînement en cours…' : 'Lancer l\'entraînement', startTraining, '.primary.ls-start', 'sparkles');
    start.disabled = !!running || !!busyElsewhere || !S.data.images.length;
    const adv = h('details.gp-det', h('summary', { text: 'Avancé' }),
      h('div.ls-form',
        h('label.l', { text: 'Optimiseur' }), ui.select(Object.entries(inf.optimizers), m.optimizer || 'adamw8bit', v => { m.optimizer = v; dirty(); }),
        h('label.l', { text: 'Portée' }), ui.select(Object.entries(inf.scopes), m.scope || 'full', v => { m.scope = v; dirty(); }),
        h('label.l', { text: 'Dropout réseau' }), num('network_dropout', 0, 0.5, 0.01),
        h('label.l', { text: 'Dropout rang' }), num('rank_dropout', 0, 0.5, 0.01),
        h('label.l', { text: 'Dropout module' }), num('module_dropout', 0, 0.5, 0.01),
        h('label.l', { text: 'Dropout légendes' }), num('caption_dropout_rate', 0, 0.5, 0.01),
        h('label.l', { text: 'Cycles du taux' }), num('lr_scheduler_num_cycles', 1, 8),
        h('label.l', { text: 'Seuil WD14' }), num('threshold', 0.1, 0.9, 0.01)));
    return h('div.ls-right',
      h('div.ls-h', { text: 'Entraînement' }),
      h('div.ls-form',
        h('label.l', { text: 'Modèle de base' }), ditSel,
        h('span'), ditNote,
        h('label.l', { text: 'Époques' }), num('epochs', 0, 200), h('span'), h('div.note', { text: '0 = utiliser les pas ci-dessous' }),
        h('label.l', { text: 'Pas' }), num('steps', 100, 20000, 50),
        h('label.l', { text: 'Répétitions' }), num('repeats', 1, 100),
        h('label.l', { text: 'Dim / alpha' }), num('dim', 2, 128),
        h('label.l', { text: 'Taux' }), lrField(m),
        h('label.l', { text: 'Résolution' }), ui.select(inf.resolutions.map(r => [String(r), r + ' px']), String(m.resolution || 1024), v => { m.resolution = +v; dirty(); }),
        h('label.l', { text: 'Options' }), h('div.ls-checks',
          ui.check('Multi-résolutions', !!m.multires, v => { m.multires = v; dirty(); }, '512 / 1024 / 1536 : utile avec peu d\'images'),
          ui.check('Miroir', !!m.flip_aug, v => { m.flip_aug = v; dirty(); }),
          ui.check('Mélanger les tags', !!m.shuffle_caption, v => { m.shuffle_caption = v; dirty(); })),
        h('label.l', { text: 'Échantillon tous les' }), ui.scrub({ value: m.sample_every ?? 250, min: 0, max: 2000, step: 50, unit: 'pas', onInput: v => { m.sample_every = v; dirty(); } })),
      sp, adv, start,
      busyElsewhere ? h('div.note', { text: 'Un autre entraînement occupe la carte graphique.' }) : null,
      progress());
  }

  // taux d'apprentissage : trop petit pour un curseur, écrit en notation scientifique (1e-4, 3.5e-5…)
  function lrField(m) {
    const f = h('input.field', { type: 'text', value: (+m.learning_rate || 1e-4).toExponential(1), spellcheck: false, title: 'Ignoré avec l\'optimiseur Prodigy' });
    f.addEventListener('keydown', e => e.stopPropagation());
    f.addEventListener('change', () => { const v = parseFloat(f.value.replace(',', '.')); if (v > 0 && v < 0.1) { m.learning_rate = v; dirty(); } f.value = (+m.learning_rate).toExponential(1); });
    return f;
  }
  function progress() {
    const s = S.status;
    if (!s) return h('div.note', { text: inf2() });
    const bar = h('div.ls-bar', h('div', { style: { width: (s.pct || 0) + '%' } }));
    const txt = h('div.ls-ptxt', { text: (s.text || '').replace(/\*\*|`|&middot;/g, m => m === '&middot;' ? '·' : '') });
    const samples = h('div.ls-samples');
    for (const f of (s.samples || []).slice(-6)) { const im = h('img', { alt: '', title: f.split(/[\\/]/).pop() }); thumb(f, 200).then(u => { im.src = u; }); im.addEventListener('click', async () => { const r = await N.loraFile(f); if (r.ok) KS.io.openEntry({ name: r.name, data: new Uint8Array(r.data), path: null }); }); samples.appendChild(im); }
    const ck = h('div.ls-ckpts');
    for (const f of (s.checkpoints || []).slice().reverse()) {
      const name = f.split(/[\\/]/).pop().replace(/\.safetensors$/, '');
      ck.appendChild(h('div.ls-ck', h('span', { text: name }), ui.btn('Essayer', () => tryLora(name), '.small', 'sparkles')));
    }
    return h('div.ls-prog',
      h('div.ls-h', { text: s.running ? 'En cours' : s.state === 'done' ? 'Terminé' : s.state === 'error' ? 'Échec' : s.state === 'stopped' ? 'Arrêté' : 'Dernier entraînement' }),
      bar, txt,
      s.running ? ui.btn('Arrêter', stopTraining, '.small', 'close') : null,
      (s.samples || []).length ? h('div.note', { text: 'Échantillons (cliquer pour ouvrir) :' }) : null, samples,
      (s.checkpoints || []).length ? h('div.note', { text: 'Sauvegardes (époques) : essayez-les dans le panneau IA.' }) : null, ck,
      s.tail && !s.running && s.state === 'error' ? h('pre.ls-log', { text: s.tail }) : null,
      s.output ? ui.btn('Ouvrir le dossier', () => N.openFolder(s.output.replace(/[\\/][^\\/]*$/, '')), '.small', 'folder-open') : null);
  }
  const inf2 = () => S.info.tagger ? 'Légendes automatiques WD14 prêtes.' : 'Légendes automatiques indisponibles : ' + S.info.tagger_error;

  /* ---------------------------------------------------------------- actions */
  let saveTimer = null, pending = {};
  async function save(patch, quiet) {
    Object.assign(pending, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const p = pending; pending = {};
      try { const r = await call('save', { name: S.cur, patch: p }); S.data.manifest = r.manifest; if (!quiet) render(); } catch (e) { toast('Enregistrement du projet : ' + e.message, 'err', 5000); }
    }, 300);
  }
  const KEYS = ['epochs', 'steps', 'repeats', 'dim', 'learning_rate', 'resolution', 'multires', 'flip_aug', 'shuffle_caption', 'sample_every', 'sample_prompt', 'base_model', 'optimizer', 'scope', 'network_dropout', 'rank_dropout', 'module_dropout', 'caption_dropout_rate', 'lr_scheduler_num_cycles', 'threshold', 'lora_type'];
  const dirty = () => { const m = S.data.manifest, p = {}; for (const k of KEYS) if (m[k] !== undefined) p[k] = m[k]; save(p, true); };
  const withBusy = async (msg, fn) => { try { await busy(msg, fn); } catch (e) { toast(e.message, 'err', 6000); } await reload(); };
  const reload = async () => { if (S.cur) { S.data = await call('load', { name: S.cur }); } await refreshProjects(); render(); };
  async function addPaths(promise) {
    const paths = await promise; if (!paths || !paths.length) return;
    await withBusy(`Ajout de ${paths.length} image(s)…`, async () => { const r = await call('add', { name: S.cur, paths }); toast(`${r.added} image(s) ajoutée(s)` + (r.added < paths.length ? ' (les noms déjà présents sont ignorés)' : ''), 'ok', 3500); });
  }
  async function addDocs(docs, selection) {
    docs = docs.filter(Boolean);
    if (!docs.length) return toast('Aucun document ouvert', 'info');
    await withBusy('Ajout depuis Kanevas…', async () => {
      let n = 0;
      for (const d of docs) {
        let c = d.composite(), R = d.rect;
        if (selection) { if (!d.selection.active) throw new Error('Faites d\'abord une sélection'); R = U.rectIntersect(U.rectInt(d.selection.bounds), d.rect); }
        const out = U.canvas(R.w, R.h), x = out.getContext('2d');
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, R.w, R.h); x.drawImage(c, -R.x, -R.y);
        const bytes = new Uint8Array(await (await U.blobFromCanvas(out)).arrayBuffer());
        const r = await N.loraWrite(S.cur, d.name.replace(/\.[^.]+$/, '') + (selection ? '_selection' : ''), bytes);
        if (!r.ok) throw new Error(r.error);
        n++;
      }
      toast(`${n} image(s) ajoutée(s) depuis Kanevas`, 'ok');
    });
  }
  async function caption(onlyMissing) {
    if (!S.info.tagger) return toast('Légendes automatiques indisponibles : ' + S.info.tagger_error, 'err', 6000);
    if (!onlyMissing && !(await KS.confirm('Refaire toutes les légendes avec WD14 ? Les légendes modifiées à la main seront remplacées.', { ok: 'Refaire' }))) return;
    await withBusy('Légendes WD14 (le premier passage charge le modèle)…', async () => {
      const r = await call('caption', { name: S.cur, only_missing: onlyMissing, threshold: S.data.manifest.threshold ?? 0.35 });
      toast('Légendes prêtes' + (r.failed.length ? ` · ${r.failed.length} image(s) illisible(s)` : ''), r.failed.length ? 'info' : 'ok', 4000);
    });
  }
  async function bulkTag(tag, add) {
    tag = (tag || '').trim().replace(/,/g, ''); if (!tag) return;
    const caps = { ...(S.data.manifest.captions || {}) };
    for (const im of S.data.images) {
      const list = (caps[im.file] || '').split(',').map(t => t.trim()).filter(Boolean).filter(t => t.toLowerCase() !== tag.toLowerCase());
      if (add) list.push(tag);
      caps[im.file] = list.join(', ');
    }
    S.data.manifest.captions = caps; await save({ captions: caps }); toast((add ? 'Ajouté à ' : 'Retiré de ') + 'toutes les légendes : ' + tag, 'ok', 2000);
  }
  async function removeSelected() {
    const files = [...S.sel];
    if (!(await KS.confirm(`Retirer ${files.length} image(s) du projet ? Les copies du projet sont supprimées (vos originaux ne sont pas touchés).`, { ok: 'Retirer', danger: true }))) return;
    await withBusy('Retrait…', async () => { await call('remove', { name: S.cur, files }); S.sel.clear(); });
  }
  async function startTraining() {
    const m = S.data.manifest;
    if (!m.trigger) return toast('Donnez un mot déclencheur', 'info');
    const mods = (S.cat && S.cat.current.modules) || [];
    const info = await call('info', { modules: mods });
    S.info = info;
    const n = S.data.images.length, per = n * (m.repeats || 10) * (m.multires ? 3 : 1), total = m.epochs > 0 ? m.epochs * per : (m.steps || 2000);
    const ok = await KS.confirm(`Lancer l'entraînement de « ${m.trigger} » ? ${n} images, environ ${total} pas (≈ ${fmtDur(total * 1.5)} à 1,5 s par pas). La carte graphique sera occupée : Kanevas décharge d'abord le modèle de Forge, et il vaut mieux ne pas générer pendant l'entraînement.`, { ok: 'Lancer' });
    if (!ok) return;
    try {
      await busy('Préparation (légendes manquantes, jeu de données)…', async () => {
        if (!S.forgeOff) await N.forgeUnload(G.url());
        const r = await call('start', { name: S.cur, dit: m.base_model || info.dit, qwen3: info.qwen3, vae: info.vae, sample_prompt: m.sample_prompt, sample_every: m.sample_every ?? 250 });
        toast(`Entraînement lancé : ${r.total} pas, environ ${fmtDur(r.estimate_s)}`, 'ok', 6000);
      });
    } catch (e) { toast('Lancement impossible : ' + e.message, 'err', 8000); }
    S.info = await call('info', { modules: mods });
    await reload();
    const run = S.data.runs.find(x => x.running); S.status = run || S.data.runs[0] || null; render();
    startPoll();
  }
  async function stopTraining() {
    if (!S.status || !(await KS.confirm('Arrêter l\'entraînement ? Les sauvegardes déjà écrites sont gardées.', { ok: 'Arrêter', danger: true }))) return;
    try { const r = await call('stop', { run: S.status.run }); S.status = r.status; } catch (e) { toast(e.message, 'err', 5000); }
    S.info = await call('info', { modules: (S.cat && S.cat.current.modules) || [] });
    await reload();
  }
  async function tryLora(name) {
    try {
      await N.forgeRefreshLoras(G.url());
      const trig = S.data.manifest.trigger || '';
      const list = G.settings().loras.filter(l => l.name !== name).concat({ name, weight: 0.8, trigger: trig });
      G.saveSettings({ loras: list });
      if (!KS.state.lastPrompt) KS.state.lastPrompt = trig;
      KS.genPanel && KS.genPanel.reload();
      toast(`« ${name} » ajouté au panneau IA (poids 0,8). Générez une nouvelle image pour l'essayer.`, 'ok', 5000);
      close(); KS.panels.focus('generate');
    } catch (e) { toast(e.message, 'err', 5000); }
  }
  function startPoll() {
    clearInterval(S.poll);
    S.poll = setInterval(async () => {
      if (!S.root || !S.status || !S.status.run) return clearInterval(S.poll);
      try {
        const r = await call('status', { run: S.status.run });
        S.status = r.status;
        const host = S.root.querySelector('.ls-prog');
        if (host) host.replaceWith(progress());
        if (!S.status.running) { clearInterval(S.poll); S.info = await call('info', { modules: (S.cat && S.cat.current.modules) || [] }); await reload(); toast('Entraînement ' + (S.status.state === 'done' ? 'terminé' : 'arrêté'), S.status.state === 'done' ? 'ok' : 'info', 6000); }
      } catch { /* passerelle occupée */ }
    }, 6000);
  }
  function close() { clearInterval(S.poll); if (S.root) S.root.remove(); S.root = null; for (const u of S.thumbs.values()) if (u) URL.revokeObjectURL(u); S.thumbs.clear(); }

  C.loraStudio = async () => {
    if (S.root) return;
    try {
      await busy('Lecture de l\'entraîneur de Forge…', async () => {
        const cat = await ensureForge();
        S.info = await call('info', { modules: cat.current.modules || [] });
        await refreshProjects();
      });
    } catch (e) { toast(e.message, 'err', 7000); return; }
    S.root = h('div.ls-root',
      h('div.ls-top', h('span', { html: KS.icon('sparkles') }), h('b', { text: 'Atelier LoRA' }),
        h('span.note', { text: (S.info.sd_scripts ? 'sd-scripts : ' + S.info.sd_scripts : 'sd-scripts introuvable') + (S.forgeOff ? ' · Forge éteint : l\'entraînement aura toute la carte graphique (pour essayer un LoRA, démarrez Forge)' : '') }), h('div.spacer'),
        ui.btn('Actualiser', async () => { S.info = await call('info', { modules: (S.cat && S.cat.current.modules) || [] }); await reload(); }, '.small', 'history'),
        ui.iconBtn('close', 'Fermer', close)),
      h('div.ls-body'));
    S.root.addEventListener('keydown', e => { if (e.key === 'Escape') close(); e.stopPropagation(); });
    document.body.appendChild(S.root);
    const running = S.info.running;
    if (running) await openProject(running.project).catch(() => render());
    else if (S.cur && S.projects.some(p => p.name === S.cur)) await openProject(S.cur).catch(() => render());
    else render();
  };
})();
