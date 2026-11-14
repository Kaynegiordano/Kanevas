// Rendu WebGL réel : tête, regard, clic et retour au repos, sur textures de test.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=process.env.KANEVAS_TEST_ROOT || path.join(__dirname,'..');
const unpacked=root.replace(/app\.asar$/,'app.asar.unpacked');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kanevas-web-'));
function texture(w,h,pixel){const b=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)b.set(pixel(x,y),(y*w+x)*4);return nativeImage.createFromBitmap(b,{width:w,height:h}).toDataURL();}
const assets={
 'base.png':texture(320,240,(x,y)=>Math.hypot(x-160,y-95)<70?[205,220,235,255]:[50+x%25,70+y%25,90,255]),
 'depth.png':texture(320,240,()=>[128,128,128,255]),
 'mask.png':texture(320,240,(x,y)=>x>90&&x<230&&y>25&&y<165?[255,255,255,255]:[0,0,0,255]),
 'look.png':texture(180,30,(x,y)=>{const frame=Math.floor(x/60),xx=x%60;return Math.abs(xx-(15+frame*15))<5&&Math.abs(y-15)<6?[0,0,0,255]:[0,0,0,0];}),
 'blink.png':texture(120,30,(x,y)=>x>=60&&y>8&&y<22?[80,80,80,255]:[0,0,0,0]),
};
const anim={taille:[320,240],boucle:20,fond:'base.png',profondeur:'depth.png',profondeur_web:'depth.png',masques:['mask.png'],camera:false,
 effets:[{type:'tete',canal:'m1.r',pivot:[160,160],haut:25,bas:160,force:.006,curseur:'head'}],
 calques:[{type:'visage',mode:'expression',image:'look.png',nom:'look',boite:[130,80,60,30],images:3,curseur:'look',courbe:'look',suit:'corps'},
 {type:'visage',image:'blink.png',nom:'eyes',boite:[130,80,60,30],images:2,curseur:'eyes',suit:'corps'}],
 curseurs:{head:{defaut:1},look:{defaut:1},eyes:{type:'bool',defaut:true}},gestes:{look:[[0,-.8],[5,0],[10,.8],[15,0]]},parallaxe:{souris:0,auto:0}};
fs.writeFileSync(path.join(tmp,'anim.json'),JSON.stringify(anim));
fs.writeFileSync(path.join(tmp,'index.html'),'const ANIM = '+JSON.stringify(anim)+';\n');
fs.writeFileSync(path.join(tmp,'assets.js'),'window.ASSETS = '+JSON.stringify(assets)+';');
fs.mkdirSync(path.join(tmp,'peinture'));
fs.writeFileSync(path.join(tmp,'peinture/peinture.json'),JSON.stringify({reglages:{interaction_regard:true,interaction_tete:true,interaction_clic:true,interaction_force:.65}}));
const configure=()=>JSON.parse(execFileSync(process.env.KANEVAS_TEST_PYTHON || 'python',[path.join(unpacked,'animation_web.py'),tmp],{encoding:'utf8',windowsHide:true}));
const available=configure();assert(available.available.tete&&available.available.regard&&available.available.clignement);
const original=fs.readFileSync(path.join(tmp,'index.html'));configure();assert(original.equals(fs.readFileSync(path.join(tmp,'index.html'))),'Assemblage idempotent');
fs.writeFileSync(path.join(tmp,'preload.cjs'),'window.requestAnimationFrame=()=>0;window.testNow=0;Object.defineProperty(performance,"now",{value:()=>window.testNow});');
app.whenReady().then(async()=>{
 let win;
 try{
  win=new BrowserWindow({show:false,width:960,height:720,webPreferences:{preload:path.join(tmp,'preload.cjs'),contextIsolation:false,offscreen:true}});
  const errors=[];win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});
  // sortie Scène (par défaut) : l'aperçu Web reste dans l'atelier, « a poster » ne reçoit aucun fond Web
  assert(!fs.existsSync(path.join(tmp,'a poster','index.html')),'Aucun fond Web dans « a poster » en sortie Scène');
  await win.loadFile(path.join(tmp,'work','apercu web','index.html'));
  let ready=false;for(let i=0;i<200;i++){ready=await win.webContents.executeJavaScript('window.READY===true');if(ready)break;await new Promise(r=>setTimeout(r,20));}assert(ready,errors.join('\n'));
  const result=await win.webContents.executeJavaScript(`(()=>{
    const pixels=()=>{render();const b=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;};
    const diff=(a,b)=>a.reduce((n,v,i)=>n+(v!==b[i]),0);
    time=0;const before=pixels();
    dispatchEvent(new MouseEvent('mousemove',{clientX:innerWidth,clientY:innerHeight/2}));for(let i=0;i<30;i++)updateParallax(0,.1);
    const right=pixels(),rightState=KaneInteraction.state();
    S.kane_tete=false;const gazeOnly=pixels();S.kane_tete=true;S.kane_regard=false;const headOnly=pixels();S.kane_regard=true;
    dispatchEvent(new MouseEvent('mousemove',{clientX:0,clientY:innerHeight/2}));for(let i=0;i<30;i++)updateParallax(0,.1);
    const left=pixels(),leftState=KaneInteraction.state();
    S.kane_regard=false;dispatchEvent(new MouseEvent('mousemove',{clientX:innerWidth/2,clientY:innerHeight/2}));for(let i=0;i<40;i++)updateParallax(0,.1);
    const verticalBase=pixels();dispatchEvent(new MouseEvent('mousemove',{clientX:innerWidth/2,clientY:innerHeight}));for(let i=0;i<40;i++)updateParallax(0,.1);
    const vertical=pixels(),lift=KaneInteraction.state().lift;
    S.kane_regard=true;dispatchEvent(new MouseEvent('mousemove',{clientX:0,clientY:innerHeight/2}));for(let i=0;i<40;i++)updateParallax(0,.1);
    const blink=LAYERS.find(l=>l.type==='visage'&&l.mode!=='expression');testNow=1000;canvas.click();testNow=1150;const b=blinkAmount(blink,0),clicked=pixels();
    testNow=2200;const settled=blinkAmount(blink,0);
    S.kane_tete=false;S.kane_regard=false;S.kane_clic=false;S.kane_interaction_force=0;
    const off=KaneInteraction.state();dispatchEvent(new MouseEvent('mouseout',{relatedTarget:null}));for(let i=0;i<40;i++)updateParallax(0,.1);
    const gone=KaneInteraction.state();
    time=0;const loopStart=pixels();time=LOOP;const loopEnd=pixels();
    return {diffRight:diff(before,right),gazeOnly:diff(before,gazeOnly),headOnly:diff(before,headOnly),vertical:diff(verticalBase,vertical),lift,diffSides:diff(right,left),diffClick:diff(left,clicked),loop:diff(loopStart,loopEnd),right:rightState.head,left:leftState.head,blink:b,settled,off:off.head,gone:gone.x,error:gl.getError()};
  })()`);
  assert(result.diffRight>100 && result.diffSides>100 && result.diffClick>100,JSON.stringify(result));
  assert(result.gazeOnly>10 && result.headOnly>100 && result.loop<30,JSON.stringify(result));
  assert(result.vertical>30 && result.lift>.4,JSON.stringify(result));
  assert(result.right>0 && result.left<0 && result.blink>.5 && result.settled===0 && result.off===0 && Math.abs(result.gone)<.01,JSON.stringify(result));
  const breath=await win.webContents.executeJavaScript(`(()=>{
    const pixels=()=>{render();const b=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;};
    const diff=(a,b)=>a.reduce((n,v,i)=>n+(v!==b[i]),0);
    time=1.5;S.kane_respire=true;const on=pixels(),move=bodyD(IMG_W/2,0,1.5);S.kane_respire=false;const off=pixels();S.kane_respire=true;
    time=0;const loopA=pixels();time=LOOP;const loopB=pixels();
    return {diff:diff(on,off),total:on.length/4,dy:move[1],loop:diff(loopA,loopB)};
  })()`);
  assert(breath.diff>50 && breath.diff<breath.total*.9 && Math.abs(breath.dy)>.3 && Math.abs(breath.dy)<20 && breath.loop<30,JSON.stringify(breath));
  assert(JSON.parse(fs.readFileSync(path.join(tmp,'anim.json'),'utf8')).effets.filter(e=>e.kane==='respire').length===1,'Un seul effet de respiration douce');
  assert.equal(result.error,0);assert.equal(errors.length,0,errors.join('\n'));
  assert(fs.readFileSync(path.join(tmp,'work/apercu web/index.html')).equals(original));
  // sortie Web : le fond Web va aussi dans « a poster » ; jamais par-dessus une scène
  fs.writeFileSync(path.join(tmp,'peinture/peinture.json'),JSON.stringify({reglages:{sortie:'web',interaction_regard:true,interaction_tete:true,interaction_clic:true,interaction_force:.65}}));
  configure();assert(fs.readFileSync(path.join(tmp,'a poster/index.html')).equals(original),'Fond Web dans « a poster » en sortie Web');
  fs.rmSync(path.join(tmp,'a poster'),{recursive:true});fs.mkdirSync(path.join(tmp,'a poster'));fs.writeFileSync(path.join(tmp,'a poster/kane-scene-export.json'),'{}');
  configure();assert(!fs.existsSync(path.join(tmp,'a poster/index.html')),'Une scène dans « a poster » n’est jamais recouverte');
  console.log('OK WebGL réel : pixels modifiés par le regard, la tête et le clic ; retrait souris, désactivation et absence d’erreur shader');
  console.log(JSON.stringify(result),JSON.stringify(breath));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
