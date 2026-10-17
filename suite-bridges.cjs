// Adaptateur de l'interface locale : exécuté dans la page, sans accès Node ni IPC.
module.exports = function installSuiteBridge(kind) {
  if (window.__kanevasSuite) return;
  window.__kanevasSuite = true;
  const send = data => window.parent.postMessage({ kv: 'suite-event', kind, ...data }, '*');
  let comfy = null, last = '', running = false;
  async function flushAnimation() {
    if (typeof P !== 'undefined' && P && typeof enregistre === 'function') {
      if (typeof peint !== 'undefined' && peint) throw new Error('Terminez le trait de pinceau avant de changer d’image');
      if (await enregistre() === false) throw new Error('Les zones de l’animation n’ont pas pu être enregistrées');
    }
  }
  function theme(p) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(p.colors || {})) if (/^--[\w-]+$/.test(key) && typeof value === 'string') root.style.setProperty(key, value);
    if (kind === 'animation') {
      const map = { '--fond': '--bg', '--panneau': '--panel', '--bord': '--border', '--texte': '--text', '--pale': '--text-2', '--champ': '--field' };
      for (const [key, value] of Object.entries(map)) root.style.setProperty(key, p.colors?.[value] || '');
      let style = document.getElementById('kanevas-suite-style');
      if (!style) { style = document.createElement('style'); style.id = 'kanevas-suite-style'; document.head.appendChild(style); }
      style.textContent = '#haut .logo,#nouvBtn,#dossierBtn{display:none}body{background:var(--bg);color:var(--text);font-family:var(--ui)}#haut,#cote{background:var(--panel);border-color:var(--border)}button,input,select,textarea,.bloc,.onglets{border-radius:3px;box-shadow:none;background-image:none}button{background:var(--raised);color:var(--text)}input[type=text],select,textarea{background:var(--field)}button.magique,button.grand,button.actif{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}';
      for (const [id, text] of [['oPeindre', '1. Zones'], ['animer', '2. Animer'], ['oApercu', '3. Aperçu'], ['videoBtn', '4. Exporter'], ['superBtn', 'Proposer les mouvements']]) {
        const el = document.getElementById(id); if (el) el.textContent = text;
      }
      const note = document.getElementById('zNote'); if (note?.previousElementSibling?.tagName === 'LABEL') note.previousElementSibling.textContent = 'Note de mouvement';
    } else {
      root.style.setProperty('--comfy-menu-bg', p.colors?.['--panel'] || '');
      root.style.setProperty('--comfy-input-bg', p.colors?.['--field'] || '');
      root.style.setProperty('--fg-color', p.colors?.['--text'] || '');
      root.style.setProperty('--bg-color', p.colors?.['--bg'] || '');
      root.style.setProperty('--p-primary-color', p.colors?.['--accent'] || '');
      root.style.setProperty('--p-primary-contrast-color', p.colors?.['--accent-ink'] || '');
      root.style.setProperty('--comfy-menu-secondary-bg', p.colors?.['--panel-2'] || '');
      root.style.setProperty('--border-color', p.colors?.['--border'] || '');
      let style = document.getElementById('kanevas-comfy-flat');
      if (!style) { style = document.createElement('style'); style.id = 'kanevas-comfy-flat'; document.head.append(style); }
      style.textContent = 'body{font-family:var(--ui);background:var(--bg);color:var(--text)}button,.p-button,.p-dialog,.p-panel,.comfy-menu,.comfyui-menu{border-radius:3px!important;box-shadow:none!important;background-image:none!important}.p-dialog,.p-panel,.comfy-menu,.comfyui-menu{background:var(--panel);color:var(--text);border-color:var(--border)}';
    }
  }
  window.addEventListener('message', async e => {
    const m = e.data;
    if (e.source !== window.parent || !m || m.kv !== 'suite-request') return;
    try {
      let value = null;
      if (m.op === 'theme') theme(m);
      else if (kind === 'animation') {
        if (document.getElementById('sauve') && window.PRET !== true) {
          const until = Date.now() + 15000;
          while (window.PRET !== true && Date.now() < until) await new Promise(r => setTimeout(r, 100));
          if (window.PRET !== true) throw new Error('L’atelier Animation initialise son projet. Réessayez dans un instant.');
        }
        if (m.op === 'flush') await flushAnimation();
        else if (m.op === 'open') {
          await flushAnimation();
          if (typeof ouvre !== 'function') throw new Error('Atelier Animation pas encore prêt');
          await chargeProjets(); await ouvre(m.dossier);
          if (typeof galerie === 'function') galerie(false);
        } else if (m.op === 'export') document.getElementById('videoBtn')?.click();
        else if (m.op === 'state') value = { dossier: typeof P === 'undefined' ? null : P, width: typeof IW === 'undefined' ? 0 : IW, height: typeof IH === 'undefined' ? 0 : IH };
        else throw new Error('Commande Animation inconnue');
      } else {
        if (!comfy) comfy = (await import('/scripts/app.js')).app;
        if (!comfy?.graph) throw new Error('ComfyUI initialise son graphe. Réessayez dans un instant.');
        if (m.op === 'workflow') {
          if (!Array.isArray(m.workflow?.nodes)) throw new Error('Choisissez un workflow ComfyUI au format interface (.json)');
          await comfy.loadGraphData(m.workflow);
        } else if (m.op === 'image') {
          const nodes = (comfy.graph._nodes || []).filter(n => n.type === 'LoadImage' && n.widgets?.some(w => w.name === 'image'));
          if (!nodes.length) throw new Error('Ce workflow ne contient aucun nœud LoadImage. Chargez un workflow avec une image en entrée.');
          const node = m.node != null ? nodes.find(n => String(n.id) === String(m.node)) : nodes.length === 1 ? nodes[0] : null;
          if (!node) value = { nodes: nodes.map(n => ({ id: n.id, title: n.title || 'LoadImage' })) };
          else {
            const widget = node.widgets.find(w => w.name === 'image');
            if (widget.options?.values && !widget.options.values.includes(m.name)) widget.options.values.push(m.name);
            widget.value = m.name; widget.callback?.(m.name); node.onWidgetChanged?.('image', m.name); node.setDirtyCanvas?.(true, true);
            value = { applied: true, node: node.id };
          }
        } else if (m.op !== 'theme') throw new Error('Commande ComfyUI inconnue');
      }
      window.parent.postMessage({ kv: 'suite-response', id: m.id, value }, '*');
    } catch (err) { window.parent.postMessage({ kv: 'suite-response', id: m.id, error: err.message }, '*'); }
  });
  if (kind === 'animation') setInterval(() => {
    const dossier = typeof P === 'undefined' ? null : P;
    const status = document.getElementById('statut')?.textContent || '';
    const busy = !!document.getElementById('animer')?.disabled;
    const next = dossier + '|' + status + '|' + busy;
    if (next !== last) { last = next; send({ dossier, status, busy, completed: running && !busy }); running = busy; }
  }, 1200);
  else setInterval(async () => {
    try {
      const response = await fetch('/queue'); if (!response.ok) return;
      const queue = await response.json(), busy = !!queue.queue_running?.length;
      const next = busy + ':' + (queue.queue_pending?.length || 0);
      if (next !== last) { last = next; send({ busy, status: busy ? 'Workflow en cours' : 'Workflow terminé', completed: running && !busy }); running = busy; }
    } catch { /* moteur arrêté */ }
  }, 2000);
  send({ ready: true });
};
