const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
let id = 0, time = 0;
const KC = { prefs: { ripple:'off', autoCrossfade:true, imageLength:5 }, cmd:{}, util:{ uid:()=> 'id'+(++id), deep:v=>JSON.parse(JSON.stringify(v)) },
  on(){}, emit(){}, toast(){}, engine:{get time(){return time;}, pause(){},seek(t){time=t;},redraw(){}}, timeline:{ensureVisible(){}},
  FX:{pcAt(pc,t){ return {...pc.kf[0],t}; }} };
const ctx=vm.createContext({KC, console});
for(const file of ['project.js','editing.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/js',file),'utf8'),ctx);
const P=KC.P, O=KC.editing;
function reset(){KC.project=P.create();KC.resetHistory();KC.sel.clear();KC.prefs.ripple='off';time=0;}
function track(kind){return P.newTrack(kind);}
function event(t,start,length,extra={}){const ev=P.newEvent({track:t.id,start,length,...extra});KC.project.events.push(ev);return ev;}
function source(){const m={id:'source',name:'Source.mp4',kind:'video',hasVideo:true,hasAudio:true,duration:10};KC.project.media.push(m);return m;}
reset();
let v=track('video'),a=track('audio');let m=source();
event(v,0,10,{media:m.id,group:'old'});event(a,0,10,{media:m.id,group:'old'});P.addMarker(8);
time=3;let inserted=O.sourceEdit(m,2,4,{mode:'insert',videoTrack:v.id,audioTrack:a.id});
assert.equal(inserted.length,2);assert.equal(inserted[0].offset,2);assert.equal(inserted[0].length,2);
assert.equal(P.duration(),12);assert.equal(KC.project.markers[0].t,10);
assert.equal(P.eventsOn(v.id)[2].offset,3);assert.equal(P.eventsOn(v.id)[2].start,5);
assert.equal(P.eventsOn(v.id)[2].group,P.eventsOn(a.id)[2].group);assert.notEqual(P.eventsOn(v.id)[2].group,'old');
KC.undo();assert.equal(P.duration(),10);assert.equal(KC.project.events.length,2);KC.redo();assert.equal(P.duration(),12);
console.log('OK insertion trois points, décalage, groupes, sources, marqueurs, annulation/rétablissement');
reset();v=track('video');a=track('audio');m=source();event(v,0,10,{media:m.id});event(a,0,10,{media:m.id});
time=3;O.sourceEdit(m,1,3,{mode:'overwrite',audio:false,videoTrack:v.id});
assert.equal(P.duration(),10);assert.equal(P.eventsOn(v.id).length,3);assert.equal(P.eventsOn(a.id).length,1);
assert.equal(P.eventsOn(v.id)[2].offset,5);assert.equal(P.eventsOn(v.id)[2].start,5);
const serialized=P.serialize();assert.throws(()=>O.sourceEdit(m,4,1));assert.throws(()=>O.sourceEdit(m,0,2,{videoTrack:a.id}));assert.equal(P.serialize(),serialized);
console.log('OK remplacement ciblé, audio intact, limites Source et validation atomique');
reset();v=track('video');a=track('audio');event(v,0,10);event(a,0,10);KC.project.loop={in:2,out:5};P.addMarker(3);P.addMarker(8);
O.range(true);assert.equal(P.duration(),7);assert.equal(KC.project.markers.length,1);assert.equal(KC.project.markers[0].t,5);
assert.equal(P.eventsOn(v.id)[1].offset,5);assert.equal(P.eventsOn(v.id)[1].start,2);
KC.undo();assert.equal(P.duration(),10);assert.equal(KC.project.markers.length,2);
O.range(false);assert.equal(P.duration(),10);assert.equal(P.eventsOn(v.id).length,2);assert.equal(P.eventsOn(v.id)[1].start,5);
console.log('OK extraire et lever : découpe des bornes, sources et marqueurs, toutes pistes, historique');
reset();v=track('video');a=track('audio');KC.prefs.ripple='all';
const x=event(v,0,2), y=event(a,0,2);event(v,10,2);event(a,10,2);
P.deleteEvents([x.id,y.id]);assert.equal(P.duration(),10);assert.equal(P.eventsOn(v.id)[0].start,8);
console.log('OK suppression ondulée d’un groupe A/V : durée retranchée une seule fois');
reset();v=track('video');KC.prefs.ripple='tracks';const cut=event(v,0,4);event(v,2,4);event(v,8,2);
P.deleteEvents([cut.id]);assert.equal(P.eventsOn(v.id)[0].start,0);assert.equal(P.eventsOn(v.id)[1].start,6);
console.log('OK ondulation : seules les parties réellement découvertes sont refermées');
reset();v=track('video');a=track('audio');const first=event(v,0,4,{group:'pair'});event(a,0,4,{group:'pair'});
KC.cmd.razorAt(first,2);assert.equal(KC.project.events.length,4);assert.equal(P.eventsOn(v.id)[1].group,P.eventsOn(a.id)[1].group);
assert.notEqual(P.eventsOn(v.id)[0].group,P.eventsOn(v.id)[1].group);KC.undo();assert.equal(KC.project.events.length,2);
console.log('OK rasoir sur groupe lié et annulation');
