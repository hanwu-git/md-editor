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
  marked.setOptions({ renderer });

  function escapeAttr(s) {
    return s.replace(/"/g, '&quot;');
  }

  // ============ 渲染管线 ============
  let renderTimer = null;

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAll, 250);
    updateLineNumbers();
  }

  function renderAll() {
    const t0 = performance.now();
    const src = editor.value;
    let html;
    try {
      html = marked.parse(src);
    } catch (e) {
      html = `<p style="color:#c0392b">渲染失败：${escapeHtml(e.message)}</p>`;
    }
    preview.innerHTML = html;

    // 代码高亮（非 mermaid）
    highlightCodeBlocks();

    // Mermaid 渲染
    renderMermaid().then(() => {
      const ms = Math.round(performance.now() - t0);
      $('render-time').textContent = `渲染 ${ms}ms · 自动刷新`;
      $('status-render').textContent = `渲染 ${ms}ms`;
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

  // 添加或复用 tab：同一路径已打开则切过去；否则新建并激活
  function addOrActivateTab(path, fileName, content, encoding, bom) {
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

  function saveFile() { saveTabContent(curTab()); }

  async function saveFileAs() {
    const t = curTab();
    if (!t) return;
    // 另存为按当前状态栏所选编码（含 BOM）写出，可用于转码保存
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
    alert(`${'MD编辑器'} v${state.version}\n\n本地 Markdown 编辑器\n· 分屏实时预览\n· Mermaid 流程图\n· 代码语法高亮\n· 多编码支持 (UTF-8 / GBK / UTF-16)\n· 完全离线运行`);
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
    } catch (e) {}
    applyViewPrefs();

    buildMenubar();
    initDivider();
    initSearchbar();
    initEncodingPicker();

    // 首个文档作为初始 tab：直接空白「未命名」，不再展示欢迎示例
    const t0 = makeTab();
    state.activeTabId = t0.id;
    editor.value = '';
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