// The only bridge between the page and the app. The page never gets Node access.
const { contextBridge, ipcRenderer } = require('electron');

let audio = {};
function play(name) {
  if (!/^[\w-]+$/.test(name)) return;
  const src = location.protocol === 'file:' ? `sounds/${name}.wav` : `/sounds/${name}.wav`;
  const a = (audio[name] ||= new Audio(src)); a.currentTime = 0; a.play().catch(() => {});
}
ipcRenderer.on('alert:sound', (_e, name) => play(name));
ipcRenderer.on('update:available', (_e, n) => window.dispatchEvent(new CustomEvent('harness:update', { detail: n })));
ipcRenderer.on('setup:log', (_e, line) => window.dispatchEvent(new CustomEvent('harness:setup-log', { detail: line })));

contextBridge.exposeInMainWorld('harness', {
  send: (m) => ipcRenderer.send('native', m),
  runUpdate: () => ipcRenderer.send('update:run'),
  setupFields: () => ipcRenderer.invoke('setup:fields'),
  install: (user, library) => ipcRenderer.invoke('setup:install', { user, library }),
});
