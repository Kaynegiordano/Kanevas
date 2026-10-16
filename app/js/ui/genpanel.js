// Panneau IA : une « mini Forge » dans Kanevas. Invite (traduite si elle est en français), modèle,
// VAE et encodeur de texte, LoRA (aperçus, poids, mots déclencheurs), préréglages (ceux de Forge et
// ceux enregistrés ici), échantillonnage, graine ; puis générer dans la sélection, une nouvelle image
// ou développer l'image. Les réglages sont partagés avec la barre contextuelle et les menus.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui, C = KS.cmd, G = KS.gen, N = KS.native;
  const norm = t => String(t || '').replace(/\s*\[[0-9a-f]{6,}\]$/i, '');
  let cat = null, catErr = '', root = null, loading = false;

  const S = () => G.settings();
  const set = (k, v) => { G.saveSettings({ [k]: v }); };

  async function loadCatalog() {
    if (!N || !N.forgeCatalog || loading) return;
    loading = true; render();
    const r = await N.forgeCatalog(S().url);
    loading = false;
    if (r.ok) { cat = r; catErr = ''; for (const l of cat.loras) if (l.preview) l.url = URL.createObjectURL(new Blob([l.preview], { type: 'image/jpeg' })); }
    else { cat = null; catErr = r.error; }
    render();
  }

  // sections repliables, état mémorisé
  const section = (title, ...kids) => {
    const open = KS.prefs.gpOpen || (KS.prefs.gpOpen = {});
    const closedByDefault = /ADetailer|MultiDiffusion|direct|Modèle|taille/i.test(title);
    const isOpen = open[title.split(' ')[0]] ?? !closedByDefault;
    const d = h('details.gp-sec', { open: isOpen }, h('summary.gp-h', { text: title }), ...kids);
    d.addEventListener('toggle', () => { open[title.split(' ')[0]] = d.open; KS.prefs.save(); });
    return d;
  };
  const row = (label, ctl) => h('div.gp-row', h('span.gp-l', { text: label }), ctl);
  const select = (opts, value, onChange) => { const s = ui.select(opts, value, onChange); s.classList.add('gp-sel'); return s; };

  function promptBlock() {
    const st = S();
    const ta = h('textarea.field.gp-prompt', { rows: 3, placeholder: 'Décrivez l\'image ou l\'objet (français ou anglais)…', spellcheck: false });
    ta.value = KS.state.lastPrompt || '';
    const sent = h('div.note.gp-sent');
    const neg = h('textarea.field.gp-neg', { rows: 2, spellcheck: false }); neg.value = st.negative;
    let seq = 0;
    const preview = U.debounce(async () => {
      const n = ++seq, raw = ta.value.trim(); KS.state.lastPrompt = ta.value;
      if (!raw) { sent.textContent = ''; return; }
      if (G.looksFrench(raw) && !(await G.mtReady(false))) { sent.textContent = 'En français : traduit en anglais au moment de générer (petit modèle local à télécharger une fois).'; return; }
      try {
        const pp = await G.preparePrompt(raw, cat ? { model: cat.current.model, current: cat.current } : null, S());
        if (n === seq) sent.textContent = 'Envoyé à Forge : ' + pp.prompt;
      } catch { sent.textContent = ''; }
    }, 400);
    ta.addEventListener('input', () => { KS.state.lastPrompt = ta.value; preview(); }); ta.addEventListener('keydown', e => e.stopPropagation());
    neg.addEventListener('change', () => set('negative', neg.value)); neg.addEventListener('keydown', e => e.stopPropagation());
    root._preview = preview;
    preview();
    return section('Invite', ta, sent, h('details.gp-det', h('summary', { text: 'À éviter (négatif)' }), neg));
  }

  function modelBlock() {
    const st = S(), cur = cat.current;
    const models = [['', 'Celui chargé dans Forge (' + norm(cur.model) + ')'], ...cat.models.map(m => [m.title, norm(m.title)])];
    const vaes = cat.modules.filter(m => m.kind === 'vae'), tes = cat.modules.filter(m => m.kind === 'te');
    const curName = (list, kind) => { const f = (cur.modules || []).find(p => list.some(m => m.path === p)); return f ? f.split(/[\\/]/).pop() : 'aucun'; };
    const keep = ui.check('Garder ce modèle chargé dans Forge', !!st.keepLoaded, v => set('keepLoaded', v), 'Sinon Forge revient à son modèle après chaque génération (deux chargements).');
    return section('Modèle',
      row('Modèle', select(models, st.model, v => { set('model', norm(v) === norm(cur.model) ? '' : v); render(); })),
      row('VAE', select([['', 'Actuel (' + curName(vaes) + ')'], ...vaes.map(m => [m.path, m.name])], st.vae, v => set('vae', v))),
      row('Encodeur', select([['', 'Actuel (' + curName(tes) + ')'], ...tes.map(m => [m.path, m.name])], st.te, v => set('te', v))),
      st.model || st.vae || st.te ? h('div.gp-row.gp-wide', keep, h('div.note', { text: 'Changer de modèle recharge Forge : la première génération est plus lente.' })) : null);
  }

  function loraBlock() {
    const st = S(), active = st.loras || [];
    const model = norm(st.model || cat.current.model);
    const q = h('input.field.gp-search', { type: 'text', placeholder: 'Chercher un LoRA…', spellcheck: false });
    q.value = root._loraQ || '';
    const grid = h('div.gp-loras');
    const fill = () => {
      grid.innerHTML = '';
      const term = q.value.trim().toLowerCase();
      for (const l of cat.loras) {
        if (term && !(l.name + ' ' + l.trigger + ' ' + l.folder).toLowerCase().includes(term)) continue;
        const on = active.some(a => a.name === l.name);
        const fit = !l.base || model.toLowerCase().includes(l.base.toLowerCase());
        const tile = h('button.gp-lora' + (on ? '.on' : '') + (fit ? '' : '.dim'), { 'data-tip': l.name + (l.trigger ? ' — ' + l.trigger : '') + (l.base ? ' (' + l.base + ')' : '') },
          l.url ? h('img', { src: l.url, alt: '' }) : h('span.gp-noimg', { html: KS.icon('image') }), h('span.gp-ln', { text: l.alias || l.name }));
        tile.addEventListener('click', () => {
          const list = S().loras.slice(), i = list.findIndex(a => a.name === l.name);
          if (i >= 0) list.splice(i, 1); else list.push({ name: l.name, weight: l.weight || 0.8, trigger: l.trigger });
          set('loras', list); render();
        });
        grid.appendChild(tile);
      }
      if (!grid.children.length) grid.appendChild(h('div.note', { text: cat.loras.length ? 'Aucun LoRA ne correspond.' : 'Aucun LoRA dans Forge.' }));
    };
    q.addEventListener('input', () => { root._loraQ = q.value; fill(); }); q.addEventListener('keydown', e => e.stopPropagation());
    fill();
    const chips = h('div.gp-chips');
    for (const a of active) {
      const l = cat.loras.find(x => x.name === a.name);
      const w = ui.scrub({ value: a.weight, min: -2, max: 2, step: 0.05, onInput: v => { const list = S().loras.map(x => x.name === a.name ? { ...x, weight: v } : x); set('loras', list); root._preview && root._preview(); } });
      const x = ui.iconBtn('close', 'Retirer', () => { set('loras', S().loras.filter(z => z.name !== a.name)); render(); }, '.sm');
      chips.appendChild(h('div.gp-chip', l && l.url ? h('img', { src: l.url, alt: '' }) : null, h('span.gp-cn', { text: a.name }), w, x));
    }
    const trig = ui.check('Ajouter les mots déclencheurs', st.useTriggers !== false, v => { set('useTriggers', v); root._preview && root._preview(); });
    return section('LoRA (style)' + (active.length ? ` · ${active.length} actif${active.length > 1 ? 's' : ''}` : ''), q, grid, active.length ? chips : null, h('div.gp-row.gp-wide', trig));
  }

  function presetBlock() {
    const mine = KS.prefs.genPresets || {};
    const opts = [['', 'Choisir…'], ...Object.keys(cat.presets || {}).map(n => ['forge:' + n, 'Forge : ' + n]), ...Object.keys(mine).map(n => ['kv:' + n, 'Kanevas : ' + n])];
    const sel = select(opts, '', v => {
      if (!v) return;
      if (v.startsWith('forge:')) {
        const p = cat.presets[v.slice(6)] || {};
        const o = {};
        if (p.sampler) o.sampler = p.sampler; if (p.scheduler) o.scheduler = p.scheduler; if (p.steps) o.steps = p.steps; if (p.cfg) o.cfg = p.cfg; if (p.dcfg) o.shift = p.dcfg;
        if (p.width && p.height) o.size = { w: p.width, h: p.height };
        G.saveSettings(o); KS.toast('Préréglage Forge appliqué : ' + v.slice(6), 'ok', 1500);
      } else { G.saveSettings(mine[v.slice(3)] || {}); KS.toast('Préréglage appliqué : ' + v.slice(3), 'ok', 1500); }
      render();
    });
    const save = ui.btn('Enregistrer…', async () => {
      const name = await KS.prompt('Enregistrer les réglages de génération', 'Nom du préréglage', 'Mon style');
      if (!name) return;
      const s = S(); const keep = {}; for (const k of ['model', 'vae', 'te', 'loras', 'sampler', 'scheduler', 'steps', 'cfg', 'shift', 'size', 'negative', 'usePrefix', 'useTriggers', 'strength', 'count', 'ad']) keep[k] = s[k];
      KS.prefs.genPresets = { ...mine, [name]: keep }; KS.prefs.save(); render();
    }, '.small');
    const del = Object.keys(mine).length ? ui.iconBtn('trash', 'Supprimer un préréglage Kanevas', () => {
      const r = del.getBoundingClientRect();
      ui.menu(Object.keys(mine).map(n => ({ label: n, action: () => { const m = { ...mine }; delete m[n]; KS.prefs.genPresets = m; KS.prefs.save(); render(); } })), r.left, r.bottom + 4);
    }, '.sm') : null;
    return section('Préréglages', h('div.gp-row.gp-wide', sel, save, del));
  }

  function samplingBlock() {
    const st = S(), pre = G.modelPreset(norm(st.model || cat.current.model));
    const seed = h('input.field.gp-seed', { type: 'text', value: st.seed == null ? -1 : st.seed });
    seed.addEventListener('change', () => { const v = parseInt(seed.value, 10); set('seed', isNaN(v) ? -1 : v); seed.value = S().seed; });
    seed.addEventListener('keydown', e => e.stopPropagation());
    const dice = ui.iconBtn('reset-colors', 'Graine au hasard (-1)', () => { set('seed', -1); seed.value = -1; }, '.sm');
    const reuse = ui.iconBtn('history', 'Reprendre la graine de la dernière image', () => { if (G.lastSeed == null) return KS.toast('Aucune génération encore', 'info'); set('seed', G.lastSeed); seed.value = G.lastSeed; }, '.sm');
    return section('Échantillonnage',
      row('Échantillonneur', select([['', 'Auto' + (pre.sampler ? ' (' + pre.sampler + ')' : '')], ...cat.samplers.map(n => [n, n])], st.sampler, v => set('sampler', v))),
      row('Planificateur', select([['', 'Auto' + (pre.scheduler ? ' (' + pre.scheduler + ')' : '')], ...cat.schedulers.map(n => [n, n])], st.scheduler, v => set('scheduler', v))),
      row('Étapes', ui.scrub({ value: st.steps, min: 4, max: 80, onInput: v => set('steps', v) })),
      row('CFG', ui.scrub({ value: st.cfg, min: 1, max: 15, step: 0.5, onInput: v => set('cfg', v) })),
      row('Shift', ui.scrub({ value: st.shift ?? 3, min: 1, max: 10, step: 0.1, onInput: v => set('shift', v), title: 'Décalage du flux (modèles anima) ; 3 dans Forge' })),
      row('Variantes', ui.seg([['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], String(st.count), v => set('count', +v))),
      row('Force', ui.scrub({ value: Math.round(st.strength * 100), min: 30, max: 100, unit: '%', onInput: v => set('strength', v / 100), title: 'Remplissage : 100 % ignore ce qu\'il y avait, moins garde ses couleurs' })),
      row('Graine', h('div.gp-inline', seed, dice, reuse)),
      h('div.gp-row.gp-wide', ui.check('Préfixe du modèle' + (pre.prefix ? ' (' + pre.prefix.replace(/,\s*$/, '') + ')' : ''), st.usePrefix !== false, v => { set('usePrefix', v); root._preview && root._preview(); })));
  }

  function actions() {
    const doc = KS.state.doc, sel = doc && doc.selection.active;
    const prompt = () => (KS.state.lastPrompt || '').trim();
    const big = ui.btn('Nouvelle image', () => C.newImageDoc(prompt()), '.primary', 'file-plus');
    big.title = 'Génère dans un nouveau document (l\'image en cours n\'est pas touchée)';
    const b = (label, icon, fn, need = 'doc', tip = '') => { const x = ui.btn(label, fn, '.small', icon); x.disabled = need === 'doc' ? !doc : need === 'sel' ? !sel : false; if (tip) x.title = tip; return x; };
    const live = ui.btn(G.live && G.live.on ? 'Arrêter l\'IA en direct' : 'IA en direct', () => C.toggleLive(), '.small' + (G.live && G.live.on ? '.on' : ''), 'sparkles');
    live.disabled = !doc; live.title = 'Forge repeint l\'image pendant que vous dessinez, dans une fenêtre flottante';
    return h('div.gp-actions', big,
      h('div.gp-agrid',
        b('Remplir la sélection', 'sparkles', () => { if (!prompt()) return KS.toast('Écrivez d\'abord une invite', 'info'); C.generativeFill(prompt()); }, 'sel', 'Remplissage génératif : un calque masqué, variantes ‹ ›'),
        b(sel ? 'Image dans la sélection' : 'Image en calque', 'image', () => C.generateImage(prompt()), 'doc', 'Nouvelle image dans un calque du document en cours'),
        b('Image → image', 'adjust', () => C.img2imgDoc(prompt()), 'doc', 'Retravaille l\'image (ou la sélection) selon l\'invite ; force dans « Image → image »'),
        b('Retoucher (ADetailer)', 'heal-spot', () => C.detailPass(), 'doc', 'Refait seulement les visages / mains / yeux détectés, comme « Skip img2img »'),
        b('Agrandir et détailler', 'upscale', () => C.upscaleDetail(), 'doc', 'ESRGAN puis MultiDiffusion par tuiles, dans un nouveau document'),
        b('Développer…', 'gen-expand', () => C.generativeExpand(), 'doc')),
      live);
  }

  function sizeBlock() {
    const st = G.studio();
    const RATIOS = [['1:1', '1:1'], ['4:5', '4:5'], ['2:3', '2:3'], ['3:4', '3:4'], ['9:16', '9:16'], ['16:9', '16:9'], ['3:2', '3:2'], ['21:9', '21:9']];
    const wv = ui.scrub({ value: st.size.w, min: 256, max: 2560, step: 8, unit: 'px', onInput: v => set('size', { ...G.studio().size, w: v }) });
    const hv = ui.scrub({ value: st.size.h, min: 256, max: 2560, step: 8, unit: 'px', onInput: v => set('size', { ...G.studio().size, h: v }) });
    const ratio = select([['', 'Format…'], ...RATIOS], '', v => {
      if (!v) return; const [a, c] = v.split(':').map(Number), k = Math.sqrt(1048576 / (a * c));
      set('size', { w: Math.round(a * k / 64) * 64, h: Math.round(c * k / 64) * 64 }); render();
    });
    const doc = KS.state.doc;
    const same = ui.btn('Comme l\'image', () => { if (!doc) return; const k = Math.sqrt(1048576 / (doc.width * doc.height)); set('size', { w: Math.round(doc.width * k / 64) * 64, h: Math.round(doc.height * k / 64) * 64 }); render(); }, '.small');
    same.disabled = !doc;
    const swap = ui.btn('⇄', () => { const z = G.studio().size; set('size', { w: z.h, h: z.w }); render(); }, '.small');
    return section('Nouvelle image : taille', row('Largeur', wv), row('Hauteur', hv), h('div.gp-row.gp-wide', ratio, same, swap),
      row('Image → image', ui.scrub({ value: Math.round(st.i2iStrength * 100), min: 5, max: 100, unit: '%', onInput: v => set('i2iStrength', v / 100), title: 'Force de « Image → image » : bas = proche de l\'original' })));
  }

  function adBlock() {
    const st = G.studio(), ad = st.ad;
    const models = [['None', 'Aucun'], ...((cat && cat.adModels) || []).map(m => [m, m])];
    const setUnits = units => set('ad', { ...G.studio().ad, units });
    const units = h('div.gp-units');
    (ad.units || []).forEach((u, i) => {
      const pr = h('input.field', { type: 'text', value: u.prompt || '', placeholder: 'invite (vide = celle de l\'image)', spellcheck: false });
      pr.addEventListener('change', () => { const l = G.studio().ad.units.slice(); l[i] = { ...l[i], prompt: pr.value }; setUnits(l); });
      pr.addEventListener('keydown', e => e.stopPropagation());
      units.appendChild(h('div.gp-unit',
        h('div.gp-row', h('span.gp-l', { text: 'Détecteur ' + (i + 1) }), select(models, u.model, v => { const l = G.studio().ad.units.slice(); l[i] = { ...l[i], model: v }; setUnits(l); })),
        pr,
        row('Force', ui.scrub({ value: Math.round((u.denoise ?? 0.4) * 100), min: 5, max: 100, unit: '%', onInput: v => { const l = G.studio().ad.units.slice(); l[i] = { ...l[i], denoise: v / 100 }; setUnits(l); } })),
        row('Confiance', ui.scrub({ value: Math.round((u.confidence ?? 0.3) * 100), min: 5, max: 95, unit: '%', onInput: v => { const l = G.studio().ad.units.slice(); l[i] = { ...l[i], confidence: v / 100 }; setUnits(l); } })),
        (ad.units || []).length > 1 ? ui.btn('Retirer', () => { setUnits(G.studio().ad.units.filter((_, j) => j !== i)); render(); }, '.small') : null));
    });
    const add = (ad.units || []).length < 3 ? ui.btn('Ajouter un détecteur', () => { setUnits([...(G.studio().ad.units || []), { model: 'hand_yolov8n.pt', prompt: '', denoise: 0.4, confidence: 0.3 }]); render(); }, '.small', 'plus') : null;
    return section('ADetailer (visages, mains, yeux)',
      h('div.gp-row.gp-wide', ui.check('Appliquer à chaque génération', !!ad.enabled, v => set('ad', { ...G.studio().ad, enabled: v }), 'Sinon seulement avec « Retoucher (ADetailer) »')),
      units, add);
  }

  function mdBlock() {
    const st = G.studio(), m = st.md;
    const ups = ((cat && cat.upscalers) || []);
    const setm = (k, v) => set('md', { ...G.studio().md, [k]: v });
    return section('Agrandir et détailler (MultiDiffusion)',
      row('Agrandir', ui.seg([['1.5', '× 1,5'], ['2', '× 2'], ['3', '× 3']], String(m.factor), v => setm('factor', +v))),
      row('Agrandisseur', select([['', 'Auto (UltraSharp)'], ...ups.map(n => [n, n])], m.upscaler, v => setm('upscaler', v))),
      row('Force', ui.scrub({ value: Math.round(m.denoise * 100), min: 5, max: 70, unit: '%', onInput: v => setm('denoise', v / 100) })),
      row('Tuiles', ui.scrub({ value: m.tile, min: 512, max: 1536, step: 64, unit: 'px', onInput: v => setm('tile', v) })),
      row('Recouvrement', ui.scrub({ value: m.overlap, min: 16, max: 256, step: 8, unit: 'px', onInput: v => setm('overlap', v) })),
      row('Méthode', select([['Mixture of Diffusers', 'Mixture of Diffusers'], ['MultiDiffusion', 'MultiDiffusion']], m.method, v => setm('method', v))),
      row('Étapes', ui.scrub({ value: m.steps, min: 6, max: 60, onInput: v => setm('steps', v) })));
  }

  function liveBlock() {
    const lv = G.studio().live, setl = (k, v) => set('live', { ...G.studio().live, [k]: v });
    return section('IA en direct',
      row('Force', ui.scrub({ value: Math.round(lv.strength * 100), min: 20, max: 95, unit: '%', onInput: v => setl('strength', v / 100) })),
      row('Étapes', ui.scrub({ value: lv.steps, min: 4, max: 20, onInput: v => setl('steps', v) })),
      row('Taille', ui.scrub({ value: lv.size, min: 512, max: 1280, step: 64, unit: 'px', onInput: v => setl('size', v) })),
      h('div.note', { text: 'Graine fixe d\'un rendu à l\'autre (bouton ↻ de la fenêtre pour en changer).' }));
  }

  function render() {
    if (!root) return;
    const box = root.closest('.pbody') || root, scroll = box.scrollTop;
    root.innerHTML = '';
    const head = h('div.gp-status', h('span.gp-dot' + (cat ? '.ok' : '')), h('span', { text: loading ? 'Lecture de Forge…' : cat ? 'Forge : ' + norm(cat.current.model) : (catErr || 'Forge non joint') + ' — lancez Forge depuis Kane OS' }),
      h('div.spacer'), ui.iconBtn('info', 'Infos de génération (PNG Info)', () => C.pngInfo(), '.sm'), ui.iconBtn('layers', 'Atelier LoRA (fabriquer un LoRA)', () => C.loraStudio(), '.sm'),
      ui.iconBtn('history', 'Relire Forge (modèles, LoRA)', () => loadCatalog(), '.sm'));
    root.appendChild(head);
    if (!N || !N.forgeCatalog) { root.appendChild(h('div.note', { text: 'La génération n\'est disponible que dans l\'application de bureau.' })); return; }
    if (!cat) { root.append(promptBlock(), actions()); box.scrollTop = scroll; return; }
    root.append(promptBlock(), actions(), presetBlock(), loraBlock(), modelBlock(), samplingBlock(), sizeBlock(), adBlock(), mdBlock(), liveBlock());
    box.scrollTop = scroll;
  }

  KS.panels.register('generate', {
    title: 'IA',
    build(el) { root = h('div.gp'); el.appendChild(root); render(); loadCatalog(); },
    show() {
      // le panneau a besoin de place : son groupe est agrandi s'il est petit
      const Gp = KS.panels.groups.find(x => x.panes.generate);
      if (Gp && !Gp.g.grow && (Gp.s.height || 0) < 420) { Gp.s.height = 460; const b = Gp.el.querySelector('.pbody'); if (b) b.style.height = '460px'; KS.prefs.save(); }
      if (root && !cat && !loading) loadCatalog();
    },
  });
  KS.genPanel = { render, reload: loadCatalog };
  for (const ev of ['selection', 'doc']) KS.on(ev, U.debounce(() => { if (root && KS.panels.isVisible('generate')) { const a = root.querySelector('.gp-actions'); if (a) a.replaceWith(actions()); } }, 80));
  C.openGenPanel = () => KS.panels.focus('generate');
})();
