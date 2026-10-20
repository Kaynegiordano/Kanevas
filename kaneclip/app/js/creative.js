// Recettes éditables : seuls les effets marqués « atelier » sont remplacés.
'use strict';
(() => {
  const P=KC.P,F=KC.FX,h=KC.h;
  const A=KC.creative={};
  A.looks={
    cinema:{name:'Cinéma doux',detail:'Contraste mesuré, couleurs retenues, chaleur légère.',color:'#9a8365',fx:[['bc',{contrast:1.10,brightness:-.01}],['color',{sat:.85,temp:.10}]]},
    noir:{name:'Noir & blanc',detail:'Une lecture graphique, pour les portraits et le documentaire.',color:'#8b9199',fx:[['bw',{amount:1}],['bc',{contrast:1.16}]]},
    naturel:{name:'Éclat naturel',detail:'Un peu de lumière et de couleur, sans effet appuyé.',color:'#5e9b90',fx:[['bc',{brightness:.025,contrast:1.04}],['color',{sat:1.08}]]},
    souvenir:{name:'Souvenir',detail:'Couleurs chaudes et sépia léger.',color:'#bb8d64',fx:[['sepia',{amount:.35}],['color',{sat:.86,temp:.12}]]},
    nuit:{name:'Nuit bleue',detail:'Une ambiance froide et plus dense.',color:'#687eae',fx:[['bc',{brightness:-.025,contrast:1.12}],['color',{sat:.82,temp:-.22}]]},
  };
  const targets=()=>KC.sel.list().filter(e=>P.kindOf(e)==='video'&&!e.caption);
  A.apply=(id,strength=100)=>{
    const look=A.looks[id],events=targets();
    if(!look||!events.length)return KC.toast('Sélectionnez des événements vidéo ou des images.','info');
    strength=KC.util.clamp(Number(strength)||0,0,100)/100;
    KC.edit('Look Atelier : '+look.name,()=>events.forEach(ev=>{
      ev.fx=ev.fx.filter(f=>!f.atelier);
      if(!strength)return;
      for(const [type,values] of look.fx){const f=F.make(type);f.atelier=id;
        for(const [key,value] of Object.entries(values)){const neutral=type==='bw'||type==='sepia'?0:f.params[key];f.params[key]=neutral+(value-neutral)*strength;}
        ev.fx.push(f);
      }
    }));
  };
  A.motion=type=>{
    const events=targets();if(!events.length)return KC.toast('Sélectionnez une image ou une vidéo.','info');
    KC.edit('Mouvement Atelier',()=>events.forEach(ev=>{
      const a=F.pcDefault(),b={...F.pcDefault(),t:ev.length};
      if(type==='in')b.zoom=1.15;
      if(type==='out')a.zoom=1.15;
      if(type==='pan'){a.zoom=b.zoom=1.15;a.cx=.46;b.cx=.54;}
      ev.pc={...ev.pc,kf:[{...a,ease:'smooth'},{...b,ease:'smooth'}]};
    }));
  };
  A.build=page=>{
    page.classList.add('creative-page');
    const strength=h('input',{type:'range',min:0,max:100,value:100,'aria-label':'Intensité du prochain look'}),value=h('b',{text:'100 %'});
    strength.addEventListener('input',()=>value.textContent=strength.value+' %');
    page.append(h('div.creative-header',h('span.creative-kicker',{text:'ATELIER CRÉATIF'}),h('h2',{text:'Donnez une intention au montage.'}),h('p',{text:'Sélectionnez vos plans. Les looks et mouvements restent éditables et annulables.'})),h('div.creative-strength',h('span',{text:'Intensité du prochain look'}),strength,value));
    const grid=h('div.creative-grid');
    for(const [id,look] of Object.entries(A.looks)){
      const card=h('button.creative-card',{dataset:{look:id}},h('span.look-swatch'),h('b',{text:look.name}),h('span',{text:look.detail}));
      card.style.setProperty('--look-color',look.color);
      card.addEventListener('click',()=>A.apply(id,+strength.value));grid.append(card);
    }
    const reset=h('button.btn.small',{text:'Retirer les looks Atelier'});reset.addEventListener('click',()=>KC.edit('Retirer les looks Atelier',()=>targets().forEach(e=>{e.fx=e.fx.filter(f=>!f.atelier);})));
    const motion=h('div.creative-motion',h('h3',{text:'Mettre une image en mouvement'}));
    for(const [type,name] of [['in','Zoom progressif'],['out','Dézoom doux'],['pan','Panoramique']]){const b=h('button.btn.small',{text:name});b.addEventListener('click',()=>A.motion(type));motion.append(b);}
    const status=h('div.creative-selection');const refresh=()=>status.textContent=targets().length+' plan(s) sélectionné(s) · les sous-titres sont exclus des recettes';
    page.append(grid,reset,motion,status);KC.on('selection',refresh);KC.on('change',refresh);refresh();
  };
})();
