// Aperçu partagé du Studio : zoom au pointeur, taille réelle, ajustement et déplacement.
'use strict';
(() => {
  const states = new WeakMap(), instances = new Set();
  let space = false;
  document.addEventListener('keydown', e => { if (e.code === 'Space' && e.target.closest?.('.iv-viewport')) { space = true; e.preventDefault(); } }, true);
  document.addEventListener('keyup', e => { if (e.code === 'Space') space = false; }, true);
  window.addEventListener('blur', () => { space = false; });
  const detached = new MutationObserver(() => { for (const i of instances) if (!i.host.isConnected) { i.observer.disconnect(); instances.delete(i); } });
  detached.observe(document.documentElement, { subtree: true, childList: true });
  KS.preview = { open(media, width, height) {
    const image = KS.h('img', { src: media.tagName === 'CANVAS' ? media.toDataURL('image/png') : media.currentSrc || media.src, alt: 'Image en plein écran' });
    const host = KS.h('div.iv-fullscreen');
    const previous = document.activeElement;
    const modal = KS.modal({ title: 'Aperçu plein écran', body: host, closeOnBackdrop: true, noFoot: true,
      onClose: () => previous?.isConnected && previous.focus() });
    modal.back.classList.add('iv-lightbox');
    const preview = KS.preview.mount(host, image, { width, height, fullscreen: false });
    preview.area.addEventListener('click', e => { if (e.target === preview.area && !e.defaultPrevented) modal.close(); });
    preview.area.focus();
    return modal;
  }, mount(host, media, { identity = media, width, height, paint = false, fullscreen = true } = {}) {
    const h = KS.h;
    let state = states.get(identity); if (!state) { state = { scale: 1, x: 0, y: 0, fit: true }; states.set(identity, state); }
    host.classList.add('iv-host');
    const area = h('div.iv-viewport', { tabIndex: 0, 'aria-label': paint ? 'Aperçu du masque · molette : zoom · bouton central ou Espace : déplacer' : 'Aperçu · molette : zoom · glisser : déplacer' });
    media.classList.add('iv-media'); area.append(media);
    const label = h('span.iv-scale', { text: 'Ajusté', 'aria-live': 'polite' });
    const button = (text, title, fn) => { const b = h('button', { text, title, type: 'button' }); b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); }); return b; };
    let drag = null, dragged = false;
    const size = () => ({ w: width || media.naturalWidth || media.width || 1, h: height || media.naturalHeight || media.height || 1 });
    const render = () => {
      const s = size(), w = area.clientWidth, hh = area.clientHeight; if (!w || !hh) return;
      if (state.fit) { state.scale = Math.min((w - 16) / s.w, (hh - 16) / s.h, 1); state.x = state.y = 0; }
      state.scale = Math.max(.01, state.scale);
      media.style.width = s.w + 'px'; media.style.height = s.h + 'px';
      media.style.transform = `translate(-50%, -50%) translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
      label.textContent = Math.round(state.scale * 100) + ' %'; area.dataset.scale = state.scale;
    };
    const zoom = (value, clientX, clientY) => {
      const rect = area.getBoundingClientRect(), x = clientX == null ? 0 : clientX - rect.left - rect.width / 2, y = clientY == null ? 0 : clientY - rect.top - rect.height / 2;
      const next = Math.min(16, Math.max(.01, value)), k = next / state.scale;
      state.x = x - (x - state.x) * k; state.y = y - (y - state.y) * k; state.scale = next; state.fit = false; render();
    };
    const controls = h('div.iv-controls', button('−', 'Réduire le zoom', () => zoom(state.scale / 1.25)), label,
      button('+', 'Augmenter le zoom', () => zoom(state.scale * 1.25)), button('Image entière', 'Réinitialiser le zoom et afficher toute l’image dans son cadre', () => { state.fit = true; render(); }),
      button('100 %', 'Taille réelle : un pixel de l’image par pixel d’écran', () => { state.x = state.y = 0; zoom(1); }),
      fullscreen ? button('⛶', 'Voir l’image en plein écran · cliquer autour ou Échap pour fermer', () => KS.preview.open(media, size().w, size().h)) : null);
    if (fullscreen) {
      media.title = 'Double-clic : voir l’image en plein écran';
      media.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); KS.preview.open(media, size().w, size().h); });
      label.title = 'Voir l’image en plein écran'; label.tabIndex = 0; label.setAttribute('role', 'button');
      label.addEventListener('click', e => { e.stopPropagation(); KS.preview.open(media, size().w, size().h); });
      label.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); KS.preview.open(media, size().w, size().h); } }); }
    controls.addEventListener('pointerdown', e => e.stopPropagation());
    controls.addEventListener('keydown', e => e.stopPropagation());
    host.append(controls, area);
    area.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); zoom(state.scale * Math.exp(-e.deltaY * .002), e.clientX, e.clientY); }, { passive: false });
    area.addEventListener('pointerdown', e => {
      if (e.button !== 1 && !(e.button === 0 && (!paint || space))) return;
      e.preventDefault(); e.stopImmediatePropagation(); area.focus();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: state.x, py: state.y }; dragged = false;
      try { area.setPointerCapture(e.pointerId); } catch { /* pointeur synthétique */ }
    }, true);
    area.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return; e.preventDefault(); e.stopPropagation();
      dragged ||= Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3;
      state.fit = false; state.x = drag.px + e.clientX - drag.x; state.y = drag.py + e.clientY - drag.y; render();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) area.addEventListener(type, e => { if (drag?.id === e.pointerId) drag = null; });
    area.addEventListener('click', e => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } });
    area.addEventListener('keydown', e => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); e.stopPropagation(); zoom(state.scale * 1.25); }
      else if (e.key === '-') { e.preventDefault(); e.stopPropagation(); zoom(state.scale / 1.25); }
      else if (e.key === '0') { e.preventDefault(); e.stopPropagation(); state.fit = true; render(); }
    });
    const observer = new ResizeObserver(render); observer.observe(area); instances.add({ host, observer });
    media.addEventListener('load', render); requestAnimationFrame(render);
    return { area, fit() { state.fit = true; render(); }, zoom, state };
  } };
})();
