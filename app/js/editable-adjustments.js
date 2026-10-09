// Les réglages conservent leur source et leurs paramètres dans un calque dédié.
'use strict';
(() => {
  const U = KS.util, C = KS.cmd;
  const clone = o => JSON.parse(JSON.stringify(o));
  async function edit(doc, layer, creation) {
    const def = { ...KS.Adjust.defs[layer.adjust.type], key: layer.adjust.type };
    const original = clone(layer.adjust), visible = layer.visible;
    const values = clone(original.params);
    const before = creation?.before || KS.Hist.structSnap(doc);
    const histo = KS.Adjust.hist(U.getData(doc.flatten(doc.layers.slice(0, doc.layers.indexOf(layer)))));
    let closed = false;
    const update = vals => {
      if (closed) return;
      layer.adjust.params = clone(vals); layer.visible = visible; layer.touch(); doc.changed();
    };
    const cancel = previewOnly => {
      layer.adjust = clone(original); layer.visible = creation && previewOnly ? false : visible;
      layer.touch(); doc.changed();
      if (!previewOnly && creation) {
        doc.removeLayer(layer);
        doc.activeId = creation.active;
        doc.selectedIds = creation.selected;
        KS.emit('active-layer', doc); KS.emit('layers', doc);
      }
      if (!previewOnly) closed = true;
    };
    const apply = vals => {
      update(vals); closed = true;
      doc.history.push({ name: (creation ? 'Créer ' : 'Modifier ') + def.name, icon: def.icon || 'adjust', ...KS.Hist.structPart(doc, before) });
      KS.emit('layers', doc); KS.emit('active-layer', doc);
      KS.panels.focus('properties');
    };
    if (!(def.params || []).length && !def.custom) { apply(values); return; }
    await KS.dialogs.params({ title: def.name + ' — réglage modifiable', def, values, histo, width: def.custom ? 400 : 520,
      preview: update, cancel, apply,
      auto: def.custom === 'levels' ? vals => {
        for (const ch of ['r', 'g', 'b']) {
          let total = 0; for (let i = 0; i < 256; i++) total += histo[ch][i];
          let lo = 0, hi = 255, sum = 0;
          for (; lo < 255; lo++) { sum += histo[ch][lo]; if (sum > total * .001) break; }
          sum = 0; for (; hi > 0; hi--) { sum += histo[ch][hi]; if (sum > total * .001) break; }
          vals[ch] = { ...KS.Adjust.LV0(), inBlack: lo, inWhite: Math.max(lo + 2, hi) };
        }
        update(vals);
      } : null,
    });
  }
  C.editAdjustment = () => {
    const doc = KS.state.doc, layer = doc?.active;
    if (!layer || layer.kind !== 'adjust') return;
    // Terminer une édition du panneau avant de capturer l'état de la boîte.
    KS.panels.defs.properties?.commitPending?.();
    if (layer.lockAll) { KS.toast('Le calque de réglage est verrouillé.', 'err'); return; }
    return edit(doc, layer);
  };
  C.newEditableAdjustment = type => {
    const doc = KS.state.doc, source = doc?.active, def = KS.Adjust.defs[type];
    if (!doc || !source || !def) return;
    KS.panels.defs.properties?.commitPending?.();
    const creation = { before: KS.Hist.structSnap(doc), active: doc.activeId, selected: new Set(doc.selectedIds) };
    const layer = new KS.Layer({ name: def.name, kind: 'adjust', adjust: { type, params: KS.Adjust.defaults(type) },
      clip: source.kind !== 'group' && (source.kind !== 'adjust' || source.clip) });
    layer.addMask(doc, doc.selection.active ? 'selection' : 'reveal');
    doc.addLayer(layer, doc.activeIndex + 1);
    return edit(doc, layer, creation);
  };
})();
