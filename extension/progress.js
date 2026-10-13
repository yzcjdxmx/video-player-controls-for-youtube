/*!
 * YouTube 仿哔哩哔哩操作 —— 常驻进度条模块(独立 content script)
 * 版本 1.3.0 · 无网络请求、无第三方依赖
 *
 * 1.3.0 改动:
 *   - 「首尾刻度」和「进度游标」拆成两个独立开关(原来是合成一个)
 *   - 两者各自有**形状**设置:竖条 / 圆点 / 小三角 / 实心方块 / 空心方块
 *
 * 1.2.3:刻度/游标高度可单独设(默认 8px,比 3px 条身高);拆出内层「条身」,容器不裁剪
 * 1.2.2:滚动同步重算(不再慢半拍)+ 首尾刻度 + 进度游标
 * 1.2.1:改挂 body + 固定定位(修「装了不显示」)+ 控制台日志 + 滚轮快路径
 *
 * 只读 currentTime / duration / buffered,不劫持按键、不改播放状态。
 */
(() => {
  'use strict';

  const VERSION = '1.5.0';      // 模块版本跟随扩展版本(三个会打日志的模块保持一致)
  const TAG = '[仿B站进度条]';

  const DEFAULTS = {
    enabled: true,
    progressBar: true,              // 常驻进度条总开关
    progressBarHeight: 3,           // 条身高度(px)
    progressBarColor: '#ff0000',    // YouTube 品牌红
    progressBarHideOnHover: false,  // 鼠标悬停时让位给原生控制条
    progressBarCaps: true,          // 首尾刻度(独立开关)
    progressBarCapShape: 'line',    // 刻度形状:line 竖条 / dot 圆点 / triangle 小三角 / square 实心方块 / squareHollow 空心方块
    progressBarKnob: true,          // 进度游标(独立开关)
    progressBarKnobShape: 'dot',    // 游标形状:同上五选一
    progressBarDecorSize: 8         // 刻度/游标高度(px),比条身高所以明显
  };

  const SHAPES = ['line', 'dot', 'triangle', 'square', 'squareHollow'];
  const YT_RED = '#ff0000';
  const COLOR_RE = /^#[0-9a-f]{3,8}$/i;

  let cfg = Object.assign({}, DEFAULTS);
  let bar = null;
  let trackEl = null;
  let bufEl = null;
  let playedEl = null;
  let knobEl = null;
  let capStart = null;
  let capEnd = null;
  let curVideo = null;
  let rafId = 0;
  let mode = '';
  let lastNote = '';
  let lastPlaceAt = 0;
  let scrollBurst = 0;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const shape = (v, fallback) => (SHAPES.indexOf(String(v)) > -1 ? String(v) : fallback);

  /* ------------------------------------------------------------------ 设置 */
  (function loadCfg() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
      chrome.storage.sync.get(DEFAULTS, (v) => {
        if (v && typeof v === 'object') {
          cfg = Object.assign(cfg, v);
          // 1.3.0:原来是一个「首尾刻度 + 进度游标」总开关,现在拆两个 —— 老值迁过来
          if ('progressBarDecor' in v && !('progressBarCaps' in v) && !('progressBarKnob' in v)) {
            cfg.progressBarCaps = cfg.progressBarKnob = !!v.progressBarDecor;
          }
        }
        setTimeout(refresh, 0);        // 延到下一个 tick:确保本文件后面那些 const 都已初始化
      });
      chrome.storage.onChanged.addListener((changes) => {
        if (!changes) return;
        for (const k of Object.keys(changes)) {
          if (k in cfg) cfg[k] = changes[k].newValue;
        }
        setTimeout(refresh, 0);
      });
    } catch (err) {
      try { console.warn(TAG + ' ' + VERSION + ' | 读取设置出错(用默认值继续)', err); } catch (e) { /* 忽略 */ }
    }
  })();

  function note(msg, extra) {
    if (msg === lastNote) return;                 // 同一状态只打一次,别刷屏
    lastNote = msg;
    try { console.log(TAG + ' ' + VERSION + ' | ' + msg, extra === undefined ? '' : extra); } catch (err) {}
  }

  /* -------------------------------------------------------------- DOM 辅助 */
  function onShorts() {
    try { return /^\/shorts(\/|$)/.test(location.pathname); } catch (err) { return false; }
  }

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

  function rectOf(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    try {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    } catch (err) { return null; }
  }

  const winHeight = () => (typeof window !== 'undefined' && window.innerHeight) || 0;
  const barHeight = () => clamp(Number(cfg.progressBarHeight) || 3, 1, 20);
  const decorHeight = () => clamp(Number(cfg.progressBarDecorSize) || 8, 2, 40);
  const hue = () => {
    const c = String(cfg.progressBarColor || '');
    return COLOR_RE.test(c) ? c : YT_RED;
  };

  /* ------------------------------------------------------------ 创建 / 摘除 */
  function stopLoop() {
    if (rafId) {
      try { cancelAnimationFrame(rafId); } catch (err) { /* 忽略 */ }
      rafId = 0;
    }
  }

  function removeBar(reason) {
    stopLoop();
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null;
    trackEl = null;
    bufEl = null;
    playedEl = null;
    knobEl = null;
    capStart = null;
    capEnd = null;
    curVideo = null;
    mode = '';
    if (reason) note('移除:' + reason);
  }

  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'bili-yt-progress';

    // 条身本体:单独一层,负责裁剪内部两段(容器不裁剪,装饰才能长出条身)
    trackEl = document.createElement('div');
    trackEl.className = 'bili-yt-progress-track';

    bufEl = document.createElement('div');
    bufEl.className = 'bili-yt-progress-buffered';
    playedEl = document.createElement('div');
    playedEl.className = 'bili-yt-progress-played';
    trackEl.appendChild(bufEl);
    trackEl.appendChild(playedEl);

    capStart = document.createElement('div');
    capStart.className = 'bili-yt-progress-cap bili-yt-progress-cap-start';
    capEnd = document.createElement('div');
    capEnd.className = 'bili-yt-progress-cap bili-yt-progress-cap-end';
    knobEl = document.createElement('div');
    knobEl.className = 'bili-yt-progress-knob';

    // 顺序即层级:条身在下,刻度与游标在上
    bar.appendChild(trackEl);
    bar.appendChild(capStart);
    bar.appendChild(capEnd);
    bar.appendChild(knobEl);
  }

  function styleBar() {
    if (!bar) return;
    bar.style.setProperty('--bili-progress-h', barHeight() + 'px');
    bar.style.setProperty('--bili-progress-decor', decorHeight() + 'px');
    playedEl.style.background = hue();

    const capShape = shape(cfg.progressBarCapShape, 'line');
    const knobShape = shape(cfg.progressBarKnobShape, 'dot');
    capStart.setAttribute('data-shape', capShape);
    capEnd.setAttribute('data-shape', capShape);
    knobEl.setAttribute('data-shape', knobShape);

    const capsOn = cfg.progressBarCaps ? '' : 'none';
    const knobOn = cfg.progressBarKnob ? '' : 'none';
    capStart.style.display = capsOn;
    capEnd.style.display = capsOn;
    knobEl.style.display = knobOn;
  }

  function hovered() {
    if (!cfg.progressBarHideOnHover) return false;
    const p = document.querySelector('#movie_player') || (curVideo && curVideo.parentElement);
    if (!p || typeof p.matches !== 'function') return false;
    try { return p.matches(':hover'); } catch (err) { return false; }
  }

  function paint(v) {
    if (!bar || !v) return;
    const dur = (isNum(v.duration) && v.duration > 0) ? v.duration : 0;
    const pos = Number(v.currentTime) || 0;
    let bufferedEnd = 0;
    try {
      const b = v.buffered;
      if (b && b.length) bufferedEnd = Number(b.end(b.length - 1)) || 0;
    } catch (err) { /* 忽略 */ }
    const p = dur ? clamp(pos / dur, 0, 1) : 0;
    const q = dur ? clamp(bufferedEnd / dur, 0, 1) : 0;
    playedEl.style.width = (p * 100).toFixed(3) + '%';
    bufEl.style.width = (q * 100).toFixed(3) + '%';
    if (knobEl) {
      // 游标 = 已播放位置;两端做夹取,免得图形半个探到画面外
      knobEl.style.left = (p * 100).toFixed(3) + '%';
      knobEl.style.transform = p <= 0.004 ? 'translateX(0)'
                            : (p >= 0.996 ? 'translateX(-100%)' : 'translateX(-50%)');
    }
    return { 已播放: p, 已缓冲: q, duration: dur, currentTime: pos };
  }

  /* ------------------------- 普通/剧场:按「视频画面下沿」摆一条固定定位的线 ------- */
  function placeFixed(v) {
    lastPlaceAt = Date.now();
    const vr = rectOf(v);
    if (!vr || vr.width < 4 || vr.height < 4) {
      bar.style.display = 'none';
      note('视频画面尺寸异常(可能还在初始化),先藏起来', vr);
      return false;
    }
    if (vr.bottom < 1 || vr.top > winHeight() - 1) {
      bar.style.display = 'none';                        // 滚出视口就别在页面上乱画
      note('视频已滚出视口,隐藏进度条', { top: vr.top, bottom: vr.bottom });
      return true;
    }
    bar.style.display = hovered() ? 'none' : 'block';
    bar.style.left = vr.left + 'px';
    // 容器贴着“条身”摆:容器底边 = 画面下沿,装饰从这条边往上长
    bar.style.top = (vr.bottom - barHeight()) + 'px';
    bar.style.width = vr.width + 'px';
    return true;
  }

  /* ------------------------------------------------------------------ 主流程 */
  function refresh() {
    if (!cfg.enabled || !cfg.progressBar) { removeBar('开关关闭'); return; }
    if (onShorts()) { removeBar('Shorts 页自带进度条'); return; }

    const v = getVideo();
    if (!v) { removeBar(null); note('页面里还没有可用的 video,先不显示'); return; }

    if (!bar) buildBar();
    curVideo = v;
    styleBar();

    const fs = document.fullscreenElement;
    if (fs) {
      /* 全屏:固定定位会被裁掉,挂进全屏元素里贴底(= 屏幕底边) */
      if (bar.parentNode !== fs) {
        fs.appendChild(bar);
        bar.removeAttribute('data-mode');
        bar.removeAttribute('style');
        styleBar();
        note('全屏模式:挂进全屏元素贴底');
      }
      mode = 'fs';
      bar.style.display = hovered() ? 'none' : 'block';
    } else {
      /* 普通/剧场:挂 body + 固定定位,坐标按视频画面下沿算 */
      if (mode !== 'fixed' || bar.parentNode !== document.body) {
        document.body.appendChild(bar);
        bar.setAttribute('data-mode', 'fixed');
        note('普通/剧场模式:挂到 body 上用固定定位(坐标按视频画面下沿实时算)');
      }
      mode = 'fixed';
      placeFixed(v);
    }

    paint(v);
    if (v.paused === false && !document.hidden) kick();
  }

  function frame() {
    rafId = 0;
    const v = curVideo;
    if (!v || !bar) return;
    if (mode === 'fixed') {
      // 位置:滚动时已同步算过,这里只是低频兜底(抓页面布局变化)
      const now = Date.now();
      if (now - lastPlaceAt > 400) placeFixed(v);
    }
    paint(v);
    if ((v.paused === false && !document.hidden) || Date.now() < scrollBurst) {
      rafId = requestAnimationFrame(frame);
    }
  }

  function kick(burstMs) {
    if (burstMs) scrollBurst = Date.now() + burstMs;
    if (!rafId && typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(frame);
  }

  function onMediaEvent(e) {
    const t = e.target;
    if (!t || t.tagName !== 'VIDEO') return;
    if (e.type === 'pause' || e.type === 'ended') stopLoop();
    refresh();
  }

  // ★ 滚动:同步重算坐标 —— 滚动事件在“绘制前”派发,所以同一帧就落位,不会慢半拍
  function onScroll() {
    if (mode !== 'fixed' || !bar || !curVideo) return;
    placeFixed(curVideo);
    kick(350);                       // 顺带保持几帧连续跟随(惯性滚动/布局抖动)
  }

  /* ------------------------------------------------------------------ 挂载 */
  for (const type of ['play', 'playing', 'pause', 'ended', 'seeked', 'seeking', 'timeupdate',
                      'durationchange', 'loadedmetadata', 'loadeddata', 'ratechange']) {
    document.addEventListener(type, onMediaEvent, true);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }, true);
  document.addEventListener('fullscreenchange', refresh, true);
  document.addEventListener('yt-navigate-finish', refresh, true);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', () => { refresh(); kick(350); }, true);

  setInterval(refresh, 1000);      // YouTube 是 SPA:兜底巡检 + 视频节点换了也能接回来
  refresh();
})();
