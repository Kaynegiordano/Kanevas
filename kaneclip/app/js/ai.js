// Agrandissement par IA (Real-ESRGAN) : installation à la demande, réglages, suivi et remplacement du média.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, M = KC.media, N = KC.native;
  const AI = KC.ai = { jobs: new Map() };
  if (!N || !N.aiStart) return;

  const MODELS = {
    'realesr-animevideov3': { name: 'Rapide — vidéo (recommandé)', scales: [2, 3, 4], desc: 'Modèle léger pensé pour la vidéo : rapide et stable d\'une image à l\'autre.' },
    'realesrgan-x4plus': { name: 'Qualité maximale — images réalistes (lent)', scales: [4], desc: 'Le plus détaillé sur les prises de vue réelles, mais nettement plus lent.' },
    'realesrgan-x4plus-anime': { name: 'Animation et dessin', scales: [4], desc: 'Pour les dessins animés, jeux en 2D et illustrations.' },
  };
  const TARGETS = [
    ['x2', 'Double (×2)'], ['x3', 'Triple (×3)'], ['x4', 'Quadruple (×4)'],
    ['1080', 'Full HD (1080p)'], ['1440', 'QHD (1440p)'], ['2160', 'UHD 4K (2160p)'],
  ];
  // Taille finale (paire) et facteur demandé
  function targetSize(m, t) {
    let f;
    if (t[0] === 'x') f = parseInt(t.slice(1), 10);
    else { const H = parseInt(t, 10); const short = Math.min(m.width, m.height); f = H / short; }
    const w = Math.round(m.width * f / 2) * 2, hh = Math.round(m.height * f / 2) * 2;
    return { w, h: hh, f };
  }

  AI.dialog = async (m) => {
    if (!m || !m.hasVideo || m.kind !== 'video') { KC.toast('Choisissez un média vidéo', 'info'); return; }
    const st = await N.aiStatus();
    const enc = await N.encoders();
    let installed = st.installed;
    const instBox = h('div');
    const renderInst = () => {
      instBox.innerHTML = '';
      if (installed) { instBox.append(h('div.note', { html: KC.icon('check') + ' Real-ESRGAN est installé.' })); return; }
      const btn = h('button.btn.primary.small', { html: KC.icon('import') + `Télécharger Real-ESRGAN (${U.fmtBytes(st.size)})` });
      const prog = h('div.progress', { style: { marginTop: '8px' }, hidden: true }, h('i', { style: { width: '0%' } }));
      btn.addEventListener('click', async () => {
        btn.disabled = true; prog.hidden = false;
        const r = await N.aiInstall();
        if (r.ok) { installed = true; renderInst(); go.disabled = false; KC.toast('Real-ESRGAN installé', 'ok'); }
        else { btn.disabled = false; KC.toast('Installation impossible : ' + r.error, 'err', 6000); }
      });
      AI.instCb = p => { prog.firstChild.style.width = (p.got / p.total * 100).toFixed(1) + '%'; };
      instBox.append(h('div.note', { text: 'L\'agrandissement par IA utilise Real-ESRGAN (licence BSD), à télécharger une fois depuis GitHub. Il tourne sur la carte graphique (Vulkan).' }), h('div', { style: { marginTop: '8px' } }, btn), prog);
    };
    renderInst();
    const model = KC.ui.select(Object.entries(MODELS).map(([k, d]) => [k, d.name]), KC.prefs.aiModel || 'realesr-animevideov3');
    const target = KC.ui.select(TARGETS, KC.prefs.aiTarget || (m.height <= 720 ? '2160' : 'x2'));
    const modelDesc = h('div.note');
    const sizeInfo = h('div', { style: { fontWeight: 600 } });
    const replace = KC.ui.check('Remplacer le média dans le projet une fois terminé', true);
    const upd = () => {
      modelDesc.textContent = MODELS[model.value].desc;
      const t = targetSize(m, target.value);
      sizeInfo.textContent = `${m.width}×${m.height} → ${t.w}×${t.h} (×${U.fmtNum(t.f, 2)})`;
    };
    model.addEventListener('change', upd); target.addEventListener('change', upd); upd();
    const frames = Math.round(m.duration * (m.fps || 30));
    const body = h('div.form', { style: { width: '600px', gridTemplateColumns: '150px 1fr' } },
      h('label', { text: 'Média' }), h('div', { text: `${m.name} — ${m.width}×${m.height}, ${U.fmtDur(m.duration)}, ${frames} images` }),
      h('div.group-title', { text: 'Outil' }), h('div.full', instBox),
      h('div.group-title', { text: 'Réglages' }),
      h('label', { text: 'Modèle' }), model, h('label'), modelDesc,
      h('label', { text: 'Taille finale' }), target, h('label'), sizeInfo,
      h('label'), replace,
      h('div.note.full', { text: 'Le traitement se fait image par image sur la carte graphique : comptez de quelques minutes à beaucoup plus selon la durée, la résolution et le modèle. Vous pouvez continuer à travailler pendant ce temps. Le fichier agrandi est créé à côté de l\'original (l\'original n\'est pas modifié).' }),
    );
    const go = h('button.btn.primary', { html: KC.icon('wand') + 'Agrandir', disabled: !installed });
    const dlg = KC.modal({ title: 'Agrandir avec l\'IA', body, buttons: [{ label: 'Annuler' }] });
    dlg.el.querySelector('.modal-foot').appendChild(go);
    go.addEventListener('click', async () => {
      const t = targetSize(m, target.value);
      const md = MODELS[model.value];
      const modelScale = md.scales.find(s => s >= t.f - 1e-6) || md.scales[md.scales.length - 1];
      const hw = enc.hw || {};
      const vcodec = hw.hevc_nvenc ? ['-c:v', 'hevc_nvenc', '-preset', 'p6', '-rc', 'vbr', '-cq', '17', '-b:v', '0', '-tag:v', 'hvc1']
        : hw.h264_nvenc ? ['-c:v', 'h264_nvenc', '-preset', 'p6', '-rc', 'vbr', '-cq', '16', '-b:v', '0']
          : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16'];
      const output = U.dir(m.path) + '\\' + U.stripExt(m.name) + ` (IA ${t.w}x${t.h}).mp4`;
      KC.prefs.aiModel = model.value; KC.prefs.aiTarget = target.value; KC.prefs.save();
      dlg.close();
      AI.run(m, { input: m.path, output, width: t.w, height: t.h, model: model.value, modelScale, fps: m.fps || P.fps(), duration: m.duration, colorspace: m.colorspace, vcodec, replace: replace.input.checked });
    });
  };

  AI.run = async (m, o) => {
    const r = await N.aiStart(o);
    if (!r.ok) { KC.alert('Agrandissement impossible', r.error); return; }
    const job = { id: r.id, media: m, o, percent: 0, done: 0, total: 1, fps: 0, eta: 0 };
    AI.jobs.set(r.id, job);
    KC.emit('ai-jobs');
    AI.showProgress(job);
  };

  AI.showProgress = (job) => {
    const bar = h('i', { style: { width: job.percent + '%' } });
    const pct = h('div', { style: { fontSize: '26px', fontWeight: 700 }, text: Math.floor(job.percent) + ' %' });
    const det = h('div.note', { text: 'Préparation…' });
    const body = h('div', { style: { width: '520px' } },
      h('div', { style: { marginBottom: '6px', color: 'var(--text-2)' }, text: `${job.media.name} → ${job.o.width}×${job.o.height}` }),
      h('div', { style: { display: 'flex', alignItems: 'end', gap: '14px', marginBottom: '8px' } }, pct, det),
      h('div.progress', bar));
    const dlg = KC.modal({
      title: 'Agrandissement par IA', body,
      buttons: [
        { label: 'Arrêter', action: async () => { await N.aiCancel(job.id); } },
        { label: 'Continuer en arrière-plan', primary: true },
      ],
    });
    job.view = { bar, pct, det, dlg };
  };

  N.onAiInstallProgress(p => { if (AI.instCb) AI.instCb(p); });
  N.onAiProgress(p => {
    const j = AI.jobs.get(p.id); if (!j) return;
    Object.assign(j, { percent: p.percent, done: p.done, total: p.total, fps: p.fps });
    const rem = p.fps > 0 ? (p.total - p.done) / p.fps : 0;
    if (j.view && j.view.bar.isConnected) {
      j.view.bar.style.width = p.percent.toFixed(1) + '%';
      j.view.pct.textContent = Math.floor(p.percent) + ' %';
      j.view.det.textContent = p.stage === 'assemblage' ? 'Assemblage de la vidéo et du son…'
        : `Image ${p.done} / ${p.total} · ${U.fmtNum(p.fps, 1)} i/s · reste ≈ ${U.fmtDur(rem)}`;
    }
    KC.emit('ai-jobs');
  });
  N.onAiDone(async d => {
    const j = AI.jobs.get(d.id); if (!j) return;
    AI.jobs.delete(d.id);
    if (j.view && j.view.dlg) j.view.dlg.close();
    KC.emit('ai-jobs');
    if (d.canceled) { KC.toast('Agrandissement arrêté', 'info'); return; }
    if (!d.ok) { KC.alert('Agrandissement impossible', d.error || 'Erreur inconnue'); return; }
    KC.toast(`Agrandissement terminé en ${U.fmtDur(d.elapsed)}`, 'ok', 4000);
    if (j.o.replace && P.media(j.media.id)) await M.replaceSource(P.media(j.media.id), d.output);
    else await M.import([d.output]);
  });

  KC.cmd.aiUpscale = (m) => {
    if (!m) {
      const ev = KC.sel.list().find(e => e.media && (P.media(e.media) || {}).kind === 'video');
      m = ev && P.media(ev.media);
    }
    if (!m) { KC.toast('Sélectionnez un événement vidéo ou un média', 'info'); return; }
    AI.dialog(m);
  };
})();
