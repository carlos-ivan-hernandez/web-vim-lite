(() => {
  const STEP = 70; // pixels for a tap of j/k/h/l
  const HOLD_DELAY = 150; // ms a key is held before it scrolls continuously
  const HOLD_SPEED = 1100; // pixels per second while held
  const EASE = 0.07; // seconds; how quickly scrolling catches up (smaller is snappier)
  const PREFIX_TIMEOUT = 1000; // ms to finish a two-key command like gg or zL
  const HINT_CHARS = "sadfjklewcmpgh";

  let mode = "normal"; // "normal" | "insert" | "hints"
  let insertFromFocus = false; // insert mode came from focusing a field, not from pressing i
  let pending = ""; // first key of a two-key command
  let pendingTimer = null;
  let lastClicked = null;
  let cachedScroller = null;

  // ---------- Settings (changed in the popup) ----------

  let enabled = true; // false when this site is turned off
  let cmdEscape = false; // only Cmd+Esc returns to normal mode; plain Esc goes to the page

  const storage = globalThis.chrome && chrome.storage && chrome.storage.local;

  function applySettings({ disabledHosts = [], cmdEscape: useCmd = false }) {
    cmdEscape = useCmd;
    const next = !disabledHosts.includes(location.hostname);
    if (enabled && !next && mode !== "normal") {
      if (mode === "hints") clearHints();
      setMode("normal");
    }
    enabled = next;
  }

  if (storage) {
    storage.get(["disabledHosts", "cmdEscape"], applySettings);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") storage.get(["disabledHosts", "cmdEscape"], applySettings);
    });
  }

  // The popup asks which site the tab is on.
  if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message && message.type === "vimlite:host") reply({ host: location.hostname });
    });
  }

  // ---------- UI (lives in a shadow root so page CSS can't touch it) ----------

  let host = null;
  let shadow = null;
  let badge = null;

  function ui() {
    if (host && host.isConnected) return shadow;
    host = document.createElement("vimlite-ui");
    host.style.cssText = "all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .hint {
          position: fixed;
          padding: 1px 4px;
          font: bold 12px/1.2 ui-monospace, Menlo, Consolas, monospace;
          text-transform: uppercase;
          color: #302505;
          background: linear-gradient(#fff785, #ffc542);
          border: 1px solid #c38a22;
          border-radius: 3px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          white-space: nowrap;
        }
        .hint .typed { color: #d4ac3a; }
        .badge {
          position: fixed;
          right: 8px;
          bottom: 8px;
          padding: 3px 8px;
          font: bold 11px/1.2 ui-monospace, Menlo, Consolas, monospace;
          color: #fff;
          background: rgba(30, 30, 30, 0.85);
          border-radius: 4px;
        }
      </style>`;
    badge = document.createElement("div");
    badge.className = "badge";
    badge.hidden = true;
    shadow.appendChild(badge);
    document.documentElement.appendChild(host);
    return shadow;
  }

  function setMode(next) {
    mode = next;
    insertFromFocus = false;
    releaseHold();
    clearPending();
    ui();
    badge.hidden = mode === "normal";
    badge.textContent = mode === "insert" ? "-- INSERT --" : "-- HINTS --";
  }

  // ---------- Helpers ----------

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
    if (el.tagName === "INPUT") {
      const nonText = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
      return !nonText.includes((el.type || "").toLowerCase());
    }
    return false;
  }

  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function clearPending() {
    pending = "";
    clearTimeout(pendingTimer);
  }

  // ---------- Scrolling ----------

  function canScroll(el, axis) {
    const doc = document.scrollingElement || document.documentElement;
    const size = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    if (size <= 1) return false;
    if (el === doc || el === document.body) return true;
    const overflow = getComputedStyle(el)[axis === "y" ? "overflowY" : "overflowX"];
    return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
  }

  // Pick what to scroll: the scrollable container around the last thing clicked,
  // then the page itself, then the biggest scrollable element (for app-style pages
  // where the document doesn't scroll).
  function scroller(axis) {
    for (let el = lastClicked; el && el.nodeType === 1; el = el.parentElement) {
      if (canScroll(el, axis)) return el;
    }
    const doc = document.scrollingElement || document.documentElement;
    if (canScroll(doc, axis)) return doc;

    if (!cachedScroller || !cachedScroller.isConnected || !canScroll(cachedScroller, axis)) {
      cachedScroller = null;
      let bestArea = 0;
      for (const el of document.querySelectorAll("body *")) {
        if (!canScroll(el, axis)) continue;
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) {
          bestArea = area;
          cachedScroller = el;
        }
      }
    }
    return cachedScroller || doc;
  }

  // Scrolling glides: each command adds distance still to go, and every frame covers part of
  // what's left, so it eases out. A held key keeps adding distance until it's released.
  let motion = null; // { el, x, y, hold, raf, last }

  function glide(dx, dy, holdKey) {
    const el = scroller(dy !== 0 ? "y" : "x");
    if (!motion || motion.el !== el) {
      stopGlide();
      motion = { el, x: 0, y: 0, hold: null, last: performance.now(), raf: 0 };
      motion.raf = requestAnimationFrame(glideFrame);
    }
    motion.x += dx;
    motion.y += dy;
    if (holdKey) {
      const length = Math.hypot(dx, dy) || 1;
      motion.hold = { key: holdKey, since: performance.now(), vx: dx / length, vy: dy / length };
    }
  }

  function glideFrame(now) {
    const m = motion;
    if (!m) return;
    const dt = Math.min((now - m.last) / 1000, 0.05);
    m.last = now;
    if (m.hold && now - m.hold.since > HOLD_DELAY) {
      m.x += m.hold.vx * HOLD_SPEED * dt;
      m.y += m.hold.vy * HOLD_SPEED * dt;
    }
    const share = 1 - Math.exp(-dt / EASE);
    // Whole pixels only, at least one while any is left, so it doesn't stall short.
    const step = (left) => {
      const d = left * share;
      return Math.abs(left) < 1 ? 0 : Math.sign(d) * Math.max(1, Math.floor(Math.abs(d)));
    };
    const sx = step(m.x);
    const sy = step(m.y);
    if (sx || sy) {
      const before = [m.el.scrollLeft, m.el.scrollTop];
      m.el.scrollBy({ left: sx, top: sy, behavior: "instant" });
      // At the edge: drop what's left instead of pushing against it.
      if (sx && m.el.scrollLeft === before[0]) m.x = 0;
      else m.x -= sx;
      if (sy && m.el.scrollTop === before[1]) m.y = 0;
      else m.y -= sy;
    }
    if (!m.hold && Math.abs(m.x) < 1 && Math.abs(m.y) < 1) {
      motion = null;
      return;
    }
    m.raf = requestAnimationFrame(glideFrame);
  }

  function releaseHold(key) {
    // Lowercased: Shift pressed during the hold turns the key's release into "J".
    if (motion && motion.hold && (key === undefined || motion.hold.key === key.toLowerCase())) motion.hold = null;
  }

  function stopGlide() {
    if (motion) cancelAnimationFrame(motion.raf);
    motion = null;
  }

  function scrollTo(x, y) {
    stopGlide();
    const el = scroller(y !== null ? "y" : "x");
    const opts = { behavior: "smooth" };
    if (x !== null) opts.left = x === Infinity ? el.scrollWidth : x;
    if (y !== null) opts.top = y === Infinity ? el.scrollHeight : y;
    el.scrollTo(opts);
  }

  function viewportHeight(el) {
    const doc = document.scrollingElement || document.documentElement;
    return el === doc ? window.innerHeight : el.clientHeight;
  }

  // ---------- Link hints ----------

  const CLICKABLE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "label[for]",
    "[role=button]",
    "[role=link]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=checkbox]",
    "[onclick]",
    "[contenteditable=''], [contenteditable=true]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  let hints = []; // { el, label, node }
  let typed = "";

  function makeLabels(count) {
    // Same idea as Vimium: no label is a prefix of another, so typing is never ambiguous.
    const labels = [""];
    let offset = 0;
    while (labels.length - offset < count || labels.length === 1) {
      const base = labels[offset++];
      for (const ch of HINT_CHARS) labels.push(base + ch);
    }
    return labels.slice(offset, offset + count).sort();
  }

  function visibleRect(el) {
    for (const r of el.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) continue;
      const style = getComputedStyle(el);
      if (style.visibility !== "visible" || style.opacity === "0") return null;
      // Skip elements covered by something else (e.g. a modal backdrop).
      const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) continue;
      return r;
    }
    return null;
  }

  function showHints() {
    const found = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(CLICKABLE)) {
      if (el.disabled) continue;
      const rect = visibleRect(el);
      if (!rect) continue;
      // Skip elements nested inside another hinted element (e.g. a span inside a link).
      if (found.some((f) => f.el.contains(el))) continue;
      const key = `${Math.round(rect.left)},${Math.round(rect.top)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ el, rect });
    }
    if (found.length === 0) return;

    const root = ui();
    const labels = makeLabels(found.length);
    hints = found.map(({ el, rect }, i) => {
      const node = document.createElement("div");
      node.className = "hint";
      node.style.left = `${Math.max(rect.left, 0)}px`;
      node.style.top = `${Math.max(rect.top, 0)}px`;
      node.textContent = labels[i];
      root.appendChild(node);
      return { el, label: labels[i], node };
    });
    typed = "";
    setMode("hints");
  }

  function clearHints() {
    for (const h of hints) h.node.remove();
    hints = [];
    typed = "";
  }

  function updateHints() {
    let matches = [];
    for (const h of hints) {
      const match = h.label.startsWith(typed);
      h.node.hidden = !match;
      if (match) {
        matches.push(h);
        h.node.innerHTML = "";
        const done = document.createElement("span");
        done.className = "typed";
        done.textContent = typed;
        h.node.append(done, h.label.slice(typed.length));
      }
    }
    if (matches.length === 1 && matches[0].label === typed) activate(matches[0].el);
    else if (matches.length === 0) exitHints();
  }

  function exitHints() {
    clearHints();
    setMode("normal");
  }

  function activate(el) {
    exitHints();
    lastClicked = el;
    if (isEditable(el)) {
      el.focus();
      setMode("insert");
    } else {
      el.focus({ preventScroll: true });
      el.click();
    }
  }

  // ---------- Keys ----------

  const commands = {
    j: () => glide(0, STEP, "j"),
    k: () => glide(0, -STEP, "k"),
    h: () => glide(-STEP, 0, "h"),
    l: () => glide(STEP, 0, "l"),
    d: () => glide(0, viewportHeight(scroller("y")) / 2),
    u: () => glide(0, -viewportHeight(scroller("y")) / 2),
    gg: () => scrollTo(null, 0),
    G: () => scrollTo(null, Infinity),
    zL: () => scrollTo(Infinity, null),
    zH: () => scrollTo(0, null),
    i: () => setMode("insert"),
    f: () => showHints(),
  };
  const prefixes = new Set(Object.keys(commands).filter((k) => k.length > 1).map((k) => k[0]));

  function consume(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onKeyDown(e) {
    if (!enabled || e.isComposing) return;
    // Holding Shift for G or zL sends its own keydown; don't let it cancel a prefix.
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;

    if (mode === "hints") {
      consume(e);
      if (e.key === "Escape") exitHints();
      else if (e.key === "Backspace") {
        typed = typed.slice(0, -1);
        updateHints();
      } else if (e.key.length === 1 && HINT_CHARS.includes(e.key.toLowerCase())) {
        typed += e.key.toLowerCase();
        updateHints();
      }
      return;
    }

    if (e.key === "Escape") {
      const active = deepActiveElement();
      const toNormal = !cmdEscape || e.metaKey;
      if (toNormal && (mode === "insert" || isEditable(active))) {
        consume(e);
        if (isEditable(active)) active.blur();
        setMode("normal");
      } else {
        clearPending();
      }
      return;
    }

    // Let the page have keys while typing or when modifiers are held.
    if (mode === "insert" || isEditable(deepActiveElement())) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = pending + e.key;
    // Held keys scroll on their own; the key's repeats would only add jumps.
    if (e.repeat && "jkhl".includes(key)) {
      consume(e);
      return;
    }
    if (commands[key]) {
      consume(e);
      clearPending();
      commands[key]();
    } else if (!pending && prefixes.has(e.key)) {
      consume(e);
      pending = e.key;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(clearPending, PREFIX_TIMEOUT);
    } else if (pending) {
      consume(e);
      clearPending();
    }
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", (e) => releaseHold(e.key), true);
  window.addEventListener("blur", () => releaseHold());

  // Typing into a field counts as insert mode; leaving it drops back to normal.
  window.addEventListener(
    "focusin",
    (e) => {
      if (enabled && mode !== "hints" && isEditable(e.composedPath()[0])) {
        setMode("insert");
        insertFromFocus = true;
      }
    },
    true,
  );
  window.addEventListener(
    "focusout",
    () => {
      setTimeout(() => {
        if (mode === "insert" && insertFromFocus && !isEditable(deepActiveElement())) setMode("normal");
      });
    },
    true,
  );
  window.addEventListener("mousedown", (e) => (lastClicked = e.composedPath()[0]), true);
  window.addEventListener("scroll", () => mode === "hints" && exitHints(), true);
  window.addEventListener("resize", () => mode === "hints" && exitHints());
})();
