// Index d'intervalles : recherche des événements proches sans balayer le montage à chaque image.
'use strict';
(() => {
  let dirty=true, owner=null, events=null, count=-1, root=null, tracks=new Map(), end=0, builds=0, visited=0;
  const tree=(list,a=0,b=list.length)=>{
    if(a>=b)return null;
    const mid=(a+b)>>1,left=tree(list,a,mid),right=tree(list,mid+1,b),ev=list[mid];
    return {ev,left,right,min:left?left.min:ev.start,max:Math.max(ev.start+ev.length,left?.max||0,right?.max||0)};
  };
  const ensure=()=>{
    const p=KC.project;
    if(!p)return;
    if(!dirty&&p===owner&&p.events===events&&p.events.length===count)return;
    owner=p;events=p.events;count=events.length;dirty=false;builds++;
    const sorted=events.slice().sort((a,b)=>a.start-b.start);
    root=tree(sorted);end=root?.max||0;tracks=new Map();
    for(const ev of sorted){if(!tracks.has(ev.track))tracks.set(ev.track,[]);tracks.get(ev.track).push(ev);}
    for(const [id,list] of tracks)tracks.set(id,tree(list));
  };
  KC.eventIndex={
    invalidate:()=>{dirty=true;},
    between:(from,to,track=null)=>{
      ensure();visited=0;const found=[];
      const walk=node=>{if(!node)return;visited++;if(node.max<=from||node.min>=to)return;
        walk(node.left);if(node.ev.start<to&&node.ev.start+node.ev.length>from)found.push(node.ev);walk(node.right);};
      walk(track===null?root:tracks.get(track));return found;
    },
    duration:()=>{ensure();return end;},
    stats:()=>({builds,visited,count}),
  };
  for(const event of ['change','project-loaded'])KC.on(event,KC.eventIndex.invalidate);
})();
