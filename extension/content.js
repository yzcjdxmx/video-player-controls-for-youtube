/*!
 * YouTube 仿哔哩哔哩操作逻辑 (Bili-style Controls for YouTube)
 * 版本 1.4.0 · 作者 yzcjdxmx <https://github.com/yzcjdxmx> · 无网络请求、无跟踪、无第三方依赖
 *
 * 做什么(与 B 站对齐的部分):
 *   1) 长按 →  = 临时 3 倍速快进,松手恢复原速
 *   2) 长按 ←  = 临时 3 倍速快退,松手恢复原速
 *   3) 短按 → / ←  = 5 秒快进 / 快退(B 站与 YouTube 原生都是 5 秒)
 *   4) Shift + → / ←  = 逐帧微调(1.1 新增;播放中会先暂停,不然那一帧看不出来)
 *   5) Ctrl + → / ←  = 跳 10 秒(1.1 新增,等于 YouTube 的 J / L;可改成 30)
 *   6) 长按、调音量、跳转时画面中央显示 B 站风格浮层
 *   7) 鼠标停在画面上滚滚轮 = 调音量(YouTube 原生只在全屏时支持)
 *   8) [ ] = 上一集 / 下一集(B 站键位;YouTube 原生是 Shift+P / Shift+N)
 *
 * 不动的地方:空格/K 播放暂停、↑↓ 音量、M 静音、F 全屏、0-9 跳百分比、
 *             J/L 快退快进 10 秒、Shift+< > 改倍速 —— 全部保持 YouTube 原生。
 */
(() => {
  'use strict';

  const DEFAULTS = {
    enabled: true,          // 总开关
    holdSpeed: 3,           // 长按时的倍速(B 站默认 3)
    holdThreshold: 250,     // 长按判定阈值(毫秒)
    longPressLeft: true,    // 长按 ← 也倍速(倒放加速)
    shortSeek: 5,           // 短按快进/快退秒数(B 站 = 5)
    overlay: true,          // 中央浮层提示
    wheelVolume: true,      // 画面滚轮调音量
    bracketNav: true,       // [ ] 切换上一集/下一集
    frameStep: true,        // Shift+←/→ 逐帧微调
    frameStepFps: 30,       // 自动探测失败时,按这个帧率算“一帧”多长
    frameStepPauses: true,  // 逐帧时若正在播放,先暂停
    ctrlArrowSeek: true,    // Ctrl+←/→ 跳 10 秒(映射 YouTube 的 J/L)
    skipSeconds: 10         // 上面那个“跳”的秒数
  };

  const HINT_CLASS = 'bili-yt-hint';
  const TYPING_SELECTOR = [
    'input', 'textarea', 'select',
    '[contenteditable="true"]', '[contenteditable=""]',
    '[role="menu"]', '[role="menuitem"]', '[role="listbox"]', '[role="option"]',
    '[role="dialog"]', '[role="textbox"]',
    '.ytp-settings-menu', '.ytp-popup', '.ytp-panel', '.ytp-contextmenu'
  ].join(',');

  let cfg = Object.assign({}, DEFAULTS);
  let hintEl = null;
  let hintTimer = 0;

  const state = { key: null, longFired: false, timer: 0, savedRate: 1 };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /* ------------------------------------------------------------------ 设置 */
  (function loadCfg() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
      chrome.storage.sync.get(DEFAULTS, (v) => {
        if (v && typeof v === 'object') cfg = Object.assign(cfg, v);
      });
      chrome.storage.onChanged.addListener((changes) => {
        if (!changes) return;
        for (const k of Object.keys(changes)) {
          if (k in cfg) cfg[k] = changes[k].newValue;
        }
      });
    } catch (err) { /* 读不到设置就用默认值,不打断页面 */ }
  })();

  /* -------------------------------------------------------------- DOM 辅助 */
  function getVideo() {
    const vids = Array.from(document.querySelectorAll('video'));
    if (!vids.length) return null;
    let best = vids[0];
    let bestArea = -1;
    for (const v of vids) {
      const area = (v.clientWidth || 0) * (v.clientHeight || 0);
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best;
  }

  function playerEl() {
    return document.querySelector('#movie_player') ||
           document.querySelector('.html5-video-player') ||
           null;
  }

  // 浮层必须挂在全屏元素(或其内部)里,否则全屏时看不见
  function hintHost() {
    const fs = document.fullscreenElement;
    if (fs && typeof fs.appendChild === 'function') return fs;
    return playerEl() || document.body;
  }

  function ensureHint() {
    const host = hintHost();
    if (!host) return null;
    if (hintEl && hintEl.parentNode === host) return hintEl;
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.className = HINT_CLASS;
      hintEl.setAttribute('aria-hidden', 'true');
    }
    host.appendChild(hintEl);
    return hintEl;
  }

  function showHint(text, kind) {
    if (!cfg.overlay) return;
    const el = ensureHint();
    if (!el) return;
    el.textContent = text;
    el.className = HINT_CLASS + ' bili-yt-show' + (kind ? ' bili-yt-' + kind : '');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 1000);
  }

  function hideHint() {
    clearTimeout(hintTimer);
    hintTimer = 0;
    if (hintEl) hintEl.className = HINT_CLASS;
  }

  function typingTarget(t) {
    if (!t || typeof t.closest !== 'function') return false;
    if (t.isContentEditable) return true;
    return !!t.closest(TYPING_SELECTOR);
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
  }

  function setRate(v, rate) {
    if (!v) return;
    try { v.playbackRate = rate; } catch (err) { /* 忽略 */ }
  }

  function durationOf(v) {
    return (typeof v.duration === 'number' && isFinite(v.duration) && v.duration > 0)
      ? v.duration : Infinity;
  }

  function seekTo(v, seconds) {
    const to = clamp((Number(v.currentTime) || 0) + seconds, 0, durationOf(v));
    try { v.currentTime = to; } catch (err) { /* 忽略 */ }
  }

  /* ------------------------------------------------------ 帧率探测(逐帧用) */
  // 用 requestVideoFrameCallback 量一批帧间隔,取中位数当成帧率;
  // 量不出来(暂停中、浏览器不支持)就退回设置里的 frameStepFps。
  function detectFps(v) {
    if (!v || typeof v.requestVideoFrameCallback !== 'function') return 0;
    const src = v.currentSrc || '';
    if (v.__biliFps && v.__biliFpsSrc === src) return v.__biliFps;
    if (v.__biliProbing) return 0;
    v.__biliProbing = true;
    const stamps = [];
    const guard = setTimeout(() => { v.__biliProbing = false; }, 4000);
    const onFrame = (now) => {
      stamps.push(now);
      if (stamps.length < 12) {
        try { v.requestVideoFrameCallback(onFrame); } catch (err) { v.__biliProbing = false; clearTimeout(guard); }
        return;
      }
      const deltas = [];
      for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
      deltas.sort((a, b) => a - b);
      const median = deltas[Math.floor(deltas.length / 2)];
      if (median > 1) {
        v.__biliFps = clamp(Math.round(1000 / median), 1, 240);
        v.__biliFpsSrc = src;
      }
      v.__biliProbing = false;
      clearTimeout(guard);
    };
    try { v.requestVideoFrameCallback(onFrame); } catch (err) { v.__biliProbing = false; clearTimeout(guard); }
    return 0;
  }

  function frameSeconds(v) {
    const fps = detectFps(v) || clamp(Number(cfg.frameStepFps) || 30, 1, 240);
    return 1 / fps;
  }

  /* ------------------------------------------------------------ 方向键接管 */
  function onKeyDown(e) {
    if (!cfg.enabled) return;
    if (e.altKey || e.metaKey) return;
    if (typingTarget(e.target)) return;                       // 输入框 / 播放器菜单里打字

    const k = e.key;
    const isArrow = (k === 'ArrowRight' || k === 'ArrowLeft');

    if (e.ctrlKey && e.shiftKey) return;                      // 三重组合键不碰

    if (e.ctrlKey) {
      if (isArrow && cfg.ctrlArrowSeek) jump(e, k);           // Ctrl+←/→ = 跳 10 秒
      return;                                                 // 其它 Ctrl 组合键原样放行
    }

    if (e.shiftKey) {
      if (isArrow && cfg.frameStep) frameStep(e, k);          // Shift+←/→ = 逐帧
      return;                                                 // Shift+< > 改倍速等交给原生
    }

    if (k === '[' || k === ']') { bracketNav(e, k); return; }
    if (!isArrow) return;

    const v = getVideo();
    if (!v) return;

    if (state.key) {
      // 同一根方向键按住产生的重复事件:继续拦截,不要再触发一次
      if (state.key === k) swallow(e);
      return;
    }

    // YouTube 在 keydown 就跳 5 秒,这里接管:短按改到 keyup 自己跳
    swallow(e);

    state.key = k;
    state.longFired = false;
    state.savedRate = v.playbackRate || 1;

    if (e.repeat) return;

    state.timer = setTimeout(() => {
      state.timer = 0;
      if (state.key !== k) return;
      if (k === 'ArrowLeft' && !cfg.longPressLeft) return;
      const speed = clamp(Number(cfg.holdSpeed) || 3, 0.25, 16);
      state.longFired = true;
      setRate(v, speed);
      showHint((k === 'ArrowRight' ? '▶▶ ' : '◀◀ ') + speed.toFixed(1) + 'X',
               k === 'ArrowRight' ? 'fast' : 'slow');
    }, clamp(Number(cfg.holdThreshold) || 250, 60, 2000));
  }

  function onKeyUp(e) {
    const k = e.key;
    if (k !== state.key) return;

    const v = getVideo();
    const wasLong = state.longFired;
    const rate = state.savedRate;

    clearTimeout(state.timer);
    state.timer = 0;
    state.key = null;
    state.longFired = false;
    swallow(e);

    if (!v) return;

    if (wasLong) {                       // 长按:恢复原速
      setRate(v, rate || 1);
      hideHint();
      return;
    }

    // 短按:自己跳 N 秒(B 站 = 5 秒)
    seekTo(v, k === 'ArrowRight' ? clamp(Number(cfg.shortSeek) || 5, 1, 60)
                                 : -clamp(Number(cfg.shortSeek) || 5, 1, 60));
    showHint((k === 'ArrowRight' ? '▶▶ ' : '◀◀ ') + clamp(Number(cfg.shortSeek) || 5, 1, 60) + 's', 'seek');
  }

  /* ------------------------------------------------------- Ctrl+←/→ 跳 10 秒 */
  function jump(e, k) {
    const v = getVideo();
    if (!v) return;
    if (e.repeat) return;                 // 按住不连跳(和 YouTube 的 J/L 一致)
    swallow(e);
    const step = clamp(Number(cfg.skipSeconds) || 10, 1, 300);
    seekTo(v, k === 'ArrowRight' ? step : -step);
    showHint((k === 'ArrowRight' ? '▶▶ ' : '◀◀ ') + step + 's', 'jump');
  }

  /* ---------------------------------------------------------- Shift+←/→ 逐帧 */
  function frameStep(e, k) {
    const v = getVideo();
    if (!v) return;
    swallow(e);
    if (cfg.frameStepPauses && v.paused === false) {
      try { v.pause(); } catch (err) { /* 忽略 */ }
    }
    seekTo(v, k === 'ArrowRight' ? frameSeconds(v) : -frameSeconds(v));
    showHint(k === 'ArrowRight' ? '⏭ 1 帧' : '⏮ 1 帧', 'frame');
  }

  // 切标签页 / 失焦时别把倍速留在 3 倍
  function releaseHold() {
    if (!state.key) return;
    const v = getVideo();
    clearTimeout(state.timer);
    state.timer = 0;
    const wasLong = state.longFired;
    const rate = state.savedRate;
    state.key = null;
    state.longFired = false;
    if (wasLong) { setRate(v, rate || 1); hideHint(); }
  }

  /* ---------------------------------------------------------------- 滚轮音量 */
  function onWheel(e) {
    if (!cfg.enabled || !cfg.wheelVolume) return;
    if (e.ctrlKey) return;                              // Ctrl+滚轮 = 浏览器缩放
    // 快路径:鼠标不在播放器上时直接返回,连 getVideo/算矩形都省掉(滚整个页面时几乎零开销)
    const t = e.target;
    if (!t || typeof t.closest !== 'function' ||
        !t.closest('video, #movie_player, .html5-video-player, ytd-player')) return;
    const v = getVideo();
    const p = playerEl();
    if (!v || !p || typeof p.getBoundingClientRect !== 'function') return;
    const r = p.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (e.clientX < r.left || e.clientX > r.right ||
        e.clientY < r.top  || e.clientY > r.bottom) return;  // 鼠标不在画面上
    if (document.fullscreenElement) return;             // 全屏时 YouTube 原生已支持
    if (!e.deltaY) return;

    swallow(e);

    const step = 0.02;                                  // 一格 2%
    const vol = clamp(Math.round(((Number(v.volume) || 0) + (e.deltaY < 0 ? step : -step)) * 100) / 100, 0, 1);
    try { v.volume = vol; } catch (err) { /* 忽略 */ }
    if (vol > 0 && v.muted) { try { v.muted = false; } catch (err) { /* 忽略 */ } }
    showHint('🔊 ' + Math.round(vol * 100) + '%', 'vol');
  }

  /* --------------------------------------------------------- [ ] 切换集数 */
  function bracketNav(e, k) {
    if (!cfg.enabled || !cfg.bracketNav) return;
    const btn = document.querySelector(k === '[' ? '.ytp-prev-button' : '.ytp-next-button');
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
    swallow(e);
    try { btn.click(); } catch (err) { /* 忽略 */ }
    showHint(k === '[' ? '⏮ 上一集' : '⏭ 下一集', 'nav');
  }

  /* ------------------------------------------------------------------ 挂载 */
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('blur', releaseHold, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHold(); }, true);
  document.addEventListener('fullscreenchange', () => {
    if (hintEl) hintEl.className = HINT_CLASS;
    if (hintEl && hintEl.parentNode !== hintHost() && hintHost()) hintHost().appendChild(hintEl);
  }, true);
})();
