// Vectoriel : tracés de Bézier (plume, sélection directe), calques de forme
// modifiables, conversions tracé <-> sélection, fond et contour de tracé.
'use strict';
(() => {
  const U = KS.util, T = KS.tools, V = KS.view, h = KS.h, ui = KS.ui;
  const K = 0.5522847498;

  /* ---------------------------------------------------------------- géométrie */
  const P = (x, y) => ({ x, y, ix: x, iy: y, ox: x, oy: y });
  KS.translateSubpaths = (sp, dx, dy) => { for (const s of sp) for (const p of s.pts) { p.x += dx; p.y += dy; p.ix += dx; p.iy += dy; p.ox += dx; p.oy += dy; } };
  KS.mapSubpaths = (sp, fn) => { for (const s of sp) for (const p of s.pts) { [p.x, p.y] = fn(p.x, p.y); [p.ix, p.iy] = fn(p.ix, p.iy); [p.ox, p.oy] = fn(p.ox, p.oy); } };
  KS.subpathBounds = sp => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of sp) for (const p of s.pts) for (const [x, y] of [[p.x, p.y], [p.ix, p.iy], [p.ox, p.oy]]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  KS.subpathsToPath2D = (sp, dx = 0, dy = 0) => {
    const p = new Path2D();
    for (const s of sp) {
      const pts = s.pts; if (!pts.length) continue;
      p.moveTo(pts[0].x + dx, pts[0].y + dy);
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; p.bezierCurveTo(a.ox + dx, a.oy + dy, b.ix + dx, b.iy + dy, b.x + dx, b.y + dy); }
      if (s.closed && pts.length > 1) { const a = pts[pts.length - 1], b = pts[0]; p.bezierCurveTo(a.ox + dx, a.oy + dy, b.ix + dx, b.iy + dy, b.x + dx, b.y + dy); p.closePath(); }
    }
    return p;
  };
  const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
  // Points le long des segments (pour le contour au pinceau et les tests de proximité)
  KS.flattenSubpath = (s, step = 2) => {
    const out = [], pts = s.pts, n = pts.length + (s.closed ? 0 : -1);
    if (pts.length === 1) return [{ x: pts[0].x, y: pts[0].y, seg: 0, t: 0 }];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(a.ox - a.x, a.oy - a.y) + Math.hypot(b.ix - a.ox, b.iy - a.oy) + Math.hypot(b.x - b.ix, b.y - b.iy);
      const k = Math.max(2, Math.ceil(len / step));
      for (let j = 0; j < k; j++) { const t = j / k; out.push({ x: bez(a.x, a.ox, b.ix, b.x, t), y: bez(a.y, a.oy, b.iy, b.y, t), seg: i, t }); }
    }
    if (!s.closed) { const l = pts[pts.length - 1]; out.push({ x: l.x, y: l.y, seg: n - 1, t: 1 }); }
    return out;
  };
  // Coupe le segment i au paramètre t (de Casteljau) et insère le nouveau point
  KS.splitSegment = (s, i, t) => {
    const a = s.pts[i], b = s.pts[(i + 1) % s.pts.length];
    const L = (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const p0 = { x: a.x, y: a.y }, p1 = { x: a.ox, y: a.oy }, p2 = { x: b.ix, y: b.iy }, p3 = { x: b.x, y: b.y };
    const q0 = L(p0, p1), q1 = L(p1, p2), q2 = L(p2, p3), r0 = L(q0, q1), r1 = L(q1, q2), m = L(r0, r1);
    a.ox = q0.x; a.oy = q0.y; b.ix = q2.x; b.iy = q2.y;
    s.pts.splice(i + 1, 0, { x: m.x, y: m.y, ix: r0.x, iy: r0.y, ox: r1.x, oy: r1.y });
  };

  // Rayons des angles [haut-gauche, haut-droit, bas-droit, bas-gauche], réduits ensemble
  // si deux angles voisins dépassent le côté (comme border-radius).
  KS.rectRadii = (w, hh, radii) => {
    const r = (radii || [0, 0, 0, 0]).map(v => Math.max(0, +v || 0));
    const f = Math.min(1, w / (r[0] + r[1] || 1), w / (r[3] + r[2] || 1), hh / (r[0] + r[3] || 1), hh / (r[1] + r[2] || 1));
    return r.map(v => v * f);
  };
  KS.roundRectSubpaths = (x, y, w, hh, radii) => {
    const [a, b, c, d] = KS.rectRadii(w, hh, radii), pts = [];
    const add = (px, py, ix = px, iy = py, ox = px, oy = py) => pts.push({ x: px, y: py, ix, iy, ox, oy });
    if (a) add(x + a, y, x + a - a * K, y); else add(x, y);
    if (b) { add(x + w - b, y, x + w - b, y, x + w - b + b * K, y); add(x + w, y + b, x + w, y + b - b * K); } else add(x + w, y);
    if (c) { add(x + w, y + hh - c, x + w, y + hh - c, x + w, y + hh - c + c * K); add(x + w - c, y + hh, x + w - c + c * K, y + hh); } else add(x + w, y + hh);
    if (d) { add(x + d, y + hh, x + d, y + hh, x + d - d * K, y + hh); add(x, y + hh - d, x, y + hh - d + d * K); } else add(x, y + hh);
    if (a) add(x, y + a, x, y + a, x, y + a - a * K);
    return [{ closed: true, pts }];
  };
  // Rectangle « dynamique » d'un calque de forme : ses angles restent modifiables tant que
  // ses points n'ont été que déplacés. Renvoie la géométrie à jour, ou null.
  KS.liveRect = L => {
    const live = L && L.kind === 'shape' && L.shape && L.shape.live;
    if (!live || live.kind !== 'rect' || L.shape.subpaths.length !== 1) return null;
    const cur = L.shape.subpaths[0].pts, gen = KS.roundRectSubpaths(live.x, live.y, live.w, live.h, live.radii)[0].pts;
    if (cur.length !== gen.length) return null;
    const dx = cur[0].x - gen[0].x, dy = cur[0].y - gen[0].y, eq = (p, q) => Math.abs(p - q) < 0.01;
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i], q = gen[i];
      if (!eq(p.x, q.x + dx) || !eq(p.y, q.y + dy) || !eq(p.ix, q.ix + dx) || !eq(p.iy, q.iy + dy) || !eq(p.ox, q.ox + dx) || !eq(p.oy, q.oy + dy)) return null;
    }
    return { ...live, x: live.x + dx, y: live.y + dy, radii: live.radii.slice() };
  };

  // Formes de base en tracés (rectangle, ellipse, étoile…)
  KS.shapeSubpaths = (kind, g, o) => {
    const { x, y, w, h: hh } = g.r;
    const poly = list => [{ closed: true, pts: list.map(([px, py]) => P(px, py)) }];
    if (kind === 'rect') return KS.roundRectSubpaths(x, y, w, hh, o && o.radii);
    if (kind === 'ellipse') {
      const cx = x + w / 2, cy = y + hh / 2, rx = w / 2, ry = hh / 2;
      return [{ closed: true, pts: [
        { x: cx, y: cy - ry, ix: cx - rx * K, iy: cy - ry, ox: cx + rx * K, oy: cy - ry },
        { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ry * K, ox: cx + rx, oy: cy + ry * K },
        { x: cx, y: cy + ry, ix: cx + rx * K, iy: cy + ry, ox: cx - rx * K, oy: cy + ry },
        { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ry * K, ox: cx - rx, oy: cy - ry * K },
      ] }];
    }
    if (kind === 'round') {
      const r = Math.min(o.radius, w / 2, hh / 2), k = r * K;
      if (r <= 0) return KS.shapeSubpaths('rect', g, o);
      return [{ closed: true, pts: [
        { x: x + r, y, ix: x + r - k, iy: y, ox: x + r, oy: y }, { x: x + w - r, y, ix: x + w - r, iy: y, ox: x + w - r + k, oy: y },
        { x: x + w, y: y + r, ix: x + w, iy: y + r - k, ox: x + w, oy: y + r }, { x: x + w, y: y + hh - r, ix: x + w, iy: y + hh - r, ox: x + w, oy: y + hh - r + k },
        { x: x + w - r, y: y + hh, ix: x + w - r + k, iy: y + hh, ox: x + w - r, oy: y + hh }, { x: x + r, y: y + hh, ix: x + r, iy: y + hh, ox: x + r - k, oy: y + hh },
        { x, y: y + hh - r, ix: x, iy: y + hh - r + k, ox: x, oy: y + hh - r }, { x, y: y + r, ix: x, iy: y + r, ox: x, oy: y + r - k },
      ] }];
    }
    if (kind === 'polygon' || kind === 'star') {
      const n = Math.max(3, o.sides | 0), cx = x + w / 2, cy = y + hh / 2, cnt = kind === 'star' ? n * 2 : n, list = [];
      for (let i = 0; i < cnt; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / cnt, k = kind === 'star' && i % 2 ? o.inner / 100 : 1; list.push([cx + Math.cos(a) * w / 2 * k, cy + Math.sin(a) * hh / 2 * k]); }
      return poly(list);
    }
    if (kind === 'heart') {
      const cx = x + w / 2;
      return [{ closed: true, pts: [
        { x: cx, y: y + hh * 0.98, ix: x + w * 1.05, iy: y + hh * 0.62, ox: x - w * 0.05, oy: y + hh * 0.62 },
        { x: x + w * 0.27, y: y + hh * 0.04, ix: x, iy: y + hh * 0.05, ox: x + w * 0.4, oy: y + hh * 0.03 },
        { x: cx, y: y + hh * 0.28, ix: cx, iy: y + hh * 0.15, ox: cx, oy: y + hh * 0.15 },
        { x: x + w * 0.73, y: y + hh * 0.04, ix: x + w * 0.6, iy: y + hh * 0.03, ox: x + w, oy: y + hh * 0.05 },
      ] }];
    }
    if (kind === 'line' || kind === 'arrow') {
      const a = g.a, b = g.b, ang = Math.atan2(b.y - a.y, b.x - a.x), lw = o.weight, nx = -Math.sin(ang), ny = Math.cos(ang);
      if (kind === 'line') return poly([[a.x + nx * lw / 2, a.y + ny * lw / 2], [b.x + nx * lw / 2, b.y + ny * lw / 2], [b.x - nx * lw / 2, b.y - ny * lw / 2], [a.x - nx * lw / 2, a.y - ny * lw / 2]]);
      const head = Math.max(lw * 3.2, 12), hw = Math.max(lw * 2.4, 9), bx = b.x - Math.cos(ang) * head, by = b.y - Math.sin(ang) * head;
      return poly([[a.x + nx * lw / 2, a.y + ny * lw / 2], [bx + nx * lw / 2, by + ny * lw / 2], [bx + nx * hw, by + ny * hw], [b.x, b.y], [bx - nx * hw, by - ny * hw], [bx - nx * lw / 2, by - ny * lw / 2], [a.x - nx * lw / 2, a.y - ny * lw / 2]]);
    }
    return [];
  };
  KS.newShapeLayer = (doc, name, subpaths, o) => new KS.Layer({
    name, kind: 'shape',
    shape: { subpaths, fill: o.fill !== false, fillColor: o.fillColor || '#3d7cf0', stroke: !!o.stroke, strokeColor: o.strokeColor || '#000000', strokeWidth: o.strokeWidth || 0 },
  });

  /* ---------------------------------------------------------------- cible vectorielle */
  // Le calque de forme actif, sinon le tracé actif du document (créé à la demande)
  KS.vectorTarget = (doc, create = true) => {
    const L = doc.active;
    if (L && L.kind === 'shape' && !doc.activePathId) return { kind: 'shape', layer: L, subpaths: L.shape.subpaths, changed: () => { L.renderShape(); doc.changed(); } };
    let p = doc.activePath;
    if (!p && create) {
      p = doc.paths.find(q => q.work);
      if (!p) { p = { id: U.uid(), name: 'Tracé de travail', work: true, subpaths: [] }; doc.paths.push(p); }
      doc.activePathId = p.id; KS.emit('paths', doc);
    }
    if (!p) return null;
    return { kind: 'path', path: p, subpaths: p.subpaths, changed: () => { KS.emit('paths', doc); KS.requestRender(); } };
  };
  const drawVectors = (ctx, target, opts = {}) => {
    if (!target) return;
    const sp = target.subpaths;
    ctx.save();
    const path = KS.subpathsToPath2D(sp);
    V.docPath(ctx, c => { c.lineWidth = 1.3 / V.zoom; c.strokeStyle = V.colors.accent || '#3d7cf0'; c.stroke(path); });
    for (const s of sp) s.pts.forEach((p, i) => {
      const a = V.toScreen(p.x, p.y);
      const showH = opts.sel && opts.sel.s === s && Math.abs(opts.sel.i - i) <= 1 || opts.allHandles;
      if (showH) for (const [hx, hy] of [[p.ix, p.iy], [p.ox, p.oy]]) {
        if (hx === p.x && hy === p.y) continue;
        const q = V.toScreen(hx, hy);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(q.x, q.y); ctx.strokeStyle = 'rgba(61,124,240,.8)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = V.colors.accent; ctx.stroke();
      }
      const on = opts.sel && opts.sel.s === s && opts.sel.i === i;
      ctx.beginPath(); ctx.rect(Math.round(a.x) - 3.5, Math.round(a.y) - 3.5, 7, 7);
      ctx.fillStyle = on ? V.colors.accent : '#fff'; ctx.fill(); ctx.strokeStyle = V.colors.accent; ctx.lineWidth = 1.2; ctx.stroke();
    });
    ctx.restore();
  };
  KS.drawVectors = drawVectors;
  // Point / poignée / segment sous le pointeur (tolérance en pixels écran)
  const hitVector = (target, ev, tol = 7) => {
    if (!target) return null;
    const near = (x, y) => { const s = V.toScreen(x, y); return Math.hypot(s.x - ev.sx, s.y - ev.sy) <= tol; };
    for (const s of target.subpaths) for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i];
      if (near(p.ox, p.oy) && (p.ox !== p.x || p.oy !== p.y)) return { type: 'out', s, i };
      if (near(p.ix, p.iy) && (p.ix !== p.x || p.iy !== p.y)) return { type: 'in', s, i };
    }
    for (const s of target.subpaths) for (let i = 0; i < s.pts.length; i++) if (near(s.pts[i].x, s.pts[i].y)) return { type: 'anchor', s, i };
    for (const s of target.subpaths) {
      for (const q of KS.flattenSubpath(s, 3 / V.zoom)) if (near(q.x, q.y)) return { type: 'segment', s, seg: q.seg, t: q.t };
    }
    return null;
  };

  /* ---------------------------------------------------------------- plume */
  T.register({
    id: 'pen', name: 'Plume', icon: 'pen', shortcut: 'P', cursor: 'crosshair',
    defaults: { mode: 'path', autoAdd: true, fill: true, fillColor: '#3d7cf0', stroke: false, strokeColor: '#000000', strokeWidth: 3 },
    options() {
      const isShape = this.o.mode === 'shape';
      return [
        { type: 'seg', id: 'mode', options: [['path', 'Tracé', 'Créer un tracé'], ['shape', 'Forme', 'Créer un calque de forme']] },
        { type: 'sep' },
        isShape ? { type: 'check', id: 'fill', label: 'Fond' } : null, isShape ? { type: 'color', id: 'fillColor' } : null,
        isShape ? { type: 'check', id: 'stroke', label: 'Contour' } : null, isShape ? { type: 'color', id: 'strokeColor' } : null, isShape ? { type: 'scrub', id: 'strokeWidth', min: 0, max: 200, unit: 'px' } : null,
        isShape ? { type: 'sep' } : null,
        { type: 'check', id: 'autoAdd', label: 'Ajout/suppression auto' },
        { type: 'sep' },
        { type: 'button', text: 'Sélection', icon: 'select-all', action: () => KS.cmd.pathToSelection() },
        { type: 'button', text: 'Masque', icon: 'mask', action: () => { KS.cmd.pathToSelection(); KS.cmd.addMask('selection'); } },
        { type: 'button', text: 'Forme', icon: 'shape-star', action: () => KS.cmd.pathToShape() },
      ];
    },
    onOption(k) { if (k === 'mode') T.renderOptions(); },
    target(doc) {
      if (this.cur) return this.cur.target;
      if (this.o.mode === 'shape' && doc.active?.kind !== 'shape') return { kind: 'temp', subpaths: [] };
      return KS.vectorTarget(doc);
    },
    down(ev, doc) {
      let p = { x: ev.x, y: ev.y };
      if (this.cur) {
        const s = this.cur.s, f = s.pts[0], last = s.pts[s.pts.length - 1];
        if (ev.shift) p = KS.snap45(last, p);
        if (s.pts.length > 1 && Math.hypot(V.toScreen(f.x, f.y).x - ev.sx, V.toScreen(f.x, f.y).y - ev.sy) < 8) { s.closed = true; this.drag = { p: f, closing: true }; return; }
        const n = P(p.x, p.y); s.pts.push(n); this.drag = { p: n };
        this.cur.target.changed && this.cur.target.changed();
        return;
      }
      const target = this.o.mode === 'shape' && doc.active?.kind !== 'shape' ? null : KS.vectorTarget(doc);
      if (target && this.o.autoAdd) {
        const hit = hitVector(target, ev);
        if (hit && hit.type === 'anchor') {
          const before = KS.Hist.structSnap(doc);
          hit.s.pts.splice(hit.i, 1);
          if (!hit.s.pts.length) target.subpaths.splice(target.subpaths.indexOf(hit.s), 1);
          target.changed();
          doc.history.push({ name: 'Supprimer le point d\'ancrage', icon: 'pen', ...KS.Hist.structPart(doc, before) });
          return;
        }
        if (hit && hit.type === 'segment') {
          const before = KS.Hist.structSnap(doc);
          KS.splitSegment(hit.s, hit.seg, hit.t);
          target.changed();
          doc.history.push({ name: 'Ajouter un point d\'ancrage', icon: 'pen', ...KS.Hist.structPart(doc, before) });
          return;
        }
      }
      // nouveau sous-tracé
      const before = KS.Hist.structSnap(doc);
      const t = target || { kind: 'temp', subpaths: [] };
      const s = { closed: false, pts: [P(p.x, p.y)] };
      t.subpaths.push(s);
      this.cur = { target: t, s, before };
      this.drag = { p: s.pts[0] };
    },
    move(ev) {
      const d = this.drag; if (!d) return;
      const p = d.p;
      if (d.closing) { p.ix = 2 * p.x - ev.x; p.iy = 2 * p.y - ev.y; this.cur.target.changed && this.cur.target.changed(); return; }
      p.ox = ev.x; p.oy = ev.y;
      if (!ev.alt) { p.ix = 2 * p.x - ev.x; p.iy = 2 * p.y - ev.y; }
      this.cur && this.cur.target.changed && this.cur.target.changed();
    },
    up(ev, doc) {
      const d = this.drag; this.drag = null;
      if (d && d.closing) this.finish(doc);
    },
    hover() { KS.requestRender(); },
    finish(doc) {
      const c = this.cur; if (!c) return;
      this.cur = null;
      const s = c.s;
      if (s.pts.length < 2 && !s.closed) { c.target.subpaths.splice(c.target.subpaths.indexOf(s), 1); KS.requestRender(); return; }
      if (c.target.kind === 'temp') {
        const L = KS.newShapeLayer(doc, doc.newLayerName('Forme'), c.target.subpaths, this.o);
        doc.addLayer(L, doc.activeIndex + 1);
        doc.history.push({ name: 'Calque de forme', icon: 'pen', ...KS.Hist.structPart(doc, c.before) });
        KS.emit('layers', doc);
      } else {
        c.target.changed();
        doc.history.push({ name: 'Tracé à la plume', icon: 'pen', ...KS.Hist.structPart(doc, c.before) });
      }
      doc.changed();
    },
    key(e, doc) {
      if (!this.cur) {
        if (e.key === 'Enter' && e.ctrlKey !== true) return false;
        return false;
      }
      if (e.key === 'Enter' || e.key === 'Escape') { this.finish(doc); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const s = this.cur.s; s.pts.pop();
        if (!s.pts.length) { this.cur.target.subpaths.splice(this.cur.target.subpaths.indexOf(s), 1); this.cur = null; }
        KS.requestRender(); return true;
      }
      return false;
    },
    deactivate(doc) { if (this.cur && doc) this.finish(doc); },
    commitOnLeave(doc) { if (this.cur && doc) this.finish(doc); },
    cancel(doc) {
      const c = this.cur; if (!c) return;
      this.cur = null;
      const i = c.target.subpaths.indexOf(c.s); if (i >= 0) c.target.subpaths.splice(i, 1);
      if (c.target.changed) c.target.changed();
      void doc;
    },
    overlay(ctx, v, doc) {
      const t = this.target(doc);
      if (t && t.kind === 'temp' && this.cur) {
        ctx.globalAlpha = 0.6;
        V.docPath(ctx, c => { const p = KS.subpathsToPath2D(t.subpaths); if (this.o.fill) { c.fillStyle = this.o.fillColor; c.fill(p); } });
        ctx.globalAlpha = 1;
      }
      drawVectors(ctx, t, { sel: this.cur ? { s: this.cur.s, i: this.cur.s.pts.length - 1 } : null });
      // élastique vers le pointeur
      if (this.cur && !this.drag && V.mouse) {
        const l = this.cur.s.pts[this.cur.s.pts.length - 1];
        V.docPath(ctx, c => { c.beginPath(); c.moveTo(l.x, l.y); c.bezierCurveTo(l.ox, l.oy, V.mouse.x, V.mouse.y, V.mouse.x, V.mouse.y); c.lineWidth = 1 / V.zoom; c.strokeStyle = 'rgba(61,124,240,.7)'; c.setLineDash([4 / V.zoom, 3 / V.zoom]); c.stroke(); });
      }
    },
  });

  /* ---------------------------------------------------------------- sélection directe */
  T.register({
    id: 'path-select', name: 'Sélection directe', icon: 'direct-select', shortcut: 'A', cursor: 'default',
    options: () => [
      { type: 'custom', render: () => h('span.opt-label', { text: 'Glisser un point ou une poignée · glisser un segment : déplacer le sous-tracé · Alt sur un point : convertir · Suppr : supprimer le point' }) },
      { type: 'sep' },
      { type: 'button', text: 'Sélection', icon: 'select-all', action: () => KS.cmd.pathToSelection() },
    ],
    down(ev, doc) {
      const t = KS.vectorTarget(doc, false); if (!t) return;
      const hit = hitVector(t, ev);
      this.sel = hit && hit.type !== 'segment' ? { s: hit.s, i: hit.i } : null;
      if (!hit) { KS.requestRender(); return; }
      this.drag = { hit, t, p0: { x: ev.x, y: ev.y }, before: KS.Hist.structSnap(doc), orig: JSON.parse(JSON.stringify(hit.s.pts)) };
      if (hit.type === 'anchor' && ev.alt) {
        const p = hit.s.pts[hit.i];
        if (p.ix !== p.x || p.ox !== p.x || p.iy !== p.y || p.oy !== p.y) { p.ix = p.ox = p.x; p.iy = p.oy = p.y; }
        this.drag.convert = true;
      }
    },
    move(ev, doc) {
      const d = this.drag; if (!d) return;
      const dx = ev.x - d.p0.x, dy = ev.y - d.p0.y, s = d.hit.s, o = d.orig;
      if (d.hit.type === 'segment') { s.pts.forEach((p, i) => { const q = o[i]; Object.assign(p, { x: q.x + dx, y: q.y + dy, ix: q.ix + dx, iy: q.iy + dy, ox: q.ox + dx, oy: q.oy + dy }); }); }
      else {
        const p = s.pts[d.hit.i], q = o[d.hit.i];
        if (d.convert) { p.ox = ev.x; p.oy = ev.y; p.ix = 2 * p.x - ev.x; p.iy = 2 * p.y - ev.y; }
        else if (d.hit.type === 'anchor') Object.assign(p, { x: q.x + dx, y: q.y + dy, ix: q.ix + dx, iy: q.iy + dy, ox: q.ox + dx, oy: q.oy + dy });
        else if (d.hit.type === 'out') { p.ox = q.ox + dx; p.oy = q.oy + dy; if (!ev.alt) { const l = Math.hypot(q.ix - q.x, q.iy - q.y), a = Math.atan2(p.oy - p.y, p.ox - p.x) + Math.PI; p.ix = p.x + Math.cos(a) * l; p.iy = p.y + Math.sin(a) * l; } }
        else { p.ix = q.ix + dx; p.iy = q.iy + dy; if (!ev.alt) { const l = Math.hypot(q.ox - q.x, q.oy - q.y), a = Math.atan2(p.iy - p.y, p.ix - p.x) + Math.PI; p.ox = p.x + Math.cos(a) * l; p.oy = p.y + Math.sin(a) * l; } }
      }
      d.t.changed();
      void doc;
    },
    up(ev, doc) {
      const d = this.drag; this.drag = null; if (!d) return;
      if (ev.x !== d.p0.x || ev.y !== d.p0.y || d.convert) doc.history.push({ name: 'Modifier le tracé', icon: 'direct-select', ...KS.Hist.structPart(doc, d.before) });
    },
    key(e, doc) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) {
        const t = KS.vectorTarget(doc, false); if (!t) return false;
        const before = KS.Hist.structSnap(doc), s = this.sel.s;
        s.pts.splice(this.sel.i, 1);
        if (!s.pts.length) t.subpaths.splice(t.subpaths.indexOf(s), 1);
        this.sel = null; t.changed();
        doc.history.push({ name: 'Supprimer le point d\'ancrage', icon: 'direct-select', ...KS.Hist.structPart(doc, before) });
        return true;
      }
      return false;
    },
    overlay(ctx, v, doc) { drawVectors(ctx, KS.vectorTarget(doc, false), { sel: this.sel, allHandles: false }); },
  });

  /* ---------------------------------------------------------------- conversions et commandes */
  const C = KS.cmd;
  C.pathToSelection = (mode = 'new') => {
    const d = KS.state.doc; if (!d) return;
    const t = KS.vectorTarget(d, false);
    if (!t || !t.subpaths.length) { KS.toast('Aucun tracé', 'err'); return; }
    const p = KS.subpathsToPath2D(t.subpaths);
    KS.Hist.selection(d, 'Tracé → sélection', () => d.selection.combine(c => c.fill(p, 'evenodd'), mode), 'select-all');
  };
  C.pathToShape = () => {
    const d = KS.state.doc; if (!d) return;
    const t = KS.vectorTarget(d, false);
    if (!t || t.kind !== 'path' || !t.subpaths.length) { KS.toast('Aucun tracé à convertir', 'err'); return; }
    const o = T.byId.pen.o;
    KS.Hist.structure(d, 'Calque de forme', () => d.addLayer(KS.newShapeLayer(d, d.newLayerName('Forme'), JSON.parse(JSON.stringify(t.subpaths)), o), d.activeIndex + 1), 'shape-star');
  };
  C.fillPath = () => {
    const d = KS.state.doc; if (!d) return;
    const t = KS.vectorTarget(d, false); if (!t || !t.subpaths.length) return KS.toast('Aucun tracé', 'err');
    const p = KS.subpathsToPath2D(t.subpaths);
    C.applyPixels(d, 'Fond du tracé', 'fill', (c, info) => { const x = c.getContext('2d'); x.translate(-info.offset.x, -info.offset.y); x.fillStyle = U.hex(KS.state.fg); x.fill(p); return c; }, { ignoreSelection: true });
  };
  C.strokePath = () => {
    const d = KS.state.doc; if (!d) return;
    const t = KS.vectorTarget(d, false); if (!t || !t.subpaths.length) return KS.toast('Aucun tracé', 'err');
    const target = T.paintTarget(d); if (!target) return;
    const b = T.byId.brush.o, tok = T.beginHist(target);
    const st = new KS.Brush.Stroke({ doc: d, target, size: b.size, hardness: (b.hardness ?? 100) / 100, opacity: b.opacity / 100, flow: b.flow / 100, spacing: b.spacing / 100, color: T.paintColor(target), mode: 'paint', direct: target.gray, ignoreSelection: true });
    for (const s of t.subpaths) { const pts = KS.flattenSubpath(s, 1); if (!pts.length) continue; st.last = null; st.start({ x: pts[0].x, y: pts[0].y, pressure: 1 }); for (const q of pts) st.move({ x: q.x, y: q.y, pressure: 1 }); }
    const r = st.commit();
    if (target.after) target.after(st.dirtyMove || r); if (target.layer) target.layer.touch();
    T.commitHist(d, target, tok, r, 'Contour du tracé', 'stroke');
    d.changed();
  };
  // Sélection → tracé : suivi des contours du masque puis simplification (Douglas-Peucker)
  C.selectionToPath = () => {
    const d = KS.state.doc; if (!d || !d.selection.alpha) return KS.toast('Aucune sélection', 'err');
    const W = d.width, H = d.height, A = d.selection.alpha, at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && A[y * W + x] === 1;
    const edges = new Map(), key = (x, y) => y * (W + 1) + x;
    const add = (x0, y0, x1, y1) => { const k = key(x0, y0); if (!edges.has(k)) edges.set(k, []); edges.get(k).push([x1, y1]); };
    const b = d.selection.bounds;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
    const loops = [];
    for (const [k0, list] of edges) {
      while (list.length) {
        const sx = k0 % (W + 1), sy = Math.floor(k0 / (W + 1)), loop = [[sx, sy]];
        let [cx, cy] = list.pop(), guard = 0;
        while ((cx !== sx || cy !== sy) && guard++ < 1e7) {
          loop.push([cx, cy]);
          const nx = edges.get(key(cx, cy)); if (!nx || !nx.length) break;
          [cx, cy] = nx.pop();
        }
        if (loop.length > 3) loops.push(loop);
      }
    }
    const rdp = (pts, eps) => {
      if (pts.length < 3) return pts;
      let mx = 0, idx = 0; const a = pts[0], z = pts[pts.length - 1], dx = z[0] - a[0], dy = z[1] - a[1], L = Math.hypot(dx, dy) || 1;
      for (let i = 1; i < pts.length - 1; i++) { const dd = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L; if (dd > mx) { mx = dd; idx = i; } }
      if (mx <= eps) return [a, z];
      return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
    };
    const sub = loops.map(l => ({ closed: true, pts: rdp([...l, l[0]], 1.2).slice(0, -1).map(([x, y]) => P(x, y)) })).filter(s => s.pts.length >= 3);
    if (!sub.length) return;
    KS.Hist.structure(d, 'Tracé depuis la sélection', () => {
      const p = { id: U.uid(), name: 'Tracé de travail', work: true, subpaths: sub };
      d.paths = d.paths.filter(q => !q.work); d.paths.push(p); d.activePathId = p.id;
    }, 'pen');
    KS.emit('paths', d); KS.requestRender();
  };
  C.newPath = () => { const d = KS.state.doc; if (!d) return; KS.Hist.structure(d, 'Nouveau tracé', () => { const p = { id: U.uid(), name: 'Tracé ' + (d.paths.filter(q => !q.work).length + 1), subpaths: [] }; d.paths.push(p); d.activePathId = p.id; }, 'pen'); KS.emit('paths', d); };
  C.deletePath = () => { const d = KS.state.doc, p = d?.activePath; if (!p) return; KS.Hist.structure(d, 'Supprimer le tracé', () => { d.paths = d.paths.filter(q => q !== p); d.activePathId = null; }, 'trash'); KS.emit('paths', d); KS.requestRender(); };
  C.savePath = () => { const d = KS.state.doc, p = d?.activePath; if (!p || !p.work) return; KS.Hist.structure(d, 'Enregistrer le tracé', () => { p.work = false; p.name = 'Tracé ' + d.paths.filter(q => !q.work).length; }, 'pen'); KS.emit('paths', d); };

  /* ---------------------------------------------------------------- panneau Tracés */
  KS.panels.register('paths', {
    title: 'Tracés', flush: true,
    build(el) {
      this.el = el;
      const r = U.debounce(() => this.render(), 30);
      KS.on('paths', r); KS.on('doc', r); KS.on('history', r);
      this.render();
    },
    render() {
      const el = this.el, d = KS.state.doc;
      el.innerHTML = '';
      if (!d) { el.appendChild(h('div.empty-note', { text: 'Aucun document' })); return; }
      const list = h('div', { style: { padding: '4px' } });
      if (!d.paths.length) list.appendChild(h('div.empty-note', { text: 'Aucun tracé. Dessinez avec la plume (P).' }));
      for (const p of d.paths) {
        const cv = h('canvas', { width: 38, height: 34 });
        const x = cv.getContext('2d'), s = Math.min(38 / d.width, 34 / d.height);
        x.fillStyle = 'rgba(128,128,128,.25)'; x.fillRect((38 - d.width * s) / 2, (34 - d.height * s) / 2, d.width * s, d.height * s);
        x.translate((38 - d.width * s) / 2, (34 - d.height * s) / 2); x.scale(s, s); x.fillStyle = '#9aa6b5'; x.fill(KS.subpathsToPath2D(p.subpaths));
        const name = h('div.lname', { text: p.name, style: { fontStyle: p.work ? 'italic' : '' } });
        const row = h('div.layer-row' + (p.id === d.activePathId ? '.active' : ''), h('div.thumb', cv), name);
        row.addEventListener('click', () => { d.activePathId = d.activePathId === p.id ? null : p.id; if (d.active?.kind === 'shape') { /* rester sur le tracé */ } KS.emit('paths', d); KS.requestRender(); });
        row.addEventListener('dblclick', async () => { const n = await KS.prompt('Renommer le tracé', 'Nom', p.name); if (n) KS.Hist.structure(d, 'Renommer le tracé', () => { p.name = n; p.work = false; }, 'pen'); KS.emit('paths', d); });
        list.appendChild(row);
      }
      const bar = h('div.layers-bottom',
        ui.iconBtn('fill', 'Remplir le tracé (premier plan)', () => C.fillPath(), '.sm'),
        ui.iconBtn('stroke', 'Contour du tracé (pinceau)', () => C.strokePath(), '.sm'),
        ui.iconBtn('select-all', 'Tracé → sélection (Ctrl+Entrée)', () => C.pathToSelection(), '.sm'),
        ui.iconBtn('pen', 'Sélection → tracé', () => C.selectionToPath(), '.sm'),
        ui.iconBtn('shape-star', 'Tracé → calque de forme', () => C.pathToShape(), '.sm'),
        ui.iconBtn('save', 'Enregistrer le tracé de travail', () => C.savePath(), '.sm'),
        ui.iconBtn('new-layer', 'Nouveau tracé', () => C.newPath(), '.sm'),
        ui.iconBtn('trash', 'Supprimer le tracé', () => C.deletePath(), '.sm'));
      el.append(list, bar);
    },
  });
})();
