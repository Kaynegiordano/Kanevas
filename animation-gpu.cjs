// Réserve la diffusion pendant une tâche Animation et libère son modèle avant/après.
module.exports = function animationGPU({ release, status, changed, interval = 1000 }) {
  let job = null, timer = null, polling = false, lastError = '';
  const state = () => ({ busy: !!job, dossier: job?.dossier || '', error: job?.error || lastError });
  const emit = () => changed?.(state());
  async function finish(current) {
    if (job !== current || current.finishing) return;
    current.finishing = true; clearTimeout(timer);
    try { await release(); }
    catch (e) { current.error = 'Libération VRAM : ' + e.message; }
    finally { lastError = current.error || ''; job = null; emit(); }
  }
  async function poll(current) {
    if (job !== current || polling) return;
    polling = true;
    try {
      const s = await status(current.dossier);
      if (s.etat !== 'en cours') await finish(current);
    } catch (e) {
      // Une panne de liaison ne prouve pas que le GPU est libre.
      const error = 'État Animation indisponible : ' + e.message;
      if (current.error !== error) { current.error = error; emit(); }
    } finally {
      polling = false;
      if (job === current) { timer = setTimeout(() => poll(current), interval); timer.unref?.(); }
    }
  }
  return {
    state,
    async run(dossier, submit, { synchronous = false } = {}) {
      if (job) throw new Error('Une opération Animation utilise déjà le moteur IA.');
      lastError = '';
      const current = job = { dossier }; emit();
      let submitted = false;
      try {
        await release();
        submitted = true;
        const result = await submit();
        if (synchronous || !result.lance) await finish(current);
        else { timer = setTimeout(() => poll(current), interval); timer.unref?.(); }
        return result;
      } catch (e) {
        if (!submitted) { job = null; lastError = e.message; emit(); throw e; }
        if (synchronous && !e.serverResponded) {
          current.error = 'Segmentation : réponse perdue. Arrêtez Animation avant de réutiliser le Studio.'; emit(); throw e;
        }
        // La réponse peut être perdue après acceptation : vérifier avant de décharger.
        if (submitted) {
          let active = true;
          try { active = (await status(dossier)).etat === 'en cours'; } catch { /* état inconnu : rester réservé */ }
          if (active) { timer = setTimeout(() => poll(current), interval); timer.unref?.(); throw e; }
        }
        await finish(current); throw e;
      }
    },
    stopped() { return job ? finish(job) : Promise.resolve(); },
  };
};
