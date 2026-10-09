// CMJN : épreuve écran (simulation d'impression), alerte des couleurs non
// imprimables et export TIFF CMJN. Approximation d'un papier couché standard,
// sans profil ICC : utile pour repérer les couleurs à risque, pas pour du
// contrôle colorimétrique d'imprimeur.
'use strict';
(() => {
  const U = KS.util, C = KS.cmd;

  // sRGB 8 bits → Lab (D65)
  const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const finv = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  const toLab = (r, g, b) => {
    const R = LIN[r], G = LIN[g], B = LIN[b];
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const fy = f(Y); return [116 * fy - 16, 500 * (f(X) - fy), 200 * (fy - f(Z))];
  };
  const toRgb = (L, a, b) => {
    const fy = (L + 16) / 116, X = finv(fy + a / 500) * 0.95047, Y = finv(fy), Z = finv(fy - b / 200) * 1.08883;
    const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
    const s = v => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
    return [s(R), s(G), s(B)];
  };
  // Chroma maximale imprimable selon teinte (°) et clarté : table approchée d'un papier couché
  const HUES = [[0, 72, 48], [40, 80, 52], [70, 85, 72], [95, 95, 88], [140, 72, 55], [200, 48, 58], [250, 52, 40], [285, 58, 30], [330, 76, 50], [360, 72, 48]];
  const limit = (L, hdeg) => {
    let i = 0; while (i < HUES.length - 2 && HUES[i + 1][0] < hdeg) i++;
    const [h0, c0, l0] = HUES[i], [h1, c1, l1] = HUES[i + 1], t = (hdeg - h0) / (h1 - h0 || 1);
    const cm = c0 + (c1 - c0) * t, lp = l0 + (l1 - l0) * t;
    const k = L > lp ? (100 - L) / (100 - lp) : L / lp;
    return Math.max(6, cm * Math.pow(Math.max(0, k), 0.75));
  };
  const LUT = new Map();
  // Applique épreuve et/ou alerte sur une ImageData (cache par couleur quantifiée)
  KS.cmykProof = (d, proof, warn) => {
    const p = d.data, cache = new Map();
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 0) continue;
      const key = ((p[i] >> 2) << 12) | ((p[i + 1] >> 2) << 6) | (p[i + 2] >> 2);
      let v = cache.get(key);
      if (!v) {
        let [L, a, b] = toLab(p[i], p[i + 1], p[i + 2]);
        const ch = Math.hypot(a, b), hdeg = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360, lim = limit(L, hdeg);
        const out = ch > lim * 1.02;
        if (proof) {
          if (ch > lim * 0.8) { const knee = lim * 0.8, nc = knee + (lim - knee) * Math.tanh((ch - knee) / (lim - knee)); a *= nc / ch; b *= nc / ch; }
          L = 12 + L * 0.82; a = a * 0.97 + 0.4; b = b * 0.97 + 1.6;           // papier légèrement chaud, noir moins profond
        }
        const [r, g, bb] = proof ? toRgb(L, a, b) : [p[i], p[i + 1], p[i + 2]];
        v = warn && out ? [128, 128, 128] : [r, g, bb];
        cache.set(key, v);
      }
      p[i] = v[0]; p[i + 1] = v[1]; p[i + 2] = v[2];
    }
    void LUT;
  };

  // L'affichage du document passe par l'épreuve si elle est active
  const origDisplay = KS.Doc.prototype.display;
  KS.Doc.prototype.display = function () {
    const base = origDisplay.call(this);
    if (!this.proof && !this.gamutWarn) return base;
    if (this._proof && this._proof.stamp === this.stamp && this._proof.key === `${this.proof}${this.gamutWarn}${JSON.stringify(this.channelView)}`) return this._proof.canvas;
    const d = U.getData(base);
    KS.cmykProof(d, this.proof, this.gamutWarn);
    const c = this._proof?.canvas && this._proof.canvas.width === base.width && this._proof.canvas.height === base.height ? this._proof.canvas : U.canvas(base.width, base.height);
    U.putData(c, d);
    this._proof = { stamp: this.stamp, key: `${this.proof}${this.gamutWarn}${JSON.stringify(this.channelView)}`, canvas: c };
    return c;
  };
  C.toggleProof = () => { const d = KS.state.doc; if (!d) return; d.proof = !d.proof; d.changed(); KS.toast(d.proof ? 'Épreuve CMJN activée (simulation approchée, sans profil ICC)' : 'Épreuve désactivée', 'info', 2200); };
  C.toggleGamut = () => { const d = KS.state.doc; if (!d) return; d.gamutWarn = !d.gamutWarn; d.changed(); };

  /* ---------------------------------------------------------------- export TIFF CMJN */
  // Séparation simple avec génération du noir (GCR) et limite d'encrage
  const separate = (r, g, b, gcr = 0.75) => {
    let c = 1 - r / 255, m = 1 - g / 255, y = 1 - b / 255;
    const k = Math.min(c, m, y) * gcr;
    if (k >= 1) return [0, 0, 0, 255];
    c = (c - k) / (1 - k); m = (m - k) / (1 - k); y = (y - k) / (1 - k);
    let tot = c + m + y + k; if (tot > 3.0) { const s = (3.0 - k) / (c + m + y); c *= s; m *= s; y *= s; }
    return [c * 255, m * 255, y * 255, k * 255];
  };
  KS.encodeTiffCMYK = (canvas, dpi = 300) => {
    const W = canvas.width, H = canvas.height, src = U.getData(canvas).data, n = W * H;
    const pix = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = src[i * 4 + 3] / 255;
      const r = src[i * 4] * a + 255 * (1 - a), g = src[i * 4 + 1] * a + 255 * (1 - a), b = src[i * 4 + 2] * a + 255 * (1 - a);
      const v = separate(r, g, b);
      pix[i * 4] = v[0]; pix[i * 4 + 1] = v[1]; pix[i * 4 + 2] = v[2]; pix[i * 4 + 3] = v[3];
    }
    const tags = [
      [256, 4, 1, W], [257, 4, 1, H], [258, 3, 4, 'bps'], [259, 3, 1, 1], [262, 3, 1, 5], [273, 4, 1, 'data'], [277, 3, 1, 4],
      [278, 4, 1, H], [279, 4, 1, pix.length], [282, 5, 1, 'xres'], [283, 5, 1, 'yres'], [284, 3, 1, 1], [296, 3, 1, 2], [332, 3, 1, 1],
    ];
    const ifdSize = 2 + tags.length * 12 + 4;
    const extra = 8 + 8 + 8;            // bps (4×2), xres, yres
    const base = 8, ifdOff = base, bpsOff = ifdOff + ifdSize, xresOff = bpsOff + 8, yresOff = xresOff + 8, dataOff = yresOff + 8;
    const buf = new ArrayBuffer(dataOff + pix.length), v = new DataView(buf);
    v.setUint16(0, 0x4949, true); v.setUint16(2, 42, true); v.setUint32(4, ifdOff, true);
    v.setUint16(ifdOff, tags.length, true);
    tags.forEach(([tag, type, count, val], i) => {
      const o = ifdOff + 2 + i * 12;
      v.setUint16(o, tag, true); v.setUint16(o + 2, type, true); v.setUint32(o + 4, count, true);
      const value = val === 'bps' ? bpsOff : val === 'data' ? dataOff : val === 'xres' ? xresOff : val === 'yres' ? yresOff : val;
      if (type === 3 && count === 1) v.setUint16(o + 8, value, true); else v.setUint32(o + 8, value, true);
    });
    v.setUint32(ifdOff + 2 + tags.length * 12, 0, true);
    for (let k = 0; k < 4; k++) v.setUint16(bpsOff + k * 2, 8, true);
    v.setUint32(xresOff, dpi, true); v.setUint32(xresOff + 4, 1, true); v.setUint32(yresOff, dpi, true); v.setUint32(yresOff + 4, 1, true);
    new Uint8Array(buf, dataOff).set(pix);
    void extra;
    return new Uint8Array(buf);
  };
  C.exportCMYK = async () => {
    const d = KS.state.doc; if (!d) return;
    const ok = await KS.confirm('Export TIFF CMJN par séparation simple (génération du noir à 75 %, encrage limité à 300 %), sans profil ICC. Pour une impression professionnelle, demandez le profil de votre imprimeur.', { title: 'Exporter en CMJN', ok: 'Exporter…' });
    if (!ok) return;
    const data = await KS.busy(() => KS.encodeTiffCMYK(d.flatten()));
    const name = d.name.replace(/\.[^.]+$/, '') + '-CMJN.tif';
    if (KS.native) {
      const p = await KS.native.saveDialog({ title: 'Exporter en CMJN', defaultPath: name, filters: [{ name: 'TIFF CMJN', extensions: ['tif', 'tiff'] }] });
      if (!p) return;
      const r = await KS.native.writeFile(p, data);
      if (r.ok) KS.toast('Exporté : ' + p.split(/[\\/]/).pop(), 'ok'); else KS.toast('Échec : ' + r.error, 'err');
    } else U.download(new Blob([data], { type: 'image/tiff' }), name);
  };
})();
