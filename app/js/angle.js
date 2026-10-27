// Angle : changer l'angle de vue d'une image. Le relief est calculé sur la carte graphique (Depth Anything V2,
// ONNX local), l'image devient un relief 3D texturé que l'on regarde d'un autre point de vue ; les zones
// découvertes (derrière un bord, hors du cadre, surfaces trop étirées) sont repeintes par Forge (ANIMA),
// puis seule cette zone est fondue dans le rendu : le reste du dessin garde ses pixels d'origine.
'use strict';
(() => {
  const U = KS.util, h = KS.h, N = KS.native, G = KS.gen;
  const D = () => KS.state.doc;
  const F = () => KS.fxui;
  const FOV = 40; // champ de vision supposé de l'image d'origine (degrés, vertical)

  /* ---------------------------------------------------------------- réglages mémorisés */
  const DEF = { v: 1, yaw: 0, pitch: 0, zoom: 1, relief: 1, edge: 0.05, strength: 1, count: 2, unify: 0.2, showMask: true, prompt: '' };
  const P = Object.assign({}, DEF, KS.prefs.angle && KS.prefs.angle.v === 1 ? KS.prefs.angle : {});
  const save = U.debounce(() => { KS.prefs.angle = P; KS.prefs.save(); }, 400);

  let T = null, Orbit = null, loading = null;
  const S = {
    src: null, name: '', info: '', depth: null, renderer: null, scene: null, camera: null, orbit: null, mesh: null, pivot: null,
    matView: null, matMask: null, result: null, dirty: true, busy: false, holes: 0,
  };
  let root = null, view = null, side = null, ro = null, raf = 0;

  function load() {
    if (!loading) loading = (async () => {
      T = await import('../vendor/three/three.module.min.js');
      Orbit = (await import('../vendor/three/OrbitControls.js')).OrbitControls;
    })().catch(e => { loading = null; throw e; });
    return loading;
  }

  /* ---------------------------------------------------------------- relief (Depth Anything V2) */
  let depthOk = false;
  async function depthReady() {
    if (depthOk) return true;
    if (!N || !N.aiDepth) return false;
    const m = (await N.aiStatus()).find(x => x.id === 'depth');
    if (!m) return false;
    if (m.installed) return (depthOk = true);
    const id = await KS.ai.downloadDialog([m], {
      title: 'Télécharger le modèle de relief',
      text: 'L’outil Angle calcule le relief de l’image avec Depth Anything V2 Large (1,3 Go, usage personnel), entièrement sur votre PC, avec la carte graphique. Il faut le télécharger une fois depuis Hugging Face.',
    });
    return (depthOk = !!id);
  }
  // Disparité normalisée 0 (loin) … 1 (proche), à la taille de travail du modèle
  async function computeDepth(src) {
    const k = 994 / Math.max(src.width, src.height);
    const w = Math.max(14, Math.round(src.width * k / 14) * 14), hh = Math.max(14, Math.round(src.height * k / 14) * 14);
    const c = U.canvas(w, hh), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, hh);
    const px = x.getImageData(0, 0, w, hh).data, n = w * hh, input = new Float32Array(3 * n);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) input[ch * n + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
    const r = await N.aiDepth(input, w, hh);
    if (!r.ok) throw new Error(r.error);
    const dims = r.dims, ow = dims[dims.length - 1], oh = dims[dims.length - 2], d = r.depth;
    const sample = []; for (let i = 0; i < d.length; i += 7) sample.push(d[i]);
    sample.sort((a, b) => a - b);
    const lo = sample[Math.floor(sample.length * 0.01)], hi = sample[Math.floor(sample.length * 0.995)], s = 1 / ((hi - lo) || 1);
    const out = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) out[i] = U.clamp((d[i] - lo) * s, 0, 1);
    return { d: out, w: ow, h: oh, ep: r.ep };
  }

  /* ---------------------------------------------------------------- relief 3D */
  // Grille de sommets sur toute l'image ; les quadrilatères qui enjambent un bord net de relief sont retirés.
  function gridOf() {
    const src = S.src, k = Math.min(1, 1024 / Math.max(src.width, src.height));
    const gw = Math.max(2, Math.round(src.width * k)) + 1, gh = Math.max(2, Math.round(src.height * k)) + 1;
    const { d, w, h: dh } = S.depth, g = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const fx = i / (gw - 1) * (w - 1), fy = j / (gh - 1) * (dh - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(dh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      g[j * gw + i] = (d[y0 * w + x0] * (1 - ax) + d[y0 * w + x1] * ax) * (1 - ay) + (d[y1 * w + x0] * (1 - ax) + d[y1 * w + x1] * ax) * ay;
    }
    // bords du relief rendus nets : près d'un saut, chaque point rejoint le côté le plus proche
    const sharp = new Float32Array(g), R = 2;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      let mn = 1, mx = 0;
      for (let y = Math.max(0, j - R); y <= Math.min(gh - 1, j + R); y++) for (let x = Math.max(0, i - R); x <= Math.min(gw - 1, i + R); x++) { const v = g[y * gw + x]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mx - mn > 0.06) { const v = g[j * gw + i]; sharp[j * gw + i] = v - mn < mx - v ? mn : mx; }
    }
    return { g: sharp, gw, gh };
  }
  const zOf = (v, zf) => 1 / (v * (1 - 1 / zf) + 1 / zf);
  function buildMesh() {
    const { g, gw, gh } = S.grid, n = gw * gh, zf = 1 + 0.8 * P.relief;
    const t = Math.tan(FOV * Math.PI / 360), aspect = S.src.width / S.src.height;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const p = j * gw + i, u = i / (gw - 1), v = j / (gh - 1), z = zOf(g[p], zf);
      pos[p * 3] = (u * 2 - 1) * t * aspect * z; pos[p * 3 + 1] = (1 - v * 2) * t * z; pos[p * 3 + 2] = -z;
      uv[p * 2] = u; uv[p * 2 + 1] = 1 - v;
    }
    const idx = new Uint32Array((gw - 1) * (gh - 1) * 6); let m = 0;
    const tau = P.edge;
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = j * gw + i, b = a + 1, c = a + gw, e = c + 1;
      const mn = Math.min(g[a], g[b], g[c], g[e]), mx = Math.max(g[a], g[b], g[c], g[e]);
      if (mx - mn > tau) continue;
      idx[m++] = a; idx[m++] = c; idx[m++] = b; idx[m++] = b; idx[m++] = c; idx[m++] = e;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(new T.BufferAttribute(idx.subarray(0, m), 1));
    if (S.mesh) { S.mesh.geometry.dispose(); S.mesh.geometry = geo; }
    else { S.mesh = new T.Mesh(geo, S.matView); S.mesh.frustumCulled = false; S.scene.add(S.mesh); }
    // pivot : profondeur médiane du sujet (la partie la plus proche de l'image)
    const near = []; for (let p = 0; p < n; p += 3) if (g[p] > 0.55) near.push(g[p]);
    near.sort((a, b) => a - b);
    const zp = zOf(near.length > 50 ? near[near.length >> 1] : 0.5, zf);
    S.pivot = V(0, 0, -zp);
    S.dirty = true;
  }
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  // Étirement : plus petite valeur singulière du passage pixel → texel, rapportée à celle de la vue d'origine
  const STRETCH = `uniform vec2 texSize; uniform float base; varying vec2 vUv;
    float stretched() { vec2 a = dFdx(vUv * texSize), b = dFdy(vUv * texSize); float mx = max(length(a), length(b)); float det = abs(a.x * b.y - a.y * b.x);
      return (det / max(mx, 1e-6)) / base < 0.42 ? 1.0 : 0.0; }`;
  function materials() {
    const tex = new T.CanvasTexture(S.src);
    tex.colorSpace = T.NoColorSpace; tex.minFilter = T.LinearMipmapLinearFilter; tex.magFilter = T.LinearFilter; tex.anisotropy = 8; tex.generateMipmaps = true;
    const uniforms = () => ({ map: { value: tex }, texSize: { value: new T.Vector2(S.src.width, S.src.height) }, base: { value: 1 }, showMask: { value: P.showMask ? 1 : 0 } });
    S.tex && S.tex.dispose(); S.tex = tex;
    S.matView = new T.ShaderMaterial({ uniforms: uniforms(), vertexShader: VERT, side: T.DoubleSide,
      fragmentShader: `uniform sampler2D map; uniform float showMask; ${STRETCH}
        void main() { vec4 c = texture2D(map, vUv); float s = stretched() * showMask; gl_FragColor = vec4(mix(c.rgb, vec3(1.0, 0.1, 0.75), s * 0.6), 1.0); }` });
    S.matColor = new T.ShaderMaterial({ uniforms: uniforms(), vertexShader: VERT, side: T.DoubleSide,
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }' });
    S.matMask = new T.ShaderMaterial({ uniforms: uniforms(), vertexShader: VERT, side: T.DoubleSide,
      fragmentShader: `${STRETCH} void main() { gl_FragColor = vec4(vec3(stretched()), 1.0); }` });
    if (S.mesh) S.mesh.material = S.matView;
  }

  /* ---------------------------------------------------------------- caméra */
  function setupScene() {
    const r = S.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.domElement.className = 'ag-gl'; r.domElement.tabIndex = 0;
    S.scene = new T.Scene();
    S.camera = new T.PerspectiveCamera(FOV, 1, 0.02, 100);
    const o = S.orbit = new Orbit(S.camera, r.domElement);
    o.enableDamping = false; o.screenSpacePanning = true; o.rotateSpeed = 0.45; o.zoomSpeed = 0.6;
    o.addEventListener('change', () => { readCamera(); S.dirty = true; });
    o.addEventListener('end', () => { S.result = null; renderSide(); });
  }
  const RAD = Math.PI / 180;
  // Place la caméra autour du pivot (lacet, tangage, distance relative)
  function applyCamera() {
    if (!S.pivot) return;
    const zp = -S.pivot.z, d = zp / P.zoom, a = P.yaw * RAD, e = P.pitch * RAD;
    S.orbit.target.copy(S.pivot);
    S.camera.position.set(S.pivot.x + Math.sin(a) * Math.cos(e) * d, S.pivot.y + Math.sin(e) * d, S.pivot.z + Math.cos(a) * Math.cos(e) * d);
    S.orbit.minAzimuthAngle = -50 * RAD; S.orbit.maxAzimuthAngle = 50 * RAD;
    S.orbit.minPolarAngle = 50 * RAD; S.orbit.maxPolarAngle = 130 * RAD;
    S.orbit.minDistance = zp * 0.45; S.orbit.maxDistance = zp * 2.2;
    S.orbit.update(); S.dirty = true;
  }
  function readCamera() {
    if (!S.pivot) return;
    const v = S.camera.position.clone().sub(S.orbit.target), d = v.length();
    P.yaw = Math.round(Math.atan2(v.x, v.z) / RAD * 10) / 10; P.pitch = Math.round(Math.asin(U.clamp(v.y / d, -1, 1)) / RAD * 10) / 10;
    P.zoom = Math.round(-S.pivot.z / d * 100) / 100; save();
    if (side) for (const k of ['yaw', 'pitch', 'zoom']) { const el = side.querySelector(`[data-k="${k}"]`); if (el && el.set) el.setQuiet(P[k]); }
  }

  /* ---------------------------------------------------------------- rendus du nouvel angle */
  let R2 = null;
  function pass(mat, clear) {
    const w = S.src.width, hh = S.src.height;
    if (!R2) R2 = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    R2.setPixelRatio(1); R2.setSize(w, hh, false);
    const cam = S.camera.clone(); cam.aspect = w / hh; cam.updateProjectionMatrix();
    mat.uniforms.base.value = 1;
    S.mesh.material = mat;
    R2.setClearColor(clear, clear === 0xffffff ? 1 : 0);
    R2.render(S.scene, cam);
    S.mesh.material = S.matView;
    const c = U.canvas(w, hh); c.getContext('2d').drawImage(R2.domElement, 0, 0);
    return c;
  }
  // Rendu du nouvel angle + masque alpha des zones à repeindre (trous, bords du cadre, étirements)
  function renderView() {
    const color = pass(S.matColor, 0x000000), m = pass(S.matMask, 0xffffff);
    const w = color.width, hh = color.height, cd = U.getData(color), md = U.getData(m), mask = new ImageData(w, hh);
    let holes = 0;
    for (let i = 0; i < w * hh; i++) {
      const hole = cd.data[i * 4 + 3] < 250 || md.data[i * 4] > 127;
      if (hole) { mask.data[i * 4 + 3] = 255; holes++; }
    }
    const alpha = U.canvas(w, hh); U.putData(alpha, mask);
    return { color, mask: dilate(alpha, 4), holes: holes / (w * hh) };
  }
  const dilate = (m, r) => {
    const b = U.blurCanvas(m, r), d = U.getData(b), px = d.data;
    for (let i = 3; i < px.length; i += 4) px[i] = px[i] > 10 ? 255 : 0;
    U.putData(b, d); return b;
  };
  // Pré-remplissage des trous par pyramide « push-pull » (couleurs voisines diffusées) : Forge part de cette base
  function pushPull(color, mask) {
    const w = color.width, hh = color.height, cd = U.getData(color).data, md = U.getData(mask).data;
    let lv = { w, h: hh, c: new Float32Array(w * hh * 4) };
    for (let i = 0; i < w * hh; i++) { const a = md[i * 4 + 3] > 127 ? 0 : 1; for (let k = 0; k < 3; k++) lv.c[i * 4 + k] = cd[i * 4 + k] * a; lv.c[i * 4 + 3] = a; }
    const levels = [lv];
    while (lv.w > 1 || lv.h > 1) {
      const nw = Math.max(1, lv.w >> 1), nh = Math.max(1, lv.h >> 1), c = new Float32Array(nw * nh * 4);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const o = (y * nw + x) * 4;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const s = (Math.min(lv.h - 1, y * 2 + dy) * lv.w + Math.min(lv.w - 1, x * 2 + dx)) * 4;
          for (let k = 0; k < 4; k++) c[o + k] += lv.c[s + k];
        }
        const wt = c[o + 3]; if (wt > 1) for (let k = 0; k < 4; k++) c[o + k] /= wt; // couleur prémultipliée, poids ≤ 1
      }
      lv = { w: nw, h: nh, c }; levels.push(lv);
    }
    const top = levels[levels.length - 1].c; if (top[3] > 0) { for (let k = 0; k < 3; k++) top[k] /= top[3]; } top[3] = 1;
    for (let l = levels.length - 2; l >= 0; l--) {
      const a = levels[l], b = levels[l + 1];
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
        const o = (y * a.w + x) * 4, wa = a.c[o + 3];
        if (wa >= 1) continue;
        const s = (Math.min(b.h - 1, y >> 1) * b.w + Math.min(b.w - 1, x >> 1)) * 4;
        for (let k = 0; k < 3; k++) a.c[o + k] += (1 - wa) * b.c[s + k];
        a.c[o + 3] = 1;
      }
    }
    const out = new ImageData(w, hh), c0 = levels[0].c;
    for (let i = 0; i < w * hh * 4; i++) out.data[i] = (i & 3) === 3 ? 255 : c0[i];
    const c = U.canvas(w, hh); U.putData(c, out); return c;
  }
  // Résultat final : le rendu du nouvel angle, la génération seulement dans les zones repeintes (fondue)
  function compose(color, gen, mask) {
    const w = color.width, hh = color.height, out = U.canvas(w, hh), x = out.getContext('2d');
    x.drawImage(gen, 0, 0, w, hh);
    const soft = U.blurCanvas(mask, 3), keep = U.copyCanvas(color), kx = keep.getContext('2d');
    kx.globalCompositeOperation = 'destination-out'; kx.drawImage(soft, 0, 0);
    x.drawImage(keep, 0, 0);
    return out;
  }

  /* ---------------------------------------------------------------- génération (Forge) */
  const promptOf = info => String(info || '').split(/\nNegative prompt:|\nSteps:/)[0].trim();
  async function generate() {
    if (!S.src || !S.mesh || S.busy) return;
    const prompt = (P.prompt || '').trim();
    if (!prompt) return KS.toast('Décrivez l’image (ou reprenez l’invite de l’image) : Forge s’en sert pour repeindre les zones découvertes', 'info', 5000);
    const forge = await G.forge(true);
    if (!forge) return KS.toast(G.forgeError(), 'err', 5000);
    S.busy = true; renderSide();
    try {
      const v = renderView();
      const W = v.color.width, H = v.color.height, B = { x: 0, y: 0, w: W, h: H };
      const fromInfo = S.info && promptOf(S.info) === prompt;
      // taille de l'image (jusqu'à 2,2 Mpx) : Forge repeint au même niveau de détail que le dessin
      const st = { ...G.settings(), strength: P.strength, count: P.count, maskBlur: 4, fill: 1, usePrefix: !fromInfo, megapixels: U.clamp(W * H / 1048576, 0.6, 2.2) };
      const pp = await G.preparePrompt(prompt, forge, st);
      let res = { variants: [v.color] };
      if (v.holes > 0.0005) res = await G.forgeGenerate(pushPull(v.color, v.mask), v.mask, B, { ...st, ...pp }, true);
      let out = res.variants.map(g => compose(v.color, g, v.mask));
      if (P.unify > 0) {
        const all = U.canvas(W, H); const ax = all.getContext('2d'); ax.fillStyle = '#000'; ax.fillRect(0, 0, W, H);
        const again = [];
        for (const c of out) again.push(compose(c, (await G.forgeGenerate(c, all, B, { ...st, ...pp, strength: P.unify, count: 1, maskBlur: 0 }, true)).variants[0], all));
        out = again;
      }
      S.result = { variants: out, i: 0, info: (res.infos && res.infos[0]) || S.info, holes: v.holes };
      if (pp.shown !== prompt) KS.toast('Envoyé à Forge : « ' + pp.shown.slice(0, 120) + ' »', 'info', 4000);
    } catch (e) { KS.toast('Génération impossible : ' + e.message, 'err', 6000); }
    S.busy = false; renderSide(); showResult();
  }
  function showResult() {
    if (!view) return;
    const img = view.querySelector('.ag-res');
    const r = S.result, c = r && r.variants[r.i];
    img.hidden = !c || S.before;
    if (c) img.src = c.toDataURL('image/jpeg', 0.92);
    S.renderer.domElement.style.visibility = c && !S.before ? 'hidden' : '';
  }
  const current = () => S.result ? S.result.variants[S.result.i] : null;

  /* ---------------------------------------------------------------- image source */
  async function setSource(canvas, name, info) {
    if (!canvas) return;
    if (!(await depthReady())) return;
    S.busy = true; S.result = null; renderSide(); showResult();
    try {
      const k = Math.min(1, 2048 / Math.max(canvas.width, canvas.height));
      S.src = k < 1 ? scaled(canvas, Math.round(canvas.width * k), Math.round(canvas.height * k)) : U.copyCanvas(canvas);
      S.name = name || 'Image'; S.info = info || '';
      if (S.info && !P.prompt) P.prompt = promptOf(S.info);
      else if (S.info) P.prompt = promptOf(S.info);
      S.depth = await G.task('Calcul du relief…', () => computeDepth(S.src));
      S.grid = gridOf();
      materials(); buildMesh();
      P.yaw = 0; P.pitch = 0; P.zoom = 1; save();
      layout(); applyCamera();
    } catch (e) { KS.toast('Relief impossible : ' + e.message, 'err', 6000); S.src = null; }
    S.busy = false; renderSide();
  }
  const scaled = (src, w, hh) => { const c = U.canvas(w, hh), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, hh); return c; };
  async function fromDoc() { const d = D(); if (!d) return KS.toast('Aucun document ouvert dans Retouche', 'info'); await setSource(d.composite(), d.name, d.genInfo); }
  async function fromFile(entry) {
    if (!entry) {
      const files = N && N.openDialog ? await N.openDialog({ title: 'Image à tourner', multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] }) : null;
      entry = files && files[0]; if (!entry) return;
    }
    const canvas = await KS.io.canvasFromEntry(entry);
    let info = ''; try { info = (await KS.png.readText(new Uint8Array(entry.data))).parameters || ''; } catch { /* pas un PNG */ }
    await setSource(canvas, entry.name, info);
  }
  async function fromStudio() {
    const it = KS.studioApi && KS.studioApi.selected();
    if (!it) return KS.toast('Aucune image générée dans Créer', 'info');
    await setSource(it.canvas, it.name || 'Image du Studio', it.info);
  }

  /* ---------------------------------------------------------------- envoi du résultat */
  async function send(target) {
    const c = current() || (S.mesh ? renderView().color : null); if (!c) return;
    const info = S.result ? S.result.info : S.info;
    if (target === 'layer') {
      const d = D(); if (!d) return KS.toast('Aucun document ouvert', 'info');
      KS.io.placeCanvas(d, c.width === d.width && c.height === d.height ? U.copyCanvas(c) : scaled(c, d.width, d.height), 'Nouvel angle', { x: 0, y: 0 });
      await KS.cmd.toggleStudio(false); return KS.toast('Ajouté en calque à « ' + d.name + ' »', 'ok', 1800);
    }
    if (target === 'save') {
      const p = await N.saveDialog({ title: 'Enregistrer le nouvel angle', defaultPath: 'angle.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (!p) return;
      let bytes = new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer());
      if (info) bytes = KS.png.writeText(bytes, 'parameters', info);
      await N.writeFile(p, bytes); return KS.toast('Enregistrée', 'ok', 1200);
    }
    KS.studioApi.sendCanvas(c, info, target);
  }

  /* ---------------------------------------------------------------- interface */
  function layout() {
    if (!view || !S.renderer) return;
    const box = view.getBoundingClientRect(), w = S.src ? S.src.width : 832, hh = S.src ? S.src.height : 1216;
    if (box.width < 10 || box.height < 10) return;
    const k = Math.min(box.width / w, box.height / hh), W = Math.floor(w * k), H = Math.floor(hh * k);
    const frame = view.querySelector('.ag-frame'); frame.style.width = W + 'px'; frame.style.height = H + 'px';
    S.renderer.setSize(W, H, true);
    S.camera.aspect = W / H; S.camera.updateProjectionMatrix();
    S.dirty = true;
  }
  function loop() {
    raf = 0;
    if (!root || !root.isConnected) return;
    if (S.dirty && S.mesh) {
      S.dirty = false;
      S.matView.uniforms.base.value = S.src.width / S.renderer.domElement.width;
      S.matView.uniforms.showMask.value = P.showMask ? 1 : 0;
      S.renderer.setClearColor(0x000000, 0); S.renderer.render(S.scene, S.camera);
    }
    raf = requestAnimationFrame(loop);
  }
  const VIEWS = [['Face', 0, 0], ['¾ gauche', -30, 0], ['¾ droite', 30, 0], ['Plongée', 0, 22], ['Contre-plongée', 0, -18], ['Un peu à gauche', -14, 4], ['Un peu à droite', 14, 4]];
  function renderSide() {
    if (!side) return;
    const { tbtn, slider } = F();
    const sc = side.scrollTop;
    const chip = (text, on, fn, tip = '') => { const b = h('button.fx-chip' + (on ? '.on' : ''), { text, title: tip }); b.addEventListener('click', fn); return b; };
    const sec = (title, ...kids) => h('div.fx-panel.ag-sec', h('div.fx-h', { text: title }), ...kids.filter(Boolean));
    const live = (label, k, a, b, step, tip) => {
      const el = slider(label, P, k, a, b, step, tip, () => { save(); S.result = null; showResult(); applyCamera(); });
      el.dataset.k = k;
      const num = el.querySelector('.fx-num'), rng = el.querySelector('.fx-rng');
      el.setQuiet = v => { num.value = v; rng.value = v; rng.style.setProperty('--p', ((U.clamp(v, a, b) - a) / (b - a) * 100) + '%'); };
      return el;
    };
    const src = sec('Image',
      h('div.fx-info', { text: S.src ? `${S.name} · ${S.src.width} × ${S.src.height}` : 'Choisissez l’image dont vous voulez changer l’angle. Son relief est calculé une fois (quelques secondes).' }),
      h('div.ag-row', tbtn('Depuis Retouche', fromDoc, '.sm'), tbtn('Importer…', () => fromFile(), '.sm'), tbtn('Dernière image créée', fromStudio, '.sm')));
    const blocks = [src];
    if (S.src && S.mesh) {
      blocks.push(sec('Angle',
        h('div.ag-row', ...VIEWS.map(([l, y, p]) => chip(l, Math.abs(P.yaw - y) < 0.6 && Math.abs(P.pitch - p) < 0.6, () => { P.yaw = y; P.pitch = p; P.zoom = 1; save(); S.result = null; showResult(); applyCamera(); renderSide(); }))),
        live('Tourner (gauche ↔ droite)', 'yaw', -50, 50, 0.5, 'Au-delà de 25° environ, le relief s’étire et Forge doit inventer davantage'),
        live('Incliner (plongée ↔ contre-plongée)', 'pitch', -40, 40, 0.5),
        live('Rapprocher', 'zoom', 0.5, 2, 0.01),
        slider('Relief', P, 'relief', 0.2, 2.5, 0.05, 'Écart de profondeur entre le sujet et le fond. Plus fort : plus de volume, plus de zones à repeindre.', () => { save(); buildMesh(); applyCamera(); S.result = null; showResult(); }),
        h('label.fx-check', (() => { const i = h('input', { type: 'checkbox', checked: !!P.showMask }); i.addEventListener('change', () => { P.showMask = i.checked; save(); S.dirty = true; }); return i; })(), h('span', { text: 'Montrer les zones à repeindre (rose, damier)' })),
        h('div.fx-info', { text: 'Glisser dans l’image : tourner · molette : rapprocher · clic droit : décaler.' })));
      const ta = h('textarea.fx-ta.fx-small', { rows: 4, spellcheck: false, placeholder: 'Ce que montre l’image (en français ou en anglais)' });
      ta.value = P.prompt || ''; ta.addEventListener('input', () => { P.prompt = ta.value; save(); });
      ta.addEventListener('keydown', e => e.stopPropagation());
      blocks.push(sec('Repeindre les zones découvertes',
        F().field('Invite' + (S.info ? ' (reprise de l’image)' : ''), ta),
        slider('Force', P, 'strength', 0.5, 1, 0.01, 'Proche de 1 : Forge invente librement dans les zones découvertes', () => save()),
        slider('Variantes', P, 'count', 1, 4, 1, '', () => save()),
        slider('Unifier le dessin', P, 'unify', 0, 0.5, 0.01, '0 : le reste de l’image garde ses pixels. Au-dessus : Forge repasse légèrement sur toute l’image pour effacer l’effet de relief (le visage se redessine à l’angle).', () => save()),
        h('div.ag-row', tbtn(S.busy ? 'Génération…' : 'Générer le nouvel angle', generate, '.primary.ag-go'))));
    }
    if (S.result) {
      const r = S.result;
      blocks.push(sec('Résultat',
        h('div.fx-info', { text: `Variante ${r.i + 1} / ${r.variants.length} · ${(r.holes * 100).toFixed(1)} % de l’image repeinte` }),
        h('div.ag-row', r.variants.length > 1 ? tbtn('◀', () => { r.i = (r.i + r.variants.length - 1) % r.variants.length; showResult(); renderSide(); }, '.sm') : null,
          r.variants.length > 1 ? tbtn('▶', () => { r.i = (r.i + 1) % r.variants.length; showResult(); renderSide(); }, '.sm') : null,
          chip(S.before ? 'Voir le résultat' : 'Voir le relief', false, () => { S.before = !S.before; showResult(); renderSide(); }),
          tbtn('Effacer', () => { S.result = null; S.before = false; showResult(); renderSide(); }, '.sm')),
        h('div.ag-actions', tbtn('Ouvrir dans Retouche', () => send('edit'), '.primary'), D() ? tbtn('Ajouter en calque à « ' + D().name + ' »', () => send('layer')) : null,
          tbtn('Vers Transformer (img2img, inpaint)', () => send('inpaint')), tbtn('Enregistrer PNG…', () => send('save')))));
    }
    side.replaceChildren(...blocks);
    side.scrollTop = sc;
  }

  KS.angleTab = {
    async render(el) {
      root = el;
      el.replaceChildren(h('div.fx-note', { text: 'Chargement…' }));
      try { await load(); } catch (e) { el.replaceChildren(h('div.fx-note', { text: 'Angle indisponible : ' + e.message })); return; }
      if (root !== el || !el.isConnected) return;
      if (!S.renderer) setupScene();
      view = h('div.ag-view', h('div.ag-frame', S.renderer.domElement, h('img.ag-res', { alt: '', hidden: true })),
        S.src ? null : h('div.ag-empty', { text: 'Déposez une image ici, ou choisissez-la à droite' }));
      view.addEventListener('dragover', e => e.preventDefault());
      view.addEventListener('drop', async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) await fromFile({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }); if (view) { const em = view.querySelector('.ag-empty'); if (em && S.src) em.remove(); } });
      side = h('div.ag-side');
      el.replaceChildren(view, side);
      ro && ro.disconnect(); ro = new ResizeObserver(() => layout()); ro.observe(view);
      layout(); renderSide(); showResult();
      if (S.mesh) applyCamera();
      if (!raf) raf = requestAnimationFrame(loop);
    },
    // pour les tests
    get state() { return S; }, prefs: P, setSource, renderView, generate, applyCamera,
  };
})();
