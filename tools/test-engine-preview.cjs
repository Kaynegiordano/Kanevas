const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const code = source.slice(source.indexOf('function ensureEnginePatches(dir)'), source.indexOf('const engineLog ='));
const context = { fs, path, engineLog() {} };
vm.createContext(context);
vm.runInContext(code, context);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kane-preview-'));
try {
  fs.mkdirSync(path.join(root, 'modules'));
  const file = path.join(root, 'modules/sd_samplers_common.py');
  for (const patched of [false, true]) {
    fs.writeFileSync(file, `def samples_to_images_tensor(sample, approximation=None, model=None):
    x_sample = None
    if approximation is None:
        approximation = approximation_indexes.get(opts.show_progress_type, 0)
        if approximation == 0${patched ? ' and opts.show_progress_type != "Full"' : ''}:
            approximation = 2
    if approximation == 0:
        x_sample = (model or shared.sd_model).decode_first_stage(sample)
    return x_sample
`);
    fs.writeFileSync(path.join(root, 'modules/shared_state.py'), '            if self.vae_stream is not None:\n                pass\n');
    context.ensureEnginePatches(root);
    assert.ok(fs.readFileSync(path.join(root, 'modules/shared_state.py'), 'utf8').includes('self.vae_stream is not None and shared.opts.show_progress_type != "Full"'));
    const result = fs.readFileSync(file, 'utf8');
    assert.ok(result.includes('if approximation == 0 and opts.show_progress_type != "Full":'));
    assert.ok(result.includes('is_live_preview = approximation is None'));
    assert.ok(result.includes('finally:\n            if is_live_preview:\n'));
    assert.ok(result.includes('sampling_prepare(active_model.forge_objects.unet, sample)'));
    context.ensureEnginePatches(root);
    assert.equal(fs.readFileSync(file, 'utf8'), result, 'patch must be idempotent');
  }
  console.log('Full preview upgrade and idempotence: OK');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
