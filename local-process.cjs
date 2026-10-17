// Arrêt explicite d'un moteur local : vérifier sa commande avant d'utiliser son PID.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const normalized = s => String(s || '').replace(/\//g, '\\').toLowerCase();
const token = (command, expected) => {
  const escaped = normalized(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[\\s"\'])' + escaped + '(?=$|[\\s"\'])').test(normalized(command));
};
function matches(command, script, python) { return token(command, script) || !!python && token(command, python) && token(command, path.basename(script)); }
function pidOnPort(port) {
  const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, encoding: 'utf8' });
  const row = out.split(/\r?\n/).map(s => s.trim().split(/\s+/)).find(c => c[0] === 'TCP' && +c[1].split(':').pop() === +port && c[3] === 'LISTENING');
  return row ? +row[4] : null;
}
function identify({ port, script, python }) {
  const pid = pidOnPort(port); if (!pid) return false;
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Processus local invalide');
  const command = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`], { windowsHide: true, encoding: 'utf8' });
  if (!matches(command, script, python)) throw new Error('Le processus sur ce port ne correspond pas au moteur attendu. Arrêt refusé.');
  return pid;
}
function stop(options) {
  const pid = identify(options); if (!pid) return false;
  execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  return true;
}
module.exports = { matches, stop, pidOnPort, identify };
