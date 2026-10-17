// Mesure du pilote, indépendante des moteurs IA et du lanceur Kane OS.
'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');

function parseMemory(csv) {
  const devices = String(csv).trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [index, name, used, total] = line.split(',').map(s => s.trim());
    return { index: Number(index), name, used: Number(used), total: Number(total) };
  });
  if (!devices.length || devices.some(d => !d.name || !Number.isInteger(d.index) || !Number.isFinite(d.used) || !Number.isFinite(d.total) || d.used < 0 || d.total <= 0 || d.used > d.total)) {
    throw new Error('Mesure VRAM indisponible');
  }
  return { ok: true, devices, used: devices.reduce((s, d) => s + d.used, 0), total: devices.reduce((s, d) => s + d.total, 0), measuredAt: Date.now() };
}

module.exports = function createMonitor(run = execFile) {
  let pending, cached, checkedAt = 0;
  return () => {
    if (pending) return pending;
    if (cached && Date.now() - checkedAt < 1500) return Promise.resolve(cached);
    const executable = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe') : 'nvidia-smi';
    pending = new Promise(resolve => {
      run(executable, ['--query-gpu=index,name,memory.used,memory.total', '--format=csv,noheader,nounits'],
        { windowsHide: true, timeout: 2500, maxBuffer: 65536, encoding: 'utf8' }, (error, stdout) => {
          let result;
          try { if (error) throw error; result = parseMemory(stdout); }
          catch { result = { ok: false, error: 'La mémoire graphique ne peut pas être lue auprès du pilote NVIDIA.' }; }
          resolve(result);
        });
    }).then(result => { cached = result; checkedAt = Date.now(); return result; }).finally(() => { pending = null; });
    return pending;
  };
};
module.exports.parseMemory = parseMemory;
