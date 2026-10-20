// Moniteur Source : repérage indépendant, sélection I/O et montage trois points.
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P;
  KC.sourceMonitor = { build(page) {
    const TR = KC.trimmer, ranges = new Map();
    let position = 0, reverse = null;
    const empty = h('div.page-empty.source-empty', h('b', { text: 'Moniteur Source' }), h('p', { text: 'Double-cliquez sur un média dans la bibliothèque. Marquez I / O, puis insérez ou remplacez dans le Programme.' }));
    const wrap = h('div.trimmer.source-monitor', { tabIndex: 0, 'aria-label': 'Moniteur Source' });
    const name = h('strong.source-title', { text: 'Source' });
    const video = h('video', { crossOrigin: 'anonymous', preload: 'auto', playsInline: true });
    const image = h('img', { hidden: true, alt: 'Image Source' });
    const stage = h('div.source-stage', video, image);
    const clock = h('span.tc#source-clock');
    const duration = () => TR.media ? (TR.media.duration || KC.prefs.imageLength) : 0;
    const fps = () => TR.media?.fps || P.fps();
    const frame = () => 1 / fps();
    const scrub = h('input#source-scrub', { type: 'range', min: 0, max: 1, step: 1/30, value: 0, 'aria-label': 'Position Source' });
    const bar = h('div.source-range', h('div.source-range-selection'));
    const wave = h('canvas.source-wave'); bar.prepend(wave);
    const range = bar.lastChild;
    const drawWave = () => {
      const width = Math.max(1, Math.round(bar.clientWidth)); wave.width = width; wave.height = 24;
      const ctx = wave.getContext('2d'); ctx.clearRect(0,0,width,24);
      if (!TR.media || !KC.media.get(TR.media).peaks) return;
      ctx.fillStyle = 'rgba(150,190,215,.65)';
      for (let x=0;x<width;x++) {
        const value = Math.sqrt(KC.media.peakRange(TR.media, x/width*duration(), (x+1)/width*duration()) || 0)*11;
        ctx.fillRect(x,12-value,1,value*2+1);
      }
    };
    const inField = h('input.field#source-in', { 'aria-label': 'Entrée Source' });
    const outField = h('input.field#source-out', { 'aria-label': 'Sortie Source (exclusive)' });
    const length = h('span#source-length');
    const play = h('button.tb', { title: 'Lire / pause Source (Espace)', 'aria-label': 'Lire / pause Source' });
    const saveRange = () => { if (TR.media) ranges.set(TR.media.id, { in: TR.in, out: TR.out }); };
    const paint = () => {
      clock.textContent = U.fmtTime(position, fps());
      inField.value = U.fmtTime(TR.in, fps()); outField.value = U.fmtTime(TR.out, fps());
      length.textContent = 'Durée ' + U.fmtTime(TR.out - TR.in, fps());
      range.style.left = (TR.in / (duration() || 1) * 100) + '%';
      range.style.width = ((TR.out - TR.in) / (duration() || 1) * 100) + '%';
      scrub.value = position;
      play.innerHTML = KC.icon(reverse || !video.paused ? 'pause' : 'play');
    };
    const seek = t => {
      position = U.clamp(Math.round(t * fps()) / fps(), 0, Math.max(0, duration() - frame()));
      if (TR.media?.kind !== 'image') video.currentTime = position;
      paint();
    };
    const pause = TR.pause = () => { if (reverse) clearInterval(reverse); reverse = null; video.pause(); paint(); };
    const setIn = t => { TR.in = U.clamp(Math.round(t*fps())/fps(), 0, Math.max(0, TR.out-frame())); saveRange(); paint(); };
    const setOut = t => { TR.out = U.clamp(Math.round(t*fps())/fps(), TR.in+frame(), duration()); saveRange(); paint(); };
    TR.setRange = (a, b) => {
      if (!TR.media || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > duration() || b-a < frame()-1e-6) return false;
      TR.in = a; TR.out = b; saveRange(); paint(); return true;
    };
    TR.seek = seek;
    const forward = rate => {
      if (TR.media?.kind === 'image') return;
      pause(); KC.engine.pause();
      if (position >= TR.out-frame()/2 || position < TR.in) seek(TR.in);
      video.playbackRate = rate;
      video.play().catch(error => { if (error.name !== 'AbortError') KC.toast('Cette source ne peut pas être lue directement. Essayez un proxy.', 'info'); });
    };
    play.addEventListener('click', () => { if (reverse || !video.paused) pause(); else forward(1); });
    const btn = (id, text, title, fn) => { const b = h('button.btn.small', { id, text, title }); b.addEventListener('click', fn); return b; };
    const transport = h('div.source-transport',
      btn('source-prev', '◀|', 'Image précédente Source', () => { pause(); seek(position-frame()); }), play,
      btn('source-next', '|▶', 'Image suivante Source', () => { pause(); seek(position+frame()); }), clock,
      btn('source-mark-in', 'I', 'Marquer l’entrée Source', () => setIn(position)),
      btn('source-mark-out', 'O', 'Marquer la sortie Source (exclusive)', () => setOut(position)),
      btn('source-reset', 'Tout', 'Utiliser la totalité du média', () => TR.setRange(0, duration())));
    const videoCheck = h('input#source-video', { type: 'checkbox', checked: true });
    const audioCheck = h('input#source-audio', { type: 'checkbox', checked: true });
    const vtrack = h('select.field#source-video-track', { 'aria-label': 'Piste vidéo de destination' });
    const atrack = h('select.field#source-audio-track', { 'aria-label': 'Piste audio de destination' });
    const destinations = () => {
      for (const [select, kind] of [[vtrack, 'video'], [atrack, 'audio']]) {
        const prev = select.value;
        select.replaceChildren(h('option', { value: '', text: 'Piste ' + (kind === 'video' ? 'vidéo' : 'audio') + ' auto' }), ...KC.project.tracks.filter(t => t.kind === kind).map(t => h('option', { value: t.id, text: P.trackLabel(t) })));
        if ([...select.options].some(o => o.value === prev)) select.value = prev;
      }
    };
    const edit = mode => {
      if (!TR.media) return;
      pause();
      try { KC.editing.sourceEdit(TR.media, TR.in, TR.out, { mode, video: videoCheck.checked, audio: audioCheck.checked, videoTrack: vtrack.value || null, audioTrack: atrack.value || null }); }
      catch (error) { KC.toast(error.message, 'err'); }
    };
    TR.insert = () => edit('insert'); TR.overwrite = () => edit('overwrite');
    const route = h('div.source-routing', h('label', videoCheck, 'Vidéo'), vtrack, h('label', audioCheck, 'Audio'), atrack);
    const actions = h('div.source-actions',
      btn('source-insert', 'Insérer', 'Insérer au curseur et décaler toutes les pistes (,)', TR.insert),
      btn('source-overwrite', 'Remplacer', 'Remplacer sur les pistes de destination, sans décaler les autres (.)', TR.overwrite));
    wrap.append(h('div.source-heading', h('span.monitor-badge', { text: 'SOURCE' }), name), stage, bar, scrub, transport,
      h('div.source-points', h('label', 'Entrée', inField), h('label', 'Sortie', outField), length), route, actions);
    page.append(empty, wrap); wrap.hidden = true;
    for (const [field, setter] of [[inField, setIn], [outField, setOut]]) field.addEventListener('change', () => {
      const value = U.parseTime(field.value, fps()); if (value == null || !Number.isFinite(value)) { paint(); return; } setter(value);
    });
    scrub.addEventListener('input', () => { pause(); seek(+scrub.value); });
    video.addEventListener('timeupdate', () => {
      position = video.currentTime;
      if (position >= TR.out && !video.paused) { pause(); seek(Math.max(TR.in, TR.out-frame())); }
      paint();
    });
    video.addEventListener('loadedmetadata', () => seek(position));
    video.addEventListener('play', paint); video.addEventListener('pause', paint);
    wrap.addEventListener('keydown', e => {
      if (U.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!['i','o',' ','j','k','l','arrowleft','arrowright',',','.'].includes(key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.repeat && [',','.','j','k','l',' '].includes(key)) return;
      if (key === 'i') setIn(position);
      if (key === 'o') setOut(position);
      if (key === ',') TR.insert();
      if (key === '.') TR.overwrite();
      if (key === 'k') pause();
      if (key === ' ') play.click();
      if (key === 'arrowleft' || key === 'arrowright') { pause(); seek(position + (key === 'arrowleft' ? -frame() : frame()) * (e.shiftKey ? 10 : 1)); }
      if (key === 'l') forward(video.paused ? 1 : Math.min(8, video.playbackRate*2));
      if (key === 'j' && TR.media?.kind !== 'image') {
        pause(); KC.engine.pause();
        let previous = performance.now();
        reverse = setInterval(() => { const now = performance.now(); seek(position-(now-previous)/1000); previous = now; if (position <= 0) pause(); }, 40);
      }
    });
    TR.open = media => {
      pause(); KC.dock.show('trimmer'); KC.engine.pause();
      TR.media = media; position = 0;
      TR.in = ranges.get(media.id)?.in || 0; TR.out = Math.min(ranges.get(media.id)?.out || duration(), duration());
      if (TR.out-TR.in < frame()) { TR.in = 0; TR.out = duration(); }
      empty.hidden = true; wrap.hidden = false;
      name.textContent = media.name; name.title = media.path;
      video.hidden = media.kind === 'image'; image.hidden = media.kind !== 'image';
      video.removeAttribute('src'); video.load();
      if (media.kind === 'image') image.src = U.mediaUrl(media.path);
      else { video.src = KC.media.url(media, true); video.load(); }
      videoCheck.disabled = !media.hasVideo; audioCheck.disabled = !media.hasAudio;
      videoCheck.checked = !!media.hasVideo; audioCheck.checked = !!media.hasAudio;
      scrub.max = Math.max(frame(), duration()-frame()); scrub.step = frame();
      destinations(); paint(); requestAnimationFrame(drawWave); wrap.focus();
    };
    KC.on('dock-tab', id => { if (id !== 'trimmer') pause(); });
    KC.on('play-state', playing => { if (playing) pause(); });
    KC.on('project-loaded', () => { pause(); TR.media = null; TR.in = TR.out = 0; ranges.clear(); wrap.hidden = true; empty.hidden = false; });
    KC.on('change', () => {
      destinations();
      if (TR.media && !P.media(TR.media.id)) { pause(); TR.media = null; wrap.hidden = true; empty.hidden = false; }
      else if (TR.media) TR.media = P.media(TR.media.id);
    });
    KC.on('media-source-changed', m => { if (m.id === TR.media?.id) TR.open(m); });
    KC.on('media-updated', m => { if (m.id === TR.media?.id) drawWave(); });
    new ResizeObserver(drawWave).observe(bar);
  } };
})();
