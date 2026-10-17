// Contrat avec le projet Kanevas. Le montage et son historique restent ceux de KaneClip.
'use strict';
(() => {
  if (window.parent === window || !KC.native) return;
  const style = document.createElement('style');
  style.textContent = '.in-kanevas #titlebar .brand,.in-kanevas #titlebar .drag-region{display:none}.in-kanevas #titlebar{padding-right:8px;height:30px;min-height:30px}';
  document.head.append(style);
  let project = null, saving = null;
  const send = data => window.parent.postMessage({ kv: 'suite-event', kind: 'video', ...data }, '*');
  async function save() {
    if (!project || !KC.project) return;
    if (saving) { await saving; return save(); }
    saving = (async () => {
      KC.project.cursor = KC.engine.time;
      const data = KC.P.serialize();
      const result = await KC.native.writeFile(project.videoPath, data);
      if (!result.ok) throw new Error(result.error || 'Enregistrement du montage impossible');
      // Le document n'est marqué enregistré que si aucune modification n'est intervenue pendant l'écriture.
      if (KC.P.serialize() === data) { KC.project.path = project.videoPath; KC.project.dirty = false; KC.emit('dirty'); }
      send({ saved: true, project: project.id });
    })();
    try { await saving; } finally { saving = null; }
  }
  window.addEventListener('message', async e => {
    const m = e.data;
    if (e.source !== window.parent || m?.kv !== 'suite-request') return;
    try {
      let value = null;
      if (m.op === 'theme') {
        KC.prefs.theme = m.theme === 'light' ? 'light' : m.theme === 'graphite' ? 'graphite' : 'dark';
        KC.applyTheme();
        for (const [key, v] of Object.entries(m.colors || {})) if (/^--[\w-]+$/.test(key)) document.documentElement.style.setProperty(key, v);
        document.documentElement.classList.add('in-kanevas');
      } else if (m.op === 'project') {
        if (project?.id !== m.project.id) {
          await save();
          const path = m.project.videoPath;
          if (await KC.native.exists(path)) await KC.cmd.openProject(path);
          else await KC.cmd.newProject();
          // Une annulation du dialogue garde le montage en place et ne l'associe pas au nouveau projet.
          if (await KC.native.exists(path)) { if (KC.project.path !== path) throw new Error('Changement de montage annulé'); }
          else if (KC.project.dirty || KC.project.path) throw new Error('Changement de montage annulé');
          project = m.project; KC.project.info.title ||= m.project.name;
        }
      } else if (m.op === 'save') await save();
      else if (m.op === 'add') {
        if (!project) throw new Error('Choisissez un projet Kanevas');
        const items = await KC.media.import([m.path]);
        if (items.length) KC.timeline.placeMedias(items, KC.P.duration(), null);
        await save(); value = { added: items.length };
      } else if (m.op === 'replace') {
        const media = KC.media.findByPath(m.previous);
        if (!media) throw new Error('Cette version n’est pas utilisée dans le montage');
        const info = await KC.native.probe(m.path);
        if (!info?.ok) throw new Error(info?.error || 'Média de remplacement illisible');
        KC.edit('Mettre à jour le média depuis Kanevas', () => {
          media.origPath ||= media.path;
          Object.assign(media, { path: m.path, name: info.name, kind: info.kind, duration: info.duration || 0, size: info.size,
            width: info.video?.width || 0, height: info.video?.height || 0, fps: info.video?.fps || 0,
            vcodec: info.video?.codec || '', acodec: info.audio?.codec || '', hasVideo: info.kind !== 'audio' && !!info.video,
            hasAudio: info.kind !== 'image' && !!info.audio, colorspace: info.video?.colorspace || '' });
        });
        KC.media.rt.delete(media.id); KC.media.prepare(media, info);
        KC.emit('media-source-changed', media); KC.emit('media-updated', media);
        await save(); value = { replaced: true };
      } else if (m.op === 'state') value = { title: KC.project?.info.title, media: KC.project?.media.map(it => ({ id: it.id, path: it.path, name: it.name })), events: KC.project?.events.length || 0 };
      else throw new Error('Commande Vidéo inconnue');
      window.parent.postMessage({ kv: 'suite-response', id: m.id, value }, '*');
    } catch (err) { window.parent.postMessage({ kv: 'suite-response', id: m.id, error: err.message }, '*'); }
  });
  let timer;
  for (const ev of ['change', 'dirty']) KC.on(ev, () => {
    if (!project || !KC.project?.dirty) return;
    clearTimeout(timer); timer = setTimeout(() => save().catch(e => send({ error: e.message })), 1500);
  });
  KC.on('jobs', () => send({ busy: KC.jobs.size > 0, status: [...KC.jobs.values()].map(j => j.label).join(' · ') }));
  send({ ready: true });
})();
