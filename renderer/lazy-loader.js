'use strict';
// 懒加载器：marked 同步加载；mermaid / highlight.js 按需注入、三级源降级、Promise 缓存。
// 暴露 window.__lazyLoader，供 app.js 使用。完全本地优先，CDN 仅作回退。
(function () {
  // 相对 index.html 所在目录的 vendor 路径
  var VENDOR = 'vendor/';

  // 三级源：本地 vendor → jsdelivr → cdnjs（按序尝试）
  var HIGHLIGHT_URLS = [
    VENDOR + 'highlight.min.js',
    'https://cdn.jsdelivr.net/npm/highlight.js@11.12.0/build/highlight.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.12.0/highlight.min.js'
  ];
  var MERMAID_URLS = [
    VENDOR + 'mermaid.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.16.1/mermaid.min.js',
    'https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.min.js'
  ];

  var pending = {};                 // src -> Promise，去重
  var mermaidP = null;              // Promise<window.mermaid>，仅成功后缓存
  var highlightP = null;            // Promise<window.hljs|null>，失败 resolve(null)
  var mermaidInited = false;        // mermaid.initialize 只执行一次

  function injectScript(src) {
    if (pending[src]) return pending[src];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        delete pending[src];        // 失败不缓存，允许下次重试
        reject(new Error('script load failed: ' + src));
      };
      s.src = src;
      document.head.appendChild(s);
    });
    pending[src] = p;
    return p;
  }

  function tryLoadStages(urls, checkGlobal) {
    var i = 0;
    function attempt() {
      if (i >= urls.length) return Promise.reject(new Error('all sources failed'));
      var url = urls[i++];
      return injectScript(url).then(function () {
        if (!checkGlobal || window[checkGlobal]) return;
        return attempt();           // 加载成功但全局缺失（如文件损坏）→ 尝试下一源
      }).catch(attempt);
    }
    return attempt();
  }

  window.__lazyLoader = {
    // 返回 Promise<window.mermaid>；首次成功加载后执行 initDeps() 一次
    ensureMermaid: function (initDeps) {
      if (mermaidP) return mermaidP;
      mermaidP = tryLoadStages(MERMAID_URLS, 'mermaid').then(function () {
        if (initDeps && !mermaidInited) {
          mermaidInited = true;
          initDeps();
        }
        return window.mermaid;
      });
      return mermaidP;
    },
    // 返回 Promise<window.hljs|null>；全部源失败时 resolve(null)，调用方静默跳过
    ensureHighlight: function () {
      if (highlightP) return highlightP;
      highlightP = tryLoadStages(HIGHLIGHT_URLS, 'hljs')
        .then(function () { return window.hljs; })
        .catch(function () { return null; });
      return highlightP;
    },
    isMermaidLoaded: function () { return !!window.mermaid; },
    isHighlightLoaded: function () { return !!window.hljs; }
  };
})();