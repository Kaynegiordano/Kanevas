// Opérations de montage Source → Programme et plages temporelles, toujours annulables.
'use strict';
(() => {
  const P = KC.P, U = KC.util;
  const O = KC.editing = {};
  const project = () => KC.project;
  O.splitAt = (time, tracks = null) => {
    const groups = new Map(), result = [];
    for (const ev of project().events.slice()) {
      if (tracks && !tracks.includes(ev.track)) continue;
      const right = P.split(ev, time);
      if (!right) continue;
      if (ev.group) {
        if (!groups.has(ev.group)) groups.set(ev.group, U.uid());
        right.group = groups.get(ev.group);
      }
      result.push(right);
    }
    return result;
  };
  O.clearRange = (start, end, tracks = null) => {
    O.splitAt(end, tracks); O.splitAt(start, tracks);
    project().events = project().events.filter(ev => (tracks && !tracks.includes(ev.track)) || ev.start < start - 1e-6 || P.end(ev) > end + 1e-6);
  };
  O.range = (extract = false) => {
    const { in: a, out: b } = project().loop;
    if (!(b - a >= P.frame() - 1e-6)) return KC.toast('Définissez une plage avec I et O ou dans la règle.', 'info');
    KC.engine.pause();
    KC.edit(extract ? 'Extraire la plage et refermer' : 'Lever la plage (laisser un vide)', () => {
      O.clearRange(a, b);
      if (extract) {
        for (const ev of project().events) if (ev.start >= b - 1e-6) ev.start = P.snapFrame(ev.start - (b - a));
        project().markers = project().markers.filter(m => m.t < a || m.t >= b).map(m => ({ ...m, t: m.t >= b ? P.snapFrame(m.t - (b - a)) : m.t }));
        project().loop = { in: a, out: a };
      }
      P.recalcCrossfades();
    });
    KC.sel.clean(); KC.emit('selection'); KC.emit('loop'); KC.engine.seek(a);
  };
  O.sourceEdit = (media, start, end, { mode = 'insert', video = true, audio = true, videoTrack = null, audioTrack = null } = {}) => {
    if (!media || !P.media(media.id)) throw new Error('Source indisponible dans ce projet.');
    if (!['insert', 'overwrite'].includes(mode)) throw new Error('Mode de montage inconnu.');
    const limit = media.kind === 'image' ? Infinity : media.duration;
    if (![start, end].every(Number.isFinite) || start < 0 || end <= start || end > limit + 1e-6) throw new Error('Les points Source sont hors du média.');
    const length = P.snapFrame(end - start), at = P.snapFrame(KC.engine.time);
    if (length < P.frame() - 1e-6) throw new Error('La sélection Source doit durer au moins une image.');
    const wants = [['video', video && media.hasVideo, videoTrack], ['audio', audio && media.hasAudio, audioTrack]].filter(x => x[1]);
    if (!wants.length) throw new Error('Activez au moins une composante disponible : vidéo ou audio.');
    for (const [kind, , id] of wants) if (id && P.track(id)?.kind !== kind) throw new Error('La piste de destination ne correspond pas à la source.');
    KC.engine.pause();
    const created = KC.edit(mode === 'insert' ? 'Insérer la sélection Source' : 'Remplacer depuis la Source', () => {
      const targets = wants.map(([kind, , id]) => P.track(id) || (P.track(KC.sel.track)?.kind === kind && P.track(KC.sel.track)) || project().tracks.find(t => t.kind === kind) || P.newTrack(kind));
      if (mode === 'insert') {
        O.splitAt(at);
        for (const ev of project().events) if (ev.start >= at - 1e-6) ev.start = P.snapFrame(ev.start + length);
        for (const marker of project().markers) if (marker.t >= at - 1e-6) marker.t = P.snapFrame(marker.t + length);
      } else O.clearRange(at, at + length, targets.map(t => t.id));
      const group = targets.length > 1 ? U.uid() : null;
      const events = targets.map(track => P.newEvent({ track: track.id, media: media.id, start: at, length, offset: start, group }));
      project().events.push(...events);
      P.recalcCrossfades();
      return events;
    });
    KC.sel.set(created.map(ev => ev.id));
    KC.engine.seek(at + length);
    KC.timeline.ensureVisible(at + length);
    return created;
  };
  KC.cmd.liftRange = () => O.range(false);
  KC.cmd.extractRange = () => O.range(true);
  KC.cmd.razorAt = (ev, time) => {
    const members = KC.sel.expand([ev]), groups = new Map(), ids = [];
    KC.edit('Couper au rasoir', () => {
      for (const original of members) {
        const right = P.split(original, P.snapFrame(time));
        if (!right) continue;
        if (original.group) {
          if (!groups.has(original.group)) groups.set(original.group, U.uid());
          right.group = groups.get(original.group);
        }
        ids.push(right.id);
      }
      P.recalcCrossfades();
    });
    if (ids.length) KC.sel.set(ids);
  };
})();
