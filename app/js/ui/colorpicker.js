// Sélecteur de couleurs TSV (carré saturation/valeur + bande de teinte).
'use strict';
(() => {
  const U = KS.util, h = KS.h;

  class ColorPicker {
    constructor({ color = { r: 0, g: 0, b: 0 }, onChange, big = false, compare = null } = {}) {
      this.onChange = onChange;
      this.hsv = U.rgb2hsv(color);
      this.rgb = { ...color };
      this.el = h('div.cp' + (big ? '.cp-big' : ''));
      this.sv = h('div.cp-sv'); this.svc = h('canvas'); this.svk = h('div.knob'); this.sv.append(this.svc, this.svk);
      this.hue = h('div.cp-hue'); this.huec = h('canvas'); this.huek = h('div.knob'); this.hue.append(this.huec, this.huek);
      const main = h('div.cp-main', this.sv, this.hue);
      this.el.appendChild(main);
      if (compare) {
        this.newSw = h('div'); this.oldSw = h('div', { style: { background: U.hex(compare) }, title: 'Couleur actuelle (cliquer pour revenir)' });
        this.oldSw.addEventListener('click', () => this.set(compare, true));
        main.appendChild(h('div.cp-compare', this.newSw, this.oldSw));
      }
      this.hex = h('input.field', { type: 'text', spellcheck: false });
      this.hex.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') this.hex.blur(); });
      this.hex.addEventListener('change', () => { const c = U.parseHex(this.hex.value); if (c) this.set(c, true); else this.sync(); });
      const fields = h('div.form-col');
      this.ch = {};
      const chan = (k, lab, max) => {
        const f = h('input.field', { type: 'text' });
        f.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') f.blur(); });
        f.addEventListener('change', () => {
          const v = U.clamp(parseFloat(f.value) || 0, 0, max);
          if ('rgb'.includes(k)) { const c = { ...this.rgb, [k]: v }; this.set(c, true); }
          else { const hs = { ...this.hsv }; if (k === 'H') hs.h = v % 360; if (k === 'S') hs.s = v / 100; if (k === 'B') hs.v = v / 100; this.setHSV(hs, true); }
        });
        this.ch[k] = f;
        return h('div.cp-chan', h('span', { text: lab }), h('span'), f);
      };
      if (big) {
        const grid = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', marginTop: '6px' } },
          chan('H', 'T', 360), chan('r', 'R', 255), chan('S', 'S', 100), chan('g', 'V', 255), chan('B', 'L', 100), chan('b', 'B', 255));
        fields.append(grid, h('div.cp-row', h('span.opt-label', { text: '#' }), this.hex));
      } else {
        fields.append(h('div.cp-row', h('span.opt-label', { text: 'Hex' }), this.hex));
      }
      this.el.appendChild(fields);
      this._drag(this.sv, (x, y, r) => { this.hsv.s = U.clamp(x / r.width, 0, 1); this.hsv.v = U.clamp(1 - y / r.height, 0, 1); this._fromHSV(); });
      this._drag(this.hue, (x, y, r) => { this.hsv.h = U.clamp(y / r.height, 0, 0.9999) * 360; this._fromHSV(); this.drawSV(); });
      requestAnimationFrame(() => { this.layout(); });
      new ResizeObserver(() => this.layout()).observe(this.sv);
    }
    _drag(el, fn) {
      el.addEventListener('pointerdown', e => {
        e.preventDefault(); el.setPointerCapture(e.pointerId);
        const go = ev => { const r = el.getBoundingClientRect(); fn(ev.clientX - r.left, ev.clientY - r.top, r); };
        go(e);
        const up = () => { el.removeEventListener('pointermove', go); el.removeEventListener('pointerup', up); this.onCommit && this.onCommit(this.rgb); };
        el.addEventListener('pointermove', go); el.addEventListener('pointerup', up);
      });
    }
    layout() {
      const r = this.sv.getBoundingClientRect(), hr = this.hue.getBoundingClientRect();
      if (r.width < 2) return;
      this.svc.width = Math.round(r.width); this.svc.height = Math.round(r.height);
      this.huec.width = Math.max(1, Math.round(hr.width)); this.huec.height = Math.max(1, Math.round(hr.height));
      const x = this.huec.getContext('2d'), g = x.createLinearGradient(0, 0, 0, this.huec.height);
      ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'].forEach((c, i) => g.addColorStop(i / 6, c));
      x.fillStyle = g; x.fillRect(0, 0, this.huec.width, this.huec.height);
      this.drawSV(); this.sync();
    }
    drawSV() {
      const c = this.svc, x = c.getContext('2d'), w = c.width, hh = c.height;
      if (w < 2) return;
      x.fillStyle = U.hex(U.hsv2rgb({ h: this.hsv.h, s: 1, v: 1 })); x.fillRect(0, 0, w, hh);
      const g1 = x.createLinearGradient(0, 0, w, 0); g1.addColorStop(0, '#fff'); g1.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g1; x.fillRect(0, 0, w, hh);
      const g2 = x.createLinearGradient(0, 0, 0, hh); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000');
      x.fillStyle = g2; x.fillRect(0, 0, w, hh);
    }
    _fromHSV() { this.rgb = U.hsv2rgb(this.hsv); this.sync(); this.onChange && this.onChange(this.rgb); }
    setHSV(hsv, fire) { this.hsv = hsv; this.rgb = U.hsv2rgb(hsv); this.drawSV(); this.sync(); if (fire && this.onChange) this.onChange(this.rgb); }
    set(c, fire = false) {
      if (!c) return;
      const hsv = U.rgb2hsv(c);
      if (hsv.s === 0 || hsv.v === 0) hsv.h = this.hsv.h;      // garde la teinte pour les gris
      this.hsv = hsv; this.rgb = { r: c.r, g: c.g, b: c.b };
      this.drawSV(); this.sync();
      if (fire && this.onChange) this.onChange(this.rgb);
    }
    sync() {
      const r = this.sv.getBoundingClientRect(), hr = this.hue.getBoundingClientRect();
      this.svk.style.left = this.hsv.s * r.width + 'px';
      this.svk.style.top = (1 - this.hsv.v) * r.height + 'px';
      this.svk.style.background = U.hex(this.rgb);
      this.huek.style.top = this.hsv.h / 360 * hr.height + 'px';
      if (document.activeElement !== this.hex) this.hex.value = U.hex(this.rgb).slice(1).toUpperCase();
      if (this.newSw) this.newSw.style.background = U.hex(this.rgb);
      const set = (k, v) => { if (this.ch[k] && document.activeElement !== this.ch[k]) this.ch[k].value = Math.round(v); };
      set('H', this.hsv.h); set('S', this.hsv.s * 100); set('B', this.hsv.v * 100);
      set('r', this.rgb.r); set('g', this.rgb.g); set('b', this.rgb.b);
    }
  }
  KS.ColorPicker = ColorPicker;

  // Boîte modale ; onLive appelé pendant le réglage (aperçu)
  KS.pickColor = (initial, title = 'Sélecteur de couleurs', onLive) => new Promise(resolve => {
    const start = initial || { r: 0, g: 0, b: 0 };
    let cur = { ...start };
    const cp = new ColorPicker({ color: start, big: true, compare: start, onChange: c => { cur = c; onLive && onLive(c); } });
    const sw = h('div.swatches', { style: { marginTop: '12px', gridTemplateColumns: 'repeat(16, 1fr)' } });
    (KS.getSwatches ? KS.getSwatches() : []).slice(0, 32).forEach(hex => {
      const s = h('div.s', { style: { background: hex }, title: hex });
      s.addEventListener('click', () => cp.set(U.parseHex(hex), true));
      sw.appendChild(s);
    });
    const body = h('div', cp.el, sw);
    const pickBtn = KS.ui.btn('Pipette', () => {
      m.el.parentElement.style.display = 'none';
      KS.once && KS.once('pick-color', c => { m.el.parentElement.style.display = ''; if (c) cp.set(c, true); });
      KS.pickingColor = true;
      KS.toast('Cliquez dans l\'image pour prélever une couleur');
    }, '', 'eyedropper');
    const m = KS.modal({
      title, body, width: 470,
      left: [pickBtn],
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: v => resolve(v === 'ok' ? cur : null),
    });
  });
})();
