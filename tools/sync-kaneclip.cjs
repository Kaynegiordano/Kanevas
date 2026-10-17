// Copie KaneClip (C:\KaneOS\KaneClip) dans kaneclip/ : son interface (app/) et ses outils du processus principal
// (ffmpeg, agrandissement IA). L'espace « Vidéo » de Kanevas les charge tels quels.
// Lancer : node tools/sync-kaneclip.cjs [dossier de KaneClip]
const fs = require('fs');
const path = require('path');
const src = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'KaneClip'));
const dst = path.join(__dirname, '..', 'kaneclip');
if (!fs.existsSync(path.join(src, 'app', 'index.html'))) { console.error('KaneClip introuvable : ' + src); process.exit(1); }
// Adaptations du contrat d'arrêt de Kane App, conservées lors de la synchronisation de KaneClip.
const mediaSource = fs.readFileSync(path.join(src, 'media-tools.cjs'), 'utf8');
const aiSource = fs.readFileSync(path.join(src, 'ai-upscale.cjs'), 'utf8');
if (!mediaSource.includes('    findFfmpeg, probe, waveform, thumbs, jobStart, keyInterval, jobCancel, proxyPath, proxyStart, encoders,') || !aiSource.includes('return { installed, install, start, cancel, size: ZIP_SIZE, toolDir };')) throw new Error('Contrat KaneClip modifié : vérifiez les méthodes d’arrêt avant la synchronisation.');
if (dst !== path.resolve(__dirname, '..', 'kaneclip')) throw new Error('Destination de synchronisation invalide');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
fs.cpSync(path.join(src, 'app'), path.join(dst, 'app'), { recursive: true, filter: f => !f.endsWith('.map') });
for (const f of ['media-tools.cjs', 'ai-upscale.cjs']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
fs.writeFileSync(path.join(dst, 'media-tools.cjs'), mediaSource.replace('    findFfmpeg, probe, waveform, thumbs, jobStart, keyInterval, jobCancel, proxyPath, proxyStart, encoders,', '    findFfmpeg, probe, waveform, thumbs, jobStart, keyInterval, jobCancel, proxyPath, proxyStart, encoders,\n    cancelAll: () => { for (const id of jobs.keys()) jobCancel(id); },'));
fs.writeFileSync(path.join(dst, 'ai-upscale.cjs'), aiSource.replace('return { installed, install, start, cancel, size: ZIP_SIZE, toolDir };', 'return { installed, install, start, cancel, cancelAll: () => { for (const id of jobs.keys()) cancel(id); }, size: ZIP_SIZE, toolDir };'));
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
let rev = '';
try { rev = require('child_process').execFileSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* pas de git */ }
fs.writeFileSync(path.join(dst, 'VERSION.json'), JSON.stringify({ version: pkg.version, commit: rev, copied: new Date().toISOString() }, null, 2));
console.log(`KaneClip ${pkg.version} (${rev || '?'}) copié dans ${dst}`);
