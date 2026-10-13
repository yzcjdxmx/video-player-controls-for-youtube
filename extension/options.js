/* 设置页:改完自动写入 chrome.storage.sync,content.js / progress.js 通过 onChanged 立即生效 */
const DEFAULTS = {
  enabled: true,
  holdSpeed: 3,
  holdThreshold: 250,
  longPressLeft: true,
  shortSeek: 5,
  overlay: true,
  wheelVolume: true,
  bracketNav: true,
  frameStep: true,
  frameStepFps: 30,
  frameStepPauses: true,
  ctrlArrowSeek: true,
  skipSeconds: 10,
  progressBar: true,
  progressBarHeight: 3,
  progressBarColor: '#ff0000',
  progressBarHideOnHover: false,
  progressBarCaps: true,
  progressBarCapShape: 'line',
  progressBarKnob: true,
  progressBarKnobShape: 'dot',
  progressBarDecorSize: 8,
  videoQuality: 'auto'
};

const KEYS = Object.keys(DEFAULTS);
const statusEl = document.getElementById('status');

function fill(cfg) {
  for (const k of KEYS) {
    const el = document.getElementById(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!cfg[k];
    else el.value = cfg[k];
  }
}

function read() {
  const out = {};
  for (const k of KEYS) {
    const el = document.getElementById(k);
    if (!el) continue;
    if (el.type === 'checkbox') out[k] = el.checked;
    else if (el.type === 'number' || el.type === 'range') {
      const n = Number(el.value);
      out[k] = Number.isFinite(n) ? n : DEFAULTS[k];
    } else {
      out[k] = el.value;                 // 文本 / 颜色(如 #ff0000)保持原样
    }
  }
  return out;
}

function save() {
  chrome.storage.sync.set(read(), () => {
    statusEl.textContent = '已保存 ' + new Date().toLocaleTimeString();
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
}

chrome.storage.sync.get(DEFAULTS, (cfg) => fill(Object.assign({}, DEFAULTS, cfg)));

for (const k of KEYS) {
  const el = document.getElementById(k);
  if (el) {
    el.addEventListener('change', save);
    if (el.type === 'color') el.addEventListener('input', save);
  }
}

document.getElementById('reset').addEventListener('click', () => {
  chrome.storage.sync.set(DEFAULTS, () => {
    fill(DEFAULTS);
    statusEl.textContent = '已恢复默认值';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});
