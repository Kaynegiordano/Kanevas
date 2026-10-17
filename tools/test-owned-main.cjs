// Vrai processus principal, profil isolé, moteurs migrés réels et métadonnées Forge défaillantes simulées.
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const root = process.env.KANEVAS_TEST_ROOT || path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-owned-main-'));
process.env.KANEVAS_PROFILE = profile;
const reportFile = process.env.KANEVAS_MANAGED_REPORT || 'C:\\KaneOS\\KanevasData\\migration.json';
const owned = require(path.join(root, 'managed-runtimes.cjs'))(profile).activate(reportFile);
let handled = false;
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url.endsWith('/cmd-flags')) { response.statusCode = 500; return response.end('{}'); }
  response.end(JSON.stringify(request.url.endsWith('/options') ? {} : request.url.includes('/adetailer/') ? { ad_model: [] } : []));
});
const wait = async test => { const until = Date.now() + 20000; while (!test() && Date.now() < until) await new Promise(r => setTimeout(r, 50)); assert(test()); };
app.on('browser-window-created', (_event, win) => {
  if (handled) return; handled = true;
  win.setOpacity(0); win.setSkipTaskbar(true);
  win.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(17863, '127.0.0.1', resolve); });
      const result = await win.webContents.executeJavaScript(`(async()=>{
        await KS.suite.ready;
        const config=await KS.native.engineConfig();
        const catalogue=await KS.native.forgeCatalog('http://127.0.0.1:17863');
        const lora=await KS.native.loraCall('info');
        const comfy=await KS.native.svcStatus('comfyui');
        const animation=await KS.native.svcStatus('wallpaper');
        const migration=await KS.native.runtimeMigrationState();
        await KS.suite.openVideo();
        return {config,catalogue:{ok:catalogue.ok,dirs:catalogue.dirs},lora:{ok:lora.ok,sd:lora.sd_scripts},comfy,animation,migration:{active:migration.active,deletionAllowed:migration.deletionAllowed}};
      })()`);
      assert(result.config.managed && result.config.runtime === owned.components.studio.directory);
      assert(result.catalogue.ok && result.catalogue.dirs.data === owned.components.studio.directory && result.catalogue.dirs.models === owned.models);
      assert(result.lora.ok && path.resolve(result.lora.sd) === path.resolve(owned.components.training.directory));
      assert.equal(result.comfy.dir, owned.components.comfyui.directory); assert.equal(result.animation.dir, owned.components.wallpaper.directory);
      assert(result.migration.active && !result.migration.deletionAllowed);
      await wait(() => win.webContents.mainFrame.frames.some(f => f.url.includes('/kaneclip/app/')));
      const frame = win.webContents.mainFrame.frames.find(f => f.url.includes('/kaneclip/app/'));
      const media = await frame.executeJavaScript('kcNative.ffAvailable()');
      assert.equal(media.path, owned.media.ffmpeg); assert(media.version);
      console.log('OK Processus principal réel : Studio, catalogue sans cmd-flags, projets LoRA, services et FFmpeg utilisent les copies Kanevas');
      server.close(); app.exit(0);
    } catch (error) { console.error(error); server.close(); app.exit(1); }
  });
});
require(path.join(root, 'main.js'));
