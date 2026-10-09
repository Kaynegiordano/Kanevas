// Kanevas — mises à jour via les releases GitHub (electron-updater).
// Actif seulement dans l'application installée ; en développement, on répond « indisponible ».
const { app, ipcMain } = require('electron');

module.exports = function setupUpdater(getWin) {
  const send = (channel, payload) => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };
  const enabled = app.isPackaged;
  let autoUpdater = null;
  let state = { status: 'idle' };
  const set = s => { state = s; send('update-status', s); };

  if (enabled) {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;            // l'utilisateur décide
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => set({ status: 'checking' }));
    autoUpdater.on('update-available', i => set({ status: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : '' }));
    autoUpdater.on('update-not-available', () => set({ status: 'none', version: app.getVersion() }));
    autoUpdater.on('download-progress', p => set({ status: 'downloading', percent: Math.round(p.percent), version: state.version }));
    autoUpdater.on('update-downloaded', i => set({ status: 'ready', version: i.version }));
    autoUpdater.on('error', e => set({ status: 'error', error: String((e && e.message) || e).split('\n')[0] }));
  }

  ipcMain.handle('app-version', () => ({ version: app.getVersion(), packaged: enabled }));
  ipcMain.handle('update-state', () => state);
  ipcMain.handle('update-check', async () => {
    if (!enabled) return { status: 'unavailable' };
    try { await autoUpdater.checkForUpdates(); } catch (e) { set({ status: 'error', error: String((e && e.message) || e).split('\n')[0] }); }
    return state;
  });
  ipcMain.handle('update-download', async () => {
    if (!enabled) return { status: 'unavailable' };
    try { await autoUpdater.downloadUpdate(); } catch (e) { set({ status: 'error', error: String((e && e.message) || e).split('\n')[0] }); }
    return state;
  });
  ipcMain.on('update-install', () => { if (enabled && state.status === 'ready') autoUpdater.quitAndInstall(false, true); });

  // Vérification discrète au démarrage
  return {
    checkSoon() { if (enabled) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000); },
  };
};
