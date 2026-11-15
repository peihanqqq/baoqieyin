/* 宝箧印陀罗尼 · Service Worker
   策略：
   - 页面/样式/脚本/小图：缓存优先（Cache-First），首次访问后离线可用
   - 音频 (.m4a) 与字体：网络优先（Network-First），失败才回退缓存；不预缓存大音频
   - 安装时只预缓存核心外壳（首屏必需），避免一次性缓存 64MB 资源
*/
const CACHE_VERSION = 'baoqieyin-v1';
const CORE_CACHE = CACHE_VERSION + '-core';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

/* 预缓存的核心资源（不含大音频、不含高清大图，按需运行时缓存） */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/pinyin-pro.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('baoqieyin-v') && k !== CORE_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 仅处理同源请求（跨域的字体/统计等交给浏览器）
  if (url.origin !== self.location.origin) return;

  // 音频与字体：网络优先
  if (/\.(m4a|mp3|wav|aac)(\?|$)/i.test(url.pathname) || /fonts\.|\.(woff2?|ttf|otf)(\?|$)/i.test(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 其余（html/css/js/图片）：缓存优先
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const resp = await fetch(req);
    if (resp && resp.status === 200) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    // 离线且无缓存：对页面请求回退到 index.html
    if (req.mode === 'navigate') {
      const idx = await caches.match('./index.html');
      if (idx) return idx;
    }
    throw e;
  }
}

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const resp = await fetch(req);
    if (resp && resp.status === 200) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}
