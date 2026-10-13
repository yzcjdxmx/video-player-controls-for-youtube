/*!
 * YouTube 仿哔哩哔哩操作 —— 默认清晰度【隔离世界这一半】
 * 版本 1.3.1 · 只做一件事:读设置 → 用 postMessage 把目标清晰度告诉主世界
 *
 * ★★ 为什么必须分两半(1.3.1 修的就是这个):
 *    content script 跑在 Chrome 的「隔离世界」里,能看到同样的 DOM,但
 *    **看不到 YouTube 用 JS 挂在 #movie_player 元素上的方法**
 *    (setPlaybackQualityRange / getAvailableQualityLevels 这类都是页面 JS 挂上去的
 *     expando 属性,隔离世界读到的是 undefined)。
 *    所以真正调用播放器接口的代码必须放进主世界 → quality-main.js(manifest 里 world:"MAIN")。
 *
 * 这一半的日志前缀是 [仿B站画质],主世界那一半是 [仿B站画质·主世界],两边都看控制台就能定位。
 */
(() => {
  'use strict';

  const VERSION = '1.4.0';
  const TAG = '[仿B站画质]';

  const DEFAULTS = { enabled: true, videoQuality: 'auto' };
  const QMAP = {
    '144': 'tiny', '240': 'small', '360': 'medium', '480': 'large',
    '720': 'hd720', '1080': 'hd1080', '1440': 'hd1440',
    '2160': 'hd2160', '4320': 'highres'
  };

  let cfg = Object.assign({}, DEFAULTS);
  let lastNote = '';
  let lastPushAt = 0;

  function note(msg) {
    if (msg === lastNote) return;
    lastNote = msg;
    try { console.log(TAG + ' ' + VERSION + ' | ' + msg); } catch (err) {}
  }

  // 把设置翻译成主世界能用的目标值:'' = 保持默认(交回自动)
  function desired() {
    if (!cfg.enabled) return '';
    const v = String(cfg.videoQuality || 'auto');
    if (v === 'auto') return '';
    if (v === 'highest') return 'highest';
    return QMAP[v] || '';
  }

  function push(why) {
    lastPushAt = Date.now();
    try {
      window.postMessage({ __biliYtQuality: 1, desired: desired() }, '*');
      note('已把清晰度设置交给主世界:' + (desired() || '保持默认 / 交回自动') + ' (' + why + ')');
    } catch (err) {
      note('postMessage 失败:' + err);
    }
  }

  /* ------------------------------------------------------------------ 设置 */
  (function loadCfg() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
      chrome.storage.sync.get(DEFAULTS, (v) => {
        if (v && typeof v === 'object') cfg = Object.assign(cfg, v);
        setTimeout(() => push('设置载入'), 0);
        setTimeout(() => push('设置载入-补发'), 600);   // 怕主世界那一半还没挂上监听
      });
      chrome.storage.onChanged.addListener((changes) => {
        if (!changes) return;
        for (const k of Object.keys(changes)) {
          if (k in cfg) cfg[k] = changes[k].newValue;
        }
        setTimeout(() => push('设置变更'), 0);
      });
    } catch (err) {
      try { console.warn(TAG + ' ' + VERSION + ' | 读取设置出错(用默认值继续)', err); } catch (e) { /* 忽略 */ }
    }
  })();

  /* ---------------------------------------------------- 媒体事件(每个视频重设) */
  function onMedia(e) {
    const t = e.target;
    if (!t || t.tagName !== 'VIDEO') return;
    if (e.type === 'loadedmetadata') { push('loadedmetadata'); return; }
    if (e.type === 'playing' && Date.now() - lastPushAt > 3000) push('playing');
  }

  document.addEventListener('loadedmetadata', onMedia, true);
  document.addEventListener('playing', onMedia, true);
  document.addEventListener('yt-navigate-finish', () => push('换视频'), true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) push('回到前台'); }, true);
})();
