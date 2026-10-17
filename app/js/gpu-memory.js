// Une seule jauge dans le cadre commun, y compris lorsque Studio est arrêté.
'use strict';
(() => {
  const root = document.querySelector('#gpu-status');
  const value = root.querySelector('.gpu-memory-value'), bar = root.querySelector('progress');
  let pending;
  async function read() {
    try {
      const r = await KS.native?.gpuMemory?.();
      if (!r?.ok || !Number.isFinite(r.used) || !Number.isFinite(r.total) || !Number.isFinite(r.measuredAt) || r.total <= 0 || r.used < 0 || r.used > r.total || Date.now() - r.measuredAt > 10000) throw new Error('Mesure indisponible');
      const percent = Math.round(r.used / r.total * 100);
      value.textContent = `${Math.round(r.used).toLocaleString('fr-FR')} / ${Math.round(r.total).toLocaleString('fr-FR')} Mo`;
      bar.value = percent; bar.hidden = false;
      root.dataset.state = percent >= 90 ? 'high' : 'ready';
      root.title = 'Mémoire graphique utilisée par toutes les applications · actualisée toutes les 3 secondes\n' +
        (r.devices || []).map(d => `${d.name} : ${Math.round(d.used)} / ${Math.round(d.total)} Mo`).join('\n');
    } catch {
      value.textContent = 'Indisponible'; bar.hidden = true;
      root.dataset.state = 'unavailable';
      root.title = 'Le pilote NVIDIA ne fournit pas de mesure. Nouvelle tentative automatique toutes les 3 secondes.';
    }
  }
  function refresh() {
    if (document.hidden) return Promise.resolve();
    if (!pending) pending = read().finally(() => { pending = null; });
    return pending;
  }
  KS.gpuMemory = { refresh };
  setInterval(refresh, 3000);
  document.addEventListener('visibilitychange', () => {
    // Ne pas laisser une ancienne valeur visible après une mise en veille.
    value.textContent = 'Lecture…'; bar.hidden = true; root.dataset.state = 'loading';
    if (!document.hidden) refresh();
  });
  refresh();
})();
