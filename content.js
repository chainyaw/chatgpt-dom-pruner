(() => {
  // ====== Tunables ======
  const KEEP = 18;
  const KEEP_CANVAS = 10;
  const CHUNK = 20;

  const DISABLE_ANIMATIONS = true;
  const MAX_STORED = 2000;
  const RUN_THROTTLE_MS = 600;

  // UI
  const BAR_STICKY = true;   // keep the control bar visible near bottom
  const BAR_SPACER_PX = 70;  // reserve space so bar doesn't cover content
  // ======================

  let scheduled = false;
  let lastRunAt = 0;
  let isPruning = false;

  // Stored older blocks as outerHTML strings, oldest -> newest
  let store = [];

  let bottomBar = null;
  let keepAnchor = null;
  let windowContainer = null;
  let spacer = null;

  const now = () => Date.now();

  function getMain() {
    return document.querySelector("main") || document.querySelector("[role='main']") || document.body;
  }

  function isCanvasOpen() {
    return !!document.querySelector("aside") ||
      !!document.querySelector('[aria-label*="Canvas"], [data-testid*="canvas" i]');
  }

  function ensureGlobalStyle() {
    if (!DISABLE_ANIMATIONS) return;
    const id = "chatgpt-pruner-style";
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.documentElement.appendChild(style);
    }
    style.textContent = `* { animation: none !important; transition: none !important; }`;
  }

  function clampStore() {
    if (store.length > MAX_STORED) {
      store = store.slice(store.length - MAX_STORED);
      // If we drop history, safest is clearing expanded window without pushing back
      clearWindow(false);
    }
  }

  function makeBtn(label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText = `
      padding: 6px 10px;
      border-radius: 10px;
      border: 1px solid rgba(128,128,128,.35);
      background: transparent;
      cursor: pointer;
      font-size: 13px;
    `;
    btn.onmouseenter = () => (btn.style.background = "rgba(128,128,128,.10)");
    btn.onmouseleave = () => (btn.style.background = "transparent");
    return btn;
  }

  function htmlListToFrag(htmlList) {
    const frag = document.createDocumentFragment();
    for (const html of htmlList) {
      const t = document.createElement("template");
      t.innerHTML = html.trim();
      const el = t.content.firstElementChild;
      if (el) frag.appendChild(el);
    }
    return frag;
  }

  // ========= Message block selection =========
  function findMessageBlocks() {
    const main = getMain();

    // Most stable: conversation turn
    let blocks = Array.from(main.querySelectorAll('[data-testid="conversation-turn"]'));
    if (blocks.length) return blocks;

    // Next: author role containers
    blocks = Array.from(main.querySelectorAll('[data-message-author-role]'));
    if (blocks.length) return blocks;

    // Fallback: assistant markdown anchors -> climb
    const bodies = Array.from(main.querySelectorAll("div.markdown.prose.markdown-new-styling"));
    const set = new Set();
    for (const b of bodies) {
      const blk = b.closest("[data-message-id]") || b.closest("article") || b.closest("div");
      if (blk) set.add(blk);
    }
    return Array.from(set);
  }
  // =========================================

  function isInsidePrunerUI(el) {
    return !!(el.closest && (
      el.closest("#chatgpt-pruner-bottombar") ||
      el.closest("#chatgpt-pruner-keep-anchor") ||
      el.closest("#chatgpt-pruner-window") ||
      el.closest("#chatgpt-pruner-spacer")
    ));
  }

  function isRealMessageBlock(b) {
    if (!b || !(b instanceof Element)) return false;
    if (b.id === "chatgpt-pruner-bottombar") return false;
    if (b.id === "chatgpt-pruner-keep-anchor") return false;
    if (b.id === "chatgpt-pruner-window") return false;
    if (b.id === "chatgpt-pruner-spacer") return false;
    if (isInsidePrunerUI(b)) return false;
    return true;
  }

  function ensureKeepAnchor(beforeEl) {
    const main = getMain();

    if (keepAnchor && keepAnchor.isConnected) return keepAnchor;

    const existing = document.getElementById("chatgpt-pruner-keep-anchor");
    if (existing) {
      keepAnchor = existing;
      return keepAnchor;
    }

    keepAnchor = document.createElement("div");
    keepAnchor.id = "chatgpt-pruner-keep-anchor";
    keepAnchor.style.cssText = "height:0; margin:0; padding:0;";

    if (beforeEl && beforeEl.parentNode) {
      beforeEl.parentNode.insertBefore(keepAnchor, beforeEl);
    } else {
      main.insertBefore(keepAnchor, main.firstChild);
    }
    return keepAnchor;
  }

  function ensureWindowContainer() {
    const main = getMain();

    if (windowContainer && windowContainer.isConnected) return windowContainer;

    const existing = document.getElementById("chatgpt-pruner-window");
    if (existing) {
      windowContainer = existing;
      return windowContainer;
    }

    windowContainer = document.createElement("div");
    windowContainer.id = "chatgpt-pruner-window";
    windowContainer.style.cssText = "display:block;";

    // Place it right ABOVE keepAnchor if possible
    if (keepAnchor && keepAnchor.isConnected && keepAnchor.parentNode) {
      keepAnchor.parentNode.insertBefore(windowContainer, keepAnchor);
    } else {
      main.insertBefore(windowContainer, main.firstChild);
    }

    return windowContainer;
  }

  function ensureSpacer() {
    const main = getMain();
    if (spacer && spacer.isConnected) return spacer;

    const existing = document.getElementById("chatgpt-pruner-spacer");
    if (existing) {
      spacer = existing;
      return spacer;
    }

    spacer = document.createElement("div");
    spacer.id = "chatgpt-pruner-spacer";
    spacer.style.cssText = `height:${BAR_SPACER_PX}px;`;
    main.appendChild(spacer);
    return spacer;
  }

  function countExpanded() {
    return windowContainer ? windowContainer.children.length : 0;
  }

  function clearWindow(pushBack) {
    if (!windowContainer) return;
    const kids = Array.from(windowContainer.children);
    if (!kids.length) return;

    if (pushBack) {
      const htmls = kids.map(n => n.outerHTML);
      store = store.concat(htmls);
      clampStore();
    }
    kids.forEach(n => n.remove());
  }

  function rebuildAnchorsFromDOM() {
    const keep = isCanvasOpen() ? KEEP_CANVAS : KEEP;
    const blocks = findMessageBlocks().filter(isRealMessageBlock);
    if (!blocks.length) return;

    const firstKept = blocks.length > keep ? blocks[blocks.length - keep] : blocks[0];
    ensureKeepAnchor(firstKept);
    ensureWindowContainer();
  }

  function ensureBottomBar() {
    const main = getMain();

    // Remove duplicates if any
    document.querySelectorAll("#chatgpt-pruner-bottombar").forEach((el, idx) => {
      if (idx > 0) el.remove();
    });

    if (bottomBar && bottomBar.isConnected) return bottomBar;

    const existing = document.getElementById("chatgpt-pruner-bottombar");
    if (existing) {
      bottomBar = existing;
      return bottomBar;
    }

    bottomBar = document.createElement("div");
    bottomBar.id = "chatgpt-pruner-bottombar";
    bottomBar.style.cssText = `
      margin: 14px 0 10px 0;
      padding: 10px 12px;
      border: 1px dashed rgba(128,128,128,.45);
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.4;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      user-select: none;
      opacity: 0.95;
      ${BAR_STICKY ? `
        position: sticky;
        bottom: 0;
        z-index: 9999;
        background: rgba(255,255,255,0.78);
        backdrop-filter: blur(8px);
      ` : ""}
    `;

    const info = document.createElement("span");
    info.style.cssText = "margin-right: 8px;";

    const btnExpand = makeBtn(`往上展開 ${CHUNK}`);
    const btnCollapse = makeBtn("收回展開區");
    const btnExpandAll = makeBtn("展開全部（可能變慢）");

    function updateInfo() {
      const keep = isCanvasOpen() ? KEEP_CANVAS : KEEP;
      info.textContent =
        `已折疊：${store.length} 則` +
        (countExpanded() ? `｜目前展開：${countExpanded()} 則` : "") +
        `｜保留最新：${keep} 則` +
        (isCanvasOpen() ? "｜Canvas 模式" : "");

      const noHistory = store.length === 0;
      btnExpand.disabled = noHistory;
      btnExpandAll.disabled = noHistory;
      btnExpand.style.opacity = noHistory ? "0.5" : "1";
      btnExpandAll.style.opacity = noHistory ? "0.5" : "1";
    }

    function expandChunk(count) {
      if (!store.length) return;

      // Ensure anchor/container exist
      if (!keepAnchor || !keepAnchor.isConnected || !windowContainer || !windowContainer.isConnected) {
        rebuildAnchorsFromDOM();
      }
      if (!keepAnchor || !keepAnchor.isConnected) return;
      if (!windowContainer || !windowContainer.isConnected) return;

      // Take from newest side (closest to now)
      const start = Math.max(0, store.length - count);
      const take = store.splice(start, store.length - start);

      const frag = htmlListToFrag(take);

      // Always insert at TOP of expanded window:
      // 1st click: chunk A inserted
      // 2nd click: older chunk B inserted above A, so it keeps growing upward
      if (windowContainer.firstChild) {
        windowContainer.insertBefore(frag, windowContainer.firstChild);
      } else {
        windowContainer.appendChild(frag);
      }

      updateInfo();
    }

    function collapseExpanded() {
      if (!windowContainer || !windowContainer.isConnected) rebuildAnchorsFromDOM();
      if (!windowContainer) return;

      clearWindow(true);
      updateInfo();
    }

    function expandAll() {
      if (!store.length) return;

      if (!keepAnchor || !keepAnchor.isConnected || !windowContainer || !windowContainer.isConnected) {
        rebuildAnchorsFromDOM();
      }
      if (!windowContainer) return;

      // Return expanded back to store first (keeps ordering consistent)
      clearWindow(true);

      const take = store.splice(0, store.length); // oldest -> newest
      const frag = htmlListToFrag(take);
      windowContainer.appendChild(frag);

      updateInfo();
    }

    btnExpand.onclick = () => expandChunk(CHUNK);
    btnCollapse.onclick = () => collapseExpanded();
    btnExpandAll.onclick = () => expandAll();

    // Expose updater
    ensureBottomBar._updateInfo = updateInfo;

    bottomBar.append(info, btnExpand, btnCollapse, btnExpandAll);
    main.appendChild(bottomBar);
    ensureSpacer();
    updateInfo();

    return bottomBar;
  }

  function updateBarInfo() {
    if (ensureBottomBar._updateInfo) ensureBottomBar._updateInfo();
  }

  function pruneOnce() {
    const t = now();
    if (t - lastRunAt < RUN_THROTTLE_MS) return;
    lastRunAt = t;
    if (isPruning) return;

    ensureGlobalStyle();
    ensureBottomBar();

    const keep = isCanvasOpen() ? KEEP_CANVAS : KEEP;

    // Only consider real message blocks; exclude our UI + expanded window
    const blocks = findMessageBlocks().filter(isRealMessageBlock);

    if (blocks.length <= keep) {
      updateBarInfo();
      return;
    }

    const extra = blocks.length - keep;
    const firstKept = blocks[extra];

    // Place anchor + window container before first kept
    ensureKeepAnchor(firstKept);
    ensureWindowContainer();

    const toRemove = blocks.slice(0, extra);

    isPruning = true;
    try {
      const htmls = [];
      for (const blk of toRemove) {
        try {
          htmls.push(blk.outerHTML);
          blk.remove();
        } catch {}
      }
      store = store.concat(htmls);
      clampStore();
      updateBarInfo();
    } finally {
      isPruning = false;
    }
  }

  function schedulePrune() {
    if (scheduled) return;
    scheduled = true;

    const run = () => {
      scheduled = false;
      pruneOnce();
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(run, { timeout: 1200 });
    } else {
      setTimeout(run, 250);
    }
  }

  function startObserver() {
    const main = getMain();
    const mo = new MutationObserver(() => {
      if (isPruning) return;
      schedulePrune();
    });
    mo.observe(main, { childList: true, subtree: true });

    schedulePrune();

    setInterval(() => {
      if (bottomBar && bottomBar.isConnected) updateBarInfo();
    }, 2500);
  }

  // init
  setTimeout(startObserver, 700);
})();
