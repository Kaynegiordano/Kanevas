// Banc d'essai des outils de retouche sur un document 6000×4000 (calque photo + réglage) :
// tampon de duplication, correcteur, goutte d'eau, densité −. Définit window.runRetouchBench().
// Chaque mouvement est suivi d'un rendu et d'une synchronisation GPU (lecture d'un pixel de l'écran).
window.runRetouchBench = async () => {
  const U = KS.util, T = KS.tools, V = KS.view, W = 6000, H = 4000;
  const doc = KS.createDoc({ name: 'Retouche', width: W, height: H });
  KS.addDoc(doc);
  const L = doc.layers[0], x = L.ctx;
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2a4060'); g.addColorStop(1, '#d0a060'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 3000; i++) { x.fillStyle = `hsla(${i * 13},60%,${30 + i % 50}%,.6)`; x.fillRect((i * 7919) % W, (i * 104729) % H, 6 + i % 40, 6 + i % 30); }
  L.touch();
  doc.addLayer(new KS.Layer({ name: 'Teinte', kind: 'adjust', adjust: { type: 'hueSat', params: { hue: 10, saturation: 10, lightness: 0 } } }), 1);
  doc.setActive(L); doc.changed(); V.fit(doc);
  const t = () => performance.now(), sync = () => V.ctx.getImageData(0, 0, 1, 1);
  V.render(); sync();
  const ev = (px, py, alt) => ({ x: px, y: py, sx: 0, sy: 0, pressure: 1, alt: !!alt, shift: false });
  const R = {};
  const stroke = async (id, y, setup) => {
    T.select(id); const tool = T.byId[id];
    if (tool.o.size !== undefined) T.setOpt(tool, 'size', 120);
    if (setup) setup(tool);
    const s0 = t(); tool.down(ev(1500, y), doc); V.render(); sync(); const down = t() - s0;
    const mv = [];
    for (let i = 1; i <= 25; i++) { const s = t(); tool.move(ev(1500 + i * 30, y + Math.sin(i / 4) * 80), doc); if (tool.preRender) tool.preRender(doc); V.render(); sync(); mv.push(t() - s); }
    const s1 = t(); tool.up(ev(2250, y), doc); V.render(); sync(); const up = t() - s1;
    await new Promise(r => setTimeout(r, 300));
    R[id] = { down: Math.round(down), move: Math.round(mv.reduce((a, b) => a + b) / mv.length), moveMax: Math.round(Math.max(...mv)), up: Math.round(up) };
  };
  await stroke('clone', 1200, tool => { tool.down(ev(800, 800, true), doc); tool.offset = null; });
  await stroke('heal', 1800, tool => { tool.down(ev(800, 2500, true), doc); tool.offset = null; });
  await stroke('heal-spot', 2400);
  await stroke('blur', 3000);
  await stroke('burn', 3400);
  // exactitude après annulation de tout
  const before = doc.history.items.length;
  const comp = () => U.getData(doc.composite(), { x: 1200, y: 900, w: 1400, h: 2800 }).data;
  const a = comp(); KS.cmd.undo(); KS.cmd.redo(); const b = comp();
  let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  R.undoRedoDiff = diff; R.steps = before;
  return R;
};
