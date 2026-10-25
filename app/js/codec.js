// Encodage des images hors du fil de l'interface : fichiers .ksp et copies de secours.
// Les PNG des calques sont produits en parallèle par des workers (png-worker.js) à partir d'instantanés
// pris dans la même tâche, donc cohérents même si l'on continue de peindre. Sans workers : toDataURL.
'use strict';
(() => {
  const able = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function' && typeof FileReader !== 'undefined';
  const pool = [], jobs = new Map();
  let seq = 0, broken = !able;
  const size = () => Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
  // un calque va toujours au même worker : c'est lui qui garde son dernier PNG
  const slot = key => { let h = 2166136261; for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619); return (h >>> 0) % size(); };
  function worker(i) {
    if (pool[i]) return pool[i];
    const w = new Worker('js/png-worker.js');
    w.onmessage = e => {
      const j = jobs.get(e.data.id); if (!j) return;
      jobs.delete(e.data.id);
      e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data.bytes);
    };
    w.onerror = e => {
      e.preventDefault?.(); broken = true;
      for (const [id, j] of jobs) if (j.w === w) { jobs.delete(id); j.reject(new Error(e.message || 'Encodeur PNG indisponible')); }
      pool.forEach(p => p && p.terminate()); pool.length = 0;
    };
    return (pool[i] = w);
  }
  const K = KS.codec = {};
  K.available = () => !broken;
  // [{ canvas, key }] -> URL data: PNG en octets, dans l'ordre. Les instantanés sont pris avant le premier « await ».
  K.pngs = list => {
    if (broken) return Promise.reject(new Error('Encodeur PNG indisponible'));
    const snaps = list.map(it => createImageBitmap(it.canvas));
    return Promise.all(snaps.map(async (snap, n) => {
      const bitmap = await snap, key = list[n].key != null ? String(list[n].key) : null;
      const w = worker(key != null ? slot(key) : n % size()), id = ++seq;
      return new Promise((resolve, reject) => { jobs.set(id, { resolve, reject, w }); w.postMessage({ id, key, bitmap }, [bitmap]); });
    }));
  };
  // Oublie les PNG gardés (plus aucun document ouvert).
  K.clear = () => { for (const w of pool) w && w.postMessage({ clear: true }); };
  KS.on('doc', () => { if (!KS.state.docs.length) K.clear(); });
})();
