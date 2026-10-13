/*!
 * YouTube 仿哔哩哔哩操作 —— 默认清晰度【主世界这一半】
 * 版本 1.3.2 · manifest 里声明 world: "MAIN",跑在页面主世界,才拿得到 YouTube 的播放器接口
 *
 * 接口调用顺序(都是播放器自己挂在 #movie_player 上的方法,没有任何官方文档):
 *   ① player.setPlaybackQualityRange(档, 档)   ← 把最低/最高都锁成同一档
 *   ② player.setPlaybackQuality(档)             ← 老接口,没有①时退回
 *   都不存在 → 只记一条日志,不报错、不影响播放
 *
 * 1.3.2 优化:
 *   - 用 player.getPlaybackQuality() 做去重:当前已经在目标档位时,那 4 次重试直接跳过
 *     (日志里原本一梭子 4 次重复调用,现在正常情况只调 1 次;档位被 YouTube 改回去才补设)
 *
 * 目标值来自隔离世界那一半(quality.js)通过 window.postMessage 传来的 {__biliYtQuality:1, desired}:
 *   desired = 'hd1080' 这类内部标识 → 锁死该档
 *   desired = 'highest' → 读当前视频可用列表,取实际能给的最高一档
 *   desired = ''        → 交回自动(setPlaybackQualityRange('auto','auto'))
 */
(() => {
  'use strict';

  const VERSION = '1.5.0';
  const TAG = '[仿B站画质·主世界]';

  const ORDER = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'hd2880', 'highres'];
  const RETRY_AT = [400, 1200, 2600, 5000];
  const VALID = /^(|highest|tiny|small|medium|large|hd720|hd1080|hd1440|hd2160|hd2880|highres)$/;
  const SKIP_WINDOW = 8000;          // 刚设过且档位没变 → 这段时间内不重复设

  let desired = '';
  let lastNote = '';
  let timers = [];
  let lastAppliedAt = 0;

  const rank = (q) => ORDER.indexOf(q);

  function note(msg) {
    if (msg === lastNote) return;
    lastNote = msg;
    try { console.log(TAG + ' ' + VERSION + ' | ' + msg); } catch (err) {}
  }

  function clearTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  function playerEl() {
    try { return document.getElementById('movie_player'); } catch (err) { return null; }
  }

  function available(p) {
    try {
      const l = (typeof p.getAvailableQualityLevels === 'function') ? p.getAvailableQualityLevels() : null;
      return Array.isArray(l) ? l.filter((q) => q && q !== 'auto') : [];
    } catch (err) { return []; }
  }

  // 播放器当前实际的清晰度标识(没有这个接口就返回空 → 不做去重)
  function current(p) {
    try {
      return (typeof p.getPlaybackQuality === 'function') ? String(p.getPlaybackQuality() || '') : '';
    } catch (err) { return ''; }
  }

  function choose(list, raw) {
    const known = list.filter((q) => rank(q) >= 0);
    if (!known.length) return raw === 'highest' ? '' : raw;   // 拿不到列表 → 直接按目标请求
    known.sort((a, b) => rank(b) - rank(a));                  // 高 → 低
    if (raw === 'highest') return known[0];
    const t = rank(raw);
    for (const q of known) {
      if (rank(q) <= t) return q;                             // 第一个不高于目标的就是最合适的
    }
    return known[known.length - 1];
  }

  function apply(why) {
    if (!desired) return;
    const p = playerEl();
    if (!p) { note('还没找到播放器,等下次事件'); return; }
    const hasRange = (typeof p.setPlaybackQualityRange === 'function');
    const hasSingle = (typeof p.setPlaybackQuality === 'function');
    if (!hasRange && !hasSingle) {
      note('播放器上没有清晰度接口,跳过(不报错、不影响播放)');
      return;
    }
    const target = choose(available(p), desired);
    if (!target) { note('拿不到可用清晰度,先不动(等下次事件)'); return; }

    const cur = current(p);
    if (cur && cur === target && Date.now() - lastAppliedAt < SKIP_WINDOW) {
      note('当前已经是 ' + target + ',跳过重复设置 (' + why + ')');
      return;
    }

    try {
      if (hasRange) p.setPlaybackQualityRange(target, target);
      else p.setPlaybackQuality(target);
      lastAppliedAt = Date.now();
      note((desired === 'highest' ? '已请求「最高可用」:' : '已请求清晰度:') + target + ' (' + why + ')');
    } catch (err) {
      note('设置清晰度失败:' + err);
    }
  }

  function release() {
    const p = playerEl();
    if (!p) return;
    try {
      if (typeof p.setPlaybackQualityRange === 'function') {
        p.setPlaybackQualityRange('auto', 'auto');
        lastAppliedAt = 0;
        note('已交回自动(放开清晰度)');
      }
    } catch (err) { /* 忽略 */ }
  }

  // 打一梭子:YouTube 的自适应随后可能把清晰度改回去(已经在目标档位的会被 apply 里的去重跳过)
  function burst(why) {
    clearTimers();
    if (!desired) return;
    RETRY_AT.forEach((ms, i) => {
      timers.push(setTimeout(() => apply(why + '#' + (i + 1)), ms));
    });
  }

  function onMedia(e) {
    const t = e.target;
    if (!t || t.tagName !== 'VIDEO') return;
    if (e.type === 'loadedmetadata') burst('loadedmetadata');
  }

  /* ------------------------------------------------------------------ 挂载 */
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.__biliYtQuality !== 1) return;
    const raw = String(d.desired || '');
    if (!VALID.test(raw)) return;                       // 只认白名单里的值
    const prev = desired;
    desired = raw;
    if (!desired) {
      clearTimers();
      if (prev) release();                              // 从"锁定某档"切回"保持默认"时放开
      return;
    }
    burst(prev === desired ? '事件补设' : '设置变更');
  }, false);

  document.addEventListener('loadedmetadata', onMedia, true);
  document.addEventListener('playing', onMedia, true);
})();
