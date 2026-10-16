// Worker de calcul des filtres : reçoit une bande d'image (avec ses lignes de recouvrement),
// renvoie les lignes [ya, yb) calculées.
'use strict';
importScripts('kernels.js');
onmessage = e => {
  const { kind, s, W, H, args, ya, yb } = e.data;
  const o = new Uint8ClampedArray((yb - ya) * W * 4);
  self.KSKernels.run(kind, s, W, H, args, o, ya, yb, ya);
  postMessage(o, [o.buffer]);
};
