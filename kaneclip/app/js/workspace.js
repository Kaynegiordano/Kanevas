// Dispositions persistantes et accès direct aux propriétés du montage.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, E = KC.engine;
  const W = KC.workspace = { focused: false };
  const PRESETS = [
    { id: 'edit', name: 'Montage', dock: .33, upper: .46, tab: 'media', inspector: true },
    { id: 'effects', name: 'Effets', dock: .30, upper: .57, tab: 'fx', inspector: true },
    { id: 'audio', name: 'Audio', dock: .30, upper: .32, tab: 'media', inspector: false },
    { id: 'vertical', name: 'Vertical', dock: .27, upper: .64, tab: 'media', inspector: false },
  ];
  let picker, inspectorButton, content, format, summary, inspectedSelection = '';
  const layouts = () => Array.isArray(KC.prefs.savedLayouts) ? KC.prefs.savedLayouts.filter(l => l && typeof l.id === 'string' && typeof l.name === 'string') : [];
  const button = (icon, label, fn, cls = 'inspector-action') => {
    const b = h('button.' + cls, { type: 'button', title: label, 'aria-label': label }, h('span', { html: KC.icon(icon) }), h('span', { text: label }));
    b.addEventListener('click', fn);
    return b;
  };

  W.applySizes = () => {
    const root = document.documentElement;
    const dock = U.clamp(Number(KC.prefs.dockW) || 460, 280, 1600);
    const upper = Number(KC.prefs.upperH) || 0;
    root.style.setProperty('--dock-w', `clamp(280px, ${dock}px, 39vw)`);
    root.style.setProperty('--upper-h', upper ? `clamp(160px, ${upper}px, calc(100vh - 420px))` : 'min(46vh, calc(100vh - 420px))');
    root.style.setProperty('--header-w', U.clamp(Number(KC.prefs.headerW) || 230, 190, 420) + 'px');
    document.body.dataset.workspace = KC.prefs.workspace;
    document.body.dataset.inspector = String(!!KC.prefs.inspector);
    document.body.dataset.timelineFocus = String(W.focused);
    if (inspectorButton) inspectorButton.setAttribute('aria-pressed', String(!!KC.prefs.inspector));
    const focus = KC.$('#timeline-focus');
    if (focus) focus.setAttribute('aria-pressed', String(W.focused));
  };
  W.activate = id => {
    const preset = PRESETS.find(p => p.id === id);
    const saved = layouts().find(p => p.id === id);
    if (!preset && !saved) return;
    W.focused = false;
    if (preset) {
      KC.prefs.dockW = Math.round(innerWidth * preset.dock);
      KC.prefs.upperH = Math.round(innerHeight * preset.upper);
      KC.prefs.inspector = preset.inspector;
      KC.prefs.headerW = 230;
      KC.dock.show(preset.tab);
    } else {
      KC.prefs.dockW = saved.dockW;
      KC.prefs.upperH = saved.upperH;
      KC.prefs.headerW = saved.headerW;
      KC.prefs.inspector = !!saved.inspector;
      KC.dock.show(saved.tab || 'media');
    }
    KC.prefs.workspace = id;
    KC.prefs.save();
    W.applySizes();
    refreshPicker();
  };
  W.toggleInspector = () => {
    KC.prefs.inspector = !KC.prefs.inspector;
    KC.prefs.save(); W.applySizes();
  };
  W.toggleTimeline = () => { W.focused = !W.focused; W.applySizes(); };
  W.save = async () => {
    const name = await KC.prompt('Enregistrer la disposition', 'Nom de la disposition', 'Mon espace de travail');
    if (!name || !name.trim()) return;
    const next = layouts().filter(l => l.name !== name.trim());
    const saved = { id: 'custom-' + U.uid(), name: name.trim().slice(0, 80), dockW: KC.$('#dock').offsetWidth || KC.prefs.dockW,
      upperH: KC.$('#upper').offsetHeight || KC.prefs.upperH, headerW: KC.prefs.headerW, tab: KC.dock.current, inspector: KC.prefs.inspector };
    KC.prefs.savedLayouts = [...next, saved].slice(-8);
    KC.prefs.workspace = saved.id;
    KC.prefs.save(); W.applySizes(); refreshPicker();
    KC.toast('Disposition enregistrée', 'ok');
  };
  W.menu = () => [
    ...PRESETS.map(p => ({ label: p.name, checked: KC.prefs.workspace === p.id, action: () => W.activate(p.id) })),
    ...layouts().map(p => ({ label: p.name, checked: KC.prefs.workspace === p.id, action: () => W.activate(p.id) })),
    '-', { label: 'Enregistrer la disposition…', icon: 'save', action: W.save },
    { label: 'Rétablir la disposition Montage', icon: 'reset', action: () => W.activate('edit') },
  ];
  function refreshPicker() {
    if (!picker) return;
    picker.replaceChildren();
    for (const p of [...PRESETS, ...layouts()]) picker.append(h('option', { value: p.id, text: p.name }));
    picker.value = KC.prefs.workspace;
    if (!picker.value) { KC.prefs.workspace = 'edit'; picker.value = 'edit'; }
  }

  const section = title => h('div.inspector-section', h('h3', { text: title }));
  const row = (label, value) => h('div.inspector-row', h('span', { text: label }), h('b', { text: value }));
  function refreshInspector() {
    if (!content || !KC.project) return;
    const selected = KC.sel.list();
    const selection = selected.map(ev => ev.id).join(',');
    // Ne pas remplacer un champ en cours de saisie lors d'un rafraîchissement.
    if (selection === inspectedSelection && content.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    inspectedSelection = selection;
    content.replaceChildren();
    const s = KC.project.settings;
    format.textContent = s.width + ' × ' + s.height + ' · ' + U.fmtFps(s.fps) + 'p';
    summary.textContent = KC.project.tracks.length + ' pistes · ' + KC.project.events.length + ' événements';
    if (selected.length === 1) {
      const ev = selected[0], video = P.kindOf(ev) === 'video', media = P.media(ev.media);
      content.append(h('div.inspector-object', h('span.object-kind', { text: video ? 'ÉVÉNEMENT VIDÉO' : 'ÉVÉNEMENT AUDIO' }), h('strong', { text: P.eventName(ev) })));
      const details = section('Événement');
      const name = h('input.field#event-name', { value: ev.name || P.eventName(ev), 'aria-label': 'Nom de l’événement' });
      name.addEventListener('change', () => KC.edit('Renommer l’événement', () => { ev.name = name.value.trim(); }));
      name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
      const level = h('input.field#event-level', { type: 'number', min: video ? 0 : -60, max: video ? 100 : 24, step: video ? 1 : .5, value: video ? Math.round(ev.opacity * 100) : ev.gain, 'aria-label': video ? 'Opacité (%)' : 'Gain (dB)' });
      level.addEventListener('change', () => {
        if (level.value === '' || !level.checkValidity()) return;
        KC.edit(video ? 'Opacité de l’événement' : 'Gain de l’événement', () => { if (video) ev.opacity = Number(level.value) / 100; else ev.gain = Number(level.value); });
        E.redraw();
      });
      details.append(h('label.inspector-field', h('span', { text: 'Nom' }), name), row('Position', U.fmtTime(ev.start, P.fps())), row('Durée', U.fmtTime(ev.length, P.fps())),
        h('label.inspector-field.inline', h('span', { text: video ? 'Opacité (%)' : 'Gain (dB)' }), level));
      content.append(details);
      const tools = section('Outils de l’événement');
      if (video) {
        tools.append(button('pancrop', 'Panoramique / recadrage', () => KC.windows.panCrop(ev)), button('fx', 'Chaîne d’effets vidéo', () => KC.windows.eventFx(ev)));
        if (ev.gen) tools.append(button('text', 'Modifier le générateur', () => KC.windows.generator(ev)));
      } else tools.append(button('fx', 'Effets de la piste audio', () => KC.windows.trackFx(P.track(ev.track))), button('normalize', 'Normaliser l’audio', KC.cmd.normalize));
      if (video) tools.append(button('pancrop', 'Transformer plusieurs événements…', () => KC.dialogs.batchTransform()));
      tools.append(button('props', 'Toutes les propriétés…', () => KC.dialogs.eventProps(ev)));
      content.append(tools);
      if (media) {
        const source = section('Source');
        source.append(h('p.source-name', { text: media.name, title: media.path }), row('Type', video ? 'Vidéo / image' : 'Audio'));
        if (media.width) source.append(row('Dimensions', media.width + ' × ' + media.height));
        content.append(source);
      }
    } else if (selected.length > 1) {
      content.append(h('div.inspector-object', h('span.object-kind', { text: 'SÉLECTION MULTIPLE' }), h('strong', { text: selected.length + ' événements' })),
        h('div.inspector-section', button('pancrop', 'Transformer la sélection…', () => KC.dialogs.batchTransform()), button('group', 'Grouper les événements', KC.cmd.group), button('ungroup', 'Dissocier les événements', KC.cmd.ungroup), button('mute', 'Muet / audible', KC.cmd.toggleMuteSel)));
    } else {
      content.append(h('div.inspector-object', h('span.object-kind', { text: 'PROJET' }), h('strong', { text: KC.project.path ? U.stripExt(U.base(KC.project.path)) : 'Sans titre' })));
      const project = section('Format du projet');
      project.append(row('Image', s.width + ' × ' + s.height), row('Cadence', U.fmtFps(s.fps) + ' i/s'), row('Audio', s.sampleRate / 1000 + ' kHz'), row('Durée', U.fmtTime(P.duration(), P.fps())), button('props', 'Propriétés du projet…', () => KC.dialogs.projectProps()));
      const track = KC.sel.track && P.track(KC.sel.track);
      if (track) {
        const tr = section('Piste sélectionnée');
        tr.append(row('Nom', P.trackLabel(track)), row('Type', track.kind === 'video' ? 'Vidéo' : 'Audio'));
        if (track.kind === 'audio') tr.append(button('fx', 'Effets de piste…', () => KC.windows.trackFx(track)));
        else tr.append(row('Zoom de la piste', Math.round(KC.FX.tmOf(track).zoom * 100) + ' %'), button('pancrop', 'Mouvement de la piste…', () => KC.windows.trackMotion(track)), button('fit', 'Remplir le cadre (piste)', () => KC.dialogs.fillTrack(track)));
        content.append(tr);
      }
      content.append(project, h('div.inspector-hint', { html: KC.icon('cursor') }, h('span', { text: 'Sélectionnez un événement pour accéder à ses réglages, son recadrage et ses effets.' })));
    }
  }
  W.init = () => {
    const controls = KC.$('#workspace-controls');
    picker = h('select.field#workspace-picker', { 'aria-label': 'Disposition des fenêtres', title: 'Disposition des fenêtres' });
    picker.addEventListener('change', () => W.activate(picker.value));
    inspectorButton = button('props', 'Afficher les propriétés de la sélection', W.toggleInspector, 'tb');
    inspectorButton.id = 'inspector-toggle';
    const options = button('settings', 'Gérer les dispositions', e => {
      const r = e.currentTarget.getBoundingClientRect(); KC.menu.open(W.menu(), r.left, r.bottom + 4);
    }, 'tb');
    controls.append(h('span.workspace-label', { text: 'Espace de travail' }), picker, options, inspectorButton);
    format = h('span#workspace-format', { title: 'Format du projet' });
    KC.$('#toolbar').insertBefore(format, KC.$('#toolbar .tb-flex'));
    summary = KC.$('#timeline-summary');
    const close = button('x', 'Masquer les propriétés', W.toggleInspector, 'tb');
    content = h('div.inspector-body');
    KC.$('#inspector-pane').append(h('div.pane-caption', h('span', { text: 'Propriétés' }), h('span.tb-flex'), close), content);
    content.addEventListener('focusout', () => setTimeout(refreshInspector, 0));
    for (const event of ['change', 'selection', 'project-loaded', 'settings']) KC.on(event, refreshInspector);
    KC.on('theme', W.applySizes);
    refreshPicker(); W.applySizes(); refreshInspector();
  };
})();
