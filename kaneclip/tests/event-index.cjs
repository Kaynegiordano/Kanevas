const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const handlers={};
const KC={project:{events:[]},on:(event,fn)=>(handlers[event]||=[]).push(fn)};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/js/event-index.js'),'utf8'),{KC});
let random=7;const rng=()=>((random=Math.imul(random,1664525)+1013904223>>>0)/4294967296);
for(let i=0;i<20000;i++)KC.project.events.push({id:i,track:'t'+i%6,start:i*.7,length:.2+rng()*2});
KC.project.events.push({id:'long',track:'t0',start:0,length:20000});
const index=KC.eventIndex,events=KC.project.events;
for(let i=0;i<150;i++){
  const from=rng()*14000,to=from+rng()*10,track=i%2?'t'+i%6:null;
  const expected=events.filter(e=>(track===null||e.track===track)&&e.start<to&&e.start+e.length>from).sort((a,b)=>a.start-b.start).map(e=>e.id);
  assert.deepEqual(Array.from(index.between(from,to,track),e=>e.id),expected);
}
assert.equal(index.stats().builds,1);
index.between(7000,7000.01);assert(index.stats().visited<150,index.stats());
const queries=Array.from({length:1000},()=>rng()*14000);
let t=performance.now();for(const from of queries)index.between(from,from+.01);const indexed=performance.now()-t;
t=performance.now();for(const from of queries)events.filter(e=>e.start<from+.01&&e.start+e.length>from);const scanned=performance.now()-t;
KC.project.events[100].start=19000;index.invalidate();assert(index.between(19000,19001).some(e=>e.id===100));
KC.project.events=KC.project.events.filter(e=>e.id!==100);assert(!index.between(19000,19001).some(e=>e.id===100));
KC.project={events:[]};assert.equal(index.duration(),0);
assert.equal(index.between(0,1).length,0);
console.log('PASS: interval index, overlaps, long background, per-track queries, mutations and project changes');
console.log(JSON.stringify({events:20001,queries:1000,indexedMs:+indexed.toFixed(2),scanMs:+scanned.toFixed(2)},null,2));
