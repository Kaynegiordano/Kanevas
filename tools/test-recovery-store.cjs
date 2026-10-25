// Copies de secours : deux générations, lecture de l'en-tête sans charger l'image, compatibilité des anciennes copies.
// node tools/test-recovery-store.cjs
'use strict';
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const createStore = require('../recovery-store.cjs');
const ksp = (w, h, extra = '') => Buffer.from(JSON.stringify({ app: 'Kanevas', version: 2, width: w, height: h, guides: {}, active: 0, thumb: null, layers: [{ name: 'Fond' + extra }] }));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-recovery-'));
  try {
    const store = createStore(dir);
    const a = await store.write('doc1', { name: 'Essai « secours »', path: 'C:\\x\\"y".ksp', format: 'ksp' }, new Uint8Array(ksp(640, 480)));
    assert.strictEqual(a.width, 640); assert.strictEqual(a.height, 480);
    const b = await store.write('doc1', { name: 'Essai « secours »', path: null, format: null }, ksp(800, 600, ' 2'));
    assert.ok(b.savedAt > a.savedAt, 'la génération suivante est plus récente');
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['doc1.0.json', 'doc1.1.json']);
    // un nouveau magasin (redémarrage) retrouve la bonne génération par l'en-tête seul
    const again = createStore(dir);
    const list = await again.list();
    assert.strictEqual(list.entries.length, 1); assert.strictEqual(list.entries[0].width, 800); assert.strictEqual(list.unreadable, 0);
    const c = await again.write('doc1', { name: 'n' }, ksp(10, 20, ' 3'));
    assert.ok(c.savedAt > b.savedAt);
    assert.ok(JSON.parse((await again.read('doc1')).data.toString('utf8')).layers[0].name.endsWith(' 3'), 'la lecture rend la dernière copie');
    // le fichier reste au format version 1 lisible par les versions précédentes
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'doc1.0.json'), 'utf8'));
    assert.strictEqual(raw.version, 1); assert.strictEqual(raw.id, 'doc1');
    assert.strictEqual(JSON.parse(Buffer.from(raw.data, 'base64').toString('utf8')).width, 10);
    // copie interrompue (fichier tronqué) : ignorée, l'autre génération reste lisible
    const full = fs.readFileSync(path.join(dir, 'doc1.0.json'));
    fs.writeFileSync(path.join(dir, 'doc1.0.json'), full.subarray(0, full.length - 10));
    const l2 = await createStore(dir).list();
    assert.strictEqual(l2.entries[0].width, 800, 'génération précédente');
    assert.strictEqual(JSON.parse((await createStore(dir).read('doc1')).data.toString('utf8')).width, 800);
    // ancienne copie écrite d'un bloc (JSON.stringify du record entier) : toujours lue
    const old = { version: 1, id: 'old', name: 'Ancien', path: null, format: null, width: 3, height: 4, savedAt: 1000, data: ksp(3, 4).toString('base64') };
    fs.writeFileSync(path.join(dir, 'old.0.json'), JSON.stringify(old));
    const l3 = await createStore(dir).list();
    assert.ok(l3.entries.some(e => e.id === 'old' && e.width === 3));
    // .ksp d'un autre producteur (ordre des clés différent) : validation complète
    const other = Buffer.from(JSON.stringify({ width: 5, height: 6, app: 'Kanevas', layers: [] }));
    assert.strictEqual((await createStore(dir).write('other', { name: 'o' }, other)).width, 5);
    await assert.rejects(createStore(dir).write('bad', { name: 'b' }, Buffer.from('{"app":"Autre","layers":[]}')));
    await again.remove('doc1');
    assert.ok(!fs.readdirSync(dir).some(n => n.startsWith('doc1.')));
    console.log('test-recovery-store : OK');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
