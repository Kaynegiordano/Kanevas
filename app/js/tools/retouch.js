// Outils de retouche : correcteurs (cicatrisation), flou/netteté/doigt, densité, éponge.
'use strict';
(() => {
  const U = KS.util, T = KS.tools, V = KS.view;

  /* ---------------------------------------------------------------- cicatrisation */
  // Interpolation « push-pull » : remplit les valeurs inconnues (poids 0) en douceur
  function pushPull(vals, wts, W, H, ch) {
    const levels = [{ v: vals, w: wts, W, H }];
    while (levels[levels.length - 1].W > 1 || levels[levels.length - 1].H > 1) {
      const p = levels[levels.length - 1], w2 = Math.max(1, Math.ceil(p.W / 2)), h2 = Math.max(1, Math.ceil(p.H / 2));
      const v = new Float32Array(w2 * h2 * ch), w = new Float32Array(w2 * h2);
      for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
        const i = y * p.W + x, j = (y >> 1) * w2 + (x >> 1), wt = p.w[i];
        if (!wt) continue;
        w[j] += wt;
        for (let c = 0; c < ch; c++) v[j * ch + c] += p.v[i * ch + c] * wt;
      }
      for (let j = 0; j < w2 * h2; j++) if (w[j]) { for (let c = 0; c < ch; c++) v[j * ch + c] /= w[j]; w[j] = Math.min(1, w[j]); }
      levels.push({ v, w, W: w2, H: h2 });
      if (levels.length > 24) break;
    }
    for (let l = levels.length - 2; l >= 0; l--) {
      const p = levels[l], q = levels[l + 1];
      for (let y = 0; y < p.H; y++) for (let x = 0; x < p.W; x++) {
        const i = y * p.W + x, wt = Math.min(1, p.w[i]);
        if (wt >= 1) continue;
        // bilinéaire depuis le niveau grossier
        const fx = Math.min(q.W - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(q.H - 1, Math.max(0, (y - 0.5) / 2));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(q.W - 1, x0 + 1), y1 = Math.min(q.H - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
        for (let c = 0; c < ch; c++) {
          const a = q.v[(y0 * q.W + x0) * ch + c], b = q.v[(y0 * q.W + x1) * ch + c], cc = q.v[(y1 * q.W + x0) * ch + c], d = q.v[(y1 * q.W + x1) * ch + c];
          const up = (a + (b - a) * ax) + ((cc + (d - cc) * ax) - (a + (b - a) * ax)) * ay;
          p.v[i * ch + c] = p.v[i * ch + c] * wt + up * (1 - wt);
        }
        p.w[i] = 1;
      }
    }
    return levels[0].v;
  }

  // Cicatrise `dst` (canevas cible) dans la zone du masque (alpha, coord. cible).
  // src : canevas source (coord. cible), décalé de off ; s'il manque, on cherche
  // automatiquement la meilleure zone voisine (correcteur localisé).
  KS.heal = (dst, src, mask, rect, off) => {
    const ring = Math.max(3, Math.round(Math.min(rect.w, rect.h) * 0.15));
    const R = U.rectIntersect({ x: rect.x - ring, y: rect.y - ring, w: rect.w + ring * 2, h: rect.h + ring * 2 }, { x: 0, y: 0, w: dst.width, h: dst.height });
    if (!R) return null;
    const W = R.w, H = R.h, N = W * H;
    const D = U.getData(dst, R).data;
    const Mraw = U.getData(mask, R).data;
    const M = new Float32Array(N);
    for (let i = 0; i < N; i++) M[i] = Mraw[i * 4 + 3] / 255;
    const grabSafe = o => {
      const c = U.canvas(W, H), x = c.getContext('2d');
      const pad = 256, P = KS._healPad && KS._healPad.src === src ? KS._healPad.c : (KS._healPad = { src, c: U.padCanvas(src, pad) }).c;
      x.drawImage(P, -(R.x + o.dx) - pad, -(R.y + o.dy) - pad);
      return U.getData(c).data;
    };
    if (!off) {
      // candidats dans 8 directions, deux distances ; score sur l'anneau connu
      let best = null;
      const base = Math.max(rect.w, rect.h) * 1.05 + ring;
      for (const k of [1, 1.6]) for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4, o = { dx: Math.round(Math.cos(ang) * base * k), dy: Math.round(Math.sin(ang) * base * k) };
        const sx = R.x + o.dx, sy = R.y + o.dy;
        const outside = sx < 0 || sy < 0 || sx + W > src.width || sy + H > src.height;
        const S = grabSafe(o);
        let e = 0, n = 0;
        for (let i = 0; i < N; i += 2) { if (M[i] > 0.02) continue; const q = i * 4; e += Math.abs(D[q] - S[q]) + Math.abs(D[q + 1] - S[q + 1]) + Math.abs(D[q + 2] - S[q + 2]); n++; }
        let score = n ? e / n : 1e9;
        if (outside) score *= 1.8;
        if (!best || score < best.score) best = { score, o };
      }
      off = best.o;
    }
    const S = grabSafe(off);
    // différence connue sur l'anneau, interpolée à l'intérieur
    const vals = new Float32Array(N * 3), wts = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (M[i] > 0.02) continue;
      const q = i * 4; wts[i] = 1;
      vals[i * 3] = D[q] - S[q]; vals[i * 3 + 1] = D[q + 1] - S[q + 1]; vals[i * 3 + 2] = D[q + 2] - S[q + 2];
    }
    const diff = pushPull(vals, wts, W, H, 3);
    // masque adouci pour fondre la retouche
    const mc = U.canvas(W, H); const mi = new ImageData(W, H);
    for (let i = 0; i < N; i++) mi.data[i * 4 + 3] = M[i] * 255;
    mc.getContext('2d').putImageData(mi, 0, 0);
    const soft = U.getData(U.blurCanvas(mc, Math.max(1, ring / 3))).data;
    const out = new ImageData(W, H), o = out.data;
    for (let i = 0; i < N; i++) {
      const q = i * 4, m = Math.max(M[i], soft[q + 3] / 255);
      if (m <= 0) { o[q] = D[q]; o[q + 1] = D[q + 1]; o[q + 2] = D[q + 2]; o[q + 3] = D[q + 3]; continue; }
      for (let c = 0; c < 3; c++) { const v = S[q + c] + diff[i * 3 + c]; o[q + c] = D[q + c] + (v - D[q + c]) * m; }
      o[q + 3] = D[q + 3] + (Math.max(D[q + 3], S[q + 3]) - D[q + 3]) * m;
    }
    dst.getContext('2d').putImageData(out, R.x, R.y);
    KS._healPad = null;
    return R;
  };

  function healTool(id, name, icon, spot) {
    T.register({
      id, name, icon, shortcut: 'J', cursor: 'none',
      defaults: { size: 40, hardness: 70, sample: 'layer' },
      options: () => [{ type: 'brush' }, { type: 'sep' }, spot ? { type: 'custom', render: () => KS.h('span.opt-label', { text: 'Peignez sur le défaut : la zone se répare au relâchement.' }) } : { type: 'custom', render: () => KS.h('span.opt-label', { text: 'Alt + clic : définir la source' }) }],
      down(ev, doc) {
        if (!spot && ev.alt) { this.src = { x: ev.x, y: ev.y, doc }; this.offset = null; KS.toast('Source définie', 'ok', 900); return; }
        if (!spot && (!this.src || this.src.doc !== doc)) { KS.toast('Alt + clic pour définir la source', 'err'); return; }
        const target = T.paintTarget(doc, { allowMaskEdit: false });
        if (!target || target.gray) return;
        this.target = target; this.token = T.beginHist(target);
        this.snap = U.copyCanvas(target.canvas);
        if (!spot) { if (!this.offset) this.offset = { dx: this.src.x - ev.x, dy: this.src.y - ev.y }; }
        const opts = { doc, target, size: this.o.size, hardness: this.o.hardness / 100, opacity: 1, flow: 1, spacing: 0.1 };
        this.stroke = spot
          ? new KS.Brush.Stroke({ ...opts, color: { r: 20, g: 20, b: 20 }, mode: 'paint' })
          : new KS.Brush.Stroke({ ...opts, mode: 'clone', cloneSource: { canvas: this.snap, ox: target.ox, oy: target.oy }, cloneOffset: this.offset });
        this.stroke.start({ x: ev.x, y: ev.y, pressure: 1 });
        this.need = true; doc.changed();
      },
      move(ev, doc) { if (this.stroke) { this.stroke.move({ x: ev.x, y: ev.y, pressure: 1 }); this.need = true; doc.changed(); } },
      preRender() {
        if (!this.stroke || !this.need) return;
        this.need = false;
        if (spot) {
          const t = this.target, c = U.fitCanvas(this.stroke.tmp, t.canvas.width, t.canvas.height), x = c.getContext('2d');
          x.drawImage(t.canvas, 0, 0); x.globalAlpha = 0.45; x.drawImage(this.stroke.buffer, 0, 0); x.globalAlpha = 1;
          t.layer.override = { canvas: c, x: t.ox, y: t.oy };
        } else this.target.layer.override = this.stroke.preview();
      },
      up(ev, doc) {
        if (!this.stroke) return;
        const t = this.target, st = this.stroke;
        this.stroke = null; this.target = null;
        t.layer.override = null;
        let mask = st.buffer;
        if (doc.selection.mask) { mask = U.copyCanvas(st.buffer); doc.selection.clip(mask, t.ox, t.oy); }
        const rect = st.rect && U.rectIntersect(U.rectInt(st.rect), { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height });
        let done = null;
        if (rect) done = KS.heal(t.canvas, this.snap, mask, rect, spot ? null : { dx: this.offset.dx, dy: this.offset.dy });
        t.layer.touch();
        T.commitHist(doc, t, this.token, done, name, icon);
        this.snap = null;
        doc.changed();
      },
      cancel() { if (this.target) { this.target.layer.override = null; this.target.layer.touch(); } this.stroke = null; },
      key(e) { return KS.brushKeys(this, e); },
      overlay(ctx) {
        T.drawBrushCursor(ctx, this.o.size);
        if (!spot && this.src && V.mouse && this.offset) {
          const p = V.toScreen(V.mouse.x + this.offset.dx, V.mouse.y + this.offset.dy);
          ctx.save(); ctx.strokeStyle = '#fff'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, this.o.size * V.zoom / 2), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      },
    });
  }
  healTool('heal-spot', 'Correcteur localisé', 'heal-spot', true);
  healTool('heal', 'Correcteur', 'heal', false);

  /* ---------------------------------------------------------------- outils à empreintes directes */
  function dabTool(cfg) {
    return T.register({
      id: cfg.id, name: cfg.name, icon: cfg.icon, shortcut: cfg.shortcut, cursor: 'none',
      defaults: Object.assign({ size: 50, hardness: 40, strength: 50, pressureSize: false }, cfg.defaults || {}),
      options() { return [{ type: 'brush' }, { type: 'sep' }, ...(cfg.options ? cfg.options() : []), { type: 'scrub', id: 'strength', label: cfg.strengthLabel || 'Intensité', min: 1, max: 100, unit: '%' }]; },
      down(ev, doc) {
        const target = T.paintTarget(doc, { allowMaskEdit: false });
        if (!target || target.gray) return;
        this.target = target; this.token = T.beginHist(target); this.rect = null;
        this.sel = doc.selection.mask ? U.getData(doc.selection.mask).data : null;
        this.last = { x: ev.x, y: ev.y };
        this.state = {};
        if (cfg.start) cfg.start.call(this, ev, doc);
        this.dab(ev.x, ev.y, ev.pressure, doc);
      },
      move(ev, doc) {
        if (!this.target) return;
        const step = Math.max(1, this.o.size * 0.18), d = U.dist(this.last, ev);
        if (d < step) return;
        const n = Math.floor(d / step);
        for (let i = 1; i <= n; i++) { const k = i * step / d; this.dab(this.last.x + (ev.x - this.last.x) * k, this.last.y + (ev.y - this.last.y) * k, ev.pressure, doc); }
        this.last = { x: this.last.x + (ev.x - this.last.x) * n * step / d, y: this.last.y + (ev.y - this.last.y) * n * step / d };
      },
      dab(x, y, pr, doc) {
        const t = this.target, size = this.o.size * (this.o.pressureSize ? Math.max(0.1, pr) : 1), r = size / 2;
        const cx = x - t.ox, cy = y - t.oy;
        const box = U.rectIntersect({ x: Math.floor(cx - r) - 1, y: Math.floor(cy - r) - 1, w: Math.ceil(size) + 3, h: Math.ceil(size) + 3 }, { x: 0, y: 0, w: t.canvas.width, h: t.canvas.height });
        if (!box) return;
        const img = U.getData(t.canvas, box), N = box.w * box.h, w = new Float32Array(N), hard = this.o.hardness / 100, k = this.o.strength / 100;
        const sel = this.sel, DW = doc.width, DH = doc.height;
        for (let j = 0; j < box.h; j++) for (let i = 0; i < box.w; i++) {
          const px = box.x + i + 0.5, py = box.y + j + 0.5;
          let v = KS.Brush.weight(Math.hypot(px - cx, py - cy) / r, hard) * k;
          if (v && sel) { const dx = Math.floor(px + t.ox), dy = Math.floor(py + t.oy); v *= dx >= 0 && dy >= 0 && dx < DW && dy < DH ? sel[(dy * DW + dx) * 4 + 3] / 255 : 0; }
          w[j * box.w + i] = v;
        }
        cfg.dab.call(this, img, w, box, { cx, cy, r, t });
        t.canvas.getContext('2d').putImageData(img, box.x, box.y);
        this.rect = U.rectUnion(this.rect, box);
        t.layer.touch(); doc.changed();
      },
      up(ev, doc) {
        if (!this.target) return;
        T.commitHist(doc, this.target, this.token, this.rect, cfg.name, cfg.icon);
        this.target = null; this.sel = null;
      },
      key(e) { return KS.brushKeys(this, e); },
      overlay(ctx) { T.drawBrushCursor(ctx, this.o.size); },
    });
  }
  const blurData = (img, radius) => {
    const c = U.canvas(img.width, img.height); c.getContext('2d').putImageData(img, 0, 0);
    return U.getData(U.blurCanvas(c, radius)).data;
  };
  dabTool({
    id: 'blur', name: 'Goutte d\'eau (flou)', icon: 'blur', shortcut: 'R',
    dab(img, w) { const b = blurData(img, 2), p = img.data; for (let i = 0; i < w.length; i++) { const k = w[i] * 0.8; if (!k) continue; const q = i * 4; for (let c = 0; c < 4; c++) p[q + c] += (b[q + c] - p[q + c]) * k; } },
  });
  dabTool({
    id: 'sharpen', name: 'Netteté', icon: 'sharpen', shortcut: 'R', defaults: { strength: 30 },
    dab(img, w) { const b = blurData(img, 1.2), p = img.data; for (let i = 0; i < w.length; i++) { const k = w[i] * 0.9; if (!k) continue; const q = i * 4; for (let c = 0; c < 3; c++) p[q + c] = U.clamp(p[q + c] + (p[q + c] - b[q + c]) * k, 0, 255); } },
  });
  dabTool({
    id: 'smudge', name: 'Doigt', icon: 'smudge', shortcut: 'R', defaults: { strength: 60, finger: false },
    options: () => [{ type: 'check', id: 'finger', label: 'Peinture au doigt' }],
    start() { this.state.carry = null; },
    dab(img, w, box, { cx, cy, r }) {
      const p = img.data, st = this.state, S = Math.ceil(r) * 2 + 1, half = Math.ceil(r);
      // le « porté » est indexé dans le carré centré sur l'empreinte
      if (!st.carry) {
        st.carry = new Float32Array(S * S * 4);
        const fg = KS.state.fg;
        for (let j = 0; j < box.h; j++) for (let i = 0; i < box.w; i++) {
          const bx = Math.round(box.x + i - cx) + half, by = Math.round(box.y + j - cy) + half;
          if (bx < 0 || by < 0 || bx >= S || by >= S) continue;
          const q = (j * box.w + i) * 4, c = (by * S + bx) * 4;
          if (this.o.finger) { st.carry[c] = fg.r; st.carry[c + 1] = fg.g; st.carry[c + 2] = fg.b; st.carry[c + 3] = 255; }
          else for (let k = 0; k < 4; k++) st.carry[c + k] = p[q + k];
        }
        return;
      }
      const rate = this.o.strength / 100;
      for (let j = 0; j < box.h; j++) for (let i = 0; i < box.w; i++) {
        const bx = Math.round(box.x + i - cx) + half, by = Math.round(box.y + j - cy) + half;
        if (bx < 0 || by < 0 || bx >= S || by >= S) continue;
        const q = (j * box.w + i) * 4, c = (by * S + bx) * 4, wt = w[j * box.w + i] / Math.max(0.01, rate);
        if (wt <= 0) continue;
        const ww = Math.min(1, wt) * 0.9;
        for (let k = 0; k < 4; k++) {
          const out = p[q + k] + (st.carry[c + k] - p[q + k]) * ww;
          p[q + k] = out;
          st.carry[c + k] += (out - st.carry[c + k]) * (1 - rate);
        }
      }
    },
  });
  const rangeW = (range, f) => range === 'shadows' ? (1 - f) * (1 - f) : range === 'highlights' ? f * f : 4 * f * (1 - f);
  const rangeOpt = () => [{ type: 'select', id: 'range', label: 'Plage', options: [['shadows', 'Tons foncés'], ['midtones', 'Tons moyens'], ['highlights', 'Tons clairs']] }];
  dabTool({
    id: 'dodge', name: 'Densité - (éclaircir)', icon: 'dodge', shortcut: 'O', strengthLabel: 'Exposition', defaults: { strength: 30, range: 'midtones' }, options: rangeOpt,
    dab(img, w) { const p = img.data, R = this.o.range; for (let i = 0; i < w.length; i++) { const k = w[i] * 0.35; if (!k) continue; const q = i * 4; for (let c = 0; c < 3; c++) { const f = p[q + c] / 255; p[q + c] = (f + k * rangeW(R, f) * (1 - f) * 1.6) * 255; } } },
  });
  dabTool({
    id: 'burn', name: 'Densité + (assombrir)', icon: 'burn', shortcut: 'O', strengthLabel: 'Exposition', defaults: { strength: 30, range: 'midtones' }, options: rangeOpt,
    dab(img, w) { const p = img.data, R = this.o.range; for (let i = 0; i < w.length; i++) { const k = w[i] * 0.35; if (!k) continue; const q = i * 4; for (let c = 0; c < 3; c++) { const f = p[q + c] / 255; p[q + c] = (f - k * rangeW(R, f) * f * 1.6) * 255; } } },
  });
  dabTool({
    id: 'sponge', name: 'Éponge', icon: 'sponge', shortcut: 'O', strengthLabel: 'Flux', defaults: { strength: 40, smode: 'desat' },
    options: () => [{ type: 'select', id: 'smode', label: 'Mode', options: [['desat', 'Désaturer'], ['sat', 'Saturer']] }],
    dab(img, w) {
      const p = img.data, sgn = this.o.smode === 'sat' ? 1 : -1;
      for (let i = 0; i < w.length; i++) { const k = w[i] * 0.3 * sgn; if (!k) continue; const q = i * 4, l = U.luma(p[q], p[q + 1], p[q + 2]); for (let c = 0; c < 3; c++) p[q + c] = U.clamp(l + (p[q + c] - l) * (1 + k), 0, 255); }
    },
  });
})();
