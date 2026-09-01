'use strict';

(function () {
  // ============ 状态 ============
  const state = {
    // 当前激活文档的镜像（绝大多数既有逻辑仍读写这些字段，改造成本最小）
    filePath: null,
    fileName: '未命名',
    encoding: 'UTF-8',
    bom: false,
    dirty: false,
    // 多标签：tabs 保存所有打开文档；活跃 tab 内容始终镜像到上面字段 + editor.value
    tabs: [],
    activeTabId: null,
    recent: [],
    theme: 'light',
    version: '',
    showPreview: true,
    syncScroll: true,
    wrap: true
  };

  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const preview = $('preview');
  const lineNums = $('line-nums');

  // ============ marked 配置 ============
  marked.use({ gfm: true, breaks: true });

  const renderer = new marked.Renderer();
  const origCode = renderer.code.bind(renderer);
  renderer.code = function ({ text, lang, escaped }) {
    const langStr = (lang || '').toLowerCase();
    if (langStr === 'mermaid' || langStr === 'mmd') {
      // 保留文本在 pre 内部；textContent 会自动解码 HTML 实体，Mermaid 按行解析原始语法
      return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
    }
    return origCode({ text, lang, escaped });
  };
  // 自定义图片：把相对路径解析为绝对路径并标记，渲染后读取本地文件展示
  renderer.image = function ({ href, title, text }) {
    const alt = text ? ` alt="${escapeAttr(text.split(/\s+/)[0])}"` : '';
    const ttl = title ? ` title="${escapeAttr(title)}"` : '';
    return `<span class="md-img" data-mdimage="${escapeAttr(href)}"><img src="" loading="lazy"${alt}${ttl}></span>`;
  };
  marked.setOptions({ renderer });

  function escapeAttr(s) {
    return s.replace(/"/g, '&quot;');
  }

  // ---- 本地图片渲染：相对/绝对路径 → 绝对路径 → 读取字节 → data URL ----

  // 把 md 里引用的图片路径解析为绝对路径（相对路径基于当前文件所在目录）
  function resolveImagePath(href) {
    if (!href) return null;
    let h = href.trim();
    if (/^data:/i.test(h)) return h;              // data URL 直接返回
    if (/^https?:\/\//i.test(h)) return h;         // 网络图片保持原样
    if (/^[a-zA-Z]:[\\/]/.test(h) || h.startsWith('\\\\')) return h; // 已是绝对路径
    const t = curTab();
    const base = (t && t.filePath) ? t.filePath.replace(/[\\/][^\\/]*$/, '') : '';
    if (!base) return h;
    // 合并路径（处理 ./ 与 ../
    const joined = base + '/' + h;
    const parts = joined.split(/[\\/]/);
    const out = [];
    for (const p of parts) {
      if (p === '.' || p === '') continue;
      if (p === '..') { out.pop(); continue; }
      out.push(p);
    }
    return out.join('\\');
  }

  const MIME_BY_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon'
  };

  function dataUrl(bytes, path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'image/png';
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:${mime};base64,${btoa(bin)}`;
  }

  // 渲染后处理所有 [data-mdimage] 图片节点（去重加载）
  function loadLocalImages() {
    if (!window.mdAPI || !window.mdAPI.readImageBytes) return;
    const nodes = Array.from(preview.querySelectorAll('[data-mdimage]'));
    nodes.forEach((el) => {
      if (el.dataset.loading || el.dataset.loaded) return;
      const href = el.dataset.mdimage;
      el.dataset.loading = '1';
      const abs = resolveImagePath(href);
      // 网络/data 图片无需后端读取
      if (/^data:/i.test(abs) || /^https?:\/\//i.test(abs)) {
        const img = el.querySelector('img');
        if (img) img.src = abs;
        el.dataset.loaded = '1';
        return;
      }
      window.mdAPI.readImageBytes(abs).then((bytes) => {
        const img = el.querySelector('img');
        if (img && Array.isArray(bytes) && bytes.length) img.src = dataUrl(bytes, abs);
        else if (img) img.alt = '(图片加载失败)';
        el.dataset.loaded = '1';
      }).catch(() => {
        const img = el.querySelector('img');
        if (img) img.alt = '(图片加载失败)';
        el.dataset.loaded = '1';
      });
    });
  }

  // ============ 渲染管线 ============
  let renderTimer = null;

  // ---- 双向精确跳转：预览块元素 ↔ 源码字符偏移 ----
  let srcLineStarts = [];   // 源码每行起始偏移
  let editorLineH = 24;      // 编辑区行高（px），由显示高度推算
  let jumpTimer = null;
  // 参与映射的块级 token 类型（会各自在预览里产生一个顶层元素）
  const SRC_BLOCK_TYPES = ['heading', 'paragraph', 'blockquote', 'hr', 'code', 'list', 'table'];

  function buildLineStarts(s) {
    const arr = [0];
    for (let i = 0; i < s.length; i++) if (s[i] === '\n') arr.push(i + 1);
    return arr;
  }

  // 渲染后把「预览顶层元素 ↔ 其在源码中的起始偏移」写进 data-src-pos。
  // 顺序一一对应才标注；数量不匹配则放弃（避免错位），保持安全降级。
  function annotatePreview(src) {
    const topEls = Array.from(preview.children);
    const tokens = marked.lexer(src).filter((t) => SRC_BLOCK_TYPES.includes(t.type));
    if (topEls.length !== tokens.length) return;
    let cursor = 0;
    for (let i = 0; i < tokens.length; i++) {
      let pos = src.indexOf(tokens[i].raw, cursor);
      if (pos < 0) pos = cursor;
      cursor = pos + tokens[i].raw.length;
      if (topEls[i]) topEls[i].dataset.srcPos = String(pos);
    }
  }

  // 由偏移转 0 起行号
  function lineOf(pos) {
    let l = 0;
    for (let i = 0; i < srcLineStarts.length; i++) { if (srcLineStarts[i] > pos) break; l = i; }
    return l;
  }

  function flashEl(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth; // 重排以重触发动画
    el.classList.add('flash');
    setTimeout(() => el && el.classList.remove('flash'), 1200);
  }

  // 右侧双击/点击一块 → 左侧选中并滚动到对应源码行
  function jumpPreviewToSource(el) {
    const pos = Number(el.dataset.srcPos);
    if (!(pos >= 0)) return;
    flashEl(el);
    const line = lineOf(pos);
    const start = srcLineStarts[line];
    const next = line + 1 < srcLineStarts.length ? srcLineStarts[line + 1] : editor.value.length;
    const end = Math.max(start, next - (next > start ? 1 : 0)); // 去掉行尾换行
    editor.focus();
    editor.setSelectionRange(start, end);
    const lineH = editorLineH || 24;
    editor.scrollTop = line * lineH;
    lineNums.scrollTop = editor.scrollTop;
    updateCursorInfo();
  }

  // 左侧光标位置 → 右侧滚动到最近的预览块并高亮
  function jumpEditorToPreview() {
    if (!state.showPreview) return;
    const pos = editor.selectionStart;
    let best = null;
    for (const e of preview.querySelectorAll('[data-src-pos]')) {
      if (Number(e.dataset.srcPos) <= pos) best = e; else break;
    }
    if (best) { flashEl(best); best.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
  }

  function scheduleJumpEditor() {
    clearTimeout(jumpTimer);
    jumpTimer = setTimeout(jumpEditorToPreview, 220);
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAll, 250);
    updateLineNumbers();
  }

  function renderAll() {
    const t0 = performance.now();
    const src = editor.value;
    srcLineStarts = buildLineStarts(src);
    let html;
    try {
      html = marked.parse(src);
    } catch (e) {
      html = `<p style="color:#c0392b">渲染失败：${escapeHtml(e.message)}</p>`;
    }
    preview.innerHTML = html;
    annotatePreview(src); // 记录「预览块元素 ↔ 源码字符偏移」映射，供双向精确跳转

    // 兼容性增强：将"看起来像 Mermaid 图"的缩进代码块提升为围栏式 mermaid 以参与渲染
    promoteIndentedMermaid();

    // 本地图片：读取相对/绝对路径的图片并展示
    loadLocalImages();

    // 代码高亮（非 mermaid）
    highlightCodeBlocks();

    // Mermaid 渲染
    renderMermaid().then(() => {
      const ms = Math.round(performance.now() - t0);
      $('render-time').textContent = `渲染 ${ms}ms · 自动刷新`;
      $('status-render').textContent = `渲染 ${ms}ms`;
    });
  }

  // Mermaid 图类型关键字（简称可识别）
  const MERMAID_DIAGRAM_TYPES = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
    'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'journey', 'gitGraph',
    'quadrantChart', 'mindmap', 'timeline', 'xychart', 'block-beta',
    'architecture-beta', 'zenuml', 'sankey-beta', 'c4', 'kanban', 'packet-beta'
  ];

  // 判断一段文本是否像 Mermaid 图：忽略前导空白后首行命中图类型关键字，且整体含箭头/连接语法
  function looksLikeMermaid(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return false;
    const first = lines[0].toLowerCase();
    const matchType = MERMAID_DIAGRAM_TYPES.some((t) => first === t || first.startsWith(t + ' '));
    if (!matchType) return false;
    // 至少含一条箭头/连接以便确认为图
    const hasLink = lines.some((l) => l.includes('-->') || l.includes('---') || l.includes('-->|') || l.includes('==>'));
    if (hasLink) return true;
    // gantt 图没有箭头，改用其专有语法（section / after 依赖）确认
    if (first === 'gantt') {
      return lines.some((l) => l.startsWith('section')) || lines.some((l) => l.includes(' after '));
    }
    return false;
  }

  // 将预览里未带 mermaid 标注、但形态像缩进式 Mermaid 的 <pre><code> 提升为 <pre class="mermaid">
  function promoteIndentedMermaid() {
    const codes = Array.from(preview.querySelectorAll('pre code'));
    codes.forEach((code) => {
      const pre = code.closest('pre');
      if (!pre || pre.classList.contains('mermaid')) return;
      if (code.querySelector('br, .hljs') && !looksLikeMermaid(code.textContent)) return;
      const text = code.textContent;
      if (!looksLikeMermaid(text)) return;
      const clean = text.replace(/\s+$/g, '');
      const pre2 = document.createElement('pre');
      pre2.className = 'mermaid';
      pre2.textContent = clean;
      pre.replaceWith(pre2);
    });
  }

  function highlightCodeBlocks() {
    const blocks = preview.querySelectorAll('pre code:not([data-highlighted])');
    if (!blocks.length) return;
    window.__lazyLoader.ensureHighlight().then((hljs) => {
      if (!hljs) return; // 全部源失败 → 降级跳过，不做高亮
      try {
        blocks.forEach((block) => {
          hljs.highlightElement(block);
          block.dataset.highlighted = '1';
        });
      } catch (e) {
        // 忽略高亮失败
      }
    });
  }

  async function renderMermaid() {
    const nodes = Array.from(preview.querySelectorAll('pre.mermaid'));
    if (!nodes.length) return; // 无 mermaid 节点 → 不触碰 3.4MB 依赖
    let runError = null;
    try {
      const mmd = await window.__lazyLoader.ensureMermaid(() => {
        mermaid.initialize({ startOnLoad: false, theme: state.theme === 'dark' ? 'dark' : 'default', securityLevel: 'strict' });
      });
      await mmd.run({ nodes });
    } catch (e) {
      runError = e;
      console.error('Mermaid run error:', e);
    }
    // 兜底检查：渲染失败的节点显示源码 + 具体错误信息
    nodes.forEach((node) => {
      if (!node.querySelector('svg')) {
        const raw = node.dataset.mermaid || node.textContent || '';
        // 尝试提取 mermaid 自带的错误文本
        const builtInErr = node.querySelector('.error-text, .mermaid-error-text, [class*="error"]');
        let detail = '';
        if (builtInErr) detail = builtInErr.textContent;
        else if (runError) detail = runError.message || '语法错误';
        const errBox = document.createElement('div');
        errBox.className = 'mermaid-error';
        errBox.innerHTML =
          `<div class="err-msg">Mermaid 渲染失败${detail ? '：' + escapeHtml(detail) : ''}</div>` +
          `<pre>${escapeHtml(raw)}</pre>`;
        node.replaceWith(errBox);
      }
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ============ 行号 ============
  function updateLineNumbers() {
    const count = editor.value.split('\n').length;
    let html = '';
    for (let i = 1; i <= count; i++) html += i + '<br>';
    lineNums.innerHTML = html;
  }

  // ============ 光标/行列/字数 ============
  function updateCursorInfo() {
    const pos = editor.selectionStart;
    const text = editor.value;
    const upto = text.substring(0, pos);
    const line = upto.split('\n').length;
    const lastNL = upto.lastIndexOf('\n');
    const col = lastNL === -1 ? pos + 1 : pos - lastNL;
    const chars = text.length;
    $('status-cursor').textContent = `第 ${line} 行 · 第 ${col} 列 · ${chars.toLocaleString()} 字符`;
  }

  // ============ 查找 / 替换 ============
  const search = {
    term: '',           // 当前搜索词
    matches: [],        // 匹配区间数组 [[start, end], ...]
    current: -1,        // 当前高亮索引
    caseSensitive: false
  };

  function getMatches(term) {
    const text = editor.value;
    const res = [];
    if (!term) return res;
    const lower = search.caseSensitive ? text : text.toLowerCase();
    const t = search.caseSensitive ? term : term.toLowerCase();
    let idx = 0;
    while (true) {
      const pos = lower.indexOf(t, idx);
      if (pos === -1) break;
      res.push([pos, pos + term.length]);
      idx = pos + term.length;
    }
    return res;
  }

  function updateMatches() {
    search.matches = getMatches(search.term);
    search.current = search.matches.length ? 0 : -1;
    renderSearch();
    updateSearchCount();
  }

  function renderSearch() {
    if (!search.term) return;
    if (search.current >= 0 && search.matches[search.current]) {
      const [s, e] = search.matches[search.current];
      editor.focus();
      editor.setSelectionRange(s, e);
    }
  }

  function updateSearchCount() {
    $('search-count').textContent = search.matches.length
      ? `${search.current + 1}/${search.matches.length}`
      : (search.term ? '无结果' : '');
  }

  function openSearch(showReplace) {
    $('searchbar').classList.remove('hidden');
    $('replace-row').classList.toggle('hidden', !showReplace);
    $('search-input').focus();
    $('search-input').select();
    if (!search.term) {
      const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
      if (sel) { $('search-input').value = sel; search.term = sel; }
    }
    updateMatches();
  }

  function closeSearch() {
    $('searchbar').classList.add('hidden');
    editor.focus();
  }

  function searchNext() {
    if (!search.matches.length) return;
    search.current = (search.current + 1) % search.matches.length;
    renderSearch();
    updateSearchCount();
  }

  function searchPrev() {
    if (!search.matches.length) return;
    search.current = (search.current - 1 + search.matches.length) % search.matches.length;
    renderSearch();
    updateSearchCount();
  }

  function replaceOne() {
    if (!search.term || search.current < 0) return;
    const [s, e] = search.matches[search.current];
    const rep = $('replace-input').value;
    const val = editor.value;
    editor.value = val.substring(0, s) + rep + val.substring(e);
    editor.setSelectionRange(s, s + rep.length);
    markDirty(true);
    updateMatches();           // 重新计算匹配（位置偏移）
    updateLineNumbers();
    scheduleRender();
  }

  function replaceAll() {
    if (!search.term) return;
    const rep = $('replace-input').value || '';
    const text = editor.value;
    const t = search.caseSensitive ? search.term : search.term.toLowerCase();
    const lower = search.caseSensitive ? text : text.toLowerCase();
    const parts = [];
    let last = 0, idx = 0;
    while ((idx = lower.indexOf(t, last)) !== -1) {
      parts.push(text.substring(last, idx) + rep);
      last = idx + search.term.length;
    }
    parts.push(text.substring(last));
    editor.value = parts.join('');
    markDirty(true);
    updateMatches();
    updateLineNumbers();
    scheduleRender();
  }

  function initSearchbar() {
    $('search-case').addEventListener('click', () => {
      search.caseSensitive = !search.caseSensitive;
      $('search-case').classList.toggle('active', search.caseSensitive);
      updateMatches();
      $('search-input').focus();
    });
    $('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.shiftKey ? searchPrev() : searchNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    });
    $('replace-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceOne();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
      }
    });
    $('search-next').addEventListener('click', () => searchNext());
    $('search-prev').addEventListener('click', () => searchPrev());
    $('replace-one').addEventListener('click', () => replaceOne());
    $('replace-all').addEventListener('click', () => replaceAll());
    $('search-close').addEventListener('click', () => closeSearch());
    $('search-input').addEventListener('input', () => {
      search.term = $('search-input').value;
      updateMatches();
    });
  }

  // ============ 主题 ============
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    state.theme = theme;
    $('theme-label').textContent = theme === 'dark' ? '深色' : '浅色';
    try { localStorage.setItem('md-theme', theme); } catch (e) {}
    // mermaid 主题联动：仅已加载时同步（未加载 → 留给 ensureMermaid 首次加载回调）
    const m = (window.__lazyLoader && window.__lazyLoader.isMermaidLoaded()) ? window.mermaid : null;
    if (m && m.initialize) {
      try { m.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default', securityLevel: 'strict' }); } catch (e) {}
    }
    renderAll();
  }

  // 首次启动：询问是否设为默认 MD 文件编辑器（用 localStorage 标记是否已询问过）
  function maybeAskSetDefaultAssoc() {
    if (!window.mdAPI || !window.mdAPI.setDefaultMdAssoc) return;
    let asked = false;
    try { asked = localStorage.getItem('md-assoc-asked') === '1'; } catch (e) {}
    if (asked) return;
    const overlay = $('assoc-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    const done = (action) => {
      overlay.classList.add('hidden');
      try { localStorage.setItem('md-assoc-asked', '1'); } catch (e) {}
      if (action === 'yes') {
        window.mdAPI.setDefaultMdAssoc().catch(() => {
          alert('设置默认编辑器失败，请稍后重试。');
        });
      }
    };

    overlay.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        done(b.dataset.assoc);
      }, { once: true });
    });
  }

  // ============ 标题 / 状态 ============
  function updateTitleBar() {
    const d = state.dirty ? ' · 已修改' : '';
    const title = `${state.fileName} - MD编辑器 v${state.version}${d}`;
    $('title-text').textContent = title;
    if (window.mdAPI) mdAPI.setTitle(title);
    $('file-name').textContent = state.fileName;
    if (state.dirty) {
      $('dirty-label').textContent = '未保存修改';
      $('dirty-label').classList.remove('hidden');
      $('status-dirty').textContent = '未保存修改';
      $('status-dirty').classList.add('dirty');
    } else {
      $('dirty-label').classList.add('hidden');
      $('status-dirty').textContent = '已保存';
      $('status-dirty').classList.remove('dirty');
    }
    $('status-encoding').textContent = `${state.encoding}${state.bom ? ' (BOM)' : ''}`;
  }

  // ============ 多标签（Tab）============
  let TAB_SEQ = 0;

  function makeTab(initial) {
    const tab = {
      id: ++TAB_SEQ,
      filePath: null,
      fileName: '未命名',
      encoding: 'UTF-8',
      bom: false,
      dirty: false,
      welcome: false,
      content: ''
    };
    if (initial) Object.assign(tab, initial);
    state.tabs.push(tab);
    return tab;
  }

  function curTab() {
    return state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0] || null;
  }

  // 把当前激活 tab 在界面的编辑状态（编辑器内容 + 状态镜像）写回其 tab 快照
  function snapshotCurToTab() {
    const t = curTab();
    if (!t) return;
    t.filePath = state.filePath;
    t.fileName = state.fileName;
    t.encoding = state.encoding;
    t.bom = state.bom;
    t.dirty = state.dirty;
    t.content = editor.value;
  }

  // 界面载入某 tab：把其快照恢复到 state 镜像与编辑器（不触发用户编辑流）
  function loadTab(t) {
    if (!t) return;
    state.filePath = t.filePath;
    state.fileName = t.fileName;
    state.encoding = t.encoding;
    state.bom = t.bom;
    state.dirty = t.dirty;
    editor.value = t.content;
    updateLineNumbers();
    renderAll();
    updateCursorInfo();
    // 直接恢复 dirty 标志 & 上报，不经过 markDirty(避免重复 updateTitleBar）
    if (window.mdAPI) mdAPI.setDirty(t.dirty);
    updateTitleBar();
    renderTabs();
  }

  // 激活某个 tab；切换前先把当前编辑状态存回原 tab
  function switchTab(id) {
    const t = state.tabs.find((x) => x.id === id);
    if (!t || t.id === state.activeTabId) return;
    snapshotCurToTab();
    state.activeTabId = t.id;
    loadTab(t);
  }

  // 渲染标签栏 DOM
  function renderTabs() {
    const bar = $('tabbar');
    bar.innerHTML = '';
    if (state.tabs.length <= 1) { // 单 tab 时不显示标签栏，保持简洁
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    state.tabs.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === state.activeTabId ? ' active' : '');
      el.title = t.filePath || t.fileName;
      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = t.fileName;
      el.appendChild(name);
      if (t.dirty) {
        const dot = document.createElement('span');
        dot.className = 'tab-dot';
        el.appendChild(dot);
      } else {
        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '×';
        close.title = '关闭';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(t.id);
        });
        el.appendChild(close);
      }
      // 点击中部切换
      const label = document.createElement('span');
      label.style.flex = '1';
      el.addEventListener('click', (e) => {
        if (e.target === close) return;
        switchTab(t.id);
      });
      // 中键关闭
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) { e.preventDefault(); closeTab(t.id); }
      });
      bar.appendChild(el);
    });
  }

  // 关闭标签；关闭前若有未保存修改需确认
  function closeTab(id) {
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const t = state.tabs[idx];
    const closeNow = () => {
      if (t.id === state.activeTabId) {
        // 删除前快照（保证关闭激活 tab 不丢最新编辑）
        snapshotCurToTab();
        state.tabs.splice(idx, 1);
        // 激活相邻 tab
        const next = state.tabs[Math.min(idx, state.tabs.length - 1)] || null;
        if (next) { state.activeTabId = next.id; loadTab(next); }
        else closeWindow();          // 最后一个 tab 关闭 → 关闭窗口
      } else {
        state.tabs.splice(idx, 1);
        renderTabs();
      }
    };
    // 仅关闭激活的 dirty tab 时确认；非激活 tab 的 dirty 内容保存在其快照，关闭仍提示
    if (t.dirty) {
      confirmSaveFor(t).then((r) => {
        if (r === 'save') {
          saveTabContent(t).then((ok) => { if (ok) { t.dirty = false; closeNow(); } });
        } else if (r === 'nosave') { closeNow(); }
        // cancel → 不关闭
      });
    } else {
      closeNow();
    }
  }

  // 打开其他内容（打开/新建/双击）时：若未编辑过的欢迎页还在，自动关闭它
  function closeWelcomeIfClean() {
    const w = state.tabs.find((t) => t.welcome);
    if (!w || w.dirty) return;       // 不存在或已被编辑 → 保留
    if (w.id === state.activeTabId) {
      state.tabs = state.tabs.filter((t) => t.id !== w.id);
      const next = state.tabs[state.tabs.length - 1] || null;
      if (next) { state.activeTabId = next.id; loadTab(next); }
    } else {
      state.tabs = state.tabs.filter((t) => t.id !== w.id);
      renderTabs();
    }
  }

  // 添加或复用 tab：同一路径已打开则切过去；否则新建并激活
  function addOrActivateTab(path, fileName, content, encoding, bom) {
    closeWelcomeIfClean();            // 打开新内容前自动收起未编辑的欢迎页
    const norm = path ? path.replace(/\\/g, '/') : null;
    const exist = norm ? state.tabs.find((t) => t.filePath && t.filePath.replace(/\\/g, '/') === norm) : null;
    if (exist) {
      switchTab(exist.id);
      return exist;
    }
    snapshotCurToTab();   // 新 tab 前保存当前编辑状态
    const t = makeTab({ filePath: path || null, fileName: fileName || (path ? path.split(/[\\/]/).pop() : '未命名'), encoding, bom, content });
    state.activeTabId = t.id;
    loadTab(t);
    return t;
  }

  // ============ 文件操作 ============
  // 新建：新开一个"未命名"tab（不再覆盖原文档，原 tab 保留）
  async function newFile() {
    addOrActivateTab(null, '未命名', '', 'UTF-8', false);
  }

  async function openFile() {
    const res = await mdAPI.openFile();
    if (!res || res.canceled) return;
    if (res.error) { alert(res.error); return; }
    addOrActivateTab(res.path, res.fileName, res.content, res.encoding, res.bom);
    addRecent(res.path);
  }

  async function openRecent(filePath) {
    const res = await mdAPI.openRecent(filePath);
    if (!res || res.canceled) return;
    if (res.error) { alert(res.error); return; }
    addOrActivateTab(res.path, res.fileName, res.content, res.encoding, res.bom);
    addRecent(res.path);
  }

  // 保存指定 tab；默认保存当前激活 tab。返回是否已成功保存（false=取消/失败）
  function saveTabContent(tab) {
    const t = tab || curTab();
    if (!t) return Promise.resolve(false);
    return mdAPI.saveFile({ path: t.filePath, content: t.content, encoding: t.encoding, bom: t.bom }).then((res) => {
      if (!res || res.canceled) return false;
      if (res.error) { alert('保存失败：' + res.error); return false; }
      if (res.saved && res.path) {
        t.filePath = res.path;
        t.fileName = res.path.split(/[\\/]/).pop();
        t.dirty = false;
        addRecent(res.path);
        // 若是对当前激活 tab 保存，同步界面镜像
        if (t.id === state.activeTabId) {
          state.filePath = t.filePath;
          state.fileName = t.fileName;
          state.dirty = false;
          if (window.mdAPI) mdAPI.setDirty(false);
          updateTitleBar();
        }
        renderTabs();
      }
      return true;
    });
  }

  async function saveFile() {
    try {
      await saveTabContent(curTab());
    } catch (e) {
      alert('保存失败：' + (e && e.message ? e.message : e));
    }
  }

  async function saveFileAs() {
    const t = curTab();
    if (!t) return;
    // 另存为按当前状态栏所选编码（含 BOM）写出，可用于转码保存
    try {
      const res = await mdAPI.saveFileAs({ content: t.content, encoding: t.encoding, bom: t.bom });
      if (!res || res.canceled) return;
      if (res.error) { alert('另存为失败：' + res.error); return; }
      if (res.saved && res.path) {
        t.filePath = res.path;
        t.fileName = res.path.split(/[\\/]/).pop();
        t.dirty = false;
        addRecent(res.path);
        if (t.id === state.activeTabId) {
          state.filePath = t.filePath;
          state.fileName = t.fileName;
          state.dirty = false;
          if (window.mdAPI) mdAPI.setDirty(false);
          updateTitleBar();
        }
        renderTabs();
      }
    } catch (e) {
      alert('另存为失败（命令异常）：' + (e && e.message ? e.message : e));
    }
  }

  function markDirty(d) {
    state.dirty = d;
    const t = curTab();
    if (t) { t.dirty = d; t.content = editor.value; }
    if (window.mdAPI) mdAPI.setDirty(d);
    updateTitleBar();
    renderTabs();
  }

  function addRecent(p) {
    if (!state.recent.includes(p)) state.recent.unshift(p);
    state.recent = state.recent.slice(0, 8);
  }

  // ============ 未保存确认 ============
  function closeWindow() {
    if (window.mdAPI) mdAPI.closeWindow();
    else window.close();
  }

  // 关闭/退出时：批量确认所有有未保存修改的 tab，全部处理完才放行退出
  async function handleExitConfirmation() {
    snapshotCurToTab();   // 先保存当前激活 tab 的最新编辑
    for (const t of state.tabs) {
      if (!t.dirty) continue;
      const r = await showConfirm(t.fileName);
      if (r === 'save') {
        const ok = await saveTabContent(t);
        if (!ok) { mdAPI.quitCanceled(); return; }   // 取消或保存失败 → 中断退出
      } else if (r === 'nosave') {
        // 继续下一个
      } else {
        mdAPI.quitCanceled();
        return;
      }
    }
    mdAPI.quitApproved();
  }

  // 针对某个 tab 的保存确认（标题显示该文件）
  function confirmSaveFor(t) {
    return showConfirm(t.fileName);
  }

  function showConfirm(fileName) {
    return new Promise((resolve) => {
      $('confirm-title').textContent = `是否保存对 ${fileName || state.fileName} 的更改？`;
      $('save-confirm-overlay').classList.remove('hidden');
      const handler = (e) => {
        const btn = e.target.dataset.confirm;
        if (!btn) return;
        $('save-confirm-overlay').classList.add('hidden');
        document.removeEventListener('click', handler);
        resolve(btn);
      };
      // 点击遮罩取消
      $('save-confirm-overlay').addEventListener('click', (e) => {
        if (e.target === $('save-confirm-overlay')) {
          $('save-confirm-overlay').classList.add('hidden');
          document.removeEventListener('click', handler);
          resolve('cancel');
        }
      });
      document.querySelectorAll('.confirm-buttons button').forEach((b) => {
        b.addEventListener('click', handler, { once: true });
      });
    });
  }

  // ============ 菜单（HTML 模拟） ============
  function buildMenubar() {
    const menubar = $('menubar');
    const menus = {
      '文件': [
        { label: '新建', acc: 'Ctrl+N', action: () => newFile() },
        { label: '打开…', acc: 'Ctrl+O', action: () => openFile() },
        { type: 'sep' },
        { label: '保存', acc: 'Ctrl+S', action: () => saveFile() },
        { label: '另存为…', acc: 'Ctrl+Shift+S', action: () => saveFileAs() },
        { type: 'sep' },
        { label: '最近打开的文件', sub: true, recent: true },
        { type: 'sep' },
        { label: '退出', acc: 'Alt+F4', danger: true, action: () => window.close() }
      ],
      '编辑': [
        { label: '撤销', acc: 'Ctrl+Z', action: () => document.execCommand('undo') },
        { label: '重做', acc: 'Ctrl+Y', action: () => document.execCommand('redo') },
        { type: 'sep' },
        { label: '查找…', acc: 'Ctrl+F', action: () => openSearch(false) },
        { label: '替换…', acc: 'Ctrl+H', action: () => openSearch(true) },
        { type: 'sep' },
        { label: '剪切', acc: 'Ctrl+X', action: () => document.execCommand('cut') },
        { label: '复制', acc: 'Ctrl+C', action: () => document.execCommand('copy') },
        { label: '粘贴', acc: 'Ctrl+V', action: pasteFromClipboard },
        { label: '全选', acc: 'Ctrl+A', action: () => editor.select() }
      ],
      '视图': [
        { label: '显示预览窗口', checked: () => state.showPreview, action: () => togglePreview() },
        { label: '同步滚动', checked: () => state.syncScroll, action: () => toggleSyncScroll() },
        { label: '自动折行', checked: () => state.wrap, action: () => toggleWrap() },
        { type: 'sep' },
        { label: '重新加载', acc: 'Ctrl+R', action: () => location.reload() },
        { label: '开发者工具', acc: 'Ctrl+Shift+I', action: () => { if (window.mdAPI) mdAPI.toggleDevTools(); } },
        { type: 'sep' },
        { title: '缩放' },
        { label: '实际大小', acc: 'Ctrl+0', action: () => { if (window.mdAPI) mdAPI.resetZoom(); } },
        { label: '放大', acc: 'Ctrl++', action: () => { if (window.mdAPI) mdAPI.zoomIn(); } },
        { label: '缩小', acc: 'Ctrl+-', action: () => { if (window.mdAPI) mdAPI.zoomOut(); } },
        { type: 'sep' },
        { label: '全屏', acc: 'F11', action: () => { if (window.mdAPI) mdAPI.toggleFullscreen(); } }
      ],
      '主题': [
        { label: '浅色', action: () => applyTheme('light') },
        { label: '深色', action: () => applyTheme('dark') }
      ],
      '帮助': [
        { label: `关于 MD编辑器`, action: () => showAbout() }
      ]
    };

    // 目录项
    Object.keys(menus).forEach((name) => {
      const mi = document.createElement('span');
      mi.className = 'menu-item';
      mi.textContent = name;
      mi.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        mi.classList.add('open');
        showMenu(mi, menus[name]);
      });
      menubar.appendChild(mi);
    });

    const hint = document.createElement('span');
    hint.id = 'menubar-hint';
    hint.textContent = 'Ctrl+S 保存 · Ctrl+Shift+S 另存为';
    menubar.appendChild(hint);

    document.addEventListener('click', closeAllMenus);

    function closeAllMenus() {
      document.querySelectorAll('.menu-popup').forEach((p) => p.remove());
      document.querySelectorAll('.menu-item.open').forEach((m) => m.classList.remove('open'));
    }

    function showMenu(anchor, items) {
      const popup = document.createElement('div');
      popup.className = 'menu-popup';
      items.forEach((it) => {
        if (it.type === 'sep') {
          const sep = document.createElement('div');
          sep.className = 'sep';
          popup.appendChild(sep);
          return;
        }
        if (it.title) {
          const t = document.createElement('div');
          t.className = 'mi-title';
          t.textContent = it.title;
          popup.appendChild(t);
          return;
        }
        const row = document.createElement('div');
        row.className = 'mi';
        if (it.danger) row.classList.add('mi-danger');
        if (typeof it.checked === 'function') {
          const check = document.createElement('span');
          check.className = 'check';
          check.textContent = it.checked() ? '✓' : '';
          row.appendChild(check);
        }
        const span = document.createElement('span');
        span.textContent = it.label;
        row.appendChild(span);
        if (it.acc) {
          const acc = document.createElement('span');
          acc.className = 'acc';
          acc.textContent = it.acc;
          row.appendChild(acc);
        }
        if (it.recent) {
          popup.appendChild(row);
          const recents = state.recent;
          if (recents.length) {
            recents.forEach((p) => {
              const r = document.createElement('div');
              r.className = 'mi';
              r.style.paddingLeft = '28px';
              r.style.fontSize = '12px';
              r.textContent = p.split(/[\\/]/).pop();
              r.title = p;
              r.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllMenus();
                openRecent(p);
              });
              popup.appendChild(r);
            });
          } else {
            const none = document.createElement('div');
            none.className = 'mi disabled';
            none.textContent = '（无）';
            popup.appendChild(none);
          }
          return;
        }
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          closeAllMenus();
          if (it.action) it.action();
        });
        popup.appendChild(row);
      });
      // 定位
      const rect = anchor.getBoundingClientRect();
      popup.style.top = (rect.bottom + 2) + 'px';
      popup.style.left = rect.left + 'px';
      document.body.appendChild(popup);
    }
  }

  function showAbout() {
    alert(`${'MD编辑器'} v${state.version}\n\n本地 Markdown 编辑器\n· 分屏实时预览，多标签页编辑\n· 双向跳转：预览双击 → 源码行 / 光标移动 → 预览高亮\n· Mermaid 流程图\n· 代码语法高亮\n· 多编码支持 (UTF-8 / GBK / UTF-16)\n· 查找替换、自动折行、同步滚动\n· 支持打开方式直接编辑 .md/.markdown/.txt\n· 明暗主题，完全离线运行`);
  }

  // ============ 粘贴（经主进程 clipboard 中转） ============
  async function pasteFromClipboard() {
    if (!window.mdAPI) { document.execCommand('paste'); return; }
    const text = await mdAPI.readClipboard();
    if (!text) return;
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
    editor.focus();
    markDirty(true);
    updateLineNumbers();
    scheduleRender();
    updateCursorInfo();
  }

  // ============ 视图开关：预览显隐 + 双向滚动同步 ============
  let scrollSyncLock = false;

  // 按滚动比例同步两个容器（编辑区与预览区内容高度不同，比例对齐）
  function syncScrollByRatio(from, to) {
    const fMax = from.scrollHeight - from.clientHeight;
    const tMax = to.scrollHeight - to.clientHeight;
    if (fMax <= 0 || tMax <= 0) return;
    to.scrollTop = (from.scrollTop / fMax) * tMax;
  }

  function applyViewPrefs() {
    $('workspace').classList.toggle('no-preview', !state.showPreview);
    applyWrap();
  }

  // 自动折行：开 → wrap=soft + pre-wrap 软换行；关 → wrap=off + pre 横向滚动
  function applyWrap() {
    editor.wrap = state.wrap ? 'soft' : 'off';
    editor.classList.toggle('wrap', state.wrap);
  }

  function togglePreview() {
    state.showPreview = !state.showPreview;
    applyViewPrefs();
    try { localStorage.setItem('md-show-preview', state.showPreview ? '1' : '0'); } catch (e) {}
  }

  function toggleSyncScroll() {
    state.syncScroll = !state.syncScroll;
    try { localStorage.setItem('md-sync-scroll', state.syncScroll ? '1' : '0'); } catch (e) {}
  }

  function toggleWrap() {
    state.wrap = !state.wrap;
    applyWrap();
    try { localStorage.setItem('md-wrap', state.wrap ? '1' : '0'); } catch (e) {}
  }

  // ============ 编码选择器（状态栏） ============
  const ENCODINGS = [
    { label: 'UTF-8', encoding: 'UTF-8', bom: false },
    { label: 'UTF-8 (BOM)', encoding: 'UTF-8', bom: true },
    { label: 'GBK', encoding: 'GBK', bom: false },
    { label: 'UTF-16LE', encoding: 'UTF-16LE', bom: false },
    { label: 'UTF-16BE', encoding: 'UTF-16BE', bom: false }
  ];

  function showEncodingMenu(anchor) {
    document.querySelectorAll('.menu-popup').forEach((p) => p.remove()); // 复用菜单关闭逻辑，避免叠加
    const popup = document.createElement('div');
    popup.className = 'menu-popup menu-popup-up';
    ENCODINGS.forEach((enc) => {
      const row = document.createElement('div');
      row.className = 'mi';
      const cur = state.encoding === enc.encoding && state.bom === enc.bom;
      const span = document.createElement('span');
      span.textContent = (cur ? '✓ ' : '') + enc.label;
      row.appendChild(span);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.remove();
        state.encoding = enc.encoding;
        state.bom = enc.bom;
        const t = curTab();
        if (t) { t.encoding = enc.encoding; t.bom = enc.bom; }
        updateTitleBar();
      });
      popup.appendChild(row);
    });
    const rect = anchor.getBoundingClientRect();
    popup.style.left = rect.left + 'px';
    popup.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    document.body.appendChild(popup);
    // 点击菜单外任意处关闭
    setTimeout(() => {
      const closer = (ev) => {
        if (!popup.contains(ev.target)) {
          popup.remove();
          document.removeEventListener('click', closer);
        }
      };
      document.addEventListener('click', closer);
    }, 0);
  }

  function initEncodingPicker() {
    const enc = $('status-encoding');
    enc.title = '点击更改编码（保存 / 另存为时按此编码写出，可用于转码）';
    enc.classList.add('clickable');
    enc.addEventListener('click', (e) => {
      e.stopPropagation();
      showEncodingMenu(enc);
    });
  }

  // ============ 快捷键 ============
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (e.shiftKey) saveFileAs();
      else saveFile();
    } else if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newFile();
    } else if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openFile();
    } else if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch(false);
    } else if (mod && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      openSearch(true);
    }
  });

  // ============ 菜单命令（主进程菜单触发） ============
  if (window.mdAPI) {
    mdAPI.onMenuCommand((cmd, payload) => {
      if (cmd === 'new') newFile();
      else if (cmd === 'open') openFile();
      else if (cmd === 'save') saveFile();
      else if (cmd === 'saveAs') saveFileAs();
      else if (cmd === 'openRecent') openRecent(payload);
      else if (cmd === 'checkUnsaved') {
        // 主进程请求确认（关闭窗口/退出前）
        handleExitConfirmation(payload && payload.action);
      }
    });
    mdAPI.onThemeCommand((theme) => applyTheme(theme));
    mdAPI.getVersion().then((v) => {
      state.version = v;
      updateTitleBar();
    });

    // 最近文件：启动时从主进程拉取持久化列表，此后由主进程推送保持同步
    mdAPI.getRecent().then((files) => {
      if (Array.isArray(files)) state.recent = files;
    });
    mdAPI.onRecentUpdated((files) => {
      if (Array.isArray(files)) state.recent = files;
    });

    // 外部传入文件路径（右键"打开方式"/命令行启动时打开指定文件）
    mdAPI.onOpenFile((filePath) => {
      openRecent(filePath);
    });
  }

  // ============ 分隔条拖拽 ============
  function initDivider() {
    const divider = $('divider');
    let dragging = false;
    divider.addEventListener('mousedown', (e) => {
      dragging = true;
      const ws = $('workspace');
      const rect = ws.getBoundingClientRect();
      document.body.style.cursor = 'col-resize';
      const move = (ev) => {
        if (!dragging) return;
        const ratio = (ev.clientX - rect.left) / rect.width;
        const clamped = Math.min(0.7, Math.max(0.3, ratio));
        $('left-pane').style.flex = `0 0 ${clamped * 100}%`;
        $('right-pane').style.flex = `0 0 ${(1 - clamped) * 100}%`;
      };
      const up = () => {
        dragging = false;
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // ============ 外链：http(s) 链接交系统默认浏览器打开 ============
  // 否则 webview 会在应用窗口内同窗口导航，把编辑器页面整个替换掉。
  function initExternalLinks() {
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        if (window.mdAPI && window.mdAPI.openExternal) {
          window.mdAPI.openExternal(href).catch(() => {});
        }
      }
    });
  }

  // ============ 标题栏按钮 ============
  $('min-btn').addEventListener('click', () => { if (window.mdAPI) mdAPI.minimize(); });
  $('max-btn').addEventListener('click', () => { if (window.mdAPI) mdAPI.maximize(); });
  $('close-btn').addEventListener('click', () => {
    if (window.mdAPI) {
      mdAPI.closeWindow();
    } else {
      window.close();
    }
  });
  $('theme-toggle').addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  // ============ 编辑器事件 ============
  editor.addEventListener('input', () => {
    markDirty(true);
    scheduleRender();
    updateCursorInfo();
  });
  editor.addEventListener('scroll', () => {
    lineNums.scrollTop = editor.scrollTop;
    if (state.syncScroll && !scrollSyncLock) {
      scrollSyncLock = true;
      syncScrollByRatio(editor, preview);
      requestAnimationFrame(() => { scrollSyncLock = false; });
    }
  });
  preview.addEventListener('scroll', () => {
    if (state.syncScroll && !scrollSyncLock) {
      scrollSyncLock = true;
      syncScrollByRatio(preview, editor);
      requestAnimationFrame(() => { scrollSyncLock = false; });
    }
  });
  editor.addEventListener('keyup', updateCursorInfo);
  editor.addEventListener('click', updateCursorInfo);

  // ---- 双向精确跳转事件 ----
  // 左侧编辑区：按光标/选择位置驱动右侧滚动并高亮对应预览块
  editor.addEventListener('click', scheduleJumpEditor);
  editor.addEventListener('keyup', scheduleJumpEditor);
  editor.addEventListener('input', scheduleJumpEditor);
  // 右侧预览：双击某块 → 左侧选中并滚动到对应源码行
  preview.addEventListener('dblclick', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-src-pos]') : null;
    if (el) jumpPreviewToSource(el);
  });

  // Ctrl+W：多标签时关闭当前标签；仅一个标签时关闭窗口
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (state.tabs.length > 1 && state.activeTabId != null) closeTab(state.activeTabId);
      else closeWindow();
    }
  });

  // ============ 初始化 ============
  function init() {
    // 主题恢复
    let saved = 'light';
    try { saved = localStorage.getItem('md-theme') || 'light'; } catch (e) {}
    if (saved === 'dark') {
      document.documentElement.dataset.theme = 'dark';
      state.theme = 'dark';
    }

    // 视图偏好恢复（预览显隐 / 滚动同步，默认均开启）
    try {
      if (localStorage.getItem('md-show-preview') === '0') state.showPreview = false;
      if (localStorage.getItem('md-sync-scroll') === '0') state.syncScroll = false;
      if (localStorage.getItem('md-wrap') === '0') state.wrap = false;
      editorLineH = parseFloat(getComputedStyle(editor).lineHeight) || editorLineH;
    } catch (e) {}
    applyViewPrefs();

    buildMenubar();
    initDivider();
    initSearchbar();
    initEncodingPicker();
    initExternalLinks();

    maybeAskSetDefaultAssoc();

    // 初始示例内容（不含 mermaid，避免首启触发 3.4MB 懒加载）
    const sample = `# 欢迎使用 MD编辑器

这是一个**本地 Markdown 编辑器**，支持：

- Markdown 实时渲染
- Mermaid 流程图（输入 \`\`\`mermaid 代码块后自动加载渲染）
- 代码语法高亮
- 明暗主题切换
- 多编码支持（UTF-8 / GBK）
- 查找替换（Ctrl+F / Ctrl+H）

## 代码高亮示例

\`\`\`js
const app = new Editor();
app.render();
\`\`\`

> 提示：按 Ctrl+S 保存文件，Ctrl+Shift+S 另存为。全程离线运行。
`;
    // 首个文档作为欢迎页；打开其他内容时若未被编辑则自动关闭
    const t0 = makeTab();
    t0.content = sample;
    t0.welcome = true;
    state.activeTabId = t0.id;
    editor.value = sample;
    updateLineNumbers();
    renderAll();
    updateCursorInfo();
    updateTitleBar();
    renderTabs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();