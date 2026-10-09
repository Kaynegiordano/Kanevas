// Alt + clic droit glissé : régler une empreinte sans peindre sur le document.
'use strict';
(() => {
  const T = KS.tools, V = KS.view, U = KS.util;
  const compatible = new Set(['brush', 'pencil', 'eraser', 'clone', 'heal', 'heal-spot', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'quick-select']);
  let gesture = null, suppressUntil = 0;
  const G = T.brushGesture = {};
  Object.defineProperty(G, 'active', { get: () => !!gesture });
  function refresh() {
    if (!gesture) return;
    const g = gesture, t = g.tool;
    T.refreshBrushCtl(t);
    if (t.id === 'quick-select') T.renderOptions();
    g.hud.textContent = `Taille : ${t.o.size} px${g.hasHardness ? ' · Dureté : ' + t.o.hardness + ' %' : ''}`;
    const p = V.toScreen(g.point.x, g.point.y);
    g.hud.style.left = U.clamp(p.x + 18, 8, Math.max(8, V.w - g.hud.offsetWidth - 8)) + 'px';
    g.hud.style.top = U.clamp(p.y + 20, 8, Math.max(8, V.h - g.hud.offsetHeight - 8)) + 'px';
    KS.requestRender();
  }
  G.begin = (e, doc) => {
    if (e.button === 2 && !e.altKey && !gesture) suppressUntil = 0;
    const tool = T.current;
    if (gesture || T.isDragging() || KS.modalOpen() || KS.pickingColor || T.spaceDown || e.button !== 2 || !e.altKey || !compatible.has(tool?.id)) return false;
    e.preventDefault();
    const pos = V.eventPos(e), point = V.toDoc(pos.sx, pos.sy);
    const hud = KS.h('div.brush-hud', { 'aria-label': 'Réglage du pinceau' });
    KS.$('#overlay-ui').appendChild(hud);
    gesture = { tool, doc, id: e.pointerId, startX: e.clientX, startY: e.clientY, zoom: V.zoom, point,
      size: tool.o.size, hardness: tool.o.hardness, hasHardness: Number.isFinite(tool.o.hardness), hud };
    V.canvas.setPointerCapture(e.pointerId);
    V.mouse = { ...pos, ...point };
    V.canvas.style.cursor = 'none';
    refresh(); return true;
  };
  G.move = e => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return false;
    e.preventDefault();
    if (KS.state.doc !== g.doc || T.current !== g.tool) { G.finish(true); return true; }
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    const delta = v => Math.abs(v) <= 3 ? 0 : v - Math.sign(v) * 3;
    const min = g.tool.id === 'quick-select' ? 2 : 1, max = g.tool.id === 'quick-select' ? 800 : 2500;
    g.tool.o.size = U.clamp(Math.round(g.size + 2 * delta(dx) / Math.max(.01, g.zoom)), min, max);
    if (g.hasHardness) g.tool.o.hardness = U.clamp(Math.round(g.hardness + delta(dy) * .5), 0, 100);
    refresh(); return true;
  };
  G.finish = cancel => {
    const g = gesture; if (!g) return;
    gesture = null; suppressUntil = Date.now() + 500;
    if (cancel) { g.tool.o.size = g.size; if (g.hasHardness) g.tool.o.hardness = g.hardness; }
    else T.saveOpts(g.tool);
    g.hud.remove();
    if (V.canvas.hasPointerCapture(g.id)) V.canvas.releasePointerCapture(g.id);
    T.refreshBrushCtl(g.tool); T.renderOptions(); T.updateCursor(); KS.requestRender();
  };
  G.end = e => {
    if (!gesture || e.pointerId !== gesture.id) return false;
    e.preventDefault();
    G.finish(e.type !== 'pointerup'); return true;
  };
  G.contextMenu = () => !!gesture || Date.now() < suppressUntil;
  G.draw = ctx => {
    const g = gesture; if (!g) return;
    const p = V.toScreen(g.point.x, g.point.y), radius = Math.max(.5, g.tool.o.size * V.zoom / 2);
    const hardness = g.hasHardness ? g.tool.o.hardness / 100 : 1;
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    if (hardness >= .99) ctx.fillStyle = 'rgba(239,68,68,.45)';
    else {
      const gradient = ctx.createRadialGradient(p.x, p.y, radius * hardness, p.x, p.y, radius);
      gradient.addColorStop(0, 'rgba(239,68,68,.5)'); gradient.addColorStop(1, 'rgba(239,68,68,0)'); ctx.fillStyle = gradient;
    }
    ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.restore();
  };
  window.addEventListener('keydown', e => {
    if (!gesture) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); G.finish(true); return; }
    // Ne pas changer d'outil ou déclencher une commande au milieu du geste.
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  window.addEventListener('keyup', e => { if (gesture && e.key === 'Alt') { e.preventDefault(); G.finish(false); } }, true);
  window.addEventListener('blur', () => G.finish(false));
  KS.on('doc', () => { if (gesture && KS.state.doc !== gesture.doc) G.finish(true); });
  KS.on('tool', () => { if (gesture && T.current !== gesture.tool) G.finish(true); });
})();
