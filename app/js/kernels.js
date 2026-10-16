// Noyaux de calcul des filtres lourds, partagés par la page et par les workers (filter-worker.js).
// Résultats identiques aux versions directes d'origine (même ordre de calcul).
'use strict';
(g => {
  // Flou de surface sur les lignes [ya, yb) : poids lus dans une table (somme des écarts 0…765),
  // pixel central mis en cache. Même ordre d'accumulation que la version directe, donc mêmes valeurs.
  function surfaceKernel(s, W, H, r, th, o, ya = 0, yb = H, oy = 0) {
    const step = r > 6 ? 2 : 1, wt = new Float64Array(766);
    for (let sum = 0; sum <= 765; sum++) { const diff = sum / 3; wt[sum] = diff > th ? 0 : 1 - diff / th / 2.5; }
    for (let y = ya; y < yb; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, r0 = s[i], g0 = s[i + 1], b0 = s[i + 2];
        let k0 = -r; while (x + k0 < 0) k0 += step;
        let R = 0, G = 0, B = 0, T = 0;
        for (let j = -r; j <= r; j += step) {
          const yy = y + j; if (yy < 0 || yy >= H) continue;
          const row = yy * W;
          for (let k = k0; k <= r; k += step) {
            const xx = x + k; if (xx >= W) break;
            const q = (row + xx) * 4, sr = s[q], sg = s[q + 1], sb = s[q + 2];
            const w = wt[(sr > r0 ? sr - r0 : r0 - sr) + (sg > g0 ? sg - g0 : g0 - sg) + (sb > b0 ? sb - b0 : b0 - sb)];
            if (w === 0) continue;
            R += sr * w; G += sg * w; B += sb * w; T += w;
          }
        }
        const p = ((y - oy) * W + x) * 4;
        o[p] = R / T; o[p + 1] = G / T; o[p + 2] = B / T; o[p + 3] = s[i + 3];
      }
    }
  }
  // Médiane (histogrammes glissants) : la position de la médiane est suivie au lieu d'être
  // recherchée depuis 0 à chaque pixel.
  function medianKernel(s, W, H, r, o, ya = 0, yb = H, oy = 0) {
    const hs = [new Uint16Array(256), new Uint16Array(256), new Uint16Array(256)];
    const m = [0, 0, 0], below = [0, 0, 0];
    for (let y = ya; y < yb; y++) {
      for (const hh of hs) hh.fill(0);
      let n = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) for (let xx = 0; xx <= Math.min(W - 1, r); xx++) { const q = (yy * W + xx) * 4; hs[0][s[q]]++; hs[1][s[q + 1]]++; hs[2][s[q + 2]]++; n++; }
      m[0] = m[1] = m[2] = 0; below[0] = below[1] = below[2] = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, p = ((y - oy) * W + x) * 4, half = n >> 1;
        for (let c = 0; c < 3; c++) {
          const hh = hs[c]; let v = m[c], b = below[c];
          while (b + hh[v] <= half) { b += hh[v]; v++; }
          while (b > half) { v--; b -= hh[v]; }
          m[c] = v; below[c] = b; o[p + c] = v;
        }
        o[p + 3] = s[i + 3];
        const xo = x - r, xi = x + r + 1;
        for (let yy = y0; yy <= y1; yy++) {
          if (xo >= 0) { const q = (yy * W + xo) * 4; for (let c = 0; c < 3; c++) { const v = s[q + c]; hs[c][v]--; if (v < m[c]) below[c]--; } n--; }
          if (xi < W) { const q = (yy * W + xi) * 4; for (let c = 0; c < 3; c++) { const v = s[q + c]; hs[c][v]++; if (v < m[c]) below[c]++; } n++; }
        }
      }
    }
  }
  // Minimum / maximum séparables, algorithme de van Herk / Gil-Werman : coût constant par pixel
  // quel que soit le rayon (bords : valeur neutre, comme l'ancienne fenêtre tronquée).
  function morphLine(b, L, w, isMax, g, hh, out, n) {
    for (let i = 0; i < L; i++) g[i] = i % w === 0 ? b[i] : (isMax ? (b[i] > g[i - 1] ? b[i] : g[i - 1]) : (b[i] < g[i - 1] ? b[i] : g[i - 1]));
    for (let i = L - 1; i >= 0; i--) hh[i] = (i % w === w - 1 || i === L - 1) ? b[i] : (isMax ? (b[i] > hh[i + 1] ? b[i] : hh[i + 1]) : (b[i] < hh[i + 1] ? b[i] : hh[i + 1]));
    for (let x = 0; x < n; x++) { const a = hh[x], c = g[x + w - 1]; out[x] = isMax ? (a > c ? a : c) : (a < c ? a : c); }
  }
  function morphKernel(s, W, H, r, isMax) {
    const w = 2 * r + 1, N = Math.max(W, H), L = N + 2 * r, neutral = isMax ? 0 : 255;
    const b = new Uint8Array(L), g = new Uint8Array(L), hh = new Uint8Array(L), out = new Uint8Array(N);
    const tmp = new Uint8ClampedArray(s.length);
    for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) {
      const Lw = W + 2 * r; b.fill(neutral, 0, Lw);
      for (let x = 0, q = y * W * 4 + c; x < W; x++, q += 4) b[x + r] = s[q];
      morphLine(b, Lw, w, isMax, g, hh, out, W);
      for (let x = 0, q = y * W * 4 + c; x < W; x++, q += 4) tmp[q] = out[x];
    }
    for (let i = 3; i < s.length; i += 4) tmp[i] = s[i];
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
      const Lh = H + 2 * r; b.fill(neutral, 0, Lh);
      for (let y = 0, q = x * 4 + c; y < H; y++, q += W * 4) b[y + r] = tmp[q];
      morphLine(b, Lh, w, isMax, g, hh, out, H);
      for (let y = 0, q = x * 4 + c; y < H; y++, q += W * 4) s[q] = out[y];
    }
  }

  // Bande [ya, yb) d'une image (ou d'un morceau d'image), écrite dans o à partir de la ligne oy
  const run = (kind, s, W, H, args, o, ya, yb, oy) => {
    if (kind === 'surface') surfaceKernel(s, W, H, args[0], args[1], o, ya, yb, oy);
    else if (kind === 'median') medianKernel(s, W, H, args[0], o, ya, yb, oy);
  };
  g.KSKernels = { surfaceKernel, medianKernel, morphKernel, run };
})(self);
