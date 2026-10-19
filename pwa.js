'use strict';
(() => {
  const status = document.getElementById('offlineStatus');
  const install = document.getElementById('installApp');
  const dialog = document.getElementById('installDialog');
  let prompt;
  document.getElementById('closeInstall').addEventListener('click', () => dialog.close());
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    prompt = event;
  });
  window.addEventListener('appinstalled', () => { install.hidden = true; prompt = null; });
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) install.hidden = true;
  install.addEventListener('click', async () => {
    if (!prompt) { dialog.showModal(); return; }
    const current = prompt;
    prompt = null;
    try { await current.prompt(); await current.userChoice; }
    catch { dialog.showModal(); }
  });
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    status.textContent = '手机安装与离线缓存需要 HTTPS 地址';
    return;
  }
  navigator.serviceWorker.register('service-worker.js').then(registration => {
    const watch = worker => {
      if (!worker) return;
      const update = () => {
        if (worker.state === 'activated') status.textContent = '离线已就绪 · 单词本保存在本机';
        if (worker.state === 'redundant') status.textContent = '离线缓存未完成，请联网后重新打开';
      };
      worker.addEventListener('statechange', update);
      update();
    };
    watch(registration.installing || registration.waiting || registration.active);
    registration.addEventListener('updatefound', () => watch(registration.installing));
  }).catch(() => { status.textContent = '离线缓存未完成，请检查网络或浏览器设置'; });
})();
