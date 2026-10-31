const assert = require('node:assert/strict');
const create = require('../onnx-sessions.cjs');
async function main() {
  let gpuRuns = 0, cpuRuns = 0, released = 0, active = 0, peak = 0;
  const created = [];
  const loadOrt = () => ({ InferenceSession: { create: async (file, opts) => {
    created.push(opts);
    const gpu = opts.executionProviders[0] === 'dml';
    return { inputNames: ['input'], outputNames: ['output'], release: async () => { released++; },
      run: async feeds => {
        active++; peak = Math.max(active, peak);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        if (gpu) { gpuRuns++; throw new Error('887A0005 GPU device removed'); }
        cpuRuns++; return { output: feeds.input };
      } };
  } } });
  const session = create({ loadOrt, modelPath: id => id, models: { segment: {} }, warn() {} });
  const [a, b] = await Promise.all([session('segment'), session('segment')]);
  assert.equal(a, b, 'concurrent loads share one session');
  const results = await Promise.all([a.run({ input: 1 }), a.run({ input: 2 }), a.run({ input: 3 })]);
  assert.deepEqual(results, [{ output: 1 }, { output: 2 }, { output: 3 }]);
  assert.equal(gpuRuns, 1, 'the failed GPU must never be reused');
  assert.equal(cpuRuns, 3);
  assert.equal(released, 1);
  assert.equal(peak, 1, 'runs must not overlap');
  assert.equal(a._ep, 'cpu');
  assert.deepEqual(created[0], { executionProviders: ['dml'], graphOptimizationLevel: 'all', executionMode: 'sequential', enableMemPattern: false });
  assert.equal(created.length, 2);

  let attempts = 0;
  const failure = new Error('CPU model unavailable');
  const retry = create({ models: { segment: {} }, modelPath: id => id, warn() {}, loadOrt: () => ({ InferenceSession: { create: async (_file, options) => {
    if (options.executionProviders[0] === 'dml') return { inputNames: ['in'], outputNames: ['out'], release: async () => {}, run: async () => { throw Error('device hung'); } };
    if (++attempts === 1) throw failure;
    return { inputNames: ['in'], outputNames: ['out'], run: async () => 'recovered' };
  } } }) });
  const s = await retry('segment');
  await assert.rejects(s.run({}), error => error === failure);
  assert.deepEqual(s.inputNames, ['in']);
  assert.equal(await s.run({}), 'recovered', 'CPU loading can recover after a failed fallback');
  const cpuError = new Error('bad CPU input');
  const cpu = create({ models: { lama: { cpu: true } }, modelPath: id => id, warn() {}, loadOrt: () => ({ InferenceSession: { create: async (_file, options) => {
    assert.deepEqual(options.executionProviders, ['cpu']);
    return { run: async () => { throw cpuError; } };
  } } }) });
  await assert.rejects((await cpu('lama')).run({}), error => error === cpuError);
  console.log('ONNX: serialized runs, GPU disposal, CPU fallback and recovery: OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
