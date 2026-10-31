// DirectML sessions cannot run concurrently. A failed GPU session must be
// released and replaced, including failures that occur after model loading.
module.exports = function onnxSessions({ loadOrt, modelPath, models, warn = console.warn }) {
  const sessions = new Map();
  function session(id, cpuOnly = false) {
    if (!models[id]) return Promise.reject(new Error('Modèle inconnu'));
    const key = id + (cpuOnly ? ':cpu' : '');
    if (sessions.has(key)) return sessions.get(key);
    const pending = create(id, cpuOnly).catch(error => { sessions.delete(key); throw error; });
    sessions.set(key, pending);
    return pending;
  }
  async function create(id, cpuOnly) {
    const ort = loadOrt();
    let current, provider, lastError;
    for (const ep of cpuOnly || models[id].cpu ? ['cpu'] : ['dml', 'cpu']) {
      try {
        current = await ort.InferenceSession.create(modelPath(id), {
          executionProviders: [ep], graphOptimizationLevel: 'all',
          ...(ep === 'dml' ? { executionMode: 'sequential', enableMemPattern: false } : {}),
        });
        provider = ep;
        break;
      } catch (error) { lastError = error; warn('ORT', ep, error.message); }
    }
    if (!current) throw lastError;
    const { inputNames, outputNames } = current;
    let tail = Promise.resolve();
    return {
      inputNames,
      outputNames,
      get _ep() { return provider; },
      run(feeds) {
        const task = tail.then(async () => {
          if (!current) current = await session(id, true);
          try { return await current.run(feeds); }
          catch (error) {
            if (provider !== 'dml') throw error;
            warn('ORT DirectML : reprise sur le processeur', error.message);
            const failed = current;
            // Mark the GPU unusable before loading the CPU replacement.
            provider = 'cpu';
            current = null;
            try { await failed.release(); } catch (releaseError) { warn('ORT release', releaseError.message); }
            // If CPU loading fails, a later call may retry loading it, never the
            // invalid GPU session. The original session promise remains cached.
            current = await session(id, true);
            return current.run(feeds);
          }
        });
        tail = task.catch(() => {});
        return task;
      },
    };
  }
  return session;
};
