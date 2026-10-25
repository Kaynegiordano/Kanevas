'use strict';
const fs = require('fs/promises');
const path = require('path');

// Deux générations par document. Le fichier précédent reste lisible si l'écriture
// suivante est interrompue ; aucune copie ne remplace le projet de l'utilisateur.
module.exports = function createRecoveryStore(directory) {
  const queues = new Map();
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
  function filename(id, slot) {
    if (!validId(id)) throw new Error('Identifiant de récupération invalide');
    return path.join(directory, `${id}.${slot}.json`);
  }
  function enqueue(id, fn) {
    filename(id, 0);
    const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(id, next);
    next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
    return next;
  }
  async function versions(id) {
    const all = [];
    for (const slot of [0, 1]) {
      try {
        const record = JSON.parse(await fs.readFile(filename(id, slot), 'utf8'));
        if (record.version !== 1 || record.id !== id || !Number.isFinite(record.savedAt) || typeof record.data !== 'string') continue;
        const data = Buffer.from(record.data, 'base64');
        const doc = JSON.parse(data.toString('utf8'));
        if (!['Kanevas', 'KaneShop'].includes(doc.app) || !Array.isArray(doc.layers) || !(doc.width > 0 && doc.height > 0)) continue;
        all.push({ ...record, data, slot });
      } catch (err) { if (!['ENOENT', 'ENOTDIR'].includes(err.code) && !(err instanceof SyntaxError)) throw err; }
    }
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }
  function summary(record) {
    return { id: record.id, name: record.name, path: record.path, format: record.format, savedAt: record.savedAt, width: record.width, height: record.height };
  }
  // En-tête d'une copie (tout ce qui précède « data ») lu sans charger ni décoder l'image : null si la copie est
  // absente ou incomplète, undefined si l'en-tête ne tient pas dans le début du fichier (lecture complète).
  async function head(id, slot) {
    let handle;
    try { handle = await fs.open(filename(id, slot), 'r'); } catch (err) { if (['ENOENT', 'ENOTDIR'].includes(err.code)) return null; throw err; }
    try {
      const { size } = await handle.stat();
      if (size < 40) return null;
      const start = Buffer.alloc(Math.min(size, 16384)), end = Buffer.alloc(2);
      await handle.read(start, 0, start.length, 0); await handle.read(end, 0, 2, size - 2);
      const text = start.toString('utf8'), at = text.indexOf(',"data":"');
      if (at < 0) return undefined;
      if (end.toString('latin1') !== '"}') return null;
      const record = JSON.parse(text.slice(0, at) + '}');
      return record.version === 1 && record.id === id && Number.isFinite(record.savedAt) ? { ...record, slot } : null;
    } catch (err) { if (err instanceof SyntaxError) return null; throw err; } finally { await handle.close(); }
  }
  async function latest(id) {
    const found = [];
    for (const slot of [0, 1]) {
      const h = await head(id, slot);
      if (h === undefined) return (await versions(id))[0] || null;
      if (h) found.push(h);
    }
    return found.sort((a, b) => b.savedAt - a.savedAt)[0] || null;
  }
  // Taille du document d'après le début du .ksp produit par Kanevas ; sinon, validation complète.
  function kspSize(data) {
    const m = /^\{"app":"(?:Kanevas|KaneShop)","version":\d+,"width":(\d+),"height":(\d+),/.exec(data.subarray(0, 200).toString('utf8'));
    if (m && data[data.length - 1] === 0x7d) return { width: +m[1], height: +m[2] };
    const doc = JSON.parse(data.toString('utf8'));
    if (!['Kanevas', 'KaneShop'].includes(doc.app) || !Array.isArray(doc.layers)) throw new Error('Copie de récupération invalide');
    return { width: doc.width, height: doc.height };
  }
  const known = new Map();             // dernière génération écrite par document : { slot, savedAt }
  return {
    write(id, metadata, input) {
      return enqueue(id, async () => {
        await fs.mkdir(directory, { recursive: true });
        const old = known.get(id) || await latest(id);
        const slot = old ? 1 - old.slot : 0;
        const data = ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : Buffer.from(input);
        const { width, height } = kspSize(data);
        const record = { version: 1, id, name: String(metadata.name || 'Sans titre'), path: typeof metadata.path === 'string' ? metadata.path : null,
          format: typeof metadata.format === 'string' ? metadata.format : null, width, height, savedAt: Math.max(Date.now(), (old?.savedAt || 0) + 1) };
        // même fichier qu'avant ({ …, "data": "<base64>" }), écrit par morceaux : pas de copie géante en mémoire
        const target = filename(id, slot), temp = target + '.tmp';
        const handle = await fs.open(temp, 'w');
        try {
          await handle.write(JSON.stringify(record).slice(0, -1) + ',"data":"');
          await handle.write(data.toString('base64'));
          await handle.write('"}');
          await handle.sync();
        } finally { await handle.close(); }
        await fs.rename(temp, target);
        known.set(id, { slot, savedAt: record.savedAt });
        return summary(record);
      });
    },
    read(id) {
      return enqueue(id, async () => {
        const record = (await versions(id))[0];
        if (!record) throw new Error('Aucune copie lisible pour ce document');
        return { ...summary(record), data: record.data };
      });
    },
    async list() {
      await Promise.all([...queues.values()].map(p => p.catch(() => {})));
      let names;
      try { names = await fs.readdir(directory); } catch (err) { if (err.code === 'ENOENT') return { entries: [], unreadable: 0 }; throw err; }
      const ids = [...new Set(names.map(n => /^([a-zA-Z0-9_-]{1,80})\.[01]\.json$/.exec(n)?.[1]).filter(Boolean))];
      const entries = []; let unreadable = 0;
      for (const id of ids) { const record = await latest(id); if (record) entries.push(summary(record)); else unreadable++; }
      return { entries: entries.sort((a, b) => b.savedAt - a.savedAt), unreadable };
    },
    remove(id) {
      known.delete(id);
      return enqueue(id, async () => {
        for (const slot of [0, 1]) {
          await fs.rm(filename(id, slot), { force: true });
          await fs.rm(filename(id, slot) + '.tmp', { force: true });
        }
      });
    },
  };
};
