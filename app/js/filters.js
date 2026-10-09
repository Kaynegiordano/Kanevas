// Filtres : chacun reçoit le canevas du calque et renvoie un nouveau canevas.
'use strict';
(() => {
  const U = KS.util;
  const C = v => v < 0 ? 0 : v > 255 ? 255 : v;

  // Échantillonnage bilinéaire (bords étendus)
  function sampler(d) {
    const W = d.width, H = d.height, p = d.data;
    return (x, y, out) => {
      x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
      const x0 = x | 0, y0 = y | 0, x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
      const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, e = (y1 * W + x1) * 4;
      for (let k = 0; k < 4; k++) {
        const t = p[a + k] + (p[b + k] - p[a + k]) * fx, u = p[c + k] + (p[e + k] - p[c + k]) * fx;
        out[k] = t + (u - t) * fy;
      }
    };
  }
  // Déformation par fonction inverse (x,y) -> source
  function warp(src, fn) {
    const d = U.getData(src), W = d.width, H = d.height, out = new ImageData(W, H), o = out.data, s = sampler(d), px = [0, 0, 0, 0];
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
      const q = fn(x, y);
      if (!q) { o[i] = d.data[i]; o[i + 1] = d.data[i + 1]; o[i + 2] = d.data[i + 2]; o[i + 3] = d.data[i + 3]; continue; }
      s(q[0], q[1], px); o[i] = px[0]; o[i + 1] = px[1]; o[i + 2] = px[2]; o[i + 3] = px[3];
    }
    const c = U.canvas(W, H); U.putData(c, out); return c;
  }
  function convolve(src, k, size, opts = {}) {
    const d = U.getData(src), W = d.width, H = d.height, p = d.data, out = new ImageData(W, H), o = out.data, h = size >> 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < size; j++) {
        const yy = Math.min(H - 1, Math.max(0, y + j - h));
        for (let i = 0; i < size; i++) {
          const xx = Math.min(W - 1, Math.max(0, x + i - h)), w = k[j * size + i];
          if (!w) continue;
          const q = (yy * W + xx) * 4; r += p[q] * w; g += p[q + 1] * w; b += p[q + 2] * w;
        }
      }
      const q = (y * W + x) * 4;
      o[q] = C(r + (opts.bias || 0)); o[q + 1] = C(g + (opts.bias || 0)); o[q + 2] = C(b + (opts.bias || 0)); o[q + 3] = p[q + 3];
    }
    const c = U.canvas(W, H); U.putData(c, out); return c;
  }
  // Bruit lissé (valeur) pour les nuages
  function makeNoise(seed) {
    const perm = new Uint8Array(512); const r = mulberry(seed);
    const base = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
    const grad = (h, x, y) => { const v = h & 3; return (v & 1 ? -x : x) + (v & 2 ? -y : y); };
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y) => {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
      const u = fade(x), v = fade(y), a = perm[X] + Y, b = perm[X + 1] + Y;
      return U.lerp(U.lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u), U.lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
    };
  }
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  const defs = {
    gaussianBlur: {
      name: 'Flou gaussien', group: 'Flou',
      params: [{ id: 'radius', label: 'Rayon', min: 0.1, max: 250, step: 0.1, def: 4, unit: 'px', log: true }],
      apply: (src, p) => U.blurCanvas(src, p.radius),
    },
    boxBlur: {
      name: 'Flou optimisé', group: 'Flou', params: [], apply: src => U.blurCanvas(src, 1.2),
    },
    motionBlur: {
      name: 'Flou directionnel', group: 'Flou',
      params: [{ id: 'angle', label: 'Angle', min: -180, max: 180, def: 0, unit: '°' }, { id: 'distance', label: 'Distance', min: 1, max: 400, def: 30, unit: 'px' }],
      apply(src, p) {
        const pad = Math.ceil(p.distance / 2) + 2, P = U.padCanvas(src, pad), out = U.canvas(src.width, src.height), o = out.getContext('2d');
        const a = p.angle * Math.PI / 180, n = Math.max(2, Math.min(96, Math.round(p.distance)));
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1) - 0.5, dx = Math.cos(a) * p.distance * t, dy = -Math.sin(a) * p.distance * t;
          o.globalAlpha = 1 / (i + 1);
          o.drawImage(P, -pad + dx, -pad + dy);
        }
        return out;
      },
    },
    radialBlur: {
      name: 'Flou radial', group: 'Flou',
      params: [
        { id: 'amount', label: 'Intensité', min: 1, max: 100, def: 15 },
        { id: 'mode', label: 'Méthode', type: 'select', def: 'zoom', options: [['zoom', 'Zoom'], ['spin', 'Rotation']] },
        { id: 'cx', label: 'Centre X', min: 0, max: 100, def: 50, unit: '%' }, { id: 'cy', label: 'Centre Y', min: 0, max: 100, def: 50, unit: '%' },
      ],
      apply(src, p) {
        const W = src.width, H = src.height, out = U.canvas(W, H), o = out.getContext('2d');
        const cx = W * p.cx / 100, cy = H * p.cy / 100, n = Math.max(4, Math.min(64, Math.round(p.amount * 1.2)));
        const P = U.padCanvas(src, 2);
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          o.save(); o.globalAlpha = 1 / (i + 1);
          o.translate(cx, cy);
          if (p.mode === 'zoom') { const s = 1 + t * p.amount / 250; o.scale(s, s); }
          else o.rotate((t - 0.5) * p.amount * Math.PI / 360);
          o.translate(-cx, -cy);
          o.drawImage(P, -2, -2);
          o.restore();
        }
        return out;
      },
    },
    surfaceBlur: {
      name: 'Flou de surface', group: 'Flou',
      params: [{ id: 'radius', label: 'Rayon', min: 1, max: 20, def: 5, unit: 'px' }, { id: 'threshold', label: 'Seuil', min: 2, max: 255, def: 15, unit: 'niv.' }],
      apply(src, p) {
        const d = U.getData(src), W = d.width, H = d.height, s = d.data, out = new ImageData(W, H), o = out.data, r = Math.round(p.radius), th = p.threshold;
        const step = r > 6 ? 2 : 1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4; let R = 0, G = 0, B = 0, wt = 0;
          for (let j = -r; j <= r; j += step) { const yy = y + j; if (yy < 0 || yy >= H) continue;
            for (let k = -r; k <= r; k += step) { const xx = x + k; if (xx < 0 || xx >= W) continue;
              const q = (yy * W + xx) * 4; const diff = (Math.abs(s[q] - s[i]) + Math.abs(s[q + 1] - s[i + 1]) + Math.abs(s[q + 2] - s[i + 2])) / 3;
              if (diff > th) continue; const w = 1 - diff / th / 2.5; R += s[q] * w; G += s[q + 1] * w; B += s[q + 2] * w; wt += w; } }
          o[i] = R / wt; o[i + 1] = G / wt; o[i + 2] = B / wt; o[i + 3] = s[i + 3];
        }
        const c = U.canvas(W, H); U.putData(c, out); return c;
      },
    },
    sharpen: {
      name: 'Plus net', group: 'Renforcement', params: [],
      apply: src => defs.unsharp.apply(src, { amount: 60, radius: 1, threshold: 0 }),
    },
    sharpenMore: {
      name: 'Encore plus net', group: 'Renforcement', params: [],
      apply: src => defs.unsharp.apply(src, { amount: 140, radius: 1, threshold: 0 }),
    },
    unsharp: {
      name: 'Accentuation', group: 'Renforcement',
      params: [{ id: 'amount', label: 'Gain', min: 1, max: 500, def: 100, unit: '%' }, { id: 'radius', label: 'Rayon', min: 0.1, max: 100, step: 0.1, def: 1.5, unit: 'px', log: true }, { id: 'threshold', label: 'Seuil', min: 0, max: 255, def: 0, unit: 'niv.' }],
      apply(src, p) {
        const d = U.getData(src), b = U.getData(U.blurCanvas(src, p.radius)).data, s = d.data, k = p.amount / 100;
        for (let i = 0; i < s.length; i += 4) for (let c = 0; c < 3; c++) {
          const diff = s[i + c] - b[i + c];
          if (Math.abs(diff) >= p.threshold) s[i + c] = C(s[i + c] + diff * k);
        }
        const c = U.canvas(d.width, d.height); U.putData(c, d); return c;
      },
    },
    highPass: {
      name: 'Passe-haut', group: 'Divers',
      params: [{ id: 'radius', label: 'Rayon', min: 0.1, max: 250, step: 0.1, def: 10, unit: 'px', log: true }],
      apply(src, p) {
        const d = U.getData(src), b = U.getData(U.blurCanvas(src, p.radius)).data, s = d.data;
        for (let i = 0; i < s.length; i += 4) for (let c = 0; c < 3; c++) s[i + c] = C(128 + s[i + c] - b[i + c]);
        const c = U.canvas(d.width, d.height); U.putData(c, d); return c;
      },
    },
    addNoise: {
      name: 'Ajout de bruit', group: 'Bruit',
      params: [{ id: 'amount', label: 'Quantité', min: 0.1, max: 400, step: 0.1, def: 12, unit: '%' }, { id: 'gaussian', label: 'Gaussienne', type: 'check', def: true }, { id: 'mono', label: 'Monochromatique', type: 'check', def: false }],
      apply(src, p) {
        const d = U.getData(src), s = d.data, a = p.amount / 100 * 128, rnd = mulberry(1234);
        const n = () => p.gaussian ? (rnd() + rnd() + rnd() - 1.5) * 1.15 : (rnd() - 0.5) * 2;
        for (let i = 0; i < s.length; i += 4) {
          if (p.mono) { const v = n() * a; s[i] = C(s[i] + v); s[i + 1] = C(s[i + 1] + v); s[i + 2] = C(s[i + 2] + v); }
          else { s[i] = C(s[i] + n() * a); s[i + 1] = C(s[i + 1] + n() * a); s[i + 2] = C(s[i + 2] + n() * a); }
        }
        const c = U.canvas(d.width, d.height); U.putData(c, d); return c;
      },
    },
    median: {
      name: 'Médiane', group: 'Bruit',
      params: [{ id: 'radius', label: 'Rayon', min: 1, max: 6, def: 2, unit: 'px' }],
      apply(src, p) {
        const d = U.getData(src), W = d.width, H = d.height, s = d.data, out = new ImageData(W, H), o = out.data, r = p.radius;
        const hr = new Uint16Array(256), hg = new Uint16Array(256), hb = new Uint16Array(256);
        const med = (h, n) => { let acc = 0, half = n >> 1; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc > half) return v; } return 255; };
        for (let y = 0; y < H; y++) {
          hr.fill(0); hg.fill(0); hb.fill(0); let n = 0;
          const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
          for (let yy = y0; yy <= y1; yy++) for (let xx = 0; xx <= Math.min(W - 1, r); xx++) { const q = (yy * W + xx) * 4; hr[s[q]]++; hg[s[q + 1]]++; hb[s[q + 2]]++; n++; }
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            o[i] = med(hr, n); o[i + 1] = med(hg, n); o[i + 2] = med(hb, n); o[i + 3] = s[i + 3];
            const xo = x - r, xi = x + r + 1;
            for (let yy = y0; yy <= y1; yy++) {
              if (xo >= 0) { const q = (yy * W + xo) * 4; hr[s[q]]--; hg[s[q + 1]]--; hb[s[q + 2]]--; n--; }
              if (xi < W) { const q = (yy * W + xi) * 4; hr[s[q]]++; hg[s[q + 1]]++; hb[s[q + 2]]++; n++; }
            }
          }
        }
        const c = U.canvas(W, H); U.putData(c, out); return c;
      },
    },
    despeckle: {
      name: 'Réduction du bruit', group: 'Bruit',
      params: [{ id: 'strength', label: 'Intensité', min: 1, max: 10, def: 5 }, { id: 'detail', label: 'Préserver les détails', min: 0, max: 100, def: 40, unit: '%' }],
      apply(src, p) {
        const sm = defs.surfaceBlur.apply(src, { radius: Math.ceil(p.strength / 2) + 1, threshold: 6 + p.strength * 5 });
        const o = sm.getContext('2d'); o.globalAlpha = p.detail / 100 * 0.8; o.drawImage(src, 0, 0); return sm;
      },
    },
    mosaic: {
      name: 'Mosaïque', group: 'Pixellisation',
      params: [{ id: 'size', label: 'Taille de cellule', min: 2, max: 200, def: 12, unit: 'px' }],
      apply(src, p) {
        const W = src.width, H = src.height, s = p.size, sw = Math.max(1, Math.ceil(W / s)), sh = Math.max(1, Math.ceil(H / s));
        const sm = U.canvas(sw, sh), sx = sm.getContext('2d');
        sx.imageSmoothingQuality = 'high'; sx.drawImage(src, 0, 0, sw * s, sh * s, 0, 0, sw, sh);
        const out = U.canvas(W, H), o = out.getContext('2d'); o.imageSmoothingEnabled = false;
        o.drawImage(sm, 0, 0, sw * s, sh * s); return out;
      },
    },
    pointillize: {
      name: 'Pointillisme', group: 'Pixellisation',
      params: [{ id: 'size', label: 'Taille de cellule', min: 3, max: 60, def: 8, unit: 'px' }],
      apply(src, p, info) {
        const W = src.width, H = src.height, out = U.canvas(W, H), o = out.getContext('2d'), d = U.getData(src).data, rnd = mulberry(7);
        o.fillStyle = U.hex(info?.bg || KS.state.bg); o.fillRect(0, 0, W, H);
        const n = Math.round(W * H / (p.size * p.size) * 1.6);
        for (let i = 0; i < n; i++) {
          const x = rnd() * W, y = rnd() * H, q = ((y | 0) * W + (x | 0)) * 4;
          o.fillStyle = `rgba(${d[q]},${d[q + 1]},${d[q + 2]},${d[q + 3] / 255})`;
          o.beginPath(); o.arc(x, y, p.size * (0.45 + rnd() * 0.25), 0, Math.PI * 2); o.fill();
        }
        return out;
      },
    },
    emboss: {
      name: 'Estampage', group: 'Esthétiques',
      params: [{ id: 'angle', label: 'Angle', min: -180, max: 180, def: 135, unit: '°' }, { id: 'height', label: 'Hauteur', min: 1, max: 10, def: 2, unit: 'px' }, { id: 'amount', label: 'Gain', min: 1, max: 500, def: 100, unit: '%' }],
      apply(src, p) {
        const d = U.getData(src), W = d.width, H = d.height, s = d.data, out = new ImageData(W, H), o = out.data;
        const a = p.angle * Math.PI / 180, dx = Math.round(Math.cos(a) * p.height), dy = Math.round(-Math.sin(a) * p.height), k = p.amount / 100;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const x1 = U.clamp(x + dx, 0, W - 1), y1 = U.clamp(y + dy, 0, H - 1), x2 = U.clamp(x - dx, 0, W - 1), y2 = U.clamp(y - dy, 0, H - 1);
          const q1 = (y1 * W + x1) * 4, q2 = (y2 * W + x2) * 4;
          const v = 128 + (U.luma(s[q1], s[q1 + 1], s[q1 + 2]) - U.luma(s[q2], s[q2 + 1], s[q2 + 2])) * k;
          o[i] = o[i + 1] = o[i + 2] = C(v); o[i + 3] = s[i + 3];
        }
        const c = U.canvas(W, H); U.putData(c, out); return c;
      },
    },
    findEdges: {
      name: 'Tracé des contours', group: 'Esthétiques', params: [],
      apply(src) {
        const d = U.getData(src), W = d.width, H = d.height, s = d.data, out = new ImageData(W, H), o = out.data;
        const L = (x, y) => { const q = (U.clamp(y, 0, H - 1) * W + U.clamp(x, 0, W - 1)) * 4; return [s[q], s[q + 1], s[q + 2]]; };
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const a = L(x - 1, y - 1), b = L(x, y - 1), c = L(x + 1, y - 1), dd = L(x - 1, y), f = L(x + 1, y), g = L(x - 1, y + 1), h = L(x, y + 1), k = L(x + 1, y + 1);
          for (let ch = 0; ch < 3; ch++) {
            const gx = -a[ch] - 2 * dd[ch] - g[ch] + c[ch] + 2 * f[ch] + k[ch], gy = -a[ch] - 2 * b[ch] - c[ch] + g[ch] + 2 * h[ch] + k[ch];
            o[i + ch] = C(255 - Math.hypot(gx, gy) * 0.5);
          }
          o[i + 3] = s[i + 3];
        }
        const c = U.canvas(W, H); U.putData(c, out); return c;
      },
    },
    glowingEdges: {
      name: 'Contours lumineux', group: 'Esthétiques', params: [{ id: 'brightness', label: 'Luminosité', min: 1, max: 20, def: 8 }],
      apply(src, p) {
        const e = defs.findEdges.apply(U.blurCanvas(src, 0.8)); const d = U.getData(e), s = d.data, k = p.brightness / 6;
        for (let i = 0; i < s.length; i += 4) { s[i] = C((255 - s[i]) * k); s[i + 1] = C((255 - s[i + 1]) * k); s[i + 2] = C((255 - s[i + 2]) * k); }
        const c = U.canvas(d.width, d.height); U.putData(c, d); return c;
      },
    },
    solarize: {
      name: 'Solarisation', group: 'Esthétiques', params: [],
      apply(src) { const d = U.getData(src), s = d.data; for (let i = 0; i < s.length; i += 4) for (let c = 0; c < 3; c++) if (s[i + c] > 127) s[i + c] = 255 - s[i + c]; const c = U.canvas(d.width, d.height); U.putData(c, d); return c; },
    },
    oilPaint: {
      name: 'Peinture à l\'huile', group: 'Esthétiques',
      params: [{ id: 'radius', label: 'Stylisation', min: 1, max: 12, def: 4, unit: 'px' }],
      apply(src, p) {
        // Kuwahara : pour chaque pixel, moyenne du quadrant le moins varié (images intégrales)
        const d = U.getData(src), W = d.width, H = d.height, s = d.data, r = p.radius;
        const W1 = W + 1, n = W1 * (H + 1);
        const S = [new Float64Array(n), new Float64Array(n), new Float64Array(n)], Q = new Float64Array(n);
        for (let y = 0; y < H; y++) {
          const rs = [0, 0, 0]; let rq = 0;
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, l = U.luma(s[i], s[i + 1], s[i + 2]);
            rs[0] += s[i]; rs[1] += s[i + 1]; rs[2] += s[i + 2]; rq += l * l;
            const k = (y + 1) * W1 + x + 1, up = y * W1 + x + 1;
            S[0][k] = S[0][up] + rs[0]; S[1][k] = S[1][up] + rs[1]; S[2][k] = S[2][up] + rs[2]; Q[k] = Q[up] + rq;
          }
        }
        const Lsum = new Float64Array(n);
        for (let k = 0; k < n; k++) Lsum[k] = 0.299 * S[0][k] + 0.587 * S[1][k] + 0.114 * S[2][k];
        const box = (A, x0, y0, x1, y1) => A[y1 * W1 + x1] - A[y0 * W1 + x1] - A[y1 * W1 + x0] + A[y0 * W1 + x0];
        const out = new ImageData(W, H), o = out.data;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let best = Infinity, br = 0, bg = 0, bb = 0;
          for (let q = 0; q < 4; q++) {
            const x0 = U.clamp(q & 1 ? x : x - r, 0, W), x1 = U.clamp(q & 1 ? x + r + 1 : x + 1, 0, W);
            const y0 = U.clamp(q & 2 ? y : y - r, 0, H), y1 = U.clamp(q & 2 ? y + r + 1 : y + 1, 0, H);
            const cnt = (x1 - x0) * (y1 - y0); if (!cnt) continue;
            const m = box(Lsum, x0, y0, x1, y1) / cnt, v = box(Q, x0, y0, x1, y1) / cnt - m * m;
            if (v < best) { best = v; br = box(S[0], x0, y0, x1, y1) / cnt; bg = box(S[1], x0, y0, x1, y1) / cnt; bb = box(S[2], x0, y0, x1, y1) / cnt; }
          }
          const i = (y * W + x) * 4; o[i] = br; o[i + 1] = bg; o[i + 2] = bb; o[i + 3] = s[i + 3];
        }
        const c = U.canvas(W, H); U.putData(c, out); return c;
      },
    },
    clouds: {
      name: 'Nuages', group: 'Rendu',
      params: [{ id: 'scale', label: 'Échelle', min: 10, max: 400, def: 100, unit: '%' }, { id: 'seed', label: 'Variation', min: 1, max: 999, def: 42 }],
      apply(src, p, info) {
        const W = src.width, H = src.height, out = new ImageData(W, H), o = out.data, noise = makeNoise(p.seed);
        const a = info?.fg || KS.state.fg, b = info?.bg || KS.state.bg, f = 1 / (Math.max(W, H) / 4 * p.scale / 100);
        for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
          let v = 0, amp = 0.5, fr = f;
          for (let k = 0; k < 6; k++) { v += noise(x * fr, y * fr) * amp; amp *= 0.5; fr *= 2; }
          const t = U.clamp(v * 1.1 + 0.5, 0, 1);
          o[i] = a.r + (b.r - a.r) * t; o[i + 1] = a.g + (b.g - a.g) * t; o[i + 2] = a.b + (b.b - a.b) * t; o[i + 3] = 255;
        }
        const c = U.canvas(W, H); U.putData(c, out); return c;
      },
    },
    lensFlare: {
      name: 'Halo', group: 'Rendu',
      params: [{ id: 'x', label: 'Position X', min: 0, max: 100, def: 30, unit: '%' }, { id: 'y', label: 'Position Y', min: 0, max: 100, def: 30, unit: '%' }, { id: 'brightness', label: 'Luminosité', min: 10, max: 300, def: 100, unit: '%' }],
      apply(src, p, info) {
        const W = src.width, H = src.height, out = U.copyCanvas(src), o = out.getContext('2d');
        const off = info?.offset || { x: 0, y: 0 }, dw = info?.doc?.width || W, dh = info?.doc?.height || H;
        const fx = dw * p.x / 100 - off.x, fy = dh * p.y / 100 - off.y, cx = dw / 2 - off.x, cy = dh / 2 - off.y, k = p.brightness / 100, R = Math.max(dw, dh);
        o.globalCompositeOperation = 'screen';
        const blob = (x, y, r, stops) => { const g = o.createRadialGradient(x, y, 0, x, y, r); stops.forEach(s => g.addColorStop(s[0], s[1])); o.fillStyle = g; o.fillRect(x - r, y - r, r * 2, r * 2); };
        blob(fx, fy, R * 0.35 * k, [[0, `rgba(255,255,245,${Math.min(1, 0.95 * k)})`], [0.08, `rgba(255,240,200,${0.6 * k})`], [0.35, `rgba(255,170,90,${0.18 * k})`], [1, 'rgba(0,0,0,0)']]);
        blob(fx, fy, R * 0.05, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
        o.save(); o.translate(fx, fy); o.globalAlpha = Math.min(1, 0.5 * k);
        for (let i = 0; i < 4; i++) { o.rotate(Math.PI / 4); const g = o.createLinearGradient(-R * 0.3, 0, R * 0.3, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,250,235,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); o.fillStyle = g; o.fillRect(-R * 0.3, -1, R * 0.6, 2); }
        o.restore();
        const ghosts = [[0.4, 0.04, '120,200,255'], [0.7, 0.025, '180,255,170'], [1.2, 0.07, '255,150,120'], [1.5, 0.035, '200,160,255'], [1.8, 0.1, '120,180,255']];
        for (const [t, r, c] of ghosts) {
          const x = fx + (cx - fx) * t * 1.2, y = fy + (cy - fy) * t * 1.2;
          blob(x, y, R * r, [[0, `rgba(${c},${0.25 * k})`], [0.7, `rgba(${c},${0.12 * k})`], [1, `rgba(${c},0)`]]);
        }
        o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
        return out;
      },
    },
    twirl: {
      name: 'Tourbillon', group: 'Déformation',
      params: [{ id: 'angle', label: 'Angle', min: -999, max: 999, def: 120, unit: '°' }],
      apply(src, p) {
        const W = src.width, H = src.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2, a = p.angle * Math.PI / 180;
        return warp(src, (x, y) => {
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d >= R) return null;
          const t = 1 - d / R, th = Math.atan2(dy, dx) + a * t * t;
          return [cx + Math.cos(th) * d, cy + Math.sin(th) * d];
        });
      },
    },
    spherize: {
      name: 'Sphérisation', group: 'Déformation',
      params: [{ id: 'amount', label: 'Intensité', min: -100, max: 100, def: 60, unit: '%' }],
      apply(src, p) {
        const W = src.width, H = src.height, cx = W / 2, cy = H / 2, rx = W / 2, ry = H / 2, k = p.amount / 100;
        return warp(src, (x, y) => {
          const nx = (x - cx) / rx, ny = (y - cy) / ry, r = Math.hypot(nx, ny); if (r >= 1 || r === 0) return null;
          const nr = k >= 0 ? U.lerp(r, Math.asin(r) / (Math.PI / 2), k) : U.lerp(r, Math.sin(r * Math.PI / 2), -k);
          const s = nr / r; return [cx + nx * s * rx, cy + ny * s * ry];
        });
      },
    },
    pinch: {
      name: 'Pincement', group: 'Déformation',
      params: [{ id: 'amount', label: 'Intensité', min: -100, max: 100, def: 50, unit: '%' }],
      apply(src, p) {
        const W = src.width, H = src.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2, k = p.amount / 100;
        return warp(src, (x, y) => {
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d >= R || d === 0) return null;
          const t = d / R, tp = k >= 0 ? Math.pow(t, 1 - 0.7 * k) : Math.pow(t, 1 - 1.5 * k);
          const s = tp / t; return [cx + dx * s, cy + dy * s];
        });
      },
    },
    wave: {
      name: 'Ondulation', group: 'Déformation',
      params: [{ id: 'amp', label: 'Amplitude', min: 1, max: 200, def: 12, unit: 'px' }, { id: 'len', label: 'Longueur d\'onde', min: 4, max: 800, def: 80, unit: 'px' }, { id: 'dir', label: 'Direction', type: 'select', def: 'both', options: [['both', 'Les deux'], ['h', 'Horizontale'], ['v', 'Verticale']] }],
      apply(src, p) {
        const k = Math.PI * 2 / p.len;
        return warp(src, (x, y) => [x + (p.dir !== 'v' ? Math.sin(y * k) * p.amp : 0), y + (p.dir !== 'h' ? Math.sin(x * k) * p.amp : 0)]);
      },
    },
    polar: {
      name: 'Coordonnées polaires', group: 'Déformation',
      params: [{ id: 'mode', label: 'Conversion', type: 'select', def: 'toPolar', options: [['toPolar', 'Rectangulaires en polaires'], ['toRect', 'Polaires en rectangulaires']] }],
      apply(src, p) {
        const W = src.width, H = src.height, cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy);
        if (p.mode === 'toPolar') return warp(src, (x, y) => { const dx = x - cx, dy = y - cy; let a = Math.atan2(dx, -dy); if (a < 0) a += Math.PI * 2; return [a / (Math.PI * 2) * W, Math.hypot(dx, dy) / Math.min(cx, cy) * H]; });
        return warp(src, (x, y) => { const a = x / W * Math.PI * 2, r = y / H * Math.min(cx, cy); return [cx + Math.sin(a) * r, cy - Math.cos(a) * r]; });
      },
    },
    maximum: {
      name: 'Maximum', group: 'Divers', params: [{ id: 'radius', label: 'Rayon', min: 1, max: 50, def: 2, unit: 'px' }],
      apply: (src, p) => morph(src, p.radius, Math.max),
    },
    minimum: {
      name: 'Minimum', group: 'Divers', params: [{ id: 'radius', label: 'Rayon', min: 1, max: 50, def: 2, unit: 'px' }],
      apply: (src, p) => morph(src, p.radius, Math.min),
    },
    offset: {
      name: 'Translation', group: 'Divers',
      params: [{ id: 'dx', label: 'Horizontal', min: -2000, max: 2000, def: 100, unit: 'px' }, { id: 'dy', label: 'Vertical', min: -2000, max: 2000, def: 0, unit: 'px' }, { id: 'wrap', label: 'Répartir sur les bords', type: 'check', def: true }],
      apply(src, p) {
        const W = src.width, H = src.height, out = U.canvas(W, H), o = out.getContext('2d');
        if (!p.wrap) { o.drawImage(src, p.dx, p.dy); return out; }
        const dx = ((p.dx % W) + W) % W, dy = ((p.dy % H) + H) % H;
        for (const ox of [dx - W, dx]) for (const oy of [dy - H, dy]) o.drawImage(src, ox, oy);
        return out;
      },
    },
  };
  function morph(src, r, op) {
    const d = U.getData(src), W = d.width, H = d.height, s = d.data, tmp = new Uint8ClampedArray(s.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) { let v = s[i + c]; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) v = op(v, s[(y * W + xx) * 4 + c]); } tmp[i + c] = v; }
      tmp[i + 3] = s[i + 3];
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) { let v = tmp[i + c]; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) v = op(v, tmp[(yy * W + x) * 4 + c]); } s[i + c] = v; }
    }
    const c = U.canvas(W, H); U.putData(c, d); return c;
  }

  KS.Filters = { defs, warp, convolve, sampler, mulberry, makeNoise };
})();
