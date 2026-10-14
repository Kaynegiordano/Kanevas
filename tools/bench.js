// Banc d'essai des performances de Kanevas (document 6000×4000, 5 calques dont un
// réglage et un calque avec ombre portée). À exécuter dans la page (console ou outil de
// développement) : définit window.runBench(), qui renvoie les temps en millisecondes,
// et vérifie que la composition partielle égale une composition complète (pixelsDiff = 0).
window.runBench = async () => {
  const U = KS.util, T = KS.tools, V = KS.view;
  const W = 6000, H = 4000;
  const doc = KS.createDoc({ name: 'Bench', width: W, height: H });
  KS.addDoc(doc);
  const fill = (L, f) => { const x = L.ctx; f(x); L.touch(); };
  const bg = doc.layers[0];
  fill(bg, x => { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#203a60'); g.addColorStop(1, '#e8a040'); x.fillStyle = g; x.fillRect(0, 0, W, H); for (let i = 0; i < 400; i++) { x.fillStyle = `hsla(${i * 7},70%,60%,.5)`; x.beginPath(); x.arc((i * 997) % W, (i * 619) % H, 40 + (i % 90), 0, 7); x.fill(); } });
  const add = (name, o = {}) => { const L = new KS.Layer({ name, w: W, h: H, ...o }); doc.addLayer(L, doc.layers.length); return L; };
  const a = add('Pixels A'); fill(a, x => { x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(500, 500, 3000, 2000); });
  const b = add('Pixels B'); fill(b, x => { x.fillStyle = 'rgba(0,120,255,.4)'; x.beginPath(); x.arc(4000, 2000, 1200, 0, 7); x.fill(); });
  b.effects = { shadow: { on: true, color: '#000000', opacity: 0.6, angle: 120, distance: 30, size: 40 } }; b.touch();
  const adj = new KS.Layer({ name: 'Teinte', kind: 'adjust', adjust: { type: 'hueSat', params: { hue: 20, saturation: 15, lightness: 0 } } });
  doc.addLayer(adj, doc.layers.length);
  const top = add('Peinture');
  doc.setActive(top); doc.changed();
  const t = () => performance.now(), frame = () => new Promise(r => setTimeout(r, 0));
  const avg = a2 => a2.reduce((p, q) => p + q, 0) / a2.length;
  const R = {};
  let s = t(); doc.compositeDirty = true; doc.composite(); R.compositeFull = t() - s;
  V.fit(doc); await frame();
  s = t(); for (let i = 0; i < 5; i++) V.render(); R.renderFit = (t() - s) / 5;
  T.select('brush');
  const tool = T.byId.brush; T.setOpt(tool, 'size', 120); T.setOpt(tool, 'smoothing', 0);
  const ev = (x, y) => ({ x, y, sx: 0, sy: 0, pressure: 0.5, shift: false, alt: false });
  s = t(); tool.down(ev(1000, 1000), doc); V.render(); R.strokeDown = t() - s;
  const times = [];
  for (let i = 1; i <= 30; i++) { const s2 = t(); tool.move(ev(1000 + i * 40, 1000 + Math.sin(i / 6) * 600), doc); V.render(); times.push(t() - s2); }
  const s3 = t(); tool.up(ev(2300, 1000), doc); V.render(); R.strokeUp = t() - s3;
  R.strokeMoveAvg = avg(times); R.strokeMoveMax = Math.max(...times);
  // sous le réglage : la zone traverse le calque de réglage
  doc.setActive(a);
  const t2 = [];
  tool.down(ev(1500, 2500), doc); V.render();
  for (let i = 1; i <= 20; i++) { const s2 = t(); tool.move(ev(1500 + i * 40, 2500), doc); V.render(); t2.push(t() - s2); }
  tool.up(ev(2300, 2500), doc); V.render();
  R.strokeBelowAdjAvg = avg(t2);
  s = t(); KS.cmd.undo(); V.render(); R.undo = t() - s;
  s = t(); KS.cmd.redo(); V.render(); R.redo = t() - s;
  // changement global (opacité d'un calque) : image affichée tout de suite (aperçu), puis pleine résolution
  const op = [];
  for (let i = 0; i < 5; i++) { const s2 = t(); top.opacity = 0.9 - i * 0.1; doc.changed(); V.render(); op.push(t() - s2); await frame(); }
  R.globalChangeFrame = avg(op);
  s = t(); while (doc.pending && doc.pending.size) await new Promise(r2 => setTimeout(r2, 20)); R.refineDone = t() - s;
  // réglage modifié en direct (curseur) : 5 positions
  const live = [];
  for (let i = 0; i < 5; i++) { const s2 = t(); adj.adjustPreview = { hue: 10 * i, saturation: 15, lightness: 0 }; doc.changed(); V.render(); live.push(t() - s2); await frame(); }
  adj.adjustPreview = null; doc.changed();
  R.adjustSliderFrame = avg(live);
  // exactitude : composition partielle = composition complète
  const part = U.getData(doc.composite()).data, fd = U.getData(doc.flatten()).data;
  let diff = 0; for (let i = 0; i < fd.length; i += 4) { const d = Math.abs(fd[i] - part[i]) + Math.abs(fd[i + 1] - part[i + 1]) + Math.abs(fd[i + 2] - part[i + 2]) + Math.abs(fd[i + 3] - part[i + 3]); if (d > 8) diff++; }
  R.pixelsDiff = diff;
  for (const k in R) R[k] = Math.round(R[k] * 10) / 10;
  return R;
};
