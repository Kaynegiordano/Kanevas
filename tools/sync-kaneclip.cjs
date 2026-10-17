// Copie KaneClip (C:\KaneOS\KaneClip) dans kaneclip/ : son interface (app/) et ses outils du processus principal
// (ffmpeg, agrandissement IA). L'espace « Vidéo » de Kanevas les charge tels quels.
// Lancer : node tools/sync-kaneclip.cjs [dossier de KaneClip]
const fs = require('fs');
const path = require('path');
const src = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'KaneClip'));
const dst = path.join(__dirname, '..', 'kaneclip');
if (!fs.existsSync(path.join(src, 'app', 'index.html'))) { console.error('KaneClip introuvable : ' + src); process.exit(1); }
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
fs.cpSync(path.join(src, 'app'), path.join(dst, 'app'), { recursive: true, filter: f => !f.endsWith('.map') });
for (const f of ['media-tools.cjs', 'ai-upscale.cjs']) fs.copyFileSync(path.join(src, f), path.join(dst, f));
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
let rev = '';
try { rev = require('child_process').execFileSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* pas de git */ }
fs.writeFileSync(path.join(dst, 'VERSION.json'), JSON.stringify({ version: pkg.version, commit: rev, copied: new Date().toISOString() }, null, 2));
console.log(`KaneClip ${pkg.version} (${rev || '?'}) copié dans ${dst}`);
