// Effets vidéo/audio, transitions, générateurs de médias et panoramique/recadrage.
// Chaque effet a deux implémentations alignées : aperçu (Canvas/SVG/Web Audio) et rendu (filtre ffmpeg).
'use strict';
(() => {
  const U = KC.util;
  const FX = KC.FX = {};

  /* ============================================================ matrices de couleur */
  // Matrices 3×3 identiques à celles des filtres CSS/SVG (saturate, hueRotate, grayscale, sepia)
  const mul3 = (a, b) => {
    const r = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
    return r;
  };
  const satM = s => [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  const hueM = deg => {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
    ];
  };
  const grayM = a => {
    const k = 1 - a;
    return [
      0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k,
      0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k,
      0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k,
    ];
  };
  const sepiaM = a => {
    const k = 1 - a;
    return [
      0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k,
      0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k,
      0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k,
    ];
  };
  const diagM = (r, g, b) => [r, 0, 0, 0, g, 0, 0, 0, b];
  const f4 = v => (Math.round(v * 10000) / 10000).toString();
  const ccm = m => `colorchannelmixer=rr=${f4(m[0])}:rg=${f4(m[1])}:rb=${f4(m[2])}:gr=${f4(m[3])}:gg=${f4(m[4])}:gb=${f4(m[5])}:br=${f4(m[6])}:bg=${f4(m[7])}:bb=${f4(m[8])}`;
  const svgMatrix = m => `${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0`;
  const hexRgb = hx => { const s = String(hx || '#000').replace('#', ''); return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0]; };

  /* ============================================================ effets vidéo */
  // type : 'svg' (filtre SVG en aperçu), 'blur', 'custom' (traitement canevas)
  FX.VIDEO = {
    enhance: {
      name: 'Amélioration des couleurs (auto)', cat: 'Couleur', icon: 'wand', auto: true,
      params: [
        { k: 'amount', label: 'Correction auto', min: 0, max: 1, step: 0.01, def: 1 },
        { k: 'vibrance', label: 'Vibrance', min: -1, max: 1.5, step: 0.01, def: 0.45 },
        { k: 'contrast', label: 'Contraste', min: 0.6, max: 1.6, step: 0.01, def: 1.08 },
        { k: 'warmth', label: 'Chaleur', min: -1, max: 1, step: 0.01, def: 0 },
        // valeurs mesurées par l'analyse (niveaux noir/blanc par canal)
        { k: 'lr', hidden: true, def: 0 }, { k: 'hr', hidden: true, def: 1 },
        { k: 'lg', hidden: true, def: 0 }, { k: 'hg', hidden: true, def: 1 },
        { k: 'lb', hidden: true, def: 0 }, { k: 'hb', hidden: true, def: 1 },
      ],
    },
    bc: {
      name: 'Luminosité et contraste', cat: 'Couleur', icon: 'color',
      params: [
        { k: 'brightness', label: 'Luminosité', min: -1, max: 1, step: 0.01, def: 0 },
        { k: 'contrast', label: 'Contraste', min: 0, max: 3, step: 0.01, def: 1 },
      ],
      svg: p => { const s = p.contrast, i = 0.5 - 0.5 * s + p.brightness; return `<feComponentTransfer><feFuncR type="linear" slope="${s}" intercept="${i}"/><feFuncG type="linear" slope="${s}" intercept="${i}"/><feFuncB type="linear" slope="${s}" intercept="${i}"/></feComponentTransfer>`; },
      ff: p => { const s = p.contrast, i = (0.5 - 0.5 * s + p.brightness) * 255; const e = `clip(val*${f4(s)}+${f4(i)}\\,0\\,255)`; return `lutrgb=r='${e}':g='${e}':b='${e}'`; },
    },
    levels: {
      name: 'Niveaux', cat: 'Couleur', icon: 'normalize',
      params: [
        { k: 'inB', label: 'Entrée noir', min: 0, max: 0.9, step: 0.01, def: 0 },
        { k: 'inW', label: 'Entrée blanc', min: 0.1, max: 1, step: 0.01, def: 1 },
        { k: 'gamma', label: 'Gamma', min: 0.1, max: 4, step: 0.01, def: 1 },
        { k: 'outB', label: 'Sortie noir', min: 0, max: 1, step: 0.01, def: 0 },
        { k: 'outW', label: 'Sortie blanc', min: 0, max: 1, step: 0.01, def: 1 },
      ],
      svg: p => {
        const d = Math.max(0.01, p.inW - p.inB), sl = 1 / d, ic = -p.inB / d;
        const amp = p.outW - p.outB, ex = 1 / p.gamma, off = p.outB;
        const st1 = `<feFuncR type="linear" slope="${sl}" intercept="${ic}"/><feFuncG type="linear" slope="${sl}" intercept="${ic}"/><feFuncB type="linear" slope="${sl}" intercept="${ic}"/>`;
        const st2 = `<feFuncR type="gamma" amplitude="${amp}" exponent="${ex}" offset="${off}"/><feFuncG type="gamma" amplitude="${amp}" exponent="${ex}" offset="${off}"/><feFuncB type="gamma" amplitude="${amp}" exponent="${ex}" offset="${off}"/>`;
        return `<feComponentTransfer>${st1}</feComponentTransfer><feComponentTransfer>${st2}</feComponentTransfer>`;
      },
      ff: p => {
        const d = Math.max(0.01, p.inW - p.inB);
        const e = `clip(255*(${f4(p.outB)}+${f4(p.outW - p.outB)}*pow(clip((val/255-${f4(p.inB)})/${f4(d)}\\,0\\,1)\\,${f4(1 / p.gamma)}))\\,0\\,255)`;
        return `lutrgb=r='${e}':g='${e}':b='${e}'`;
      },
    },
    color: {
      name: 'Correcteur de couleur', cat: 'Couleur', icon: 'color',
      params: [
        { k: 'sat', label: 'Saturation', min: 0, max: 3, step: 0.01, def: 1 },
        { k: 'hue', label: 'Teinte', min: -180, max: 180, step: 1, def: 0, unit: '°' },
        { k: 'temp', label: 'Température', min: -1, max: 1, step: 0.01, def: 0 },
        { k: 'tint', label: 'Nuance', min: -1, max: 1, step: 0.01, def: 0 },
      ],
      matrix: p => {
        const t = p.temp * 0.25, n = p.tint * 0.2;
        return mul3(diagM(1 + t, 1 - n, 1 - t), mul3(hueM(p.hue), satM(p.sat)));
      },
    },
    balance: {
      name: 'Balance des couleurs', cat: 'Couleur', icon: 'color',
      params: [
        { k: 'r', label: 'Rouge', min: 0, max: 2, step: 0.01, def: 1 },
        { k: 'g', label: 'Vert', min: 0, max: 2, step: 0.01, def: 1 },
        { k: 'b', label: 'Bleu', min: 0, max: 2, step: 0.01, def: 1 },
      ],
      matrix: p => diagM(p.r, p.g, p.b),
    },
    bw: {
      name: 'Noir et blanc', cat: 'Couleur', icon: 'solid',
      params: [{ k: 'amount', label: 'Intensité', min: 0, max: 1, step: 0.01, def: 1 }],
      matrix: p => grayM(p.amount),
    },
    sepia: {
      name: 'Sépia', cat: 'Couleur', icon: 'image',
      params: [{ k: 'amount', label: 'Intensité', min: 0, max: 1, step: 0.01, def: 1 }],
      matrix: p => sepiaM(p.amount),
    },
    invert: {
      name: 'Inverser', cat: 'Couleur', icon: 'refresh',
      params: [{ k: 'amount', label: 'Intensité', min: 0, max: 1, step: 0.01, def: 1 }],
      svg: p => { const s = 1 - 2 * p.amount, i = p.amount; return `<feComponentTransfer><feFuncR type="linear" slope="${s}" intercept="${i}"/><feFuncG type="linear" slope="${s}" intercept="${i}"/><feFuncB type="linear" slope="${s}" intercept="${i}"/></feComponentTransfer>`; },
      ff: p => { const e = `clip(val*${f4(1 - 2 * p.amount)}+${f4(255 * p.amount)}\\,0\\,255)`; return `lutrgb=r='${e}':g='${e}':b='${e}'`; },
    },
    blur: {
      name: 'Flou gaussien', cat: 'Flou et netteté', icon: 'eye',
      params: [{ k: 'radius', label: 'Rayon', min: 0, max: 80, step: 0.5, def: 8 }],
      // rayon exprimé pour une image de 1080 lignes
      ff: (p, c) => { const s = p.radius / 1080 * c.srcH; return s > 0.05 ? `gblur=sigma=${f4(s)}` : null; },
    },
    sharpen: {
      name: 'Netteté', cat: 'Flou et netteté', icon: 'wand',
      params: [{ k: 'amount', label: 'Intensité', min: 0, max: 3, step: 0.05, def: 0.8 }],
      svg: p => { const a = p.amount; return `<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0"/>`; },
      ff: p => { const a = f4(p.amount), c = f4(1 + 4 * p.amount); const m = `0 -${a} 0 -${a} ${c} -${a} 0 -${a} 0`; return `convolution='${m}':'${m}':'${m}':'0 0 0 0 1 0 0 0 0'`; },
    },
    glow: {
      name: 'Lueur douce', cat: 'Stylisation', icon: 'bolt',
      params: [
        { k: 'radius', label: 'Rayon', min: 1, max: 80, step: 0.5, def: 20 },
        { k: 'amount', label: 'Intensité', min: 0, max: 1, step: 0.01, def: 0.5 },
      ],
      ff: (p, c) => `split[gA][gB];[gB]gblur=sigma=${f4(p.radius / 1080 * c.srcH)}[gC];[gA][gC]blend=all_mode=screen:all_opacity=${f4(p.amount)}`,
    },
    vignette: {
      name: 'Vignette', cat: 'Stylisation', icon: 'safe',
      params: [
        { k: 'amount', label: 'Intensité', min: 0, max: 1, step: 0.01, def: 0.6 },
        { k: 'size', label: 'Taille', min: 0.2, max: 1.5, step: 0.01, def: 0.75 },
      ],
      image: true,
    },
    mosaic: {
      name: 'Pixelisation', cat: 'Stylisation', icon: 'grid',
      params: [{ k: 'size', label: 'Taille des blocs', min: 2, max: 120, step: 1, def: 18 }],
      ff: (p, c) => { const n = Math.max(1, p.size / 1080 * c.srcH); const w = Math.max(1, Math.round(c.srcW / n)), hh = Math.max(1, Math.round(c.srcH / n)); return `scale=${w}:${hh}:flags=area,scale=${c.srcW}:${c.srcH}:flags=neighbor`; },
    },
    grain: {
      name: 'Grain de film', cat: 'Stylisation', icon: 'dots',
      params: [{ k: 'amount', label: 'Intensité', min: 0, max: 60, step: 1, def: 18 }],
      ff: p => p.amount > 0 ? `noise=c0s=${Math.round(p.amount)}:c1s=${Math.round(p.amount)}:c2s=${Math.round(p.amount)}:allf=t` : null,
    },
    mirror: {
      name: 'Miroir', cat: 'Transformation', icon: 'split',
      params: [
        { k: 'h', label: 'Horizontal', type: 'check', def: true },
        { k: 'v', label: 'Vertical', type: 'check', def: false },
      ],
      ff: p => [p.h ? 'hflip' : null, p.v ? 'vflip' : null].filter(Boolean).join(',') || null,
    },
    crop: {
      name: 'Rognage des bords', cat: 'Transformation', icon: 'trim',
      params: [
        { k: 'l', label: 'Gauche', min: 0, max: 0.49, step: 0.005, def: 0.1, pct: true },
        { k: 'r', label: 'Droite', min: 0, max: 0.49, step: 0.005, def: 0.1, pct: true },
        { k: 't', label: 'Haut', min: 0, max: 0.49, step: 0.005, def: 0, pct: true },
        { k: 'b', label: 'Bas', min: 0, max: 0.49, step: 0.005, def: 0, pct: true },
      ],
      ff: (p, c) => {
        const l = Math.round(p.l * c.srcW), r = Math.round(p.r * c.srcW), t = Math.round(p.t * c.srcH), b = Math.round(p.b * c.srcH);
        const w = Math.max(2, c.srcW - l - r), hh = Math.max(2, c.srcH - t - b);
        return `crop=${w}:${hh}:${l}:${t},pad=${c.srcW}:${c.srcH}:${l}:${t}:color=black@0`;
      },
    },
    chroma: {
      name: 'Incrustation chromatique', cat: 'Incrustation', icon: 'wand',
      params: [
        { k: 'color', label: 'Couleur', type: 'color', def: '#00ff00' },
        { k: 'sim', label: 'Similarité', min: 0.01, max: 1, step: 0.005, def: 0.22 },
        { k: 'blend', label: 'Fondu', min: 0, max: 1, step: 0.005, def: 0.08 },
      ],
      ff: p => `format=yuva444p,chromakey=color=0x${String(p.color).replace('#', '')}:similarity=${f4(p.sim)}:blend=${f4(p.blend)},format=rgba`,
    },
  };
  /* ------------------------------------------------------------ amélioration automatique des couleurs */
  // Partie linéaire par canal : niveaux auto (mélangés selon « amount »), chaleur, puis contraste autour de 0,5
  FX.enhanceLinear = p => {
    const ch = (lo, hi, warm) => {
      const d = Math.max(0.05, hi - lo);
      let s = 1 + p.amount * (1 / d - 1), i = p.amount * (-lo / d);
      s *= 1 + warm; i *= 1 + warm;
      const c = p.contrast;
      return [s * c, i * c + 0.5 - 0.5 * c];
    };
    const w = p.warmth * 0.12;
    return { r: ch(p.lr, p.hr, w), g: ch(p.lg, p.hg, 0), b: ch(p.lb, p.hb, -w) };
  };
  FX.VIDEO.enhance.svg = p => {
    const L = FX.enhanceLinear(p);
    return `<feComponentTransfer><feFuncR type="linear" slope="${L.r[0]}" intercept="${L.r[1]}"/><feFuncG type="linear" slope="${L.g[0]}" intercept="${L.g[1]}"/><feFuncB type="linear" slope="${L.b[0]}" intercept="${L.b[1]}"/></feComponentTransfer>`;
  };
  FX.VIDEO.enhance.ff = p => {
    const L = FX.enhanceLinear(p);
    if (Math.abs(p.vibrance) > 0.005) return { lut: FX.enhanceCube(p) };   // vibrance : LUT 3D exacte
    const e = ([s, i]) => `'clip(val*${f4(s)}+${f4(i * 255)}\\,0\\,255)'`;
    return `lutrgb=r=${e(L.r)}:g=${e(L.g)}:b=${e(L.b)}`;
  };
  // Même calcul que l'aperçu (partie linéaire puis vibrance), valeurs 0-1
  FX.enhancePixel = (L, vib, r, g, b) => {
    const cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
    r = cl(r * L.r[0] + L.r[1]); g = cl(g * L.g[0] + L.g[1]); b = cl(b * L.b[0] + L.b[1]);
    if (Math.abs(vib) < 0.005) return [r, g, b];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const luma = g * 0.715158 + r * 0.212656 + b * 0.072186;
    const c = 1 + vib * (1 - Math.sign(vib) * (mx - mn));
    return [cl(luma + (r - luma) * c), cl(luma + (g - luma) * c), cl(luma + (b - luma) * c)];
  };
  // LUT 3D au format .cube (rouge variant le plus vite)
  FX.enhanceCube = (p, N = 33) => {
    const L = FX.enhanceLinear(p);
    const lines = ['TITLE "KaneClip amelioration"', 'LUT_3D_SIZE ' + N];
    for (let bi = 0; bi < N; bi++) for (let gi = 0; gi < N; gi++) for (let ri = 0; ri < N; ri++) {
      const o = FX.enhancePixel(L, p.vibrance, ri / (N - 1), gi / (N - 1), bi / (N - 1));
      lines.push(o.map(v => v.toFixed(5)).join(' '));
    }
    return lines.join('\n') + '\n';
  };
  // Vibrance : même calcul que le filtre vibrance de ffmpeg (coefficients de luminance par défaut)
  FX.vibrancePixels = (x, w, hh, intensity) => {
    if (Math.abs(intensity) < 0.005) return;
    const img = x.getImageData(0, 0, w, hh), d = img.data;
    const sg = Math.sign(intensity);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const luma = g * 0.715158 + r * 0.212656 + b * 0.072186;
      const c = 1 + intensity * (1 - sg * (mx - mn));
      d[i] = (luma + (r - luma) * c) * 255;
      d[i + 1] = (luma + (g - luma) * c) * 255;
      d[i + 2] = (luma + (b - luma) * c) * 255;
    }
    x.putImageData(img, 0, 0);
  };
  // Analyse : niveaux 0,5 % / 99,5 % par canal sur plusieurs images de l'événement
  FX.analyzeLevels = (images) => {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
    let total = 0;
    for (const im of images) {
      const iw = im.naturalWidth || im.videoWidth || im.width, ih = im.naturalHeight || im.videoHeight || im.height;
      if (!iw || !ih) continue;
      const k = Math.min(1, 160 / Math.max(iw, ih));
      c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
      x.drawImage(im, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) { hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; total++; }
    }
    if (!total) return null;
    const pct = (h, q) => { let acc = 0; const lim = total * q; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= lim) return v / 255; } return 1; };
    const out = {};
    ['r', 'g', 'b'].forEach((ch, i) => {
      let lo = pct(hist[i], 0.005), hi = pct(hist[i], 0.995);
      // garde-fous : pas de correction extrême sur une image volontairement sombre ou claire
      lo = Math.min(lo, 0.22); hi = Math.max(hi, 0.62);
      if (hi - lo < 0.4) { const m = (hi + lo) / 2; lo = m - 0.2; hi = m + 0.2; }
      out['l' + ch] = Math.round(lo * 1000) / 1000; out['h' + ch] = Math.round(hi * 1000) / 1000;
    });
    return out;
  };

  // Les effets « matrice » partagent l'aperçu SVG et le filtre colorchannelmixer
  for (const k in FX.VIDEO) {
    const d = FX.VIDEO[k];
    if (d.matrix) {
      d.svg = p => `<feColorMatrix type="matrix" values="${svgMatrix(d.matrix(p))}"/>`;
      d.ff = p => ccm(d.matrix(p));
    }
  }

  /* ============================================================ effets audio (pistes) */
  FX.AUDIO = {
    eq: {
      name: 'Égaliseur 3 bandes', icon: 'normalize',
      params: [
        { k: 'low', label: 'Graves', min: -18, max: 18, step: 0.5, def: 0, unit: ' dB' },
        { k: 'lowF', label: 'Fréq. graves', min: 40, max: 500, step: 1, def: 200, unit: ' Hz' },
        { k: 'mid', label: 'Médiums', min: -18, max: 18, step: 0.5, def: 0, unit: ' dB' },
        { k: 'midF', label: 'Fréq. médiums', min: 200, max: 5000, step: 10, def: 1000, unit: ' Hz' },
        { k: 'high', label: 'Aigus', min: -18, max: 18, step: 0.5, def: 0, unit: ' dB' },
        { k: 'highF', label: 'Fréq. aigus', min: 1500, max: 16000, step: 50, def: 5000, unit: ' Hz' },
      ],
      ff: p => `bass=g=${p.low}:f=${p.lowF}:w=0.7,equalizer=f=${p.midF}:t=q:w=1:g=${p.mid},treble=g=${p.high}:f=${p.highF}:w=0.7`,
      web: (ac, p) => {
        const a = ac.createBiquadFilter(); a.type = 'lowshelf'; a.frequency.value = p.lowF; a.gain.value = p.low;
        const b = ac.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = p.midF; b.Q.value = 1; b.gain.value = p.mid;
        const c = ac.createBiquadFilter(); c.type = 'highshelf'; c.frequency.value = p.highF; c.gain.value = p.high;
        a.connect(b); b.connect(c);
        return { input: a, output: c };
      },
    },
    comp: {
      name: 'Compresseur', icon: 'speed',
      params: [
        { k: 'threshold', label: 'Seuil', min: -60, max: 0, step: 0.5, def: -20, unit: ' dB' },
        { k: 'ratio', label: 'Rapport', min: 1, max: 20, step: 0.1, def: 4, unit: ':1' },
        { k: 'attack', label: 'Attaque', min: 1, max: 200, step: 1, def: 10, unit: ' ms' },
        { k: 'release', label: 'Relâchement', min: 10, max: 1000, step: 5, def: 200, unit: ' ms' },
        { k: 'makeup', label: 'Gain de sortie', min: 0, max: 24, step: 0.5, def: 0, unit: ' dB' },
      ],
      ff: p => `acompressor=threshold=${f4(U.dbToGain(p.threshold))}:ratio=${p.ratio}:attack=${p.attack}:release=${p.release}:makeup=${f4(Math.max(1, U.dbToGain(p.makeup)))}`,
      web: (ac, p) => {
        const c = ac.createDynamicsCompressor();
        c.threshold.value = p.threshold; c.ratio.value = p.ratio; c.knee.value = 2.8;
        c.attack.value = p.attack / 1000; c.release.value = p.release / 1000;
        const g = ac.createGain(); g.gain.value = U.dbToGain(p.makeup);
        c.connect(g);
        return { input: c, output: g };
      },
    },
    echo: {
      name: 'Écho', icon: 'refresh',
      params: [
        { k: 'delay', label: 'Retard', min: 20, max: 1500, step: 5, def: 320, unit: ' ms' },
        { k: 'feedback', label: 'Réinjection', min: 0, max: 0.9, step: 0.01, def: 0.35 },
        { k: 'mix', label: 'Mixage', min: 0, max: 1, step: 0.01, def: 0.35 },
      ],
      ff: p => {
        const taps = [1, 2, 3, 4, 5], d = taps.map(k => p.delay * k).join('|');
        const dec = taps.map(k => f4(Math.max(0.001, Math.min(1, p.mix * Math.pow(p.feedback, k - 1))))).join('|');
        return `aecho=1:1:${d}:${dec}`;
      },
      web: (ac, p) => {
        const input = ac.createGain(), out = ac.createGain();
        const dl = ac.createDelay(2); dl.delayTime.value = p.delay / 1000;
        const fb = ac.createGain(); fb.gain.value = p.feedback;
        const wet = ac.createGain(); wet.gain.value = p.mix;
        input.connect(out); input.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(out);
        return { input, output: out };
      },
    },
    hp: {
      name: 'Passe-haut', icon: 'audio',
      params: [{ k: 'f', label: 'Fréquence', min: 20, max: 2000, step: 1, def: 80, unit: ' Hz' }],
      ff: p => `highpass=f=${p.f}`,
      web: (ac, p) => { const b = ac.createBiquadFilter(); b.type = 'highpass'; b.frequency.value = p.f; b.Q.value = 0.707; return { input: b, output: b }; },
    },
    lp: {
      name: 'Passe-bas', icon: 'audio',
      params: [{ k: 'f', label: 'Fréquence', min: 200, max: 20000, step: 10, def: 8000, unit: ' Hz' }],
      ff: p => `lowpass=f=${p.f}`,
      web: (ac, p) => { const b = ac.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = p.f; b.Q.value = 0.707; return { input: b, output: b }; },
    },
  };

  FX.defaults = (def) => { const o = {}; for (const p of def.params) o.k = 0, o[p.k] = p.def; delete o.k; return o; };
  FX.make = (type, audio = false) => {
    const d = (audio ? FX.AUDIO : FX.VIDEO)[type];
    return { id: U.uid(), type, on: true, params: FX.defaults(d) };
  };
  FX.params = (fx, audio = false) => {
    const d = (audio ? FX.AUDIO : FX.VIDEO)[fx.type];
    return Object.assign(FX.defaults(d), fx.params || {});
  };

  /* ------------------------------------------------------------ aperçu : filtres SVG */
  const svgCache = new Map();
  let svgSeq = 0;
  FX.svgFilterId = (inner) => {
    let id = svgCache.get(inner);
    if (id) return id;
    id = 'kcf' + (++svgSeq);
    const defs = document.querySelector('#svg-filters defs');
    const f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', id);
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '1'); f.setAttribute('height', '1');
    f.innerHTML = inner;
    defs.appendChild(f);
    svgCache.set(inner, id);
    if (svgCache.size > 400) {
      // Nettoyage grossier : on repart de zéro (les filtres sont recréés à la demande)
      const keep = new Map([[inner, id]]);
      for (const [k, v] of svgCache) if (v !== id) { const el = document.getElementById(v); if (el) el.remove(); }
      svgCache.clear(); for (const [k, v] of keep) svgCache.set(k, v);
    }
    return id;
  };

  // Applique la chaîne d'effets à une source déjà dessinée dans `canvas` (taille de travail w×h).
  // srcH : hauteur de la source d'origine (pour les rayons exprimés « par 1080 lignes »).
  const tmpA = document.createElement('canvas'), tmpB = document.createElement('canvas');
  const fit = (c, w, hh) => { if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; } };
  const noiseC = document.createElement('canvas');
  FX.applyPreview = (canvas, fxList) => {
    const w = canvas.width, hh = canvas.height;
    const list = (fxList || []).filter(f => f.on !== false && FX.VIDEO[f.type]);
    if (!list.length) return canvas;
    let cur = canvas;
    let i = 0;
    const ctxOf = c => c.getContext('2d', { willReadFrequently: false });
    const swap = () => { const n = cur === tmpA ? tmpB : tmpA; fit(n, w, hh); const x = ctxOf(n); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'copy'; x.globalAlpha = 1; x.filter = 'none'; return { n, x }; };
    while (i < list.length) {
      // Regroupe les effets « filtre » consécutifs en un seul dessin
      const filters = [];
      let vib = 0;
      while (i < list.length) {
        const f = list[i], d = FX.VIDEO[f.type], p = FX.params(f);
        if (d.svg) {
          filters.push(`url(#${FX.svgFilterId(d.svg(p))})`);
          if (f.type === 'enhance' && Math.abs(p.vibrance) > 0.005) { vib = p.vibrance; i++; break; }
        }
        else if (f.type === 'blur') { const r = p.radius / 1080 * hh; if (r > 0.05) filters.push(`blur(${r.toFixed(2)}px)`); }
        else break;
        i++;
      }
      if (filters.length) {
        const { n, x } = swap();
        x.filter = filters.join(' ');
        x.drawImage(cur, 0, 0);
        x.filter = 'none'; x.globalCompositeOperation = 'source-over';
        if (vib) FX.vibrancePixels(x, w, hh, vib);
        cur = n;
        continue;
      }
      const f = list[i++], p = FX.params(f);
      const { n, x } = swap();
      x.drawImage(cur, 0, 0);
      x.globalCompositeOperation = 'source-over';
      if (f.type === 'mirror') {
        x.globalCompositeOperation = 'copy';
        x.setTransform(p.h ? -1 : 1, 0, 0, p.v ? -1 : 1, p.h ? w : 0, p.v ? hh : 0);
        x.drawImage(cur, 0, 0);
        x.setTransform(1, 0, 0, 1, 0, 0);
      } else if (f.type === 'mosaic') {
        const k = Math.max(1, p.size / 1080 * hh);
        const sw = Math.max(1, Math.round(w / k)), sh = Math.max(1, Math.round(hh / k));
        fit(noiseC, sw, sh);
        const nx = noiseC.getContext('2d'); nx.imageSmoothingEnabled = true; nx.clearRect(0, 0, sw, sh); nx.drawImage(cur, 0, 0, sw, sh);
        x.globalCompositeOperation = 'copy'; x.imageSmoothingEnabled = false; x.drawImage(noiseC, 0, 0, w, hh); x.imageSmoothingEnabled = true;
      } else if (f.type === 'vignette') {
        FX.drawVignette(x, w, hh, p);
      } else if (f.type === 'grain') {
        const a = p.amount / 255 * 1.6;
        const nw = Math.max(1, Math.round(w / 2)), nh = Math.max(1, Math.round(hh / 2));
        fit(noiseC, nw, nh);
        const nx = noiseC.getContext('2d');
        const id = nx.createImageData(nw, nh), d = id.data;
        for (let j = 0; j < d.length; j += 4) { const v = Math.random() * 255; d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255; }
        nx.putImageData(id, 0, 0);
        x.globalAlpha = Math.min(1, a); x.globalCompositeOperation = 'overlay';
        x.drawImage(noiseC, 0, 0, w, hh);
        x.globalAlpha = 1; x.globalCompositeOperation = 'destination-in'; x.drawImage(cur, 0, 0); x.globalCompositeOperation = 'source-over';
      } else if (f.type === 'glow') {
        x.globalCompositeOperation = 'screen'; x.globalAlpha = p.amount;
        x.filter = `blur(${(p.radius / 1080 * hh).toFixed(2)}px)`;
        x.drawImage(cur, 0, 0);
        x.filter = 'none'; x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      } else if (f.type === 'crop') {
        const l = Math.round(p.l * w), r = Math.round(p.r * w), t = Math.round(p.t * hh), b = Math.round(p.b * hh);
        x.clearRect(0, 0, l, hh); x.clearRect(w - r, 0, r, hh); x.clearRect(0, 0, w, t); x.clearRect(0, hh - b, w, b);
      } else if (f.type === 'chroma') {
        FX.chromaKey(x, w, hh, p);
      }
      cur = n;
    }
    return cur;
  };
  FX.vignetteGradient = (x, w, hh, p, op = 'source-over') => {
    const r = Math.hypot(w, hh) / 2;
    const g = x.createRadialGradient(w / 2, hh / 2, r * p.size * 0.45, w / 2, hh / 2, r * Math.max(p.size, 0.25) * 1.05);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${p.amount})`);
    x.save();
    x.globalCompositeOperation = op;
    x.fillStyle = g; x.fillRect(0, 0, w, hh);
    x.restore();
  };
  FX.drawVignette = (x, w, hh, p) => FX.vignetteGradient(x, w, hh, p, 'source-atop');
  // Même formule que le filtre chromakey de ffmpeg (distance dans le plan UV)
  FX.chromaKey = (x, w, hh, p) => {
    const img = x.getImageData(0, 0, w, hh), d = img.data;
    const [kr, kg, kb] = hexRgb(p.color);
    const ku = -0.169 * kr - 0.331 * kg + 0.5 * kb + 128, kv = 0.5 * kr - 0.419 * kg - 0.081 * kb + 128;
    const sim = p.sim, bl = p.blend;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const u = -0.169 * r - 0.331 * g + 0.5 * b + 128, v = 0.5 * r - 0.419 * g - 0.081 * b + 128;
      const du = u - ku, dv = v - kv;
      const diff = Math.sqrt((du * du + dv * dv) / (255 * 255 * 2)) * 1.0;
      let a;
      if (bl > 0.0001) a = Math.min(1, Math.max(0, (diff - sim) / bl)); else a = diff > sim ? 1 : 0;
      d[i + 3] = d[i + 3] * a;
    }
    x.putImageData(img, 0, 0);
  };

  /* ------------------------------------------------------------ rendu : chaîne ffmpeg d'un événement */
  // Retourne { chain: 'f1,f2,...', images: [{key, w, h, draw(ctx)}] } ; les images servent à la vignette.
  FX.ffChain = (fxList, c) => {
    const parts = [], images = [];
    let n = 0;
    for (const f of (fxList || [])) {
      if (f.on === false) continue;
      const d = FX.VIDEO[f.type]; if (!d) continue;
      const p = FX.params(f);
      if (f.type === 'vignette') {
        const key = 'vig' + (c.uid || '') + '_' + (n++);
        // Voile noir dont l'opacité suit le dégradé : superposé, il équivaut à la vignette de l'aperçu
        images.push({ key, w: c.srcW, h: c.srcH, draw: (x) => FX.vignetteGradient(x, c.srcW, c.srcH, p) });
        parts.push({ overlayImage: key });
        continue;
      }
      const s = d.ff(p, c);
      if (s && s.lut) parts.push({ lut: s.lut });
      else if (s) parts.push(s);
    }
    return { parts, images };
  };
  FX.ffAudioChain = (fxList) => (fxList || []).filter(f => f.on !== false && FX.AUDIO[f.type]).map(f => FX.AUDIO[f.type].ff(FX.params(f, true))).join(',');

  /* ============================================================ transitions */
  FX.TRANSITIONS = {
    dissolve: { name: 'Fondu enchaîné', desc: 'Fondu classique', anim: 'dissolve' },
    dip: { name: 'Fondu au noir', desc: 'Passe par le noir', anim: 'dip' },
    flash: { name: 'Fondu au blanc', desc: 'Flash lumineux', anim: 'flash' },
    'slide-l': { name: 'Glissement ←', desc: 'Entre par la droite', anim: 'slide-l' },
    'slide-r': { name: 'Glissement →', desc: 'Entre par la gauche', anim: 'slide-r' },
    'slide-u': { name: 'Glissement ↑', desc: 'Entre par le bas', anim: 'slide-u' },
    'slide-d': { name: 'Glissement ↓', desc: 'Entre par le haut', anim: 'slide-d' },
    'push-l': { name: 'Poussée ←', desc: 'Pousse le plan précédent', anim: 'push-l' },
    'push-r': { name: 'Poussée →', desc: 'Pousse le plan précédent', anim: 'push-r' },
    zoom: { name: 'Zoom avant', desc: 'Apparaît en grandissant', anim: 'zoom' },
  };
  // État de l'événement entrant B à la progression p (0→1) de sa transition
  FX.transIn = (type, p) => {
    p = U.clamp(p, 0, 1);
    switch (type) {
      case 'dip': return { alpha: p < 0.5 ? 0 : (p - 0.5) * 2, dx: 0, dy: 0, scale: 1 };
      case 'flash': return { alpha: p < 0.5 ? 0 : 1, dx: 0, dy: 0, scale: 1 };
      case 'slide-l': case 'push-l': return { alpha: 1, dx: 1 - p, dy: 0, scale: 1 };
      case 'slide-r': case 'push-r': return { alpha: 1, dx: -(1 - p), dy: 0, scale: 1 };
      case 'slide-u': return { alpha: 1, dx: 0, dy: 1 - p, scale: 1 };
      case 'slide-d': return { alpha: 1, dx: 0, dy: -(1 - p), scale: 1 };
      case 'zoom': return { alpha: Math.min(1, p * 2), dx: 0, dy: 0, scale: Math.max(0.001, p) };
      default: return { alpha: p, dx: 0, dy: 0, scale: 1 };
    }
  };
  // État de l'événement sortant A pendant la transition de B
  FX.transOut = (type, p) => {
    p = U.clamp(p, 0, 1);
    switch (type) {
      case 'dip': return { alpha: p < 0.5 ? 1 - p * 2 : 0, dx: 0 };
      case 'flash': return { alpha: p < 0.5 ? 1 : 0, dx: 0 };
      case 'push-l': return { alpha: 1, dx: -p };
      case 'push-r': return { alpha: 1, dx: p };
      default: return { alpha: 1, dx: 0 };
    }
  };
  // Voile blanc du « fondu au blanc » (0→1→0)
  FX.flashAlpha = p => p <= 0 || p >= 1 ? 0 : p < 0.5 ? p * 2 : (1 - p) * 2;

  /* ============================================================ générateurs de médias */
  FX.GENERATORS = {
    text: {
      name: 'Titres et texte', icon: 'text',
      def: () => ({
        type: 'text', text: 'Votre titre', font: 'Outfit', size: 0.09, bold: true, italic: false, color: '#ffffff',
        align: 'center', x: 0.5, y: 0.5, outline: 0, outlineColor: '#000000', shadow: true, shadowColor: '#000000',
        shadowBlur: 0.012, shadowOffset: 0.004, box: false, boxColor: '#000000', boxAlpha: 0.55, boxPad: 0.025,
        lineHeight: 1.15, spacing: 0, anim: 'none',
      }),
    },
    lower: {
      name: 'Bandeau (tiers inférieur)', icon: 'text',
      def: () => ({
        type: 'text', text: 'Prénom Nom\nFonction', font: 'Outfit', size: 0.05, bold: true, italic: false, color: '#ffffff',
        align: 'left', x: 0.08, y: 0.8, outline: 0, outlineColor: '#000000', shadow: false, shadowColor: '#000000',
        shadowBlur: 0.01, shadowOffset: 0.003, box: true, boxColor: '#1d2a44', boxAlpha: 0.85, boxPad: 0.022,
        lineHeight: 1.2, spacing: 0, anim: 'slide-left',
      }),
    },
    solid: { name: 'Couleur unie', icon: 'solid', def: () => ({ type: 'solid', color: '#3d7cf0' }) },
    gradient: { name: 'Dégradé', icon: 'gradient', def: () => ({ type: 'gradient', c1: '#1b2a6b', c2: '#d8487c', angle: 135, radial: false }) },
    checker: { name: 'Damier', icon: 'checker', def: () => ({ type: 'checker', c1: '#ffffff', c2: '#cccccc', size: 0.05 }) },
  };
  FX.genName = g => {
    if (!g) return 'Généré';
    if (g.type === 'text') return (String(g.text || '').split('\n')[0] || 'Texte').slice(0, 40);
    const d = FX.GENERATORS[g.type];
    return d ? d.name : 'Généré';
  };
  FX.textAnims = {
    none: 'Aucune', fade: 'Fondu', 'slide-up': 'Glisser depuis le bas', 'slide-left': 'Glisser depuis la gauche',
    'zoom-in': 'Zoom avant', 'zoom-out': 'Zoom arrière', 'pop': 'Rebond',
  };

  // Dessine le générateur sur un canevas W×H (transparent hors du contenu)
  FX.renderGen = (g, cv) => {
    const W = cv.width, H = cv.height, x = cv.getContext('2d');
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, W, H);
    if (g.type === 'solid') { x.fillStyle = g.color; x.fillRect(0, 0, W, H); }
    else if (g.type === 'gradient') {
      let gr;
      if (g.radial) gr = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
      else {
        const a = (g.angle - 90) * Math.PI / 180, r = (Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))) / 2;
        gr = x.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
      }
      gr.addColorStop(0, g.c1); gr.addColorStop(1, g.c2);
      x.fillStyle = gr; x.fillRect(0, 0, W, H);
    } else if (g.type === 'checker') {
      const s = Math.max(2, g.size * H);
      x.fillStyle = g.c1; x.fillRect(0, 0, W, H);
      x.fillStyle = g.c2;
      for (let yy = 0, r = 0; yy < H; yy += s, r++) for (let xx = (r % 2) * s; xx < W; xx += s * 2) x.fillRect(xx, yy, s, s);
    } else if (g.type === 'text') {
      FX.drawText(x, g, W, H);
    }
    x.restore();
  };
  FX.drawText = (x, g, W, H) => {
    const size = Math.max(4, g.size * H);
    x.font = `${g.italic ? 'italic ' : ''}${g.bold ? '700' : '400'} ${size}px "${g.font}", "Outfit", "Segoe UI", sans-serif`;
    try { x.letterSpacing = (g.spacing * size).toFixed(1) + 'px'; } catch { /* ancien moteur */ }
    x.textBaseline = 'middle';
    const lines = String(g.text || '').split('\n');
    const lh = size * g.lineHeight;
    const widths = lines.map(l => x.measureText(l).width);
    const bw = Math.max(1, ...widths), bh = lh * lines.length;
    const cx = g.x * W, cy = g.y * H;
    const left = g.align === 'left' ? cx : g.align === 'right' ? cx - bw : cx - bw / 2;
    const top = cy - bh / 2;
    if (g.box) {
      const pad = g.boxPad * H;
      x.save();
      x.globalAlpha = g.boxAlpha;
      x.fillStyle = g.boxColor;
      const r = Math.min(pad, 14 * H / 1080);
      x.beginPath();
      x.roundRect(left - pad * 1.4, top - pad, bw + pad * 2.8, bh + pad * 2, r);
      x.fill();
      x.restore();
    }
    x.textAlign = g.align === 'left' ? 'left' : g.align === 'right' ? 'right' : 'center';
    const ax = g.align === 'left' ? left : g.align === 'right' ? left + bw : left + bw / 2;
    lines.forEach((l, i) => {
      const yy = top + lh * (i + 0.5);
      if (g.shadow) {
        x.save();
        x.shadowColor = g.shadowColor; x.shadowBlur = g.shadowBlur * H; x.shadowOffsetX = g.shadowOffset * H; x.shadowOffsetY = g.shadowOffset * H;
        x.fillStyle = g.color; x.fillText(l, ax, yy);
        x.restore();
      }
      if (g.outline > 0) {
        x.save();
        x.lineJoin = 'round'; x.miterLimit = 2;
        x.lineWidth = g.outline * H * 2; x.strokeStyle = g.outlineColor;
        x.strokeText(l, ax, yy);
        x.restore();
      }
      x.fillStyle = g.color;
      x.fillText(l, ax, yy);
    });
  };
  // Une animation de texte se traduit en images-clés de panoramique + fondus
  FX.applyTextAnim = (ev, anim) => {
    const L = ev.length, d = Math.min(0.8, L / 3);
    ev.gen.anim = anim;
    const base = { cx: 0.5, cy: 0.5, zoom: 1, rot: 0, ease: 'smooth' };
    ev.pc = null;
    ev.fadeIn = 0; ev.fadeOut = 0;
    if (anim === 'fade') { ev.fadeIn = d; ev.fadeOut = d; }
    else if (anim === 'slide-up') { ev.pc = { kf: [{ ...base, t: 0, cy: 0.35 }, { ...base, t: d }] }; ev.fadeIn = d * 0.8; ev.fadeOut = d * 0.6; }
    else if (anim === 'slide-left') { ev.pc = { kf: [{ ...base, t: 0, cx: 0.75 }, { ...base, t: d }] }; ev.fadeIn = d * 0.7; ev.fadeOut = d * 0.6; }
    else if (anim === 'zoom-in') { ev.pc = { kf: [{ ...base, t: 0, zoom: 0.6 }, { ...base, t: d }] }; ev.fadeIn = d; ev.fadeOut = d * 0.6; }
    else if (anim === 'zoom-out') { ev.pc = { kf: [{ ...base, t: 0, zoom: 1.6 }, { ...base, t: d }] }; ev.fadeIn = d; ev.fadeOut = d * 0.6; }
    else if (anim === 'pop') { ev.pc = { kf: [{ ...base, t: 0, zoom: 0.4 }, { ...base, t: d * 0.6, zoom: 1.12 }, { ...base, t: d }] }; ev.fadeIn = d * 0.4; ev.fadeOut = d * 0.5; }
  };

  /* ============================================================ panoramique / recadrage */
  // Image-clé : cx, cy = point de la source (0-1) placé au centre de la sortie ; zoom (1 = ajusté) ; rot (degrés)
  FX.pcDefault = () => ({ t: 0, cx: 0.5, cy: 0.5, zoom: 1, rot: 0, ease: 'linear' });
  FX.EASES = { linear: 'Linéaire', smooth: 'Lisse', fast: 'Rapide', slow: 'Lent', hold: 'Maintien' };
  const ease = (e, p) => {
    switch (e) {
      case 'smooth': return p * p * (3 - 2 * p);
      case 'fast': return 1 - (1 - p) * (1 - p);
      case 'slow': return p * p;
      case 'hold': return 0;
      default: return p;
    }
  };
  FX.pcAt = (pc, t) => {
    const kf = pc && pc.kf && pc.kf.length ? pc.kf : [FX.pcDefault()];
    if (kf.length === 1 || t <= kf[0].t) return { ...FX.pcDefault(), ...kf[0], t };
    const last = kf[kf.length - 1];
    if (t >= last.t) return { ...FX.pcDefault(), ...last, t };
    for (let i = 0; i < kf.length - 1; i++) {
      const a = kf[i], b = kf[i + 1];
      if (t >= a.t && t <= b.t) {
        const p = ease(a.ease || 'linear', (t - a.t) / Math.max(1e-6, b.t - a.t));
        return { t, cx: U.lerp(a.cx, b.cx, p), cy: U.lerp(a.cy, b.cy, p), zoom: U.lerp(a.zoom, b.zoom, p), rot: U.lerp(a.rot, b.rot, p), ease: a.ease };
      }
    }
    return { ...last, t };
  };
  FX.pcIsIdentity = pc => {
    if (!pc || !pc.kf || !pc.kf.length) return true;
    return pc.kf.every(k => Math.abs(k.cx - 0.5) < 1e-6 && Math.abs(k.cy - 0.5) < 1e-6 && Math.abs(k.zoom - 1) < 1e-6 && Math.abs(k.rot) < 1e-6);
  };
  FX.pcAnimated = pc => !!(pc && pc.kf && pc.kf.length > 1);
  // Expression ffmpeg d'une propriété des images-clés en fonction de la variable de temps `tv`
  FX.pcExpr = (pc, prop, tv) => {
    const kf = pc && pc.kf && pc.kf.length ? pc.kf : [FX.pcDefault()];
    const v = k => f4(k[prop]);
    if (kf.length === 1) return v(kf[0]);
    let expr = v(kf[kf.length - 1]);
    for (let i = kf.length - 2; i >= 0; i--) {
      const a = kf[i], b = kf[i + 1], d = Math.max(1e-6, b.t - a.t);
      const p = `((${tv}-${f4(a.t)})/${f4(d)})`;
      let e;
      switch (a.ease) {
        case 'smooth': e = `(${p}*${p}*(3-2*${p}))`; break;
        case 'fast': e = `(1-(1-${p})*(1-${p}))`; break;
        case 'slow': e = `(${p}*${p})`; break;
        case 'hold': e = '0'; break;
        default: e = p;
      }
      expr = `if(lt(${tv}\\,${f4(b.t)})\\,${v(a)}+(${f4(b[prop] - a[prop])})*${e}\\,${expr})`;
    }
    return `if(lt(${tv}\\,${f4(kf[0].t)})\\,${v(kf[0])}\\,${expr})`;
  };
  FX.f4 = f4;
})();
