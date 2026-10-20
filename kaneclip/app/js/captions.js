'use strict';
(() => {
  const C=KC.captions={},P=KC.P,U=KC.util;
  const stamp=t=>{const n=Math.max(0,Math.round(t*1000));return [Math.floor(n/3600000),Math.floor(n/60000)%60,Math.floor(n/1000)%60].map(v=>String(v).padStart(2,'0')).join(':')+','+String(n%1000).padStart(3,'0');};
  C.parse=text=>{
    if(typeof text!=='string'||text.length>5e6)throw new Error('Fichier SRT absent ou trop volumineux.');
    const blocks=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[ \t]*\n/),out=[];
    const time=s=>{const m=s.match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})$/);if(!m||+m[2]>59||+m[3]>59)return NaN;return +m[1]*3600 + +m[2]*60 + +m[3]+ +m[4]/1000;};
    for(const [i,block] of blocks.entries()){
      const lines=block.split('\n');if(/^\d+$/.test(lines[0].trim()))lines.shift();
      const match=lines.shift()?.trim().match(/^(\d{1,3}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/);
      const start=match?time(match[1]):NaN,end=match?time(match[2]):NaN;
      const body=lines.join('\n').replace(/<\/?(?:b|i|u|font)(?:\s[^>]*)?>/gi,'').trim();
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!body||body.length>4000)throw new Error('Bloc SRT '+(i+1)+' invalide. Rien n’a été importé.');
      out.push({start,end,text:body});if(out.length>10000)throw new Error('Maximum : 10 000 sous-titres par import.');
    }
    return out.sort((a,b)=>a.start-b.start);
  };
  C.list=()=>KC.project.events.filter(e=>e.caption&&e.gen?.type==='text').sort((a,b)=>a.start-b.start);
  C.srt=()=>C.list().filter(e=>String(e.gen.text||'').trim()).map((e,i)=>(i+1)+'\n'+stamp(e.start)+' --> '+stamp(P.end(e))+'\n'+String(e.gen.text||'').trim()).join('\n\n')+'\n';
  C.style=(boxed=false)=>({ ...KC.FX.GENERATORS.text.def(),size:.045,y:.86,bold:true,outline:boxed?0:.003,box:boxed,boxAlpha:.72,boxPad:.012,shadow:!boxed });
  C.add=cues=>{
    if(!Array.isArray(cues)||!cues.length)return [];
    for(const cue of cues)if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||cue.end<=cue.start||!String(cue.text||'').trim())throw new Error('Sous-titre invalide.');
    const created=KC.edit('Ajouter les sous-titres',()=>{
      let track=KC.project.tracks.find(t=>t.role==='captions');
      if(!track){track=P.newTrack('video',0);track.name='Sous-titres';track.role='captions';track.color=6;}
      const events=cues.map(cue=>P.newEvent({track:track.id,start:P.snapFrame(cue.start),length:Math.max(P.frame(),P.snapFrame(cue.end)-P.snapFrame(cue.start)),caption:true,gen:{...C.style(),text:String(cue.text).trim()}}));
      KC.project.events.push(...events);return events;
    });KC.sel.set(created.map(e=>e.id));return created;
  };
  C.import=async()=>{
    const paths=await KC.native.openDialog({title:'Importer des sous-titres SRT',multi:false,filters:[{name:'Sous-titres SubRip',extensions:['srt']}]});
    if(!paths.length)return;
    try{const file=await KC.native.readText(paths[0]);if(!file.ok)throw new Error(file.error);const cues=C.parse(file.text);C.add(cues);KC.dock.show('captions');KC.toast(cues.length+' sous-titres importés et intégrés à l’image.', 'ok');}catch(e){KC.toast(e.message,'err',6000);}
  };
  C.export=async()=>{
    if(!C.list().some(e=>String(e.gen.text||'').trim()))return KC.toast('Aucun sous-titre non vide dans ce montage.','info');
    const path=await KC.native.saveDialog({title:'Exporter les sous-titres SRT',defaultPath:'Sous-titres.srt',filters:[{name:'Sous-titres SubRip',extensions:['srt']}]});
    if(!path)return;const result=await KC.native.writeFile(path,C.srt());KC.toast(result.ok?'Sous-titres SRT enregistrés.':result.error,result.ok?'ok':'err');
  };
  C.build=page=>{
    const h=KC.h;
    let limit=100;
    const button=(label,fn)=>{const b=h('button.btn.small',{text:label});b.addEventListener('click',fn);return b;};
    const list=h('div.caption-list');
    const search=h('input.field#caption-search',{placeholder:'Rechercher dans les sous-titres…','aria-label':'Rechercher dans les sous-titres'});
    page.append(h('div.page-bar',button('Importer SRT',C.import),button('Exporter SRT',C.export),button('+ Au curseur',()=>{
      const lp=KC.project.loop,start=lp.out>lp.in?lp.in:KC.engine.time,end=lp.out>lp.in?lp.out:start+2;
      C.add([{start,end,text:'Nouveau sous-titre'}]);
    })),h('div.caption-note',{text:'Textes intégrés au rendu vidéo. SRT séparé exportable. Cliquez un timecode pour relire le passage.'}));
    const styles=h('div.caption-styles',h('span',{text:'Style de tous les sous-titres'}));
    for(const [label,boxed] of [['Clair',false],['Cartouche',true]])styles.append(button(label,()=>KC.edit('Styliser les sous-titres',()=>C.list().forEach(e=>{e.gen={...e.gen,...C.style(boxed),text:e.gen.text};}))));
    page.append(styles,search,list);
    const render=()=>{
      if(list.contains(document.activeElement)&&/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))return;
      list.replaceChildren();
      if(!C.list().length)list.append(h('div.page-empty',{text:'Importez un SRT ou écrivez vos sous-titres. Tous les textes restent modifiables sur une piste dédiée.'}));
      const filtered=C.list().filter(c=>c.gen.text.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
      for(const cue of filtered.slice(0,limit)){
        const row=h('div.caption-row');
        const go=button(U.fmtTime(cue.start,P.fps())+' → '+U.fmtTime(P.end(cue),P.fps()),()=>{KC.engine.seek(cue.start);KC.sel.set([cue.id]);});
        const text=h('textarea.field',{rows:2,value:cue.gen.text,'aria-label':'Texte du sous-titre'});
        text.addEventListener('change',()=>KC.edit('Modifier le sous-titre',()=>{cue.gen.text=text.value;cue.name='';}));
        const del=button('Retirer',()=>KC.edit('Retirer le sous-titre',()=>{KC.project.events=KC.project.events.filter(e=>e.id!==cue.id);}));
        const timing=button('Calage',()=>KC.dialogs.eventProps(cue));
        row.append(h('div.caption-row-head',go,timing,del),text);list.append(row);
      }
      if(filtered.length>limit)list.append(button('Afficher les 100 suivants ('+limit+'/'+filtered.length+')',()=>{limit+=100;render();}));
    };
    search.addEventListener('input',()=>{limit=100;render();});
    list.addEventListener('focusout',()=>setTimeout(render,0));KC.on('change',render);KC.on('project-loaded',render);render();
  };
})();
