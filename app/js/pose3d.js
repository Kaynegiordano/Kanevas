// Pose 3D : un corps humain posable (MakeHuman, CC0) dans le Studio IA, pour servir de guide de dessin et de génération.
// Le corps vient de app/assets/pose3d (tools/build-human.py) ; Three.js est chargé à la première ouverture de l'onglet.
// Les os n'ont pas d'orientation propre au repos : chaque rotation est exprimée dans le repère du parent,
// ce qui rend les poses toutes faites, le miroir et la cinématique inverse simples à écrire.
// Repère du personnage : +Y en haut, +Z devant lui, +X à sa gauche (os « .L »).
'use strict';
(() => {
  const U = KS.util, h = KS.h, C = KS.cmd, N = KS.native;
  const D = () => KS.state.doc;
  const F = () => KS.fxui;
  const SCALE = 0.1; // MakeHuman travaille en décimètres
  const LEVELS = ['min', 'average', 'max'];

  /* ---------------------------------------------------------------- réglages mémorisés */
  const DEF = {
    v: 1,
    morph: { gender: 0.15, muscle: 0.5, weight: 0.5, height: 0.5, prop: 0.5, cup: 0 },
    pose: null, cam: null, focal: 50,
    light: { az: 35, el: 40, power: 2.4, amb: 0.9, rim: true, shadow: true },
    skin: 'clay', floor: true, out: { w: 832, h: 1216 }, mode: 'shaded', manOpacity: 1, sym: false, library: [],
  };
  const P = Object.assign({}, DEF, KS.prefs.pose3d && KS.prefs.pose3d.v === 1 ? KS.prefs.pose3d : {});
  for (const k of ['morph', 'light', 'out']) P[k] = Object.assign({}, DEF[k], P[k]);
  const save = U.debounce(() => { KS.prefs.pose3d = P; KS.prefs.save(); }, 400);

  /* ---------------------------------------------------------------- état de la scène */
  let T = null, Orbit = null, Gizmo = null, loading = null, failed = '';
  const S = {
    renderer: null, scene: null, camera: null, orbit: null, gizmo: null, mesh: null, bones: [], B: {}, model: null,
    handles: null, ikTarget: null, sel: null, tool: 'rotate', ref: null, dirty: true, undo: [], redo: [], restHead: {},
    lights: {}, floor: null, grid: null, palmSign: {}, keyVerts: null,
  };
  let root = null, view = null, side = null, ro = null, raf = 0;

  async function fetchBuffer(path) {
    try { const r = await fetch(path); if (r.ok) return await r.arrayBuffer(); } catch { /* file:// : XMLHttpRequest prend le relais */ }
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open('GET', path); x.responseType = 'arraybuffer';
      x.onload = () => (x.status === 0 || x.status === 200) && x.response ? res(x.response) : rej(new Error('lecture impossible : ' + path));
      x.onerror = () => rej(new Error('lecture impossible : ' + path)); x.send();
    });
  }
  function load() {
    if (!loading) loading = (async () => {
      T = await import('../vendor/three/three.module.min.js');
      Orbit = (await import('../vendor/three/OrbitControls.js')).OrbitControls;
      Gizmo = (await import('../vendor/three/TransformControls.js')).TransformControls;
      const [json, bin] = await Promise.all([fetchBuffer('assets/pose3d/human.json'), fetchBuffer('assets/pose3d/human.bin')]);
      S.model = { meta: JSON.parse(new TextDecoder().decode(json)), bin };
      build();
    })().catch(e => { failed = e.message || String(e); loading = null; throw e; });
    return loading;
  }

  /* ---------------------------------------------------------------- corps : maillage, squelette, morphologie */
  const V3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const Q = () => new T.Quaternion();
  function build() {
    const { meta, bin } = S.model, n = meta.vertexCount;
    const base = new Float32Array(bin, meta.positions, n * 3);
    const index = new Uint16Array(bin, meta.indices, meta.indexCount);
    const used = new Uint8Array(n); for (const i of index) used[i] = 1;
    S.model.base = base; S.model.used = used;
    S.model.dominant = new Uint8Array(bin, meta.skinIndex, n * 4);
    for (const t of Object.values(meta.targets)) { t.idx = new Uint16Array(bin, t.index, t.count); t.d = new Int16Array(bin, t.delta, t.count * 3); }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setIndex(new T.BufferAttribute(index, 1));
    geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(Uint16Array.from(new Uint8Array(bin, meta.skinIndex, n * 4)), 4));
    geo.setAttribute('skinWeight', new T.BufferAttribute(new Float32Array(bin, meta.skinWeight, n * 4), 4));
    const mat = new T.MeshStandardMaterial({ color: 0xcdbfb2, roughness: 0.72, metalness: 0 });
    S.bones = meta.bones.map(b => { const bone = new T.Bone(); bone.name = b.name; S.B[b.name] = bone; return bone; });
    meta.bones.forEach((b, i) => { if (b.parent) S.B[b.parent].add(S.bones[i]); });
    const mesh = S.mesh = new T.SkinnedMesh(geo, mat);
    mesh.castShadow = true; mesh.frustumCulled = false;
    mesh.add(S.B.root);
    S.skeleton = new T.Skeleton(S.bones);
    morph(true);
    mesh.bind(S.skeleton);
    restKeys();
    if (P.pose) applyPose(P.pose, false);
  }
  function weightsOf(m) {
    const W = {}, gw = { female: 1 - m.gender, male: m.gender };
    const lv = v => ({ min: Math.max(0, (0.5 - v) * 2), max: Math.max(0, (v - 0.5) * 2), average: 1 - Math.abs(v - 0.5) * 2 });
    const mw = lv(m.muscle), ww = lv(m.weight), hw = lv(m.height);
    for (const g of ['female', 'male']) {
      for (const a of LEVELS) for (const b of LEVELS) W[`u:${g}:${a}:${b}`] = gw[g] * mw[a] * ww[b];
      for (const r of ['african', 'asian', 'caucasian']) W[`race:${r}:${g}`] = gw[g] / 3;
      W[`height:${g}:min`] = gw[g] * hw.min; W[`height:${g}:max`] = gw[g] * hw.max;
      W[`prop:${g}`] = gw[g] * U.clamp(m.prop, 0, 1);
    }
    W['cup:min'] = gw.female * Math.max(0, -m.cup); W['cup:max'] = gw.female * Math.max(0, m.cup);
    return W;
  }
  // Applique la morphologie : sommets, articulations, longueurs des os ; la pose en cours est gardée.
  function morph(first) {
    const { meta, base, used } = S.model, n = meta.vertexCount;
    const pos = new Float32Array(base);
    for (const [k, w] of Object.entries(weightsOf(P.morph))) {
      const t = meta.targets[k]; if (!t || Math.abs(w) < 1e-4 || !t.count) continue;
      const s = t.scale * w, idx = t.idx, d = t.d;
      for (let i = 0; i < t.count; i++) { const o = idx[i] * 3, j = i * 3; pos[o] += d[j] * s; pos[o + 1] += d[j + 1] * s; pos[o + 2] += d[j + 2] * s; }
    }
    let minY = Infinity;
    for (let i = 0; i < n; i++) if (used[i] && pos[i * 3 + 1] < minY) minY = pos[i * 3 + 1];
    for (let i = 0; i < n; i++) { pos[i * 3] *= SCALE; pos[i * 3 + 1] = (pos[i * 3 + 1] - minY) * SCALE; pos[i * 3 + 2] *= SCALE; }
    const joint = name => {
      const vs = meta.joints[name], p = V3();
      for (const v of vs) p.x += pos[v * 3], p.y += pos[v * 3 + 1], p.z += pos[v * 3 + 2];
      return p.multiplyScalar(1 / vs.length);
    };
    const keep = first ? null : snapshot();
    S.joint = {};
    for (const b of meta.bones) { S.joint[b.name] = joint(b.head); S.joint[b.name + ':tail'] = joint(b.tail); }
    for (const b of meta.bones) {
      const bone = S.B[b.name], head = S.joint[b.name];
      bone.quaternion.identity();
      bone.position.copy(b.parent ? head.clone().sub(S.joint[b.parent]) : head);
      S.restHead[b.name] = bone.position.clone();
    }
    S.mesh.updateMatrixWorld(true);
    const attr = S.mesh.geometry.attributes.position;
    attr.array.set(pos); attr.needsUpdate = true;
    S.mesh.geometry.computeVertexNormals();
    if (!first) { S.skeleton.calculateInverses(); applyPose(keep, false); }
    S.dirty = true;
  }
  // Repères fixes du visage pour OpenPose (nez, oreilles) et sens de la paume, lus sur le corps au repos
  function restKeys() {
    const { base, used, meta } = S.model, n = meta.vertexCount;
    const eye = V3(), ev = meta.joints[meta.bones.find(b => b.name === 'eye.L').head];
    for (const i of ev) eye.add(V3(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]));
    eye.multiplyScalar(1 / ev.length);
    let nose = -1, earL = -1, earR = -1;
    for (let i = 0; i < n; i++) {
      if (!used[i]) continue;
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      if (Math.abs(x) < 0.08 && y < eye.y && y > eye.y - 0.7 && (nose < 0 || z > base[nose * 3 + 2])) nose = i;
      if (Math.abs(y - eye.y + 0.15) < 0.25 && z < eye.z - 0.6 && z > eye.z - 1.9) {
        if (earL < 0 || x > base[earL * 3]) earL = i;
        if (earR < 0 || x < base[earR * 3]) earR = i;
      }
    }
    S.keyVerts = { nose, earL, earR };
    for (const s of ['L', 'R']) {
      const p = name => S.joint[name + '.' + s];
      const dir = p('finger3-1').clone().sub(p('wrist')).normalize(), across = p('finger2-1').clone().sub(p('finger5-1')).normalize();
      const nrm = dir.clone().cross(across).normalize();
      const hint = S.joint['finger2-3.' + s + ':tail'].clone().sub(p('finger2-1')).normalize().sub(p('finger2-1').clone().sub(p('metacarpal1')).normalize());
      S.palmSign[s] = nrm.dot(hint) >= 0 ? 1 : -1;
    }
  }

  /* ---------------------------------------------------------------- pose : instantanés, miroir, annuler */
  const side_ = n => /\.L$/.test(n) ? 'L' : /\.R$/.test(n) ? 'R' : '';
  const twin = n => n.replace(/\.L$/, '.#').replace(/\.R$/, '.L').replace(/\.#$/, '.R');
  const mirrorQ = q => [q[0], -q[1], -q[2], q[3]];
  function snapshot() {
    const q = {};
    for (const b of S.bones) { const x = b.quaternion; if (Math.abs(x.x) + Math.abs(x.y) + Math.abs(x.z) > 1e-6) q[b.name] = [x.x, x.y, x.z, x.w].map(v => +v.toFixed(6)); }
    const off = S.B.root.position.clone().sub(S.restHead.root);
    return { q, root: [off.x, off.y, off.z].map(v => +v.toFixed(4)) };
  }
  function applyPose(p, record = true) {
    if (record) pushUndo();
    for (const b of S.bones) b.quaternion.identity();
    if (p && p.q) for (const [k, v] of Object.entries(p.q)) if (S.B[k]) S.B[k].quaternion.set(v[0], v[1], v[2], v[3]);
    S.B.root.position.copy(S.restHead.root);
    if (p && p.root) S.B.root.position.add(V3(...p.root));
    S.mesh.updateMatrixWorld(true);
    changed();
  }
  function mirrored(p, swap) {
    const q = {};
    for (const b of S.bones) {
      const src = swap ? twin(b.name) : b.name, v = p.q[src];
      if (!v) continue;
      q[b.name] = mirrorQ(v);
    }
    return { q, root: [-p.root[0], p.root[1], p.root[2]] };
  }
  function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
  function undo(redo) {
    const from = redo ? S.redo : S.undo, to = redo ? S.undo : S.redo;
    if (!from.length) return;
    to.push(snapshot()); applyPose(from.pop(), false); syncGizmo();
  }
  const changed = () => { S.dirty = true; P.pose = snapshot(); save(); };

  /* ---------------------------------------------------------------- outils de pose */
  const wp = bone => bone.getWorldPosition(V3());
  function rotateWorld(bone, q) {
    const pw = Q(); bone.parent.getWorldQuaternion(pw);
    const bw = Q(); bone.getWorldQuaternion(bw);
    bone.quaternion.copy(pw.invert().multiply(q.clone().multiply(bw)));
    bone.updateMatrixWorld(true);
  }
  function aim(name, endName, dir) {
    const bone = S.B[name], v = wp(S.B[endName]).sub(wp(bone));
    if (v.lengthSq() < 1e-12) return;
    rotateWorld(bone, Q().setFromUnitVectors(v.normalize(), V3(...dir).normalize()));
  }
  function spread(names, deg) {
    const [x, y, z] = deg.map(d => d * Math.PI / 180 / names.length);
    const q = Q().setFromEuler(new T.Euler(x, y, z, 'YXZ'));
    for (const n of names) S.B[n].quaternion.multiply(q);
    S.mesh.updateMatrixWorld(true);
  }
  // Deux os (bras ou jambe) amenés vers une cible ; l'orientation de la main ou du pied est conservée.
  function solveIK(s, limb, target) {
    const [up, mid, end] = limb === 'arm' ? ['upperarm01', 'lowerarm01', 'wrist'] : ['upperleg01', 'lowerleg01', 'foot'];
    const U1 = S.B[up + '.' + s], M1 = S.B[mid + '.' + s], E1 = S.B[end + '.' + s];
    const endQ = Q(); E1.getWorldQuaternion(endQ);
    const A = wp(U1), Bp = wp(M1), Cp = wp(E1);
    const a = A.distanceTo(Bp), b = Bp.distanceTo(Cp);
    const d = U.clamp(A.distanceTo(target), Math.abs(a - b) + 1e-4, a + b - 1e-4);
    let n = Bp.clone().sub(A).cross(Cp.clone().sub(Bp));
    if (n.lengthSq() < 1e-10) n = V3(0, 0, limb === 'arm' ? -1 : 1).cross(Cp.clone().sub(A));
    n.normalize();
    const cur = Math.acos(U.clamp(A.clone().sub(Bp).normalize().dot(Cp.clone().sub(Bp).normalize()), -1, 1));
    const want = Math.acos(U.clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    rotateWorld(M1, Q().setFromAxisAngle(n, cur - want));
    const v = wp(E1).sub(A).normalize(), t = target.clone().sub(A).normalize();
    rotateWorld(U1, Q().setFromUnitVectors(v, t));
    const pw = Q(); E1.parent.getWorldQuaternion(pw);
    E1.quaternion.copy(pw.invert().multiply(endQ));
    S.mesh.updateMatrixWorld(true);
    return [U1, M1, E1];
  }
  const HANDS = {
    relaxed: { label: 'Détendue', c: [0.2, 0.15, 0.25, 0.35, 0.45], s: 0.3 },
    open: { label: 'Ouverte', c: [0, 0, 0, 0, 0], s: 1 },
    fist: { label: 'Poing', c: [0.85, 1, 1, 1, 1], s: 0 },
    point: { label: 'Pointer', c: [0.75, 0, 1, 1, 1], s: 0 },
    peace: { label: 'Victoire', c: [0.85, 0, 0, 1, 1], s: 1 },
    grip: { label: 'Saisir', c: [0.45, 0.55, 0.6, 0.65, 0.7], s: 0.2 },
    pinch: { label: 'Pincer', c: [0.45, 0.5, 0.2, 0.15, 0.1], s: 0.3 },
  };
  function applyHand(s, key) {
    const def = HANDS[key]; if (!def) return;
    const b = n => S.B[n + '.' + s];
    for (let f = 1; f <= 5; f++) for (let k = 1; k <= 3; k++) b(`finger${f}-${k}`).quaternion.identity();
    S.mesh.updateMatrixWorld(true);
    const dir = wp(b('finger3-1')).sub(wp(b('wrist'))).normalize(), across = wp(b('finger2-1')).sub(wp(b('finger5-1'))).normalize();
    const nrm = dir.clone().cross(across).normalize().multiplyScalar(S.palmSign[s]);
    const SPREAD = [0, 9, 0, -7, -15], CURL = [[30, 40, 55], [75, 95, 70], [75, 95, 70], [75, 95, 70], [75, 95, 70]];
    for (let f = 1; f <= 5; f++) {
      const c = def.c[f - 1], base = b(`finger${f}-1`);
      if (f > 1 && def.s) rotateWorld(base, Q().setFromAxisAngle(nrm, S.palmSign[s] * SPREAD[f - 1] * def.s * Math.PI / 180));
      const d = wp(b(`finger${f}-2`)).sub(wp(base)).normalize();
      const toward = f === 1 ? nrm.clone().sub(across.clone().multiplyScalar(0.6)).normalize() : nrm;
      const axis = d.clone().cross(toward).normalize();
      if (axis.lengthSq() < 1e-8) continue;
      for (let k = 1; k <= 3; k++) rotateWorld(b(`finger${f}-${k}`), Q().setFromAxisAngle(axis, c * CURL[f - 1][k - 1] * Math.PI / 180));
    }
  }

  /* ---------------------------------------------------------------- poses toutes faites (directions pour le côté gauche ; le droit est en miroir) */
  const SEG = { arm: ['upperarm01', 'lowerarm01'], fore: ['lowerarm01', 'wrist'], hand: ['wrist', 'finger3-1'], thigh: ['upperleg01', 'lowerleg01'], shin: ['lowerleg01', 'foot'], foot: ['foot', 'toe3-1'] };
  const POSES = [
    { id: 'rest', label: 'A (repos)', ops: [], hands: 'relaxed' },
    { id: 'stand', label: 'Debout', ops: [['both', 'arm', [0.17, -1, 0.02]], ['both', 'fore', [0.1, -1, 0.14]], ['both', 'thigh', [0.04, -1, 0]], ['both', 'shin', [0.02, -1, -0.02]]], hands: 'relaxed' },
    { id: 'tpose', label: 'T', ops: [['both', 'arm', [1, 0, 0]], ['both', 'fore', [1, 0, 0]], ['both', 'hand', [1, -0.05, 0]], ['both', 'thigh', [0.05, -1, 0]], ['both', 'shin', [0.02, -1, 0]]], hands: 'open' },
    { id: 'contra', label: 'Déhanché', ops: [['root', 0, 0, 5], ['spine', 0, 0, -9], ['neck', 0, -6, 5], ['R', 'thigh', [-0.08, -1, 0]], ['R', 'shin', [-0.02, -1, 0]], ['L', 'thigh', [0.12, -1, 0.14]], ['L', 'shin', [0.02, -1, -0.12]], ['both', 'arm', [0.2, -1, 0]], ['both', 'fore', [0.1, -1, 0.15]]], hands: 'relaxed' },
    { id: 'walk', label: 'Marche', ops: [['spine', 0, 6, 0], ['L', 'thigh', [0.03, -0.92, 0.4]], ['L', 'shin', [0.02, -1, 0.06]], ['R', 'thigh', [-0.03, -0.95, -0.32]], ['R', 'shin', [-0.02, -0.8, -0.55]], ['L', 'arm', [0.15, -1, -0.32]], ['L', 'fore', [0.1, -1, -0.05]], ['R', 'arm', [-0.15, -1, 0.35]], ['R', 'fore', [-0.1, -0.75, 0.65]]], hands: 'relaxed' },
    { id: 'run', label: 'Course', ops: [['spine', 14, 8, 0], ['L', 'thigh', [0.03, -0.45, 0.9]], ['L', 'shin', [0.02, -1, -0.12]], ['R', 'thigh', [-0.03, -0.85, -0.55]], ['R', 'shin', [-0.03, -0.25, -1]], ['L', 'arm', [0.12, -0.9, -0.45]], ['L', 'fore', [0.06, -0.15, 1]], ['R', 'arm', [-0.12, -0.85, 0.5]], ['R', 'fore', [-0.1, 0.7, 0.75]]], hands: 'fist' },
    { id: 'sit', label: 'Assis', ops: [['both', 'thigh', [0.1, -0.05, 1]], ['both', 'shin', [0.03, -1, 0.05]], ['both', 'arm', [0.12, -1, 0.3]], ['both', 'fore', [-0.05, -0.2, 1]]], hands: 'relaxed' },
    { id: 'cross', label: 'En tailleur', ops: [['spine', 6, 0, 0], ['both', 'thigh', [0.75, -0.15, 0.65]], ['both', 'shin', [-0.85, -0.05, 0.5]], ['both', 'arm', [0.2, -1, 0.25]], ['both', 'fore', [0.15, -0.45, 0.9]]], hands: 'relaxed' },
    { id: 'kneel', label: 'À genoux', ops: [['both', 'thigh', [0.07, -1, 0.04]], ['both', 'shin', [0.02, -0.05, -1]], ['both', 'foot', [0, -0.25, -1]], ['both', 'arm', [0.15, -1, 0.1]], ['both', 'fore', [0.05, -1, 0.3]]], hands: 'relaxed' },
    { id: 'squat', label: 'Accroupi', ops: [['spine', 24, 0, 0], ['both', 'thigh', [0.45, 0.08, 0.88]], ['both', 'shin', [0.12, -1, -0.42]], ['both', 'arm', [0.22, -0.6, 0.75]], ['both', 'fore', [0, -0.25, 1]]], hands: 'relaxed' },
    { id: 'arms', label: 'Bras croisés', ops: [['both', 'arm', [0.22, -1, 0.3]], ['both', 'fore', [-1, 0.15, 0.3]], ['both', 'thigh', [0.06, -1, 0]], ['both', 'shin', [0.02, -1, 0]]], hands: 'fist' },
    { id: 'hips', label: 'Mains aux hanches', ops: [['both', 'arm', [0.75, -0.65, -0.18]], ['both', 'fore', [-0.6, -0.72, 0.25]], ['both', 'thigh', [0.1, -1, 0]], ['both', 'shin', [0.02, -1, 0]]], hands: 'open' },
    { id: 'cheer', label: 'Bras levés', ops: [['both', 'arm', [0.45, 0.9, 0.05]], ['both', 'fore', [0.2, 1, 0.08]], ['both', 'thigh', [0.08, -1, 0]], ['both', 'shin', [0.02, -1, 0]], ['neck', -10, 0, 0]], hands: 'open' },
    { id: 'fight', label: 'Garde', ops: [['spine', 8, -22, 0], ['L', 'thigh', [0.14, -0.95, 0.3]], ['L', 'shin', [0.05, -1, 0.05]], ['R', 'thigh', [-0.14, -0.95, -0.3]], ['R', 'shin', [-0.04, -1, -0.12]], ['L', 'arm', [0.25, -0.75, 0.6]], ['L', 'fore', [-0.25, 0.85, 0.45]], ['R', 'arm', [-0.3, -0.85, 0.4]], ['R', 'fore', [0.35, 0.8, 0.45]], ['neck', 4, 18, 0]], hands: 'fist' },
    { id: 'punch', label: 'Coup de poing', ops: [['spine', 6, 30, 0], ['L', 'thigh', [0.14, -0.95, 0.32]], ['L', 'shin', [0.05, -1, 0.08]], ['R', 'thigh', [-0.14, -0.95, -0.3]], ['R', 'shin', [-0.04, -1, -0.1]], ['R', 'arm', [-0.05, 0.05, 1]], ['R', 'fore', [0, 0.05, 1]], ['L', 'arm', [0.25, -0.8, 0.5]], ['L', 'fore', [-0.2, 0.85, 0.5]], ['neck', 0, -25, 0]], hands: 'fist' },
    { id: 'lie', label: 'Allongé', ops: [['root', -90, 0, 0], ['both', 'arm', [0.25, 0, 1]], ['both', 'fore', [0.15, 0, 1]], ['both', 'thigh', [0.06, 0, 1]], ['both', 'shin', [0.02, 0, 1]], ['both', 'foot', [0, 1, 0.3]]], hands: 'relaxed' },
  ];
  function applyPreset(p) {
    pushUndo();
    applyPose(null, false);
    for (const op of p.ops) {
      if (op[0] === 'root') { S.B.root.quaternion.setFromEuler(new T.Euler(...op.slice(1).map(d => d * Math.PI / 180), 'YXZ')); S.mesh.updateMatrixWorld(true); }
      else if (op[0] === 'spine') spread(['spine05', 'spine04', 'spine03', 'spine02', 'spine01'], op.slice(1));
      else if (op[0] === 'neck') spread(['neck01', 'neck02', 'neck03', 'head'], op.slice(1));
      else {
        const [a, e] = SEG[op[1]], d = op[2];
        if (op[0] !== 'R') aim(a + '.L', e + '.L', d);
        if (op[0] !== 'L') aim(a + '.R', e + '.R', op[0] === 'both' ? [-d[0], d[1], d[2]] : d);
      }
    }
    if (p.hands) { applyHand('L', p.hands); applyHand('R', p.hands); }
    ground(false);
    select(null); changed(); renderSide();
  }
  // Pose le corps sur le sol (point le plus bas des sommets déformés)
  function ground(record = true) {
    if (record) pushUndo();
    S.mesh.updateMatrixWorld(true);
    const { used, meta } = S.model, v = V3();
    let minY = Infinity;
    for (let i = 0; i < meta.vertexCount; i += 2) if (used[i]) { S.mesh.getVertexPosition(i, v); if (v.y < minY) minY = v.y; }
    if (isFinite(minY)) { S.B.root.position.y -= minY; S.mesh.updateMatrixWorld(true); }
    if (record) changed();
  }

  /* ---------------------------------------------------------------- articulations cliquables */
  const CTRL = {
    root: 'Bassin', spine05: 'Bas du dos', spine03: 'Dos', spine01: 'Poitrine', neck01: 'Cou', head: 'Tête',
    clavicle: 'Épaule', upperarm01: 'Bras', lowerarm01: 'Coude', wrist: 'Main', upperleg01: 'Hanche', lowerleg01: 'Genou', foot: 'Pied',
  };
  const FINGERS = ['Pouce', 'Index', 'Majeur', 'Annulaire', 'Auriculaire'];
  const isCtrl = n => !!CTRL[n.replace(/\.[LR]$/, '')] || /^finger\d-\d\.[LR]$/.test(n);
  function label(n) {
    const s = side_(n), base = n.replace(/\.[LR]$/, ''), f = /^finger(\d)-(\d)$/.exec(base);
    const name = f ? FINGERS[f[1] - 1] + ' ' + f[2] : CTRL[base] || base;
    return name + (s ? (s === 'L' ? ' gauche' : ' droit' + (/^(Main|Hanche|Épaule)/.test(name) ? 'e' : '')) : '');
  }
  const endOf = n => /^(wrist|foot)\.[LR]$/.test(n);
  function controlFor(name) {
    let b = S.B[name];
    while (b && !isCtrl(b.name)) b = b.parent && b.parent.isBone ? b.parent : null;
    return b ? b.name : 'root';
  }
  function makeHandles() {
    const g = S.handles = new T.Group(); g.renderOrder = 10;
    const geo = new T.SphereGeometry(1, 14, 10);
    for (const b of S.bones) {
      if (!isCtrl(b.name)) continue;
      const finger = b.name.startsWith('finger');
      const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: endOf(b.name) ? 0xff9b3d : 0x4aa3ff, depthTest: false, transparent: true, opacity: 0.85 }));
      m.scale.setScalar(finger ? 0.006 : b.name === 'root' ? 0.022 : 0.015);
      m.renderOrder = 10; m.userData.bone = b.name; m.userData.finger = finger;
      g.add(m);
    }
    S.scene.add(g);
  }
  function updateHandles() {
    if (!S.handles) return;
    const s = S.sel && side_(S.sel);
    const showFingers = s && (/^finger/.test(S.sel) || /^wrist/.test(S.sel));
    for (const m of S.handles.children) {
      const n = m.userData.bone;
      m.visible = !m.userData.finger || !!(showFingers && side_(n) === s);
      S.B[n].getWorldPosition(m.position);
      m.material.color.set(n === S.sel ? 0xffe14d : endOf(n) ? 0xff9b3d : 0x4aa3ff);
    }
    S.handles.updateMatrixWorld(true);
  }
  function select(name) {
    S.sel = name;
    if (S.tool === 'move' && name !== 'root' && !endOf(name || '')) S.tool = 'rotate';
    syncGizmo(); renderSide(); S.dirty = true;
  }
  function syncGizmo() {
    const g = S.gizmo; if (!g) return;
    g.detach();
    if (!S.sel) return;
    if (S.tool === 'move' && endOf(S.sel)) { S.B[S.sel].getWorldPosition(S.ikTarget.position); g.setMode('translate'); g.setSpace('world'); g.attach(S.ikTarget); }
    else if (S.tool === 'move' && S.sel === 'root') { g.setMode('translate'); g.setSpace('world'); g.attach(S.B.root); }
    else { g.setMode('rotate'); g.setSpace(P.space || 'local'); g.attach(S.B[S.sel]); }
    S.dirty = true;
  }
  function mirrorLive(names) {
    if (!P.sym) return;
    for (const n of names) {
      const s = side_(n); if (!s) continue;
      const q = S.B[n].quaternion, o = S.B[twin(n)];
      o.quaternion.set(q.x, -q.y, -q.z, q.w);
    }
    S.mesh.updateMatrixWorld(true);
  }

  /* ---------------------------------------------------------------- scène, caméra, lumières */
  function setupScene() {
    const r = S.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    r.domElement.className = 'p3-gl'; r.domElement.tabIndex = 0;
    const scene = S.scene = new T.Scene();
    S.camera = new T.PerspectiveCamera(27, 832 / 1216, 0.05, 60);
    scene.add(S.mesh);
    const hemi = S.lights.hemi = new T.HemisphereLight(0xf4f1ec, 0x6b6660, 1);
    const key = S.lights.key = new T.DirectionalLight(0xffffff, 2);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.6, bottom: -1, near: 0.1, far: 12 });
    const rim = S.lights.rim = new T.DirectionalLight(0xdfe8ff, 1.1);
    scene.add(hemi, key, key.target, rim);
    const floor = S.floor = new T.Mesh(new T.PlaneGeometry(30, 30), new T.ShadowMaterial({ opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const grid = S.grid = new T.GridHelper(10, 40, 0x8a8f99, 0xb9bec7); grid.material.transparent = true; grid.material.opacity = 0.45; scene.add(grid);
    const orbit = S.orbit = new Orbit(S.camera, r.domElement);
    orbit.enableDamping = false; orbit.screenSpacePanning = true; orbit.target.set(0, 0.9, 0);
    orbit.addEventListener('change', () => { S.dirty = true; saveCam(); });
    S.ikTarget = new T.Object3D(); scene.add(S.ikTarget);
    const g = S.gizmo = new Gizmo(S.camera, r.domElement);
    g.setSize(0.75);
    scene.add(g.getHelper());
    let ikLimb = null;
    g.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
    g.addEventListener('mouseDown', () => { pushUndo(); ikLimb = S.sel && endOf(S.sel) && S.tool === 'move' ? (/^wrist/.test(S.sel) ? 'arm' : 'leg') : null; });
    g.addEventListener('objectChange', () => {
      if (ikLimb) {
        const s = side_(S.sel), moved = solveIK(s, ikLimb, S.ikTarget.position.clone());
        mirrorLive(moved.map(b => b.name));
      } else if (S.sel) mirrorLive([S.sel]);
      S.dirty = true;
    });
    g.addEventListener('mouseUp', () => { if (ikLimb) S.B[S.sel].getWorldPosition(S.ikTarget.position); ikLimb = null; changed(); });
    g.addEventListener('change', () => { S.dirty = true; });
    makeHandles();
    // clic : choisir une articulation (poignée ou partie du corps)
    const ray = new T.Raycaster(), ndc = new T.Vector2();
    let down = null;
    r.domElement.addEventListener('pointerdown', e => { r.domElement.focus({ preventScroll: true }); down = g.dragging || g.axis ? null : { x: e.clientX, y: e.clientY }; });
    r.domElement.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return;
      const rect = r.domElement.getBoundingClientRect();
      ndc.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(ndc, S.camera); updateHandles();
      const handles = S.handles.children.filter(m => m.visible);
      let hit = ray.intersectObjects(handles, false)[0];
      if (hit) return select(hit.object.userData.bone);
      S.mesh.computeBoundingSphere();
      hit = ray.intersectObject(S.mesh, false)[0];
      if (!hit) return select(null);
      const v = hit.face.a;
      select(controlFor(S.bones[S.model.dominant[v * 4]].name));
    });
    r.domElement.addEventListener('keydown', onKey);
    applyLights(); applyMaterial();
    if (P.cam) { S.camera.position.fromArray(P.cam.pos); orbit.target.fromArray(P.cam.target); } else setView('front');
    setFocal(P.focal, false);
    orbit.update();
  }
  const saveCam = U.debounce(() => { P.cam = { pos: S.camera.position.toArray(), target: S.orbit.target.toArray() }; save(); }, 300);
  function applyLights() {
    const L = P.light, az = L.az * Math.PI / 180, el = L.el * Math.PI / 180;
    const c = wp(S.B.spine03);
    S.lights.key.position.set(c.x + Math.sin(az) * Math.cos(el) * 5, c.y + Math.sin(el) * 5, c.z + Math.cos(az) * Math.cos(el) * 5);
    S.lights.key.target.position.copy(c); S.lights.key.intensity = L.power; S.lights.key.castShadow = !!L.shadow;
    S.lights.hemi.intensity = L.amb;
    S.lights.rim.position.set(c.x - Math.sin(az) * 4, c.y + 2.5, c.z - Math.cos(az) * 4); S.lights.rim.intensity = L.rim ? 1.1 : 0;
    S.floor.visible = !!(P.floor && L.shadow); S.grid.visible = !!P.floor;
    S.dirty = true;
  }
  const SKINS = { clay: ['Argile', 0xcdbfb2], grey: ['Gris', 0xb7bcc4], skin: ['Peau', 0xf0c9ae], dark: ['Peau foncée', 0x8d5b3f] };
  function applyMaterial() { S.mesh.material.color.set((SKINS[P.skin] || SKINS.clay)[1]); S.dirty = true; }
  const fovOf = f => 2 * Math.atan(12 / f) * 180 / Math.PI;
  function setFocal(f, keepSize = true) {
    f = U.clamp(+f || 50, 12, 200);
    if (keepSize && S.camera) {
      const t = S.orbit.target, v = S.camera.position.clone().sub(t);
      const k = Math.tan(S.camera.fov * Math.PI / 360) / Math.tan(fovOf(f) * Math.PI / 360);
      S.camera.position.copy(t.clone().add(v.multiplyScalar(k)));
    }
    P.focal = f; S.camera.fov = fovOf(f); S.camera.updateProjectionMatrix(); S.dirty = true; save(); saveCam();
  }
  const VIEWS = [['front', 'Face'], ['three', 'Trois-quarts'], ['side', 'Profil'], ['back', 'Dos'], ['high', 'Plongée'], ['low', 'Contre-plongée'], ['bust', 'Buste'], ['face', 'Visage']];
  function setView(id) {
    S.mesh.updateMatrixWorld(true);
    const head = wp(S.B.head), box = new T.Box3().setFromObject(S.mesh, true), size = box.getSize(V3());
    const tan = Math.tan(S.camera.fov * Math.PI / 360), aspect = S.camera.aspect || 0.68;
    // le corps entier tient dans l'image, quel que soit l'angle
    const fit = (hh, ww) => Math.max(hh / 2 / tan, ww / 2 / (tan * aspect)) * 1.1;
    let az = 0, el = 4, target = box.getCenter(V3()), dist = fit(size.y, Math.max(size.x, size.z)) + Math.max(size.x, size.z) / 2;
    if (id === 'three') az = 38;
    if (id === 'side') az = 90;
    if (id === 'back') az = 180;
    if (id === 'high') { az = 20; el = 38; }
    if (id === 'low') { az = 15; el = -22; }
    if (id === 'bust') { az = 12; target = V3(head.x, head.y - 0.22, head.z); dist = fit(0.75, 0.75); }
    if (id === 'face') { az = 8; el = 2; target = V3(head.x, head.y + 0.08, head.z + 0.03); dist = fit(0.36, 0.36); }
    const a = az * Math.PI / 180, e = el * Math.PI / 180;
    S.orbit.target.copy(target);
    S.camera.position.set(target.x + Math.sin(a) * Math.cos(e) * dist, target.y + Math.sin(e) * dist, target.z + Math.cos(a) * Math.cos(e) * dist);
    S.orbit.update(); S.dirty = true; saveCam();
  }

  /* ---------------------------------------------------------------- rendus pour l'export */
  let R2 = null;
  const outSize = () => S.ref ? { w: S.ref.width, h: S.ref.height } : { w: P.out.w, h: P.out.h };
  function offscreen(w, hh) {
    if (!R2) { R2 = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); R2.shadowMap.enabled = true; R2.shadowMap.type = T.PCFSoftShadowMap; }
    R2.setPixelRatio(1); R2.setSize(w, hh, false);
    return R2;
  }
  function shot(material, { floor = false, bg = null } = {}) {
    const { w, h: hh } = outSize(), r = offscreen(w, hh);
    const cam = S.camera.clone(); cam.aspect = w / hh; cam.updateProjectionMatrix();
    const keep = { mat: S.mesh.material, grid: S.grid.visible, floor: S.floor.visible, handles: S.handles.visible, giz: S.gizmo.getHelper().visible, bg: S.scene.background };
    if (material) S.mesh.material = material;
    S.grid.visible = false; S.floor.visible = floor && keep.floor; S.handles.visible = false; S.gizmo.getHelper().visible = false;
    S.scene.background = bg ? new T.Color(bg) : null;
    r.setClearColor(0x000000, 0);
    r.render(S.scene, cam);
    const c = U.canvas(w, hh); c.getContext('2d').drawImage(r.domElement, 0, 0);
    Object.assign(S.mesh, { material: keep.mat }); S.grid.visible = keep.grid; S.floor.visible = keep.floor; S.handles.visible = keep.handles; S.gizmo.getHelper().visible = keep.giz; S.scene.background = keep.bg;
    return { canvas: c, cam };
  }
  function depthMaterial(cam) {
    const box = new T.Box3().setFromObject(S.mesh, true), sph = box.getBoundingSphere(new T.Sphere());
    const d = cam.position.distanceTo(sph.center);
    cam.near = Math.max(0.01, d - sph.radius); cam.far = d + sph.radius;
    return new T.MeshDepthMaterial();
  }
  function renderDepth() {
    const { w, h: hh } = outSize(), r = offscreen(w, hh);
    const cam = S.camera.clone(); cam.aspect = w / hh;
    const mat = depthMaterial(cam); cam.updateProjectionMatrix();
    const keep = S.mesh.material; S.mesh.material = mat;
    const vis = [S.grid.visible, S.floor.visible, S.handles.visible, S.gizmo.getHelper().visible];
    S.grid.visible = S.floor.visible = S.handles.visible = false; S.gizmo.getHelper().visible = false;
    S.scene.background = new T.Color(0x000000);
    r.render(S.scene, cam);
    S.scene.background = null; S.mesh.material = keep;
    [S.grid.visible, S.floor.visible, S.handles.visible] = vis; S.gizmo.getHelper().visible = vis[3];
    const c = U.canvas(w, hh); c.getContext('2d').drawImage(r.domElement, 0, 0); mat.dispose();
    return c;
  }
  // Contours : arêtes de la silhouette (profondeur) et des plis (normales), traits noirs sur fond transparent
  function renderLines() {
    const depth = renderDepth(), normal = shot(new T.MeshNormalMaterial(), { bg: 0x000000 }).canvas;
    const w = depth.width, hh = depth.height;
    const dd = depth.getContext('2d').getImageData(0, 0, w, hh).data, nn = normal.getContext('2d').getImageData(0, 0, w, hh).data;
    const out = new ImageData(w, hh), o = out.data, k = Math.max(1, Math.round(Math.max(w, hh) / 1100));
    const at = (x, y) => (U.clamp(y, 0, hh - 1) * w + U.clamp(x, 0, w - 1)) * 4;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = at(x, y), a = at(x + k, y), b = at(x, y + k), c = at(x - k, y), e = at(x, y - k);
      const z = dd[i], zmax = Math.max(Math.abs(dd[a] - z), Math.abs(dd[b] - z), Math.abs(dd[c] - z), Math.abs(dd[e] - z));
      const sil = (z > 0) !== (dd[a] > 0) || (z > 0) !== (dd[b] > 0) || (z > 0) !== (dd[c] > 0) || (z > 0) !== (dd[e] > 0);
      let nmax = 0;
      if (z > 0) for (const j of [a, b, c, e]) { if (!dd[j]) continue; const dn = Math.abs(nn[i] - nn[j]) + Math.abs(nn[i + 1] - nn[j + 1]) + Math.abs(nn[i + 2] - nn[j + 2]); if (dn > nmax) nmax = dn; }
      const v = sil ? 255 : Math.min(255, Math.max(zmax > 10 ? (zmax - 10) * 18 : 0, nmax > 110 ? (nmax - 110) * 3 : 0));
      o[i + 3] = v;
    }
    const c = U.canvas(w, hh); c.getContext('2d').putImageData(out, 0, 0);
    return c;
  }
  // OpenPose (18 points, couleurs de ControlNet) sur fond noir
  function renderOpenPose() {
    const { w, h: hh } = outSize(), cam = S.camera.clone(); cam.aspect = w / hh; cam.updateProjectionMatrix();
    const v = i => S.mesh.getVertexPosition(i, V3()), b = n => wp(S.B[n]);
    const K = S.keyVerts;
    const pts3 = [v(K.nose), b('upperarm01.L').add(b('upperarm01.R')).multiplyScalar(0.5), b('upperarm01.R'), b('lowerarm01.R'), b('wrist.R'), b('upperarm01.L'), b('lowerarm01.L'), b('wrist.L'),
      b('upperleg01.R'), b('lowerleg01.R'), b('foot.R'), b('upperleg01.L'), b('lowerleg01.L'), b('foot.L'), b('eye.R'), b('eye.L'), v(K.earR), v(K.earL)];
    const pts = pts3.map(p => { const q = p.project(cam); return [(q.x + 1) / 2 * w, (1 - q.y) / 2 * hh]; });
    const COL = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]];
    const LIMBS = [[2, 3], [2, 6], [3, 4], [4, 5], [6, 7], [7, 8], [2, 9], [9, 10], [10, 11], [2, 12], [12, 13], [13, 14], [2, 1], [1, 15], [15, 17], [1, 16], [16, 18]];
    const c = U.canvas(w, hh), x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, w, hh);
    const sw = Math.max(2, Math.round(Math.max(w, hh) / 256));
    LIMBS.forEach(([a, bb], i) => {
      const p = pts[a - 1], q = pts[bb - 1], len = Math.hypot(q[0] - p[0], q[1] - p[1]) / 2, ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
      x.fillStyle = `rgba(${COL[i].join(',')},0.6)`;
      x.beginPath(); x.ellipse((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, len, sw, ang, 0, Math.PI * 2); x.fill();
    });
    pts.forEach((p, i) => { x.fillStyle = `rgb(${COL[i].join(',')})`; x.beginPath(); x.arc(p[0], p[1], sw, 0, Math.PI * 2); x.fill(); });
    return c;
  }
  const MODES = [['shaded', 'Ombré'], ['lines', 'Contours'], ['silhouette', 'Silhouette'], ['depth', 'Profondeur'], ['normal', 'Normales'], ['openpose', 'OpenPose']];
  function renderOut(mode = P.mode, { opaque = false } = {}) {
    S.mesh.updateMatrixWorld(true);
    if (mode === 'lines') return renderLines();
    if (mode === 'depth') return renderDepth();
    if (mode === 'openpose') return renderOpenPose();
    if (mode === 'normal') return shot(new T.MeshNormalMaterial(), { bg: 0x8080ff }).canvas;
    if (mode === 'silhouette') return shot(new T.MeshBasicMaterial({ color: 0x1b1d22 }), { bg: opaque ? 0xffffff : null }).canvas;
    return shot(null, { floor: true, bg: opaque ? 0xe9e7e4 : null }).canvas;
  }
  const modeName = m => (MODES.find(x => x[0] === m) || MODES[0])[1].toLowerCase();
  async function toLayer() {
    const d = D(), canvas = renderOut();
    const name = 'Pose 3D (' + modeName(P.mode) + ')';
    if (!d) { KS.addDoc(docOf(canvas, name)); await C.toggleStudio(false); return KS.toast('Nouveau document avec la pose', 'ok', 1800); }
    const L = KS.io.placeCanvas(d, canvas, name, canvas.width === d.width && canvas.height === d.height ? { x: 0, y: 0 } : undefined);
    if (['shaded', 'silhouette'].includes(P.mode)) { L.opacity = 0.45; L.touch && L.touch(); d.changed(); KS.emit('layers', d); }
    await C.toggleStudio(false);
    KS.toast('Calque « ' + name + ' » ajouté à « ' + d.name + ' »', 'ok', 2200);
  }
  function docOf(canvas, name) {
    const d = new KS.Doc({ name, width: canvas.width, height: canvas.height });
    d.addLayer(new KS.Layer({ name, canvas }), 0); return d;
  }
  async function toDoc() { KS.addDoc(docOf(renderOut(P.mode, { opaque: !['lines', 'openpose', 'depth', 'normal'].includes(P.mode) }), 'Pose 3D')); await C.toggleStudio(false); }
  function toImg2img() {
    if (!KS.studioApi) return;
    KS.studioApi.sendCanvas(renderOut(P.mode === 'lines' || P.mode === 'shaded' || P.mode === 'silhouette' ? 'shaded' : P.mode, { opaque: true }), '', 'img2img');
  }
  async function savePng() {
    const c = renderOut();
    const p = await N.saveDialog({ title: 'Enregistrer la pose', defaultPath: 'pose-3d-' + P.mode + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!p) return;
    await N.writeFile(p, new Uint8Array(await (await U.blobFromCanvas(c)).arrayBuffer()));
    KS.toast('Enregistrée', 'ok', 1200);
  }

  /* ---------------------------------------------------------------- image de référence (le dessin à reprendre) */
  function setRef(canvas) {
    S.ref = canvas; layout(); renderSide();
    if (view) { const img = view.querySelector('.p3-ref'); if (img) img.src = canvas ? canvas.toDataURL('image/jpeg', 0.9) : ''; }
  }
  async function refFromDoc() { const d = D(); if (!d) return KS.toast('Aucun document ouvert dans Retouche', 'info'); setRef(d.composite()); }
  async function refFromFile() {
    const files = N && N.openDialog ? await N.openDialog({ title: 'Dessin de référence', multi: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] }) : null;
    if (files && files[0]) setRef(await KS.io.canvasFromEntry(files[0]));
  }

  /* ---------------------------------------------------------------- interface */
  function layout() {
    if (!view || !S.renderer) return;
    const box = view.getBoundingClientRect(), { w, h: hh } = outSize();
    if (box.width < 10 || box.height < 10) return;
    const k = Math.min(box.width / w, box.height / hh), W = Math.floor(w * k), H = Math.floor(hh * k);
    const frame = view.querySelector('.p3-frame');
    frame.style.width = W + 'px'; frame.style.height = H + 'px';
    S.renderer.setSize(W, H, true);
    S.camera.aspect = W / H; S.camera.updateProjectionMatrix();
    const ref = view.querySelector('.p3-ref'); if (ref) ref.hidden = !S.ref;
    S.renderer.domElement.style.opacity = S.ref ? P.manOpacity : 1;
    S.dirty = true;
  }
  function loop() {
    raf = 0;
    if (!root || !root.isConnected) return;
    if (S.dirty) { S.dirty = false; updateHandles(); S.renderer.render(S.scene, S.camera); }
    raf = requestAnimationFrame(loop);
  }
  function onKey(e) {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) { e.preventDefault(); e.stopPropagation(); undo(k === 'y' || e.shiftKey); renderSide(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const act = { r: () => setTool('rotate'), g: () => setTool('move'), escape: () => select(null), f: () => setView('front'), m: () => { P.sym = !P.sym; save(); renderSide(); } }[k];
    if (act) { e.preventDefault(); e.stopPropagation(); act(); }
  }
  function setTool(t) {
    if (t === 'move' && S.sel !== 'root' && !endOf(S.sel || '')) return KS.toast('« Déplacer » : bassin, mains et pieds', 'info', 1800);
    S.tool = t; syncGizmo(); renderSide();
  }
  function resetBone() {
    if (!S.sel) return;
    pushUndo();
    S.B[S.sel].quaternion.identity();
    if (S.sel === 'root') S.B.root.position.copy(S.restHead.root);
    mirrorLive([S.sel]); S.mesh.updateMatrixWorld(true); syncGizmo(); changed();
  }

  function renderSide() {
    if (!side || !S.mesh) return;
    const { tbtn, slider, tabs, field } = F();
    const sc = side.scrollTop;
    const chip = (text, on, fn, tip = '') => { const b = h('button.fx-chip' + (on ? '.on' : ''), { text, title: tip }); b.addEventListener('click', fn); return b; };
    const chips = (...a) => h('div.p3-chips', ...a);
    const sec = (title, ...kids) => h('div.fx-panel.p3-sec', h('div.fx-h', { text: title }), ...kids.filter(Boolean));
    const sel = S.sel;
    const selBox = sec('Articulation',
      h('div.fx-info', { text: sel ? label(sel) : 'Cliquez une partie du corps ou un point bleu. Orange : mains et pieds, à tirer avec « Déplacer ».' }),
      chips(chip('Tourner (R)', S.tool === 'rotate', () => setTool('rotate')), chip('Déplacer (G)', S.tool === 'move', () => setTool('move'), 'Bassin : déplacer le corps. Mains et pieds : tirer le membre entier.'),
        chip('Axes : ' + ((P.space || 'local') === 'local' ? 'locaux' : 'du monde'), false, () => { P.space = (P.space || 'local') === 'local' ? 'world' : 'local'; save(); syncGizmo(); renderSide(); })),
      h('div.p3-chips', tbtn('Remettre à zéro', resetBone, '.sm'), tbtn('Poser au sol', () => ground(true), '.sm', 'Descend le corps jusqu’à ce qu’il touche le sol'),
        tbtn('↶', () => { undo(false); renderSide(); }, '.sm', 'Annuler (Ctrl+Z)'), tbtn('↷', () => { undo(true); renderSide(); }, '.sm', 'Rétablir (Ctrl+Y)')),
      h('label.fx-check', { title: 'Le côté opposé suit en miroir (M)' }, (() => { const i = h('input', { type: 'checkbox', checked: !!P.sym }); i.addEventListener('change', () => { P.sym = i.checked; save(); }); return i; })(), h('span', { text: 'Symétrie gauche ⇄ droite' })),
      sel && /^(wrist|finger)/.test(sel) ? h('div', h('div.fx-lbl', { text: 'Main ' + (side_(sel) === 'L' ? 'gauche' : 'droite') }),
        chips(...Object.entries(HANDS).map(([k, v]) => chip(v.label, false, () => { pushUndo(); applyHand(side_(sel), k); if (P.sym) { applyHand(side_(sel) === 'L' ? 'R' : 'L', k); } changed(); })))) : null);
    const poses = sec('Poses',
      chips(...POSES.map(p => chip(p.label, false, () => applyPreset(p)))),
      h('div.p3-chips', tbtn('Miroir', () => { applyPose(mirrored(snapshot(), true)); syncGizmo(); }, '.sm', 'Inverse gauche et droite'),
        tbtn('Gauche → droite', () => { const p = snapshot(); for (const n of Object.keys(p.q)) if (side_(n) === 'R') delete p.q[n]; for (const [n, q] of Object.entries(snapshot().q)) if (side_(n) === 'L') p.q[twin(n)] = mirrorQ(q); applyPose(p); }, '.sm'),
        tbtn('Droite → gauche', () => { const p = snapshot(); for (const n of Object.keys(p.q)) if (side_(n) === 'L') delete p.q[n]; for (const [n, q] of Object.entries(snapshot().q)) if (side_(n) === 'R') p.q[twin(n)] = mirrorQ(q); applyPose(p); }, '.sm')),
      h('div.fx-lbl', { text: 'Mes poses' }),
      P.library.length ? chips(...P.library.map((p, i) => {
        const b = chip(p.name, false, () => { if (p.morph) { P.morph = Object.assign({}, DEF.morph, p.morph); morph(false); } applyPose(p.pose); renderSide(); }, 'Clic droit : supprimer');
        b.addEventListener('contextmenu', e => { e.preventDefault(); P.library.splice(i, 1); save(); renderSide(); });
        return b;
      })) : h('div.fx-info', { text: 'Aucune pose enregistrée.' }),
      (() => {
        const name = h('input.fx-in', { placeholder: 'Pose ' + (P.library.length + 1), spellcheck: false });
        const add = () => {
          const n = name.value.trim() || 'Pose ' + (P.library.length + 1);
          P.library.push({ name: n, pose: snapshot(), morph: Object.assign({}, P.morph) }); save(); renderSide();
          KS.toast('Pose « ' + n + ' » enregistrée (clic droit dessus pour la supprimer)', 'ok', 2200);
        };
        name.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
        return h('div.p3-save', name, tbtn('Enregistrer', add, '.sm'));
      })());
    const body = sec('Corps',
      chips(chip('Femme', P.morph.gender < 0.5, () => { P.morph.gender = 0.1; morph(false); save(); renderSide(); }), chip('Homme', P.morph.gender >= 0.5, () => { P.morph.gender = 0.9; morph(false); save(); renderSide(); })),
      ...[['gender', 'Femme ↔ Homme', 0, 1], ['muscle', 'Muscles', 0, 1], ['weight', 'Poids', 0, 1], ['height', 'Taille', 0, 1], ['prop', 'Proportions idéales', 0, 1], ['cup', 'Poitrine', -1, 1]]
        .map(([k, l, a, b]) => slider(l, P.morph, k, a, b, 0.01, '', () => { morphLater(); save(); })),
      chips(...Object.entries(SKINS).map(([k, v]) => chip(v[0], P.skin === k, () => { P.skin = k; save(); applyMaterial(); renderSide(); }))));
    const cam = sec('Caméra',
      chips(...VIEWS.map(([id, l]) => chip(l, false, () => setView(id)))),
      slider('Focale (mm)', P, 'focal', 12, 200, 1, 'Courte : perspective forte, déformée. Longue : perspective écrasée, comme un téléobjectif.', v => setFocal(v)),
      h('div.fx-info', { text: 'Clic gauche : tourner · clic droit : glisser · molette : approcher.' }));
    const light = sec('Lumière',
      slider('Direction', P.light, 'az', -180, 180, 1, '', () => applyLights()),
      slider('Hauteur', P.light, 'el', -10, 89, 1, '', () => applyLights()),
      slider('Intensité', P.light, 'power', 0, 6, 0.05, '', () => applyLights()),
      slider('Ambiance', P.light, 'amb', 0, 3, 0.05, '', () => applyLights()),
      h('div.p3-chips', ...[['rim', 'Contre-jour'], ['shadow', 'Ombre portée']].map(([k, l]) => chip(l, !!P.light[k], () => { P.light[k] = !P.light[k]; save(); applyLights(); renderSide(); })),
        chip('Sol', !!P.floor, () => { P.floor = !P.floor; save(); applyLights(); renderSide(); })));
    const { w, h: hh } = outSize();
    const wIn = h('input.fx-num', { type: 'number', min: 64, max: 4096, step: 8, value: w, disabled: !!S.ref }), hIn = h('input.fx-num', { type: 'number', min: 64, max: 4096, step: 8, value: hh, disabled: !!S.ref });
    const setOut = () => { P.out = { w: U.clamp(+wIn.value || 832, 64, 4096), h: U.clamp(+hIn.value || 1216, 64, 4096) }; save(); layout(); };
    wIn.addEventListener('change', setOut); hIn.addEventListener('change', setOut);
    const ref = sec('Dessin de référence',
      h('div.fx-info', { text: S.ref ? `Image ${S.ref.width} × ${S.ref.height} derrière le mannequin : placez la caméra et la pose dessus.` : 'Placez votre dessin derrière le mannequin pour caler l’angle et la pose.' }),
      h('div.p3-chips', tbtn('Depuis Retouche', refFromDoc, '.sm'), tbtn('Importer…', refFromFile, '.sm'), S.ref ? tbtn('Retirer', () => setRef(null), '.sm') : null),
      S.ref ? slider('Opacité du mannequin', P, 'manOpacity', 0.1, 1, 0.05, '', () => { save(); layout(); }) : null,
      S.ref ? null : h('div', h('div.fx-lbl', { text: 'Format de sortie' }), h('div.p3-size', wIn, h('span', { text: '×' }), hIn),
        chips(...[[832, 1216, 'Portrait'], [1024, 1024, 'Carré'], [1216, 832, 'Paysage']].map(([a, b, l]) => chip(l, w === a && hh === b, () => { P.out = { w: a, h: b }; save(); layout(); renderSide(); })))));
    const out = sec('Envoyer',
      h('div.fx-lbl', { text: 'Rendu' }),
      chips(...MODES.map(([k, l]) => chip(l, P.mode === k, () => { P.mode = k; save(); renderSide(); }))),
      h('div.fx-info', { text: { shaded: 'Le mannequin éclairé, fond transparent : calque guide à dessiner par-dessus.', lines: 'Uniquement les traits du corps : idéal pour décalquer et ébaucher.', silhouette: 'La forme pleine, pour placer les masses.', depth: 'Carte de profondeur (proche = clair).', normal: 'Orientation des surfaces (carte de normales).', openpose: 'Squelette au format OpenPose (couleurs ControlNet).' }[P.mode] }),
      h('div.p3-actions', tbtn(D() ? 'Calque guide dans « ' + D().name + ' »' : 'Ouvrir dans Retouche', toLayer, '.primary', 'Ajoute le rendu en calque au-dessus du dessin, puis revient dans Retouche'),
        tbtn('Nouveau document', toDoc), tbtn('Vers Transformer', toImg2img, '', 'Envoie le mannequin ombré (fond plein) comme image source de img2img'), tbtn('Enregistrer PNG…', savePng)));
    side.replaceChildren(selBox, poses, body, cam, light, ref, out);
    side.scrollTop = sc;
  }
  const morphLater = (() => { let t = 0; return () => { if (t) return; t = requestAnimationFrame(() => { t = 0; morph(false); }); }; })();

  KS.poseTab = {
    async render(el) {
      root = el;
      el.replaceChildren(h('div.p3-loading.fx-note', { text: failed ? 'Pose 3D indisponible : ' + failed : 'Chargement du corps 3D…' }));
      try { await load(); } catch (e) { el.replaceChildren(h('div.fx-note', { text: 'Pose 3D indisponible : ' + e.message })); return; }
      if (root !== el || !el.isConnected) return;
      if (!S.renderer) setupScene();
      view = h('div.p3-view', h('div.p3-frame', h('img.p3-ref', { alt: '', hidden: !S.ref, src: S.ref ? S.ref.toDataURL('image/jpeg', 0.9) : '' }), S.renderer.domElement));
      side = h('div.p3-side');
      el.replaceChildren(view, side);
      ro && ro.disconnect(); ro = new ResizeObserver(layout); ro.observe(view);
      layout(); renderSide(); syncGizmo();
      if (!raf) raf = requestAnimationFrame(loop);
    },
    // pour les tests
    get state() { return S; }, applyPreset: id => applyPreset(POSES.find(p => p.id === id)), setView, renderOut, presets: POSES.map(p => p.id),
  };
})();
