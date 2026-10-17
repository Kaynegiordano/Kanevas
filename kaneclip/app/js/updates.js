// Mises à jour (releases GitHub) : vérification au démarrage, téléchargement et installation sur demande.
'use strict';
(() => {
  const h = KC.h, N = KC.native;
  const up = KC.updates = { available: !!(N && N.updateCheck), version: '1.0.0', packaged: false, state: { status: 'idle' } };
  if (!up.available) return;

  let manual = false, dlg = null, prog = null;
  const close = () => { if (dlg) { dlg.close(); dlg = null; } };
  const show = (title, body, buttons) => { close(); dlg = KC.modal({ title, body, buttons }); };
  const text = (t, extra) => h('div', { style: { width: '420px', lineHeight: '1.5' } }, h('div', { text: t }), extra || null);

  function render(s) {
    if (s.status === 'available') {
      if (!manual && KC.prefs.skipUpdate === s.version) return;
      show('Mise à jour disponible', text('KaneClip ' + s.version + ' est disponible (vous avez la version ' + up.version + ').',
        h('div.note', { style: { marginTop: '8px' }, text: 'Le téléchargement se fait depuis GitHub ; votre projet ouvert n\'est pas touché.' })), [
        { label: 'Ignorer cette version', action: () => { KC.prefs.skipUpdate = s.version; KC.prefs.save(); } },
        { label: 'Plus tard' },
        { label: 'Télécharger', primary: true, action: () => { manual = true; N.updateDownload(); } },
      ]);
    } else if (s.status === 'downloading') {
      const label = 'Téléchargement de KaneClip ' + (s.version || '') + '… ' + (s.percent || 0) + ' %';
      if (prog && prog.isConnected) prog.textContent = label;
      else { prog = h('div', { text: label }); show('Téléchargement', h('div', { style: { width: '420px' } }, prog), [{ label: 'En arrière-plan' }]); }
    } else if (s.status === 'ready') {
      show('Prêt à installer', text('KaneClip ' + s.version + ' est téléchargé. KaneClip va se fermer puis se rouvrir.',
        KC.project && KC.project.dirty ? h('div.note', { style: { marginTop: '8px' }, text: 'Le projet a des modifications non enregistrées : enregistrez-le d\'abord.' }) : null), [
        { label: 'Plus tard' },
        { label: 'Redémarrer et installer', primary: true, action: () => N.updateInstall() },
      ]);
    } else if (manual && s.status === 'none') {
      KC.toast('KaneClip est à jour (version ' + up.version + ')', 'ok'); manual = false;
    } else if (manual && s.status === 'error') {
      KC.toast('Mise à jour impossible : ' + (s.error || 'erreur inconnue'), 'err', 5000); manual = false;
    } else if (manual && s.status === 'checking') {
      KC.toast('Recherche de mises à jour…', 'info', 1500);
    }
  }

  N.onUpdateStatus(s => { up.state = s; render(s); });
  N.appVersion().then(v => { up.version = v.version; up.packaged = v.packaged; });

  KC.cmd.checkUpdates = async () => {
    if (!up.packaged) { KC.toast('Les mises à jour ne fonctionnent que dans la version installée', 'info', 3000); return; }
    manual = true;
    const r = await N.updateCheck();
    if (r && r.status === 'available') render(r);
  };
})();
