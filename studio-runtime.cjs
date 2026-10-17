// Configuration du moteur Studio séparée du lanceur Forge. Aucun téléchargement ou déplacement implicite.
const fs = require('node:fs');
const path = require('node:path');
module.exports = function runtimeConfig(profile) {
  const file = path.join(profile, 'studio-runtime.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const resolve = base => {
    const c = read(), runtime = c.directory || base.data;
    return { ...base, root: c.kaneRoot || base.root, runtime, python: c.python || path.join(runtime, 'venv', 'Scripts', 'python.exe'), models: c.models || base.models, shareExternal: c.shareExternal !== false };
  };
  const save = (options, base) => {
    const directory = String(options.directory || '').trim(), models = String(options.models || '').trim();
    if (directory && (!path.isAbsolute(directory) || !fs.existsSync(path.join(directory, 'launch.py')) || !fs.existsSync(path.join(directory, 'venv', 'Scripts', 'python.exe')))) throw new Error('Choisissez un moteur local contenant launch.py et son environnement venv\\Scripts\\python.exe');
    if (models && (!path.isAbsolute(models) || !fs.statSync(models).isDirectory())) throw new Error('Le dossier des modèles est introuvable');
    const c = { directory, models, shareExternal: options.shareExternal !== false, kaneRoot: base.root };
    fs.mkdirSync(profile, { recursive: true }); const temp = file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(c, null, 2)); fs.renameSync(temp, file);
    return resolve(base);
  };
  return { read, resolve, save };
};
