// Contrôles réutilisables : curseurs de piste, fader vertical, lignes de paramètres, listes.
'use strict';
(() => {
  const h = KC.h, U = KC.util;
  const UI = KC.ui = {};

  // Curseur horizontal compact (en-têtes de piste). map/unmap : valeur <-> position 0-1
  UI.hslider = ({ value, map = v => v, unmap = v => v, center = false, onInput, onStart, onEnd, def }) => {
    const knob = h('div.knob'), fill = h('div.fill');
    const el = h('div.hslider' + (center ? '.center' : ''), h('div.rail'), fill, knob);
    let v = value;
    const paint = () => { const p = U.clamp(map(v), 0, 1); knob.style.left = (p * 100) + '%'; fill.style.width = (p * 100) + '%'; };
    el.set = nv => { v = nv; paint(); };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect();
      const at = ev => U.clamp((ev.clientX - r.left) / r.width, 0, 1);
      if (onStart) onStart();
      const p0 = map(v), x0 = e.clientX;
      const fine = e.shiftKey;
      const upd = ev => {
        const p = fine || ev.ctrlKey ? U.clamp(p0 + (ev.clientX - x0) / r.width * 0.2, 0, 1) : at(ev);
        v = unmap(p); paint(); if (onInput) onInput(v);
      };
      if (!fine) upd(e);
      U.drag(e, (dx, dy, ev) => upd(ev), () => { if (onEnd) onEnd(v); });
    });
    el.addEventListener('dblclick', e => { e.stopPropagation(); if (def === undefined) return; if (onStart) onStart(); v = def; paint(); if (onInput) onInput(v); if (onEnd) onEnd(v); });
    paint();
    return el;
  };

  // Fader vertical (bus maître) : position 0-1
  UI.vfader = ({ value, onInput, onEnd, def }) => {
    const knob = h('div.knob');
    const el = h('div.vfader', h('div.rail'), knob);
    let v = value;
    const paint = () => { knob.style.top = `calc(6px + ${(1 - v)} * (100% - 12px))`; };
    el.set = nv => { v = nv; paint(); };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const upd = ev => { v = U.clamp(1 - (ev.clientY - r.top - 6) / (r.height - 12), 0, 1); paint(); if (onInput) onInput(v); };
      upd(e);
      U.drag(e, (dx, dy, ev) => upd(ev), () => { if (onEnd) onEnd(v); });
    });
    el.addEventListener('dblclick', () => { if (def === undefined) return; v = def; paint(); if (onInput) onInput(v); if (onEnd) onEnd(v); });
    paint();
    return el;
  };

  // Conversion fader <-> dB (courbe de type console : 0,75 ≈ 0 dB, haut = +12 dB)
  UI.faderToDb = p => p <= 0.0001 ? -Infinity : p >= 0.75 ? (p - 0.75) / 0.25 * 12 : 40 * Math.log10(p / 0.75);
  UI.dbToFader = db => !isFinite(db) || db <= -80 ? 0 : db >= 0 ? 0.75 + Math.min(12, db) / 12 * 0.25 : 0.75 * Math.pow(10, db / 40);

  // Ligne de paramètre d'effet : libellé + curseur + saisie
  UI.param = (def, value, onInput, onCommit) => {
    const row = h('div.param');
    const lab = h('label', { text: def.label, title: def.label });
    if (def.type === 'check') {
      const c = h('input', { type: 'checkbox', checked: !!value });
      c.addEventListener('change', () => { onInput(c.checked); if (onCommit) onCommit(); });
      row.append(lab, h('div', c), h('div'));
      return row;
    }
    if (def.type === 'color') {
      const c = h('input', { type: 'color', value });
      c.addEventListener('input', () => onInput(c.value));
      c.addEventListener('change', () => { if (onCommit) onCommit(); });
      row.append(lab, h('div', c), h('div'));
      return row;
    }
    if (def.type === 'select') {
      const s = UI.select(def.options, value, v => { onInput(v); if (onCommit) onCommit(); });
      row.append(lab, s, h('div'));
      return row;
    }
    const scale = def.pct ? 100 : 1;
    const dec = def.step >= 1 ? 0 : def.step >= 0.1 ? 1 : def.step >= 0.01 ? 2 : 3;
    const rng = h('input', { type: 'range', min: def.min, max: def.max, step: def.step, value });
    const num = h('input.field.num', { value: (value * scale).toFixed(def.pct ? 1 : dec) });
    rng.addEventListener('input', () => { const v = parseFloat(rng.value); num.value = (v * scale).toFixed(def.pct ? 1 : dec); onInput(v); });
    rng.addEventListener('change', () => { if (onCommit) onCommit(); });
    rng.addEventListener('dblclick', () => { rng.value = def.def; num.value = (def.def * scale).toFixed(def.pct ? 1 : dec); onInput(def.def); if (onCommit) onCommit(); });
    num.addEventListener('change', () => {
      let v = parseFloat(String(num.value).replace(',', '.')) / scale;
      if (!isFinite(v)) v = def.def;
      v = U.clamp(v, def.min, def.max);
      rng.value = v; num.value = (v * scale).toFixed(def.pct ? 1 : dec); onInput(v); if (onCommit) onCommit();
    });
    num.addEventListener('keydown', e => e.stopPropagation());
    row.append(lab, rng, num);
    row.title = def.unit ? def.label + ' (' + def.unit.trim() + ')' : def.label;
    return row;
  };

  UI.select = (options, value, onChange) => {
    const s = h('select.field');
    for (const o of options) {
      if (o === '-') { s.appendChild(h('option', { disabled: true, text: '──────────' })); continue; }
      const [v, l] = Array.isArray(o) ? o : [o, o];
      s.appendChild(h('option', { value: v, text: l }));
    }
    s.value = value;
    if (onChange) s.addEventListener('change', () => onChange(s.value));
    return s;
  };
  UI.check = (label, value, onChange) => {
    const c = h('input', { type: 'checkbox', checked: !!value });
    if (onChange) c.addEventListener('change', () => onChange(c.checked));
    const l = h('label.chk', c, h('span', { text: label }));
    l.input = c;
    return l;
  };
  UI.num = (value, { step = 1, min = -Infinity, max = Infinity, width = 90, onChange, dec = 2 } = {}) => {
    const i = h('input.field', { value: Number(value).toFixed(dec).replace(/\.?0+$/, '') || '0', style: { width: width + 'px' } });
    i.addEventListener('change', () => {
      let v = parseFloat(String(i.value).replace(',', '.'));
      if (!isFinite(v)) v = value;
      v = U.clamp(v, min, max);
      i.value = String(Math.round(v / step) * step === v ? v : v);
      if (onChange) onChange(v);
    });
    i.addEventListener('keydown', e => e.stopPropagation());
    return i;
  };
  // Champ de temps (format courant), renvoie des secondes
  UI.time = (value, onChange) => {
    const i = h('input.field', { value: U.fmtTime(value, KC.P.fps()), style: { width: '130px', fontFamily: 'var(--mono)' } });
    i.addEventListener('change', () => {
      const v = U.parseTime(i.value, KC.P.fps());
      if (v == null) { i.value = U.fmtTime(value, KC.P.fps()); return; }
      value = Math.max(0, v); i.value = U.fmtTime(value, KC.P.fps());
      if (onChange) onChange(value);
    });
    i.addEventListener('keydown', e => e.stopPropagation());
    i.get = () => value;
    return i;
  };
})();
