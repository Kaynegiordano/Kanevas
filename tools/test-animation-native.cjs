// Vraie fenêtre Kane App, vrai moteur Animation migré et vrai pont d'ouverture de fichier.
const {app,dialog,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const occupied=execFileSync('netstat',['-ano','-p','TCP'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).map(l=>l.trim().split(/\s+/)).some(c=>c[0]==='TCP' && c[1]?.endsWith(':8780') && c[3]==='LISTENING');
assert(!occupied,'Fermez Animation avant ce test isolé : le port 8780 est utilisé.');
const root=process.env.KANEVAS_TEST_ROOT || path.join(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kanevas-animation-native-'));
const profile=path.join(tmp,'profile');process.env.KANEVAS_PROFILE=profile;
const managed=require(path.join(root,'managed-runtimes.cjs'))(profile);
const owned=managed.activate('C:\\KaneOS\\KanevasData\\migration.json');
owned.source=tmp;fs.writeFileSync(path.join(profile,'managed-runtimes.json'),JSON.stringify(owned));
const output=path.join(tmp,'output','animation'),fixture=path.join(tmp,'Choix réel.png');fs.mkdirSync(output,{recursive:true});
const rgba=Buffer.alloc(128*64*4,210);for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
fs.writeFileSync(fixture,nativeImage.createFromBitmap(rgba,{width:128,height:64}).toPNG());
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});
const dir=owned.components.wallpaper.directory;
const child=spawn(path.join(dir,'venv/Scripts/python.exe'),['-u',path.join(root.replace(/app\.asar$/,'app.asar.unpacked'),'animation-runtime.py'),'--server',path.join(dir,'outils/peintre.py'),'--port','8780'],
  {cwd:dir,windowsHide:true,env:{...process.env,WEA_PROJETS:output,PYTHONIOENCODING:'utf-8'},stdio:'ignore'});
let handled=false;
app.on('browser-window-created',(_e,win)=>{
  if(handled)return;handled=true;win.setOpacity(0);win.setSkipTaskbar(true);
  win.webContents.once('did-finish-load',async()=>{
    try{
      let ready=false;
      for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:8780/api/projets')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
      assert(ready,'Serveur Animation non disponible');
      const result=await win.webContents.executeJavaScript(`(async()=>{
        await KS.suite.ready;await KS.suite.importAnimation();
        const state=await KS.ws.request('wallpaper','state');
        const image=await KS.native.readFile(${JSON.stringify(fixture)});
        const saved=await KS.native.saveOutput('txt2img','native-output.png',image.data);
        await KS.suite.openVideo();
        return {state,docs:KS.state.docs.length,saved};
      })()`);
      assert.equal(result.state.width,128);assert.equal(result.state.height,64);assert.equal(result.docs,0);
      assert(fs.existsSync(path.join(output,result.state.dossier,'scene.png')));
      assert(result.saved.ok && result.saved.path.startsWith(path.join(tmp,'output','studio')+path.sep));
      const frame=win.webContents.mainFrame.frames.find(f=>f.url.includes('/kaneclip/app/'));
      assert.equal(await frame.executeJavaScript('kcNative.outputDir()'),path.join(tmp,'output','montage'));
      console.log('OK Import Animation natif réel : image visible 128×64, aucun document Edition, source dans output/animation');
      console.log('OK Pont réel : sauvegarde Studio dans output/studio et dossier de rendu Montage dans output/montage');
      child.kill();app.exit(0);
    }catch(error){console.error(error);child.kill();app.exit(1);}
  });
});
require(path.join(root,'main.js'));
