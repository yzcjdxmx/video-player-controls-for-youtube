/*!
 * Video Player Controls for YouTube —— 后台脚本(service worker)
 * 版本 1.4.0 · 作者 yzcjdxmx <https://github.com/yzcjdxmx>
 *
 * 唯一职责:点工具栏图标 → 打开设置页。
 * (content script 里没法调 chrome.runtime.openOptionsPage,所以需要这一层。)
 */
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
