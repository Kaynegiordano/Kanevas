// Filtre Fluidité : déformation au pinceau (avancer, reconstruire, tourbillon,
// contraction, dilatation). Champ de déplacement inverse calculé en aperçu réduit,
// puis appliqué à pleine résolution.
'use strict';
(() => {
  const U = KS.util, h = KS.h, ui = KS.ui;

  KS.liquify = () => {
    const d = KS.state.doc; if (!d) return;
    const L = KS.tools.pixelLayer(d, { allowMaskEdit: false }); if (!L) return;
    L.ensureCovers(d.rect);
    const FW = L.canvas.width, FH = L.canvas.height;
    const s = Math.min(1, 1500 / Math.max(FW, FH));
    const W = Math.max(1, Math.round(FW * s)), H = Math.max(1, Math.round(FH * s));
    const small = U.canvas(W, H); { const x = small.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(L.canvas, 0, 0, W, H); }
    const src = U.getData(small).data;
    const DX = new Float32Array(W * H), DY = new Float32Array(W * H);
    const out = new ImageData(W, H);
    out.data.set(src);
    const view = h('canvas', { width: W, height: H, style: { display: 'block', maxWidth: '100%', maxHeight: '100%', margin: 'auto', imageRendering: 'auto' } });
    const cur = h('canvas', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
    const stage = h('div', { class: 'checker', style: { position: 'relative', flex: '1', minWidth: '0', height: '72vh', display: 'flex', borderRadius: '8px', overflow: 'hidden', cursor: 'none' } }, view, cur);
    view.getContext('2d').putImageData(out, 0, 0);

    const o = Object.assign({ tool: 'push', size: 120, pressure: 50, rate: 60 }, KS.prefs.liquify || {});
    const TOOLS = [['push', 'smudge', 'Déformation avant'], ['reconstruct', 'undo', 'Reconstruction'], ['twirlCW', 'rotate-cw', 'Tourbillon horaire'], ['twirlCCW', 'rotate-ccw', 'Tourbillon antihoraire'], ['pucker', 'minus', 'Contraction'], ['bloat', 'plus', 'Dilatation']];
    const side = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
    const btns = TOOLS.map(([id, ic, tip]) => {
      const b = ui.iconBtn(ic, tip, () => { o.tool = id; btns.forEach(x => x.classList.toggle('on', x === b)); });
      if (o.tool === id) b.classList.add('on');
      side.appendChild(b); return b;
    });
    const opts = h('div.form-col', { style: { width: '220px', gap: '10px' } },
      h('h4', { text: 'Options de l\'outil', style: { margin: '0', fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' } }),
      ui.paramRow({ id: 'size', label: 'Taille', min: 5, max: 1500, unit: 'px' }, o.size, v => { o.size = v; }),
      ui.paramRow({ id: 'pressure', label: 'Pression', min: 1, max: 100, unit: '%' }, o.pressure, v => { o.pressure = v; }),
      ui.paramRow({ id: 'rate', label: 'Vitesse', min: 1, max: 100 }, o.rate, v => { o.rate = v; }),
      ui.btn('Tout reconstruire', () => { DX.fill(0); DY.fill(0); renderRegion(0, 0, W, H); }, '.small', 'undo'),
      h('div.note', { text: '[ ] : taille du pinceau. Les outils de tourbillon, contraction et dilatation agissent en continu tant que le bouton est enfoncé.' }));
    opts.querySelectorAll('.param').forEach(p => { p.style.gridTemplateColumns = '1fr'; p.style.gap = '4px'; });

    // échantillonnage bilinéaire de la source
    function sample(x, y, i) {
      x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
      const x0 = x | 0, y0 = y | 0, x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
      const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, e = (y1 * W + x1) * 4, p = out.data;
      for (let k = 0; k < 4; k++) { const t = src[a + k] + (src[b + k] - src[a + k]) * fx, u = src[c + k] + (src[e + k] - src[c + k]) * fx; p[i + k] = t + (u - t) * fy; }
    }
    function field(F, x, y) {
      x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
      const x0 = x | 0, y0 = y | 0, x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
      const t = F[y0 * W + x0] + (F[y0 * W + x1] - F[y0 * W + x0]) * fx, u = F[y1 * W + x0] + (F[y1 * W + x1] - F[y1 * W + x0]) * fx;
      return t + (u - t) * fy;
    }
    function renderRegion(x0, y0, x1, y1) {
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = y * W + x; sample(x + DX[k], y + DY[k], k * 4); }
      view.getContext('2d').putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
    }
    // une application du pinceau en (cx, cy), δ = déplacement (déformation avant)
    function dab(cx, cy, mx, my) {
      const r = o.size * s / 2, k = o.pressure / 100;
      const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(W, Math.ceil(cx + r)), y1 = Math.min(H, Math.ceil(cy + r));
      const bw = x1 - x0, bh = y1 - y0; if (bw <= 0 || bh <= 0) return;
      const ox = new Float32Array(bw * bh), oy = new Float32Array(bw * bh);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { ox[(y - y0) * bw + x - x0] = DX[y * W + x]; oy[(y - y0) * bw + x - x0] = DY[y * W + x]; }
      const get = (F, own, x, y) => { const lx = x - x0, ly = y - y0; if (lx >= 0 && ly >= 0 && lx < bw - 1 && ly < bh - 1) { const a = Math.floor(lx), b = Math.floor(ly), fx = lx - a, fy = ly - b; const t = own[b * bw + a] + (own[b * bw + a + 1] - own[b * bw + a]) * fx, u = own[(b + 1) * bw + a] + (own[(b + 1) * bw + a + 1] - own[(b + 1) * bw + a]) * fx; return t + (u - t) * fy; } return field(F, x, y); };
      const rate = o.rate / 100;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const dx = x - cx, dy = y - cy, dd = (dx * dx + dy * dy) / (r * r);
        if (dd >= 1) continue;
        const f = (1 - dd) * (1 - dd) * k, i = y * W + x;
        let qx, qy;
        if (o.tool === 'push') { qx = x - mx * f; qy = y - my * f; }
        else if (o.tool === 'reconstruct') { DX[i] *= 1 - f * 0.25 * rate; DY[i] *= 1 - f * 0.25 * rate; continue; }
        else if (o.tool === 'twirlCW' || o.tool === 'twirlCCW') { const a = (o.tool === 'twirlCW' ? -1 : 1) * f * 0.12 * rate, c = Math.cos(a), sn = Math.sin(a); qx = cx + dx * c - dy * sn; qy = cy + dx * sn + dy * c; }
        else if (o.tool === 'pucker') { const m = 1 + f * 0.06 * rate; qx = cx + dx * m; qy = cy + dy * m; }
        else { const m = 1 - f * 0.06 * rate; qx = cx + dx * m; qy = cy + dy * m; }
        DX[i] = get(DX, ox, qx, qy) + qx - x; DY[i] = get(DY, oy, qx, qy) + qy - y;
      }
      renderRegion(x0, y0, x1, y1);
    }
    const toImg = e => { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, sx: e.clientX, sy: e.clientY }; };
    let last = null, timer = 0, mouse = null;
    const drawCursor = () => {
      const r = stage.getBoundingClientRect(), vr = view.getBoundingClientRect();
      cur.width = r.width; cur.height = r.height;
      const x = cur.getContext('2d'); x.clearRect(0, 0, cur.width, cur.height);
      if (!mouse) return;
      const rad = o.size * s / 2 * vr.width / W;
      x.beginPath(); x.arc(mouse.sx - r.left, mouse.sy - r.top, rad, 0, Math.PI * 2);
      x.lineWidth = 2.5; x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke(); x.lineWidth = 1; x.strokeStyle = '#fff'; x.stroke();
    };
    stage.addEventListener('pointermove', e => {
      mouse = toImg(e); drawCursor();
      if (last && o.tool === 'push') { const p = mouse; const dist = Math.hypot(p.x - last.x, p.y - last.y), step = Math.max(1, o.size * s * 0.08); const n = Math.ceil(dist / step); for (let i = 1; i <= n; i++) { const ax = last.x + (p.x - last.x) * (i - 1) / n, ay = last.y + (p.y - last.y) * (i - 1) / n; dab(ax, ay, (p.x - last.x) / n, (p.y - last.y) / n); } last = p; }
      else if (last) last = mouse;
    });
    stage.addEventListener('pointerleave', () => { mouse = null; drawCursor(); });
    stage.addEventListener('pointerdown', e => {
      stage.setPointerCapture(e.pointerId); last = toImg(e); mouse = last;
      if (o.tool !== 'push') { const tick = () => { if (!last) return; dab(last.x, last.y, 0, 0); timer = requestAnimationFrame(tick); }; tick(); }
    });
    const stop = () => { last = null; cancelAnimationFrame(timer); };
    stage.addEventListener('pointerup', stop); stage.addEventListener('pointercancel', stop);
    const keys = e => { if (e.key === '[' || e.key === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight') { e.preventDefault(); e.stopPropagation(); const up = e.code === 'BracketRight' || e.key === ']'; o.size = U.clamp(Math.round(o.size * (up ? 1.15 : 1 / 1.15)), 5, 1500); opts.querySelectorAll('.param')[0].set(o.size); drawCursor(); } };
    window.addEventListener('keydown', keys, true);

    KS.modal({
      title: 'Fluidité — ' + L.name, width: Math.min(window.innerWidth - 60, 1500),
      body: h('div', { style: { display: 'flex', gap: '12px', alignItems: 'stretch' } }, side, stage, opts),
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }],
      onClose: async v => {
        window.removeEventListener('keydown', keys, true);
        stop();
        KS.prefs.liquify = o; KS.prefs.save();
        if (v !== 'ok') return;
        await KS.busy(() => {
          const full = U.getData(L.canvas), sp = full.data, res = new ImageData(FW, FH), rp = res.data, smp = KS.Filters.sampler(full), px = [0, 0, 0, 0];
          for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
            const fx = x * s, fy = y * s;
            const ddx = field(DX, fx, fy) / s, ddy = field(DY, fx, fy) / s, i = (y * FW + x) * 4;
            if (ddx === 0 && ddy === 0) { rp[i] = sp[i]; rp[i + 1] = sp[i + 1]; rp[i + 2] = sp[i + 2]; rp[i + 3] = sp[i + 3]; continue; }
            smp(x + ddx, y + ddy, px); rp[i] = px[0]; rp[i + 1] = px[1]; rp[i + 2] = px[2]; rp[i + 3] = px[3];
          }
          const tok = KS.Hist.begin(L);
          L.ctx.putImageData(res, 0, 0); L.touch();
          KS.Hist.commitPixels(d, 'Fluidité', tok, null, 'liquify');
          d.changed();
        });
      },
    });
    requestAnimationFrame(drawCursor);
  };
})();
