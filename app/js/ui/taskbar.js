// Barre des tâches contextuelle (Photoshop) : sous l'image, les actions utiles pour la
// situation (sélection, calque généré et ses variantes, calque de pixels), avec une invite
// de remplissage génératif.
'use strict';
(() => {
  const h = KS.h, ui = KS.ui, C = KS.cmd, T = KS.tools, G = KS.gen;
  const D = () => KS.state.doc;
  const HIDE_TOOLS = new Set(['crop', 'transform', 'text', 'pen', 'path-select']);
  let bar = null, mode = null, queued = false;

  const btn = (icon, label, fn, cls = '') => {
    const b = h('button.ctx-btn' + cls, { 'data-tip': label }, h('span', { html: KS.icon(icon) }), h('span.t', { text: label }));
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
  };
  const iconOnly = (icon, label, fn) => { const b = ui.iconBtn(icon, label, e => { e.stopPropagation(); fn(); }, '.sm'); return b; };
  const more = items => iconOnly('more', 'Plus d\'actions', () => {
    const r = bar.getBoundingClientRect();
    ui.menu([...items, { sep: true }, { label: 'Masquer la barre des tâches contextuelle', action: () => { KS.prefs.ctxBar = false; KS.prefs.save(); render(); } }], r.right - 240, r.top - 8, { up: true });
  });

  function content(d) {
    if (mode === 'prompt') {
      const inp = h('input.field.ctx-prompt', { type: 'text', placeholder: 'Décrivez ce qu\'il faut générer (vide : remplir avec les alentours)', spellcheck: false });
      inp.value = KS.state.lastPrompt || '';
      const go = () => { const p = inp.value; KS.state.lastPrompt = p; mode = null; render(); C.generativeFill(p); };
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') go(); else if (e.key === 'Escape') { mode = null; render(); } });
      setTimeout(() => inp.focus(), 0);
      return [h('span.ctx-ico', { html: KS.icon('sparkles') }), inp, btn('sparkles', 'Générer', go, '.primary'), iconOnly('settings', 'Paramètres de génération…', () => { mode = null; render(); C.generativeFill(); }), iconOnly('close', 'Fermer', () => { mode = null; render(); })];
    }
    const L = d.active;
    if (d.selection.active) {
      return [
        btn('sparkles', 'Remplissage génératif', () => { mode = 'prompt'; render(); }, '.primary'),
        btn('remove', 'Supprimer', () => C.removeSelection()),
        btn('mask', 'Masque', () => C.addMask('selection')),
        btn('select-invert', 'Intervertir', () => C.invertSelection()),
        btn('select-none', 'Désélectionner', () => C.deselect()),
        more([
          { label: 'Contour progressif…', action: C.feather }, { label: 'Sélectionner et masquer…', action: C.refineEdge },
          { label: 'Calque par copier', action: () => C.layerViaCopy(false) }, { label: 'Remplir…', action: C.fill },
          { label: 'Remplissage d\'après le contenu', action: () => C.contentAwareFill(d) },
        ]),
      ];
    }
    if (L && L._gen && L._gen.variants.length) {
      const g = L._gen, n = g.variants.length;
      const parts = [];
      if (n > 1) parts.push(iconOnly('chevron-left', 'Variante précédente', () => G.setVariant(d, L, g.i - 1)), h('span.ctx-count', { text: `${g.i + 1} / ${n}` }), iconOnly('chevron-right', 'Variante suivante', () => G.setVariant(d, L, g.i + 1)));
      if (g.job) parts.push(btn('sparkles', 'Générer encore', () => G.generateMore(d, L), '.primary'));
      parts.push(btn('mask', 'Modifier le masque', () => { L.editMask = true; KS.emit('layers', d); T.select('brush'); }));
      parts.push(more([{ label: 'Harmoniser…', action: C.harmonize }, { label: 'Fusionner vers le bas', action: C.mergeDown }, { label: 'Supprimer le calque', action: C.deleteLayer }]));
      return parts;
    }
    const parts = [btn('sparkles', 'Sélectionner le sujet', () => C.selectSubject())];
    if (L && L.kind === 'raster') parts.push(btn('remove-bg', 'Supprimer l\'arrière-plan', () => C.removeBackground()));
    if (L && L.kind === 'raster' && d.layers.indexOf(L) > 0) parts.push(btn('harmonize', 'Harmoniser', () => C.harmonize()));
    parts.push(btn('gen-expand', 'Développement génératif', () => C.generativeExpand()));
    parts.push(more([{ label: 'Super résolution IA…', action: C.superResolution }, { label: 'Ton automatique', action: C.autoTone }, { label: 'Couleur automatique', action: C.autoColor }]));
    return parts;
  }

  function render() {
    queued = false;
    if (!bar) { bar = h('div.ctx-bar'); bar.addEventListener('pointerdown', e => e.stopPropagation()); KS.$('#overlay-ui').appendChild(bar); }
    const d = D();
    const tool = T.current?.id;
    const show = d && KS.prefs.ctxBar !== false && !HIDE_TOOLS.has(tool) && !d.quickMask;
    bar.hidden = !show;
    if (!show) { mode = null; return; }
    if (mode === 'prompt' && !d.selection.active) mode = null;
    bar.classList.toggle('prompt', mode === 'prompt');
    bar.replaceChildren(...content(d));
  }
  const queue = () => { if (queued) return; queued = true; requestAnimationFrame(render); };
  KS.taskbar = { render: queue, prompt: () => { mode = 'prompt'; queue(); } };
  for (const ev of ['doc', 'selection', 'active-layer', 'layers', 'tool', 'gen', 'quickmask', 'history']) KS.on(ev, queue);
  // pendant un geste sur l'image, la barre s'efface pour ne pas gêner
  document.addEventListener('pointerdown', e => { if (bar && e.target.id === 'view') bar.classList.add('ghost'); }, true);
  document.addEventListener('pointerup', () => { if (bar) bar.classList.remove('ghost'); }, true);
  C.toggleCtxBar = () => { KS.prefs.ctxBar = KS.prefs.ctxBar === false; KS.prefs.save(); queue(); };
})();
