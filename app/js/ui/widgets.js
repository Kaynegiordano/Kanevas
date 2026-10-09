// Petits composants d'interface réutilisables.
'use strict';
(() => {
  const U = KS.util, h = KS.h;
  const ui = KS.ui = {};

  const fmt = (v, step) => {
    if (step && step < 1) { const d = Math.max(0, Math.min(3, Math.ceil(-Math.log10(step)))); return (+v).toFixed(d).replace(/\.?0+$/, '') || '0'; }
    return String(Math.round(v));
  };
  const setRangeFill = (r) => { const p = (r.value - r.min) / (r.max - r.min) * 100; r.style.setProperty('--p', p + '%'); };
  ui.fmt = fmt;

  // Curseur simple (gradient : fond coloré, ex. 'hue' ou un linear-gradient css)
  ui.range = ({ value, min = 0, max = 100, step = 1, onInput, onChange, gradient, log } = {}) => {
    const r = h('input', { type: 'range', min: 0, max: 1000, step: 1 });
    const toPos = v => log ? Math.log(v / min) / Math.log(max / min) * 1000 : (v - min) / (max - min) * 1000;
    const toVal = p => { let v = log ? min * Math.pow(max / min, p / 1000) : min + (max - min) * p / 1000; v = Math.round(v / step) * step; return U.clamp(+v.toFixed(4), min, max); };
    r.value = toPos(value);
    setRangeFill(r);
    r.addEventListener('input', () => { setRangeFill(r); onInput && onInput(toVal(+r.value)); });
    r.addEventListener('change', () => onChange && onChange(toVal(+r.value)));
    r.addEventListener('keydown', e => e.stopPropagation());
    r.setValue = v => { r.value = toPos(v); setRangeFill(r); };
    if (!gradient) return r;
    r.classList.add('grad-range');
    const bar = h('div.grad-track', { style: { background: gradient === 'hue' ? 'linear-gradient(90deg,#0ff,#00f,#f0f,#f00,#ff0,#0f0,#0ff)' : gradient } });
    const wrap = h('div.grad-wrap', bar, r);
    wrap.setValue = r.setValue; wrap.input = r;
    return wrap;
  };

  // Champ numérique « glissable » (on fait glisser l'étiquette), avec curseur déroulant
  ui.scrub = ({ label, value, min = 0, max = 100, step = 1, unit = '', onInput, onChange, width, log, popup = true, title } = {}) => {
    let v = value;
    const input = h('input', { type: 'text', value: fmt(v, step), spellcheck: false });
    if (width) input.style.width = width + 'px';
    const lbl = label ? h('span.lbl', { text: label, title: title || 'Faire glisser pour régler' }) : null;
    const box = h('span.box', input, unit ? h('span.unit', { text: unit }) : null);
    const el = h('span.scrub', lbl, box);
    const set = (nv, fire = 'input') => {
      nv = U.clamp(Math.round(nv / step) * step, min, max);
      nv = +nv.toFixed(4);
      v = nv; input.value = fmt(v, step);
      if (fire === 'input' && onInput) onInput(v);
      if (fire === 'change' && onChange) onChange(v);
      if (fire === 'both') { onInput && onInput(v); onChange && onChange(v); }
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { input.blur(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(v + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), 'both'); }
      else if (e.key === 'Escape') { input.value = fmt(v, step); input.blur(); }
    });
    input.addEventListener('change', () => { const n = parseFloat(input.value.replace(',', '.')); if (!isNaN(n)) set(n, 'both'); else input.value = fmt(v, step); });
    input.addEventListener('wheel', e => { if (document.activeElement !== input) return; e.preventDefault(); set(v + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 10 : 1), 'both'); }, { passive: false });
    if (lbl) {
      lbl.addEventListener('pointerdown', e => {
        e.preventDefault();
        lbl.setPointerCapture(e.pointerId);
        const x0 = e.clientX, v0 = v, range = max - min;
        const mv = ev => {
          const dx = ev.clientX - x0;
          if (log) set(v0 * Math.pow(1.01, dx * (ev.shiftKey ? 3 : 1)));
          else set(v0 + dx * Math.max(step, range / 300) * (ev.shiftKey ? 10 : 1) * (ev.altKey ? 0.1 : 1));
        };
        const up = () => { lbl.removeEventListener('pointermove', mv); lbl.removeEventListener('pointerup', up); onChange && onChange(v); };
        lbl.addEventListener('pointermove', mv); lbl.addEventListener('pointerup', up);
      });
    }
    if (popup) {
      const drop = h('button.drop', { html: KS.icon('chevron-down'), tabIndex: -1 });
      box.appendChild(drop);
      drop.addEventListener('click', () => {
        const r = box.getBoundingClientRect();
        const rg = ui.range({ value: v, min, max, step, log, onInput: nv => set(nv), onChange: nv => onChange && onChange(nv) });
        const pop = h('div.slider-pop', rg);
        document.body.appendChild(pop);
        pop.style.left = Math.min(window.innerWidth - 220, r.left) + 'px';
        pop.style.top = (r.bottom + 6) + 'px';
        const close = e => { if (!pop.contains(e.target) && e.target !== drop) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
        setTimeout(() => document.addEventListener('pointerdown', close, true));
      });
    }
    el.set = nv => { v = nv; input.value = fmt(v, step); };
    el.get = () => v;
    return el;
  };

  ui.select = (options, value, onChange, cls = '') => {
    const s = h('select.field' + cls);
    for (const o of options) {
      if (o === null) { s.appendChild(h('option', { disabled: true, text: '──────────' })); continue; }
      const [val, lab] = Array.isArray(o) ? o : [o, o];
      s.appendChild(h('option', { value: val, text: lab }));
    }
    s.value = value;
    s.addEventListener('change', () => onChange && onChange(s.value));
    s.addEventListener('keydown', e => e.stopPropagation());
    return s;
  };
  ui.check = (label, value, onChange, title) => {
    const i = h('input', { type: 'checkbox', checked: !!value });
    i.addEventListener('change', () => onChange && onChange(i.checked));
    const l = h('label.check', { title }, i, label ? h('span', { text: label }) : null);
    l.set = v => { i.checked = !!v; };
    l.input = i;
    return l;
  };
  ui.seg = (options, value, onChange) => {
    const el = h('div.seg');
    const btns = options.map(([val, content, title]) => {
      const b = h('button', { title: title || '', 'data-tip': title || '' });
      if (KS.ICONS[content]) b.innerHTML = KS.icon(content); else b.textContent = content;
      if (val === value) b.classList.add('on');
      b.addEventListener('click', () => { btns.forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange && onChange(val); });
      el.appendChild(b);
      return b;
    });
    el.set = v => btns.forEach((b, i) => b.classList.toggle('on', options[i][0] === v));
    return el;
  };
  ui.colorChip = (hex, onChange, title = 'Choisir une couleur') => {
    const b = h('button.color-chip', { title, style: { background: hex } });
    b.value = hex;
    b.addEventListener('click', async () => {
      const c = await KS.pickColor(U.parseHex(b.value), title, col => { b.style.background = U.hex(col); onChange && onChange(U.hex(col), true); });
      if (c) { b.value = U.hex(c); b.style.background = b.value; onChange && onChange(b.value); }
      else { b.style.background = b.value; onChange && onChange(b.value, true); }
    });
    b.set = v => { b.value = v; b.style.background = v; };
    return b;
  };
  ui.iconBtn = (icon, title, onClick, cls = '') => {
    const b = h('button.icon-btn' + cls, { html: KS.icon(icon), 'data-tip': title, 'aria-label': title });
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };
  ui.btn = (label, onClick, cls = '', icon) => {
    const b = h('button.btn' + cls, { html: icon ? KS.icon(icon) : '' });
    b.appendChild(document.createTextNode(label));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };

  // Ligne de paramètre (étiquette, curseur, champ) pour les boîtes de réglage
  ui.paramRow = (def, value, onInput) => {
    if (def.type === 'heading') return h('div.prop-section', h('h4', { text: def.label, style: { margin: '14px 0 2px' } }));
    if (def.type === 'check') {
      const c = ui.check(def.label, value, onInput);
      const row = h('div.param.wide', h('span'), c); row.set = c.set; return row;
    }
    if (def.type === 'color') {
      const chip = ui.colorChip(value, onInput, def.label);
      const row = h('div.param.wide', h('span.pl', { text: def.label }), h('div', chip)); row.set = chip.set; return row;
    }
    if (def.type === 'select') {
      const s = ui.select(def.options, value, onInput);
      const row = h('div.param.wide', h('span.pl', { text: def.label }), s); row.set = v => { s.value = v; }; return row;
    }
    const step = def.step || 1;
    const field = h('input.field', { type: 'text', value: fmt(value, step) });
    const rg = ui.range({ value, min: def.min, max: def.max, step, log: def.log, gradient: def.gradient, onInput: v => { field.value = fmt(v, step); onInput(v); } });
    field.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') field.blur(); });
    field.addEventListener('change', () => {
      let v = parseFloat(field.value.replace(',', '.'));
      if (isNaN(v)) v = value;
      v = U.clamp(v, def.min, def.max);
      field.value = fmt(v, step); rg.setValue(v); onInput(v);
    });
    const row = h('div.param', h('span.pl', { text: def.label + (def.unit ? ` (${def.unit})` : '') }), rg, field);
    row.set = v => { field.value = fmt(v, step); rg.setValue(v); };
    return row;
  };

  /* ---------------------------------------------------------------- menus contextuels */
  let openMenus = [];
  ui.closeMenus = () => { openMenus.forEach(m => m.remove()); openMenus = []; document.removeEventListener('pointerdown', outside, true); KS.emit('menus-closed'); };
  function outside(e) { if (!openMenus.some(m => m.contains(e.target)) && !e.target.closest('.menu-btn')) ui.closeMenus(); }
  ui.menu = (items, x, y, opts = {}) => {
    if (!opts.sub) ui.closeMenus();
    const m = h('div.menu');
    const list = typeof items === 'function' ? items() : items;
    let subOpen = null;
    for (const it of list) {
      if (!it) continue;
      if (it.sep) { m.appendChild(h('div.msep')); continue; }
      if (it.head) { m.appendChild(h('div.mhead', { text: it.head })); continue; }
      if (it.hidden) continue;
      const dis = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
      const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
      const row = h('div.mi' + (dis ? '.disabled' : ''),
        h('span.ic', { html: chk ? KS.icon('check') : it.icon ? KS.icon(it.icon) : '' }),
        h('span.lb', { text: typeof it.label === 'function' ? it.label() : it.label }),
        it.kb ? h('span.kb', { text: it.kb }) : null,
        it.sub ? h('span.sub-arrow', { html: KS.icon('chevron-right') }) : null);
      if (it.sub && !dis) {
        row.addEventListener('mouseenter', () => {
          if (subOpen) { subOpen.remove(); openMenus = openMenus.filter(q => q !== subOpen); }
          m.querySelectorAll('.mi.hl').forEach(q => q.classList.remove('hl'));
          row.classList.add('hl');
          const r = row.getBoundingClientRect();
          subOpen = ui.menu(it.sub, r.right - 2, r.top - 5, { sub: true, parentRect: r });
        });
      } else {
        row.addEventListener('mouseenter', () => {
          if (subOpen) { subOpen.remove(); openMenus = openMenus.filter(q => q !== subOpen); subOpen = null; }
          m.querySelectorAll('.mi.hl').forEach(q => q.classList.remove('hl'));
        });
        if (!dis) row.addEventListener('click', () => { ui.closeMenus(); it.action && it.action(); });
      }
      m.appendChild(row);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    let left = x, top = y;
    if (left + r.width > window.innerWidth - 4) left = opts.parentRect ? opts.parentRect.left - r.width + 2 : window.innerWidth - r.width - 4;
    if (top + r.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    openMenus.push(m);
    if (!opts.sub) setTimeout(() => document.addEventListener('pointerdown', outside, true));
    return m;
  };
  ui.menuOpen = () => openMenus.length > 0;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && openMenus.length) { e.stopPropagation(); ui.closeMenus(); } }, true);

  /* ---------------------------------------------------------------- info-bulles */
  let tipEl = null, tipTimer = 0, tipTarget = null;
  document.addEventListener('mouseover', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === tipTarget) return;
    tipTarget = t; clearTimeout(tipTimer);
    if (tipEl) { tipEl.remove(); tipEl = null; }
    if (!t || !t.dataset.tip) return;
    tipTimer = setTimeout(() => {
      if (!document.body.contains(t)) return;
      const r = t.getBoundingClientRect();
      tipEl = h('div.tip', { text: t.dataset.tip });
      if (t.dataset.key) tipEl.appendChild(h('span.k', { text: t.dataset.key }));
      document.body.appendChild(tipEl);
      const tr = tipEl.getBoundingClientRect();
      let x = r.left + r.width / 2 - tr.width / 2, y = r.bottom + 6;
      if (t.closest('#toolbar')) { x = r.right + 8; y = r.top + r.height / 2 - tr.height / 2; }
      if (y + tr.height > window.innerHeight) y = r.top - tr.height - 6;
      tipEl.style.left = U.clamp(x, 4, window.innerWidth - tr.width - 4) + 'px';
      tipEl.style.top = y + 'px';
    }, 450);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(tipTimer); if (tipEl) { tipEl.remove(); tipEl = null; } }, true);
})();
