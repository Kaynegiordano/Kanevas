// Traduction locale français → anglais des invites de génération (Opus-MT fr-en, Helsinki-NLP,
// licence CC-BY 4.0, export ONNX quantifié de Xenova). Les modèles d'image comme anima ne
// comprennent que l'anglais : une invite en français leur fait dessiner n'importe quoi.
// Découpage SentencePiece « unigram » (Viterbi sur les scores du vocabulaire) puis décodage glouton.
const fs = require('fs');
const path = require('path');

module.exports = (dir, loadOrt) => {
  let tok = null, enc = null, dec = null;
  const PAD = 59513, EOS = 0;

  function loadTok() {
    if (tok) return tok;
    const tj = JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8'));
    const vocab = tj.model.vocab, map = new Map();
    let maxLen = 0, minScore = 0;
    vocab.forEach(([p, s], i) => {
      if (!map.has(p)) map.set(p, [i, s]);
      if (p.length > maxLen) maxLen = p.length;
      if (s < minScore) minScore = s;
    });
    tok = { vocab, map, maxLen, unk: vocab.findIndex(v => v[0] === '<unk>'), unkScore: minScore - 10 };
    return tok;
  }
  // Meilleur découpage d'un mot (préfixé de ▁) en morceaux du vocabulaire
  function encodeWord(w) {
    const T = loadTok(), n = w.length;
    const best = new Float64Array(n + 1).fill(-Infinity), back = new Int32Array(n + 1), ids = new Int32Array(n + 1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      for (let L = 1; L <= Math.min(T.maxLen, n - i); L++) {
        const e = T.map.get(w.substr(i, L));
        if (e && best[i] + e[1] > best[i + L]) { best[i + L] = best[i] + e[1]; back[i + L] = i; ids[i + L] = e[0]; }
      }
      // caractère inconnu
      if (best[i] + T.unkScore > best[i + 1]) { best[i + 1] = best[i] + T.unkScore; back[i + 1] = i; ids[i + 1] = T.unk; }
    }
    const out = [];
    for (let k = n; k > 0; k = back[k]) out.push(ids[k]);
    return out.reverse();
  }
  const encode = s => {
    const ids = [];
    for (const w of s.normalize('NFKC').split(/\s+/).filter(Boolean)) ids.push(...encodeWord('▁' + w));
    return ids.slice(0, 250).concat(EOS);
  };

  async function sessions() {
    const o = loadOrt();
    const opt = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' };
    if (!enc) enc = await o.InferenceSession.create(path.join(dir, 'encoder_model_quantized.onnx'), opt);
    if (!dec) dec = await o.InferenceSession.create(path.join(dir, 'decoder_model_quantized.onnx'), opt);
    return o;
  }
  const i64 = (o, a) => new o.Tensor('int64', BigInt64Array.from(a, BigInt), [1, a.length]);

  async function one(s) {
    const o = await sessions(), T = loadTok();
    const ids = encode(s), mask = ids.map(() => 1);
    const am = i64(o, mask);
    const eo = await enc.run({ input_ids: i64(o, ids), attention_mask: am });
    const hs = eo[enc.outputNames[0]];
    const outIds = [PAD], V = T.vocab.length;
    for (let step = 0; step < Math.min(200, ids.length * 3 + 10); step++) {
      const feeds = {};
      for (const n of dec.inputNames) feeds[n] = n === 'input_ids' ? i64(o, outIds) : /hidden/.test(n) ? hs : am;
      const r = await dec.run(feeds);
      const lg = r.logits.data, off = (outIds.length - 1) * V;
      let bi = EOS, bv = -Infinity;
      for (let v = 0; v < V; v++) { if (v === PAD) continue; const x = lg[off + v]; if (x > bv) { bv = x; bi = v; } }
      if (bi === EOS) break;
      outIds.push(bi);
    }
    return outIds.slice(1).map(i => T.vocab[i][0]).join('').replace(/▁/g, ' ').trim();
  }

  // Une ligne à la fois ; les listes séparées par des virgules sont traduites morceau par morceau
  // (style « mots-clés » des invites), les phrases d'un bloc.
  return async text => {
    const lines = String(text).split(/\n+/).map(l => l.trim()).filter(Boolean), out = [];
    for (const l of lines) {
      const parts = l.split(/\s*,\s*/).filter(Boolean);
      if (parts.length > 1 && parts.every(p => p.split(/\s+/).length <= 6)) {
        const t = []; for (const p of parts) t.push((await one(p)).replace(/[.。]$/, ''));
        out.push(t.join(', '));
      } else out.push((await one(l)).replace(/\.$/, ''));
    }
    return out.join('\n');
  };
};
