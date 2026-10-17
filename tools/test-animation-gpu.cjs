const assert = require('node:assert/strict');
const create = require('../animation-gpu.cjs');
const wait = async test => { const until = Date.now() + 1500; while (!test() && Date.now() < until) await new Promise(r => setTimeout(r, 10)); assert(test(), 'Attente GPU'); };
(async () => {
  let releases = 0, state = 'en cours', offline = false, refuse = false;
  const events = [];
  const gpu = create({ interval: 5,
    release: async () => { if (refuse) throw new Error('Studio occupé'); releases++; },
    status: async () => { if (offline) throw new Error('serveur indisponible'); return { etat: state }; },
    changed: s => events.push(s),
  });
  await gpu.run('Projet', async () => ({ lance: true }));
  assert(gpu.state().busy); assert.equal(releases, 1);
  await assert.rejects(gpu.run('Autre', async () => ({ lance: true })), /déjà/);
  offline = true; await wait(() => gpu.state().error.includes('indisponible'));
  assert.equal(releases, 1, 'Un état inconnu ne décharge pas une tâche active');
  offline = false; state = 'fini'; await wait(() => !gpu.state().busy);
  assert.equal(releases, 2);
  await gpu.run('Refusé', async () => ({ lance: false }));
  assert(!gpu.state().busy); assert.equal(releases, 4);
  await gpu.run('SAM', async () => ({ masque: 'png' }), { synchronous: true });
  assert(!gpu.state().busy); assert.equal(releases, 6);
  refuse = true; let submitted = false;
  await assert.rejects(gpu.run('Occupé', async () => { submitted = true; }), /Studio occupé/);
  assert(!submitted && !gpu.state().busy); refuse = false;
  state = 'en cours'; offline = true;
  await assert.rejects(gpu.run('Réponse perdue', async () => { throw new Error('liaison perdue'); }), /liaison perdue/);
  assert(gpu.state().busy, 'Un POST peut avoir été accepté malgré une réponse perdue');
  offline = false; state = 'erreur'; await wait(() => !gpu.state().busy);
  state = 'en cours'; await gpu.run('Arrêt explicite', async () => ({ lance: true }));
  await gpu.stopped(); assert(!gpu.state().busy);
  await assert.rejects(gpu.run('SAM inconnu', async () => { throw new Error('liaison perdue'); }, { synchronous: true }));
  assert(gpu.state().busy && gpu.state().error.includes('Segmentation'));
  await gpu.stopped();
  assert(events.some(e => e.busy) && events.some(e => !e.busy));
  console.log('OK Réservation exclusive, décharge avant/après, refus, erreur, SAM, réponse perdue, panne réseau et arrêt explicite');
})().catch(e => { console.error(e); process.exitCode = 1; });
