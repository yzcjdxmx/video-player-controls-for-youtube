/*!
 * Video Player Controls for YouTube —— 设置备份 / 恢复【纯逻辑】
 * 版本 1.5.0 · 作者 yzcjdxmx <https://github.com/yzcjdxmx>
 *
 * 为什么单独一个文件、且不碰 chrome.storage / DOM:
 *   options.js 里那个环境测不了(需要 chrome API + 完整 DOM)。
 *   把「导出成什么格式」「导入时怎么校验」抽出来做成纯函数,就能用 test/smoke-backup.html
 *   在普通页面里把各种脏数据(类型错、超范围、非法颜色、原型污染…)全测一遍。
 *
 * 校验策略:【只按 DEFAULTS 里存在的键走】+ 逐键类型校验
 *   · 多余的键 / 类型不对的键 → 一律丢弃并记账,绝不写进 storage(否则设置页会渲染出错)
 *   · 数值超出合理范围 → 夹紧到边界并记账(不丢数据,也不让离谱值进去)
 *   · 颜色必须是 #rrggbb;枚举值必须在白名单里
 *   · 输出对象是【新建的空对象】逐键赋值 → 天然免疫 __proto__ / constructor 这类原型污染
 */
(function (root) {
  'use strict';

  const META_APP = 'video-player-controls-for-youtube';

  // 有界数值的合理范围(超出就夹紧)
  const RANGES = {
    holdSpeed: [0.25, 16],
    holdThreshold: [0, 5000],
    shortSeek: [0, 600],
    frameStepFps: [1, 240],
    skipSeconds: [0, 600],
    progressBarHeight: [1, 40],
    progressBarDecorSize: [1, 40]
  };

  // 枚举白名单(与设置页下拉框的取值一一对应)
  const ENUMS = {
    progressBarCapShape: ['line', 'dot', 'triangle', 'square', 'squareHollow'],
    progressBarKnobShape: ['line', 'dot', 'triangle', 'square', 'squareHollow']
  };

  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const QUALITY_RE = /^(auto|highest|[0-9]{3,4})$/;

  function typeOf(v) {
    if (Array.isArray(v)) return '数组';
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'boolean') return 'true/false';
    if (t === 'number') return '数字';
    if (t === 'string') return '字符串';
    if (t === 'object') return '对象';
    return t;
  }

  // 单键校验:返回 { ok, value?, why?, adjusted? }
  function checkKey(key, defVal, v) {
    const t = typeof defVal;
    if (t === 'boolean') {
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, why: '需要 true/false,实际是 ' + typeOf(v) };
    }
    if (t === 'number') {
      if (typeof v !== 'number' || !isFinite(v)) {
        return { ok: false, why: '需要数字,实际是 ' + typeOf(v) + (typeof v === 'number' ? '(非有限数)' : '') };
      }
      const r = RANGES[key];
      if (r) {
        const c = Math.min(r[1], Math.max(r[0], v));
        if (c !== v) return { ok: true, value: c, adjusted: v + ' → ' + c };
      }
      return { ok: true, value: v };
    }
    if (t === 'string') {
      if (typeof v !== 'string') return { ok: false, why: '需要字符串,实际是 ' + typeOf(v) };
      if (key === 'progressBarColor') {
        return COLOR_RE.test(v) ? { ok: true, value: v } : { ok: false, why: '颜色要写成 #rrggbb,实际是 "' + v + '"' };
      }
      if (ENUMS[key]) {
        return ENUMS[key].indexOf(v) >= 0 ? { ok: true, value: v } : { ok: false, why: '只能是 ' + ENUMS[key].join(' / ') };
      }
      if (key === 'videoQuality') {
        return QUALITY_RE.test(v) ? { ok: true, value: v } : { ok: false, why: '只能是 auto / highest / 分辨率数字' };
      }
      if (v.length > 64) return { ok: false, why: '字符串太长' };
      return { ok: true, value: v };
    }
    return { ok: false, why: '扩展里没有这种类型的设置' };
  }

  // 生成备份对象(不改动入参)
  function makeBackup(cfg, version, nowIso) {
    const data = {};
    for (const k of Object.keys(cfg || {})) data[k] = cfg[k];
    return { _app: META_APP, _version: String(version || ''), _exportedAt: String(nowIso || ''), data: data };
  }

  // 解析备份文本 → { ok, settings, skipped[], adjusted[], meta } 或 { ok:false, error }
  function parseBackup(text, defaults) {
    let raw;
    try {
      raw = JSON.parse(String(text));
    } catch (e) {
      return { ok: false, error: '不是合法的 JSON 文件(' + ((e && e.message) ? e.message : '解析失败') + ')' };
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: '文件内容不是一份设置对象,拿到的是 ' + typeOf(raw) };
    }
    if (raw._app && raw._app !== META_APP) {
      return { ok: false, error: '这是别的扩展的备份文件(_app = ' + raw._app + ')' };
    }

    const src = (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) ? raw.data : raw;
    const settings = {};
    const skipped = [];
    const adjusted = [];

    // ★ 只遍历 defaults 的键:源文件里多出来的键天然进不来
    for (const k of Object.keys(defaults || {})) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      const r = checkKey(k, defaults[k], src[k]);
      if (r.ok) {
        settings[k] = r.value;
        if (r.adjusted) adjusted.push(k + ':' + r.adjusted);
      } else {
        skipped.push(k + '(' + r.why + ')');
      }
    }
    // 记账:源文件里多出来的键(只放行 3 个已知元字段 + data;__proto__ / constructor 这类一律列出来)
    for (const k of Object.keys(src)) {
      if (Object.prototype.hasOwnProperty.call(defaults || {}, k)) continue;
      if (k === 'data' || k === '_app' || k === '_version' || k === '_exportedAt') continue;
      skipped.push(k + '(扩展里没有这个设置)');
    }

    return {
      ok: true,
      settings: settings,
      skipped: skipped,
      adjusted: adjusted,
      meta: { app: raw._app || '', version: raw._version || '', exportedAt: raw._exportedAt || '' }
    };
  }

  const api = { META_APP: META_APP, RANGES: RANGES, ENUMS: ENUMS, makeBackup: makeBackup, parseBackup: parseBackup, checkKey: checkKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BiliBackup = api;
})(typeof window !== 'undefined' ? window : globalThis);
