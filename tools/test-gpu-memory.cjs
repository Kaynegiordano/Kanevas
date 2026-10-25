'use strict';
const assert = require('node:assert/strict');
const monitor = require('../gpu-memory.cjs');
(async () => {
  const sample = monitor.parseMemory('0, NVIDIA RTX, 1302, 16275\r\n1, NVIDIA GTX, 256, 8192\r\n');
  assert.equal(sample.used, 1558); assert.equal(sample.total, 24467); assert.equal(sample.devices.length, 2);
  for (const csv of ['', '0, NVIDIA RTX, N/A, 16000', '0, NVIDIA RTX, 20, 0', '0, NVIDIA RTX, 17000, 16000']) assert.throws(() => monitor.parseMemory(csv));
  let calls = 0, callback;
  const read = monitor((_exe, args, options, cb) => {
    calls++; callback = cb;
    assert(options.windowsHide && options.timeout <= 3000);
    assert(args.includes('--format=csv,noheader,nounits'));
  });
  const first = read(), second = read(); assert.equal(first, second); assert.equal(calls, 1);
  callback(null, '0, NVIDIA RTX, 0, 16275'); assert.equal((await first).used, 0);
  assert.equal((await read()).total, 16275); assert.equal(calls, 1);
  const failed = monitor((_exe, _args, _options, cb) => cb(new Error('timeout')));
  assert.equal((await failed()).ok, false);
  // relevé continu : un seul processus, mesures lues dans son flux (lignes coupées comprises), redémarré après arrêt
  const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
  let spawned = 0, killed = 0, shots = 0, proc;
  const fakeSpawn = (_exe, args, options) => {
    spawned++; assert(args.includes('-lms') && options.windowsHide);
    proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.kill = () => { killed++; proc.emit('exit', null); };
    return proc;
  };
  const live = monitor((_exe, _args, _options, cb) => { shots++; cb(null, '0, NVIDIA RTX, 100, 16000'); }, fakeSpawn);
  assert.equal((await live()).used, 100, 'pas encore de relevé : lecture ponctuelle');
  proc.stdout.write('0, NVIDIA RTX, 2000, 16000\r\n1, NVIDIA GTX, 10');
  await new Promise(r => setImmediate(r));
  assert.equal((await live()).used, 2000); assert.equal(shots, 1); assert.equal(spawned, 1);
  proc.stdout.write('0, 8192\r\n'); await new Promise(r => setImmediate(r));
  const both = await live(); assert.equal(both.used, 2100); assert.equal(both.total, 24192); assert.equal(both.devices.length, 2);
  live.stop(); assert.equal(killed, 1); assert.equal(live.streaming(), false);
  await live(); assert.equal(spawned, 2, 'relancé à la lecture suivante'); live.stop();
  const real = await monitor()();
  if (process.env.KANEVAS_REQUIRE_GPU) assert(real.ok, real.error);
  console.log('OK VRAM : plusieurs cartes, valeurs invalides, requêtes groupées, délai borné et erreur sans ancienne mesure');
  console.log(JSON.stringify({ driver: real.ok, used: real.used, total: real.total, devices: real.devices?.map(d => d.name) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
