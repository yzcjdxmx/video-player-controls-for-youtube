/* 设置页:改完自动写入 chrome.storage.sync;content.js / progress.js / quality.js 通过 onChanged 立即生效
 * 版本 1.5.0:
 *   · 顶部版本号改成从 manifest 读(chrome.runtime.getManifest().version)—— 再也不怕忘改这里的版本号
 *   · 新增「备份与恢复」:导出成 .json / 从 .json 导入(校验逻辑在 backup.js,纯函数、可自测)
 * 注意:浏览器自带同步只在【同一扩展 ID】内生效,开发者模式版与商店版是两个 ID,所以要用文件搬。
 */
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
const backupMsg = document.getElementById('backupMsg');
const VERSION = (function () {
  try { return chrome.runtime.getManifest().version; } catch (e) { return ''; }
})();

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

function note(text, ms) {
  if (!backupMsg) return;
  backupMsg.textContent = text;
  if (ms) setTimeout(() => { if (backupMsg.textContent === text) backupMsg.textContent = ''; }, ms);
}

// 顶部版本号以 manifest 为准
const verEl = document.getElementById('version');
if (verEl && VERSION) verEl.textContent = 'v' + VERSION;

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

/* ---------------- 备份:导出 ---------------- */
const exportBtn = document.getElementById('exportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    const backup = BiliBackup.makeBackup(read(), VERSION, new Date().toISOString());
    const text = JSON.stringify(backup, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'video-player-controls-settings-v' + (VERSION || '0') + '-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    note('✅ 已导出 ' + KEYS.length + ' 项设置到下载文件夹:' + a.download, 8000);
  });
}

/* ---------------- 备份:导入 ---------------- */
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
if (importBtn && importFile) {
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const f = importFile.files && importFile.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const res = BiliBackup.parseBackup(r.result, DEFAULTS);
      importFile.value = '';                     // 允许连续导同一个文件
      if (!res.ok) { note('❌ 导入失败:' + res.error, 10000); return; }
      const n = Object.keys(res.settings).length;
      if (!n) { note('⚠️ 文件里没有一项能用的设置(全部被跳过,见下面明细)', 10000); }
      chrome.storage.sync.set(res.settings, () => {
        chrome.storage.sync.get(DEFAULTS, (cfg) => {
          fill(Object.assign({}, DEFAULTS, cfg));
          let msg = '✅ 已恢复 ' + n + ' 项设置';
          if (res.adjusted.length) msg += ';夹紧 ' + res.adjusted.length + ' 项(' + res.adjusted.join('、') + ')';
          if (res.skipped.length) msg += ';跳过 ' + res.skipped.length + ' 项:' + res.skipped.join('、');
          if (res.meta.version) msg += '  [备份来自 v' + res.meta.version + ']';
          note(msg, 20000);
        });
      });
    };
    r.onerror = () => { importFile.value = ''; note('❌ 读文件失败,换一个再试', 8000); };
    r.readAsText(f);
  });
}
