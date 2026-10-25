// Worker d'encodage PNG (fichiers .ksp, copies de secours) : reçoit l'instantané d'un calque,
// renvoie son URL data: en octets. Un calque déjà vu dont l'empreinte des pixels n'a pas changé
// n'est pas réencodé : on renvoie le PNG précédent.
'use strict';
const cache = new Map();                       // clé (calque, masque, couche) -> { sum, bytes }
const LIMIT = 96 * 1048576;                    // octets gardés par worker
const HASH_MAX = 50e6;                         // au-delà (pixels), pas d'empreinte : encodage direct
const text = new TextEncoder();
let held = 0;

// Empreinte 64 bits (deux lignes de mélange) de tous les pixels, lue mot par mot.
function digest(px) {
  const u = new Uint32Array(px.buffer, px.byteOffset, px.byteLength >> 2);
  let a = 0x811c9dc5 | 0, b = 0x9e3779b9 | 0;
  for (let i = 0; i < u.length; i++) {
    const v = u[i];
    a = Math.imul(a ^ v, 0x01000193);
    b = Math.imul((b + v) | 0, 0x85ebca6b) ^ (b >>> 13);
  }
  return (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
}
function keep(key, entry) {
  const old = cache.get(key);
  if (old) { cache.delete(key); held -= old.bytes.length; }
  cache.set(key, entry); held += entry.bytes.length;
  while (held > LIMIT && cache.size > 1) {
    const [k, v] = cache.entries().next().value;
    cache.delete(k); held -= v.bytes.length;
  }
}
onmessage = async e => {
  const m = e.data;
  if (m.clear) { cache.clear(); held = 0; return; }
  const { id, key, bitmap } = m;
  try {
    const w = bitmap.width, h = bitmap.height;
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bitmap, 0, 0); bitmap.close();
    const sum = key != null && w * h <= HASH_MAX ? w + 'x' + h + '.' + digest(x.getImageData(0, 0, w, h).data) : null;
    const old = sum && cache.get(key);
    let bytes;
    if (old && old.sum === sum) { cache.delete(key); cache.set(key, old); bytes = old.bytes; }
    else {
      bytes = text.encode(new FileReaderSync().readAsDataURL(await c.convertToBlob({ type: 'image/png' })));
      if (sum) keep(key, { sum, bytes });
    }
    const out = bytes.slice();
    postMessage({ id, bytes: out }, [out.buffer]);
  } catch (err) { postMessage({ id, error: String((err && err.message) || err) }); }
};
