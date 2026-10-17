/* WP Behaviors 0.5.0 | Unstyled, dependency-free behavior primitives.
MIT License

Copyright (c) 2026 WP Behaviors contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
(() => {
  "use strict";
  const messages = {
    toast: { close: "Close", "close-label": "Dismiss notification", success: "Action completed" },
    carousel: { "slide-label": "Go to slide {index}", position: "{index} / {count}" },
    gallery: { "image-error": "Image could not be loaded. Try another image or close." },
    combobox: { required: "Please select an item from the list." },
    "load-more": {
      loading: "Loading…",
      loaded: "Loaded {count} items",
      "loaded-complete": "Loaded {count} items. All results shown.",
      complete: "No more results",
      "empty-page": "No new results on this page. You can continue loading.",
      error: "{error} Please try again.",
    },
    form: {
      invalid: "Please check required fields and input formats.",
      submitting: "Submitting…",
      uploading: "Uploading… {percent}%",
      success: "Submitted successfully",
      error: "{error} You can retry; your input has been retained.",
    },
    "file-upload": {
      "file-label": "{name} · {size} bytes",
      remove: "Remove",
      "invalid-file": "{name} exceeds the size limit or has an unsupported format.",
      "max-files": "Up to {count} files allowed.",
      selected: "{count} files selected",
      uploading: "Uploading…",
      success: "Upload complete",
      error: "{error} Files retained; you can retry.",
      "network-error": "Network error. Please retry.",
      timeout: "Upload timed out. Please retry.",
      cancelled:
        "Transfer cancelled; check the server receipt to confirm acceptance. Retry uses the same operation ID.",
    },
    stepper: { invalid: "Complete the required fields in the current step first." },
    copy: {
      empty: "Nothing to copy",
      unavailable: "Clipboard unavailable. Please copy manually.",
      success: "Copied",
      error: "Copy failed: {error}",
    },
  };
  const registry = new Map(),
    instances = new Map(),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let sequence = 0;
  const uid = (el) => {
    if (el.id) return el.id;
    let id;
    do {
      id = `wb-${++sequence}`;
    } while (document.getElementById(id));
    return id;
  };
  const owned = (root, selector) =>
    [...root.querySelectorAll(selector)].filter((el) => el.closest("[data-behavior]") === root);
  const focusable = (el) =>
    [...el.querySelectorAll("button,a[href],input,select,textarea,[tabindex]")].filter(
      (e) =>
        !e.disabled &&
        e.tabIndex >= 0 &&
        !e.closest("[hidden],[inert]") &&
        e.getClientRects().length,
    );
  const number = (value, fallback = 0) =>
    Number.isFinite(Number(value)) && value !== undefined && value !== ""
      ? Number(value)
      : fallback;
  const text = (el, value) => {
    if (el) el.textContent = String(value);
  };
  const endpoint = (value) => {
    const url = new URL(value, location.href);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== location.origin)
      throw Error("Endpoint must be same-origin HTTP(S).");
    return url;
  };
  async function request(url, options) {
    const signal = options?.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000);
    const response = await fetch(endpoint(url), {
      credentials: "same-origin",
      redirect: "error",
      ...options,
      signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error(`Invalid JSON response (${response.status})`);
    }
    if (!response.ok) {
      const error = Error(data.message || `HTTP ${response.status}`);
      error.data = data;
      throw error;
    }
    return data;
  }
  // A request whose upload is watched: XMLHttpRequest, because fetch reports no upload progress. The
  // same answer rules as request(): same origin, JSON, a non-2xx is an error carrying its data, and a
  // redirect is refused (fetch's redirect:'error'). The clock restarts with every byte that moves, so a
  // large file on a slow line is not cut off while it is still arriving.
  function watched(url, { body, headers = {}, signal, progress }) {
    const target = endpoint(url);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let timer;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => xhr.abort(), 30000);
      };
      const fail = (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        reject(error);
      };
      const stop = () => xhr.abort();
      xhr.open("POST", target.href);
      xhr.withCredentials = true;
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.addEventListener("progress", (e) => {
        arm();
        if (e.lengthComputable) progress(e.loaded, e.total);
      });
      xhr.addEventListener("abort", () =>
        fail(signal?.aborted ? Error("Aborted") : Error("Upload timed out")),
      );
      xhr.addEventListener("error", () => fail(Error("Network error")));
      xhr.addEventListener("load", () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        if (xhr.responseURL && new URL(xhr.responseURL).href !== target.href) {
          reject(Error("The endpoint redirected"));
          return;
        }
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          reject(Error(`Invalid JSON response (${xhr.status})`));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          const error = Error(data.message || `HTTP ${xhr.status}`);
          error.data = data;
          reject(error);
          return;
        }
        resolve(data);
      });
      signal?.addEventListener("abort", stop, { once: true });
      arm();
      xhr.send(body);
    });
  }
  // Where this visit came from, kept for the tab's session: the first page, an outside referrer and the
  // campaign parameters. A form with data-attribution sends it; nothing else reads it.
  const ATTRIBUTION = "wb-attribution",
    CAMPAIGN = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "gbraid",
      "wbraid",
      "fbclid",
      "msclkid",
    ];
  function captureAttribution() {
    try {
      if (sessionStorage.getItem(ATTRIBUTION)) return;
      const url = new URL(location.href),
        a = { landing: url.origin + url.pathname + url.search, at: new Date().toISOString() };
      if (document.referrer) {
        const from = new URL(document.referrer);
        if (from.origin !== location.origin) a.referrer = from.href;
      }
      for (const key of CAMPAIGN) {
        const value = url.searchParams.get(key);
        if (value) a[key] = value.slice(0, 500);
      }
      sessionStorage.setItem(ATTRIBUTION, JSON.stringify(a));
    } catch {}
  }
  const attribution = () => {
    try {
      return JSON.parse(sessionStorage.getItem(ATTRIBUTION) || "{}");
    } catch {
      return {};
    }
  };
  // Conversions, reported to whatever Google tag the page loads: GTM reads dataLayer events, gtag.js
  // reads gtag() commands. With neither, nothing happens. <html data-behavior-analytics="off"> opts out.
  function track(event, params) {
    if (document.documentElement.dataset.behaviorAnalytics === "off") return;
    const gtm = Object.keys(window.google_tag_manager || {}).some((key) => key.startsWith("GTM-"));
    if (gtm && Array.isArray(window.dataLayer)) window.dataLayer.push({ event, ...params });
    else if (typeof window.gtag === "function") window.gtag("event", event, params);
    else if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event, ...params });
  }
  const CONTACT = [
    [/^tel:/i, "phone"],
    [/^sms:/i, "sms"],
    [/^mailto:/i, "email"],
    [/^(https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\/|whatsapp:)/i, "whatsapp"],
  ];
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link) return;
      const href = link.getAttribute("href") || "";
      const hit = CONTACT.find(([pattern]) => pattern.test(href));
      if (hit) track("contact", { method: hit[1], link_url: link.href });
    },
    { capture: true },
  );
  document.addEventListener("behavior:change", (event) => {
    const d = event.detail || {};
    if (d.behavior === "form" && d.success) track("generate_lead", { form_name: d.name || "" });
  });
  function context(root) {
    const abort = new AbortController(),
      cleanups = [],
      originals = new Map(),
      motions = new Map();
    const c = {
      message(key, values = {}) {
        const pattern =
          root.getAttribute("data-message-" + key) ?? messages[root.dataset.behavior]?.[key] ?? key;
        return pattern.replace(/\{([a-z]+)\}/g, (all, name) =>
          Object.hasOwn(values, name) ? String(values[name]) : all,
        );
      },
      root,
      signal: abort.signal,
      all: (selector) => owned(root, selector),
      one(selector) {
        const all = owned(root, selector);
        if (all.length !== 1) throw Error(`Expected exactly one ${selector}`);
        return all[0];
      },
      button(el) {
        if (el?.tagName !== "BUTTON") throw Error("Control must be a button");
        c.attr(el, "type", "button");
        return el;
      },
      save(el, name) {
        let attrs = originals.get(el);
        if (!attrs) originals.set(el, (attrs = new Map()));
        if (!attrs.has(name)) attrs.set(name, el.getAttribute(name));
      },
      attr(el, name, value) {
        if (name.startsWith("aria-") && typeof value === "boolean") value = String(value);
        c.save(el, name);
        if (value === null || value === false) el.removeAttribute(name);
        else el.setAttribute(name, value === true ? "" : String(value));
      },
      style(el, values) {
        c.save(el, "style");
        Object.assign(el.style, values);
      },
      id(el) {
        c.attr(el, "id", uid(el));
        return el.id;
      },
      show(el, show) {
        c.attr(el, "hidden", !show);
      },
      state(state) {
        c.attr(root, "data-state", state);
      },
      emit(detail) {
        if (!abort.signal.aborted)
          root.dispatchEvent(
            new CustomEvent("behavior:change", {
              bubbles: true,
              detail: { behavior: root.dataset.behavior, ...detail },
            }),
          );
      },
      on(el, event, fn, options = {}) {
        el.addEventListener(event, fn, { ...options, signal: abort.signal });
      },
      cleanup(fn) {
        cleanups.push(fn);
      },
      stop(el) {
        motions.get(el)?.cancel();
        motions.delete(el);
      },
      async animate(el, frames, kind = root.dataset.behavior) {
        c.stop(el);
        const css = getComputedStyle(el);
        const raw =
          css.getPropertyValue(`--${kind}-duration`).trim() ||
          css.getPropertyValue("--behavior-duration").trim() ||
          (kind === "disclosure" ? "280ms" : "200ms");
        const duration =
          reduced.matches || document.hidden
            ? 0
            : Math.max(0, parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000));
        if (!duration || !el.animate || abort.signal.aborted) return !abort.signal.aborted;
        const easing =
          css.getPropertyValue(`--${kind}-easing`).trim() ||
          css.getPropertyValue("--behavior-easing").trim() ||
          (kind === "disclosure" ? "cubic-bezier(.45,0,.55,1)" : "ease-out");
        let a;
        try {
          a = el.animate(frames, { duration, easing, fill: "both" });
        } catch {
          return true;
        }
        motions.set(el, a);
        try {
          await a.finished;
          return !abort.signal.aborted && motions.get(el) === a;
        } catch {
          return false;
        }
        // Caller settles its final DOM state before canceling the filled animation.
      },
      finishAnimations() {
        for (const a of motions.values())
          if (a.playState === "running" || a.playState === "paused") a.finish();
      },
      destroy() {
        abort.abort();
        for (const a of motions.values()) a.cancel();
        motions.clear();
        for (const fn of cleanups.reverse()) fn();
        for (const [el, attrs] of originals)
          for (const [name, value] of attrs)
            value === null ? el.removeAttribute(name) : el.setAttribute(name, value);
      },
    };
    return c;
  }
  function initOne(root) {
    if (instances.has(root)) return instances.get(root).api;
    const c = context(root);
    try {
      const setup = registry.get(root.dataset.behavior);
      if (!setup) throw Error(`Unknown behavior: ${root.dataset.behavior}`);
      const api = setup(c) || {};
      c.attr(root, "data-enhanced", "true");
      instances.set(root, { c, api });
      return api;
    } catch (error) {
      c.destroy();
      throw error;
    }
  }
  function roots(scope) {
    return [
      ...(scope.matches?.("[data-behavior]") ? [scope] : []),
      ...scope.querySelectorAll("[data-behavior]"),
    ];
  }
  function init(scope = document) {
    const errors = [];
    for (const root of roots(scope))
      try {
        initOne(root);
      } catch (error) {
        errors.push({ root, message: error.message });
        console.warn("[WPBehaviors]", error.message, root);
      }
    return errors;
  }
  function destroy(scope = document) {
    for (const root of roots(scope).reverse()) {
      const entry = instances.get(root);
      if (entry) {
        entry.c.destroy();
        instances.delete(root);
      }
    }
  }
  const define = (name, setup) => registry.set(name, setup);
  const api = {
    version: "0.5.0",
    init,
    destroy,
    get: (root) => instances.get(root)?.api,
    capabilities: () => [...registry.keys()],
  };
  window.WPBehaviors = api;
  reduced.addEventListener("change", () => {
    if (reduced.matches) for (const { c } of instances.values()) c.finishAnimations();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) for (const { c } of instances.values()) c.finishAnimations();
  });

  define("disclosure", (c) => {
    const button = c.button(c.one("[data-trigger]")),
      panel = c.one("[data-panel]");
    c.attr(button, "aria-controls", c.id(panel));
    const box = document.createElement("div");
    box.dataset.disclosureMotion = "";
    box.style.cssText = "display:flow-root;overflow:clip";
    panel.before(box);
    box.append(panel);
    c.cleanup(() => {
      box.before(panel);
      box.remove();
    });
    let open = false,
      revision = 0;
    const set = (value, animate = true, notify = true) => {
      const rev = ++revision,
        from = box.hidden ? 0 : box.getBoundingClientRect().height;
      c.stop(box);
      open = !!value;
      if (!open && panel.contains(document.activeElement)) button.focus();
      c.attr(panel, "inert", !open);
      c.attr(button, "aria-expanded", open);
      c.state(open ? "open" : "closed");
      if (!animate) {
        box.hidden = !open;
        c.show(panel, open);
      } else {
        box.hidden = false;
        c.show(panel, true);
        const to = open ? box.getBoundingClientRect().height : 0;
        c.animate(box, [
          { height: `${from}px`, minHeight: "0" },
          { height: `${to}px`, minHeight: "0" },
        ]).then((done) => {
          if (done && rev === revision) {
            box.hidden = !open;
            c.show(panel, open);
            c.stop(box);
          }
        });
      }
      if (notify) c.emit({ open });
    };
    set(button.getAttribute("aria-expanded") === "true", false, false);
    c.on(button, "click", () => set(!open));
    return {
      set,
      get open() {
        return open;
      },
    };
  });
  define("accordion", (c) => {
    const items = [...c.root.querySelectorAll("[data-behavior=disclosure]")].filter(
      (el) => el.parentElement.closest("[data-behavior=accordion]") === c.root,
    );
    if (!items.length) throw Error("Accordion requires disclosure children");
    const children = items.map(initOne);
    if (c.root.dataset.multiple !== "true") {
      let found = false;
      for (const child of children)
        if (child.open) {
          if (found) child.set(false, false, false);
          found = true;
        }
    }
    c.on(c.root, "behavior:change", (event) => {
      const i = items.indexOf(event.target);
      if (i < 0 || !event.detail.open || c.root.dataset.multiple === "true") return;
      children.forEach((child, j) => {
        if (j !== i && child.open) child.set(false, true, false);
      });
    });
    return { items: children };
  });

  const modal = (c, drawer = false) => {
    const dialog = c.one("dialog"),
      triggers = c.all("[data-dialog-open]"),
      closers = c.all("[data-dialog-close]");
    const label =
      dialog.getAttribute("aria-label") ||
      dialog
        .getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join("")
        .trim();
    if (!label || !triggers.length || !closers.length || typeof dialog.showModal !== "function")
      throw Error("Modal requires accessible name, open/close buttons and native dialog");
    [...triggers, ...closers].forEach(c.button);
    let opener,
      revision = 0,
      unlock,
      focusAfterClose;
    const frame = () => ({
      opacity: 0,
      transform: drawer
        ? c.root.dataset.side === "left"
          ? "translateX(-24px)"
          : "translateX(24px)"
        : "translateY(8px) scale(.98)",
    });
    const release = () => {
      unlock?.();
      unlock = null;
    };
    const close = () => {
      if (!dialog.open || c.root.dataset.state === "closing") return;
      const rev = ++revision,
        css = getComputedStyle(dialog);
      c.state("closing");
      c.animate(dialog, [{ opacity: css.opacity, transform: css.transform }, frame()]).then(
        (done) => {
          if (done && rev === revision && dialog.open) dialog.close();
        },
      );
    };
    const open = (source = triggers[0]) => {
      if (dialog.open) return;
      opener = source;
      focusAfterClose = null;
      const rev = ++revision;
      dialog.showModal();
      unlock = lockScroll();
      c.state("open");
      c.animate(dialog, [frame(), { opacity: 1, transform: "none" }]).then((done) => {
        if (done && rev === revision) c.stop(dialog);
      });
      c.emit({ open: true });
    };
    triggers.forEach((button) => {
      c.attr(button, "aria-haspopup", "dialog");
      c.attr(button, "aria-controls", c.id(dialog));
      c.on(button, "click", () => open(button));
    });
    closers.forEach((button) => c.on(button, "click", close));
    if (drawer)
      c.on(dialog, "click", (event) => {
        const link = event.target.closest("a[href]");
        if (
          !link ||
          event.defaultPrevented ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const url = new URL(link.href, location.href);
        if (url.origin === location.origin && url.pathname === location.pathname && url.hash) {
          try {
            focusAfterClose = document.getElementById(decodeURIComponent(url.hash.slice(1)));
          } catch {}
          if (focusAfterClose) c.attr(focusAfterClose, "tabindex", "-1");
        }
        close();
      });
    c.on(dialog, "cancel", (event) => {
      event.preventDefault();
      close();
    });
    c.on(dialog, "close", () => {
      ++revision;
      c.stop(dialog);
      c.state("closed");
      release();
      const target = focusAfterClose?.isConnected ? focusAfterClose : opener;
      if (target?.isConnected) target.focus({ preventScroll: true });
      c.emit({ open: false });
    });
    c.cleanup(() => {
      ++revision;
      if (dialog.open) dialog.close();
      release();
    });
    c.state("closed");
    return { open, close, dialog };
  };
  let scrollLocks = 0,
    oldOverflow = "";
  function lockScroll() {
    if (!scrollLocks++) {
      oldOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (!--scrollLocks) document.documentElement.style.overflow = oldOverflow;
    };
  }
  define("dialog", (c) => modal(c));
  define("drawer", (c) => modal(c, true));
  define("tabs", (c) => {
    const list = c.one("[data-tab-list]"),
      tabs = c.all("[data-tab]"),
      panels = c.all("[data-tab-panel]");
    if (!tabs.length || tabs.length !== panels.length || tabs.some((t) => !list.contains(t)))
      throw Error("Tabs require matching buttons and panels");
    tabs.forEach(c.button);
    const enabled = () => tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled().length) throw Error("Tabs need an enabled tab");
    const vertical = c.root.dataset.orientation === "vertical";
    c.attr(list, "role", "tablist");
    c.attr(list, "aria-orientation", vertical ? "vertical" : "horizontal");
    tabs.forEach((tab, i) => {
      c.attr(tab, "role", "tab");
      c.attr(tab, "aria-controls", c.id(panels[i]));
      c.attr(panels[i], "role", "tabpanel");
      c.attr(panels[i], "aria-labelledby", c.id(tab));
      c.attr(panels[i], "tabindex", "0");
    });
    let selected = -1,
      revision = 0;
    const select = (index, focus = false, notify = true) => {
      if (!enabled().includes(index)) return;
      if (panels[selected]?.contains(document.activeElement)) focus = true;
      const changed = selected !== index,
        rev = ++revision;
      selected = index;
      panels.forEach((p) => c.stop(p));
      tabs.forEach((tab, i) => {
        c.attr(tab, "aria-selected", String(i === index));
        c.attr(tab, "tabindex", i === index ? "0" : "-1");
        c.show(panels[i], i === index);
      });
      c.attr(c.root, "data-active-tab", index);
      if (focus) tabs[index].focus();
      if (notify && changed) {
        c.animate(panels[index], [
          { opacity: 0, transform: "translateY(5px)" },
          { opacity: 1, transform: "none" },
        ]).then((done) => {
          if (done && rev === revision) c.stop(panels[index]);
        });
        c.emit({ index });
      }
    };
    const initial = tabs.findIndex(
      (t) => t.getAttribute("aria-selected") === "true" && !t.disabled,
    );
    select(initial < 0 ? enabled()[0] : initial, false, false);
    tabs.forEach((tab, i) => {
      c.on(tab, "click", () => select(i));
      c.on(tab, "keydown", (event) => {
        const items = enabled(),
          at = items.indexOf(i),
          rtl = getComputedStyle(list).direction === "rtl";
        let target;
        const next = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight",
          prev = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
        if (event.key === next) target = items[(at + 1) % items.length];
        else if (event.key === prev) target = items[(at - 1 + items.length) % items.length];
        else if (event.key === "Home") target = items[0];
        else if (event.key === "End") target = items.at(-1);
        else return;
        event.preventDefault();
        select(target, true);
      });
    });
    return { select };
  });

  // Floating panels use fixed positioning, auto-flip and viewport clamping.
  const floating = (c, kind) => {
    const trigger =
        kind === "tooltip" ? c.one("[data-trigger]") : c.button(c.one("[data-trigger]")),
      panel = c.one("[data-panel]");
    let open = false,
      revision = 0,
      timer,
      raf = 0;
    const position = () => {
      if (!open) return;
      const r = trigger.getBoundingClientRect(),
        p = panel.getBoundingClientRect(),
        gap = 8,
        pad = 8;
      const below = innerHeight - r.bottom,
        above = r.top;
      const top =
        below >= p.height + gap || below >= above
          ? r.bottom + gap
          : Math.max(pad, r.top - p.height - gap);
      c.style(panel, {
        position: "fixed",
        left: `${Math.max(pad, Math.min(r.left, innerWidth - p.width - pad))}px`,
        top: `${Math.min(top, Math.max(pad, innerHeight - p.height - pad))}px`,
        maxWidth: `calc(100vw - ${pad * 2}px)`,
        maxHeight: `calc(100vh - ${pad * 2}px)`,
        overflowY: "auto",
        zIndex: "1000",
      });
    };
    const schedule = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          position();
        });
    };
    const items = () => focusable(panel);
    if (kind === "tooltip") {
      c.attr(panel, "role", "tooltip");
      const previous = trigger.getAttribute("aria-describedby");
      c.attr(trigger, "aria-describedby", [previous, c.id(panel)].filter(Boolean).join(" "));
    } else {
      c.attr(trigger, "aria-expanded", "false");
      c.attr(trigger, "aria-controls", c.id(panel));
    }
    if (kind === "dropdown") {
      c.attr(trigger, "aria-haspopup", "menu");
      c.attr(panel, "role", "menu");
      c.all("[data-menu-item]").forEach((item) => {
        c.attr(item, "role", "menuitem");
        c.attr(item, "tabindex", "-1");
      });
    }
    const set = (value, focus = false) => {
      clearTimeout(timer);
      if (open === value) return;
      open = value;
      const rev = ++revision;
      c.stop(panel);
      c.state(open ? "open" : "closed");
      if (kind !== "tooltip") c.attr(trigger, "aria-expanded", String(open));
      c.show(panel, open);
      if (open) {
        position();
        c.animate(panel, [
          { opacity: 0, transform: "translateY(-3px)" },
          { opacity: 1, transform: "none" },
        ]).then((done) => {
          if (done && rev === revision) c.stop(panel);
        });
        if (focus)
          (kind === "dropdown"
            ? c
                .all("[data-menu-item]")
                .find((e) => !e.disabled && e.getAttribute("aria-disabled") !== "true")
            : items()[0]
          )?.focus();
      }
      c.emit({ open });
    };
    c.show(panel, false);
    c.state("closed");
    if (kind === "tooltip") {
      c.on(trigger, "pointerenter", () => {
        timer = setTimeout(() => set(true), 300);
      });
      c.on(trigger, "pointerleave", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (document.activeElement !== trigger && !panel.matches(":hover")) set(false);
        }, 150);
      });
      c.on(panel, "pointerenter", () => clearTimeout(timer));
      c.on(panel, "pointerleave", () => {
        if (document.activeElement !== trigger) set(false);
      });
      c.on(trigger, "focus", () => set(true));
      c.on(trigger, "blur", () => {
        if (!trigger.matches(":hover") && !panel.matches(":hover")) set(false);
      });
    } else {
      c.on(trigger, "click", () => set(!open));
      c.on(trigger, "keydown", (e) => {
        if (kind === "dropdown" && ["ArrowDown", "ArrowUp"].includes(e.key)) {
          e.preventDefault();
          const enabled = c
            .all("[data-menu-item]")
            .filter((e) => !e.disabled && e.getAttribute("aria-disabled") !== "true");
          if (open) (e.key === "ArrowUp" ? enabled.at(-1) : enabled[0])?.focus();
          else {
            set(true, true);
            if (e.key === "ArrowUp") enabled.at(-1)?.focus();
          }
        }
      });
    }
    c.on(document, "pointerdown", (e) => {
      if (open && !c.root.contains(e.target)) set(false);
    });
    c.on(document, "keydown", (e) => {
      if (open && e.key === "Escape") {
        e.preventDefault();
        set(false);
        if (kind !== "tooltip") trigger.focus();
      }
    });
    // A press inside the root moves focus through the body on its way to the item (or never focuses a
    // button at all, in Safari): that is not leaving, and the click that follows decides.
    let pressing = false;
    c.on(c.root, "pointerdown", () => {
      pressing = true;
    });
    for (const end of ["pointerup", "pointercancel"])
      c.on(
        document,
        end,
        () => {
          pressing = false;
        },
        { capture: true },
      );
    c.on(c.root, "focusout", (e) => {
      if (pressing || (e.relatedTarget && c.root.contains(e.relatedTarget))) return;
      queueMicrotask(() => {
        if (
          !c.signal.aborted &&
          !pressing &&
          !c.root.contains(document.activeElement) &&
          !(kind === "tooltip" && (trigger.matches(":hover") || panel.matches(":hover")))
        )
          set(false);
      });
    });
    if (kind === "dropdown") {
      c.on(panel, "click", (e) => {
        const item = e.target.closest("[data-menu-item]");
        if (!item) return;
        if (item.disabled || item.getAttribute("aria-disabled") === "true") {
          e.preventDefault();
          return;
        }
        set(false);
        trigger.focus();
        c.emit({ selected: item.dataset.value || item.textContent.trim() });
      });
      c.on(panel, "keydown", (e) => {
        const all = c
            .all("[data-menu-item]")
            .filter((el) => !el.disabled && el.getAttribute("aria-disabled") !== "true"),
          i = all.indexOf(document.activeElement);
        let to;
        if (e.key === "ArrowDown") to = (i + 1) % all.length;
        else if (e.key === "ArrowUp") to = (i - 1 + all.length) % all.length;
        else if (e.key === "Home") to = 0;
        else if (e.key === "End") to = all.length - 1;
        else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          to = all.findIndex(
            (el, j) => j > i && el.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()),
          );
          if (to < 0)
            to = all.findIndex((el) =>
              el.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()),
            );
        } else return;
        if (to >= 0 && all[to]) {
          e.preventDefault();
          all[to].focus();
        }
      });
    }
    c.on(window, "resize", schedule);
    c.on(document, "scroll", schedule, { capture: true, passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    c.cleanup(() => {
      observer.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    });
    return { set };
  };
  for (const kind of ["dropdown", "popover", "tooltip"]) define(kind, (c) => floating(c, kind));
  define("toast", (c) => {
    const region = c.one("[data-toast-region]"),
      queue = [];
    let active,
      paused = false,
      timer,
      remaining = 0,
      started = 0,
      sequence = 0;
    c.attr(region, "aria-live", "polite");
    c.attr(region, "aria-atomic", "false");
    const arm = () => {
      clearTimeout(timer);
      if (!paused && active && remaining > 0) {
        started = performance.now();
        timer = setTimeout(dismiss, remaining);
      }
    };
    const pause = () => {
      if (paused) return;
      paused = true;
      if (timer) remaining = Math.max(1, remaining - (performance.now() - started));
      clearTimeout(timer);
    };
    const resume = () => {
      paused = false;
      arm();
    };
    const render = () => {
      if (active || !queue.length) return;
      active = queue.shift();
      remaining = active.duration;
      const item = document.createElement("div"),
        message = document.createElement("span"),
        close = document.createElement("button");
      item.dataset.toast = "";
      item.setAttribute("role", "status");
      message.textContent = active.message;
      close.type = "button";
      close.textContent = c.message("close");
      close.setAttribute("aria-label", c.message("close-label"));
      item.append(message, close);
      region.append(item);
      active.element = item;
      close.addEventListener("click", dismiss, { signal: c.signal });
      c.animate(item, [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "none" },
      ]).then((done) => {
        if (done) c.stop(item);
      });
      arm();
      c.emit({ state: "shown", id: active.id });
    };
    function dismiss() {
      if (!active) return;
      clearTimeout(timer);
      const previous = active;
      active = null;
      const focus = previous.element.contains(document.activeElement);
      c.stop(previous.element);
      previous.element.remove();
      c.emit({ state: "dismissed", id: previous.id });
      render();
      if (focus)
        (active?.element.querySelector("button") || c.all("[data-toast-trigger]")[0])?.focus();
    }
    const notify = (message, duration = number(c.root.dataset.duration, 4500)) => {
      if (typeof message !== "string" || !message.trim()) return;
      const id = ++sequence;
      queue.push({ id, message, duration: Math.max(0, duration) });
      render();
      return id;
    };
    c.all("[data-toast-trigger]").forEach((button) => {
      c.button(button);
      c.on(button, "click", () => notify(button.dataset.message || c.message("success")));
    });
    c.on(document, "visibilitychange", () => {
      if (document.hidden) pause();
      else if (!region.matches(":hover") && !region.contains(document.activeElement)) resume();
    });
    c.on(region, "pointerenter", pause);
    c.on(region, "pointerleave", () => {
      if (!region.contains(document.activeElement)) resume();
    });
    c.on(region, "focusin", pause);
    c.on(region, "focusout", () =>
      queueMicrotask(() => {
        if (!c.signal.aborted && !region.contains(document.activeElement)) resume();
      }),
    );
    c.cleanup(() => {
      clearTimeout(timer);
      active?.element.remove();
      queue.length = 0;
    });
    return { notify, dismiss };
  });
  define("carousel", (c) => {
    const slides = c.all("[data-slide]"),
      previous = c.button(c.one("[data-prev]")),
      next = c.button(c.one("[data-next]")),
      dots = c.all("[data-slide-to]"),
      status = c.one("[data-carousel-status]");
    if (!slides.length) throw Error("Carousel requires slides");
    c.style(c.root, { touchAction: "pan-y" });
    let index = 0,
      revision = 0,
      timer,
      startX,
      paused = true;
    c.attr(c.root, "role", "region");
    c.attr(c.root, "aria-roledescription", "carousel");
    c.attr(status, "aria-live", "polite");
    slides.forEach((slide, i) => {
      c.attr(slide, "role", "group");
      c.attr(slide, "aria-roledescription", "slide");
      c.attr(slide, "aria-label", `${i + 1} / ${slides.length}`);
    });
    dots.forEach(c.button);
    const select = (value, notify = true) => {
      const target = (value + slides.length) % slides.length,
        changed = target !== index;
      const hadFocus = slides[index]?.contains(document.activeElement);
      index = target;
      const rev = ++revision;
      slides.forEach((slide, i) => {
        c.stop(slide);
        c.show(slide, i === index);
        c.attr(slide, "inert", i !== index);
      });
      dots.forEach((button, i) => {
        c.attr(button, "aria-current", i === index ? "true" : null);
        c.attr(button, "aria-label", c.message("slide-label", { index: i + 1 }));
      });
      c.attr(c.root, "data-index", index);
      text(status, c.message("position", { index: index + 1, count: slides.length }));
      if (hadFocus) next.focus();
      if (notify && changed) {
        c.animate(slides[index], [{ opacity: 0 }, { opacity: 1 }]).then((done) => {
          if (done && rev === revision) c.stop(slides[index]);
        });
        c.emit({ index });
      }
    };
    const syncPlay = () =>
      c.all("[data-carousel-play]").forEach((b) => c.attr(b, "aria-pressed", String(!paused)));
    const pause = () => {
      paused = true;
      clearInterval(timer);
      syncPlay();
    };
    const play = () => {
      pause();
      if (reduced.matches) return;
      paused = false;
      syncPlay();
      timer = setInterval(
        () => select(index + 1),
        Math.max(1500, number(c.root.dataset.interval, 5000)),
      );
    };
    c.on(previous, "click", () => {
      pause();
      select(index - 1);
    });
    c.on(next, "click", () => {
      pause();
      select(index + 1);
    });
    dots.forEach((button, i) =>
      c.on(button, "click", () => {
        pause();
        select(i);
      }),
    );
    c.on(c.root, "keydown", (e) => {
      if (e.target.closest("input,textarea,select") || !["ArrowLeft", "ArrowRight"].includes(e.key))
        return;
      e.preventDefault();
      pause();
      const direction = getComputedStyle(c.root).direction === "rtl" ? -1 : 1;
      select(index + (e.key === "ArrowRight" ? direction : -direction));
    });
    c.on(c.root, "pointerdown", (e) => {
      if (e.pointerType !== "mouse" && !e.target.closest("button,a,input"))
        startX = { x: e.clientX, y: e.clientY };
    });
    c.on(c.root, "pointerup", (e) => {
      if (!startX) return;
      const dx = e.clientX - startX.x,
        dy = e.clientY - startX.y;
      startX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        pause();
        select(index + (dx < 0 ? 1 : -1));
      }
    });
    c.on(c.root, "pointercancel", () => {
      startX = null;
    });
    c.on(c.root, "pointerenter", pause);
    c.on(c.root, "focusin", pause);
    c.on(document, "visibilitychange", () => {
      if (document.hidden) pause();
    });
    c.on(reduced, "change", () => {
      if (reduced.matches) pause();
    });
    const playButton = c.all("[data-carousel-play]")[0];
    if (playButton) {
      c.button(playButton);
      c.on(playButton, "click", () => {
        paused ? play() : pause();
        c.attr(playButton, "aria-pressed", String(!paused));
      });
    }
    if (c.root.dataset.autoplay === "true" && !playButton)
      throw Error("Autoplay requires an explicit play/pause button");
    c.cleanup(pause);
    select(0, false);
    if (c.root.dataset.autoplay === "true") play();
    return {
      select,
      pause,
      play,
      get index() {
        return index;
      },
    };
  });
  define("gallery", (c) => {
    const thumbnails = c.all("[data-gallery-item]"),
      dialog = c.one("dialog"),
      image = c.one("[data-gallery-image]"),
      caption = c.one("[data-gallery-caption]"),
      previous = c.button(c.one("[data-gallery-prev]")),
      next = c.button(c.one("[data-gallery-next]")),
      closeButton = c.button(c.one("[data-gallery-close]"));
    if (!thumbnails.length || !dialog.getAttribute("aria-label"))
      throw Error("Gallery needs images and named dialog");
    let index = 0,
      opener,
      unlock,
      revision = 0;
    c.save(image, "src");
    c.save(image, "alt");
    const show = (value) => {
      index = (value + thumbnails.length) % thumbnails.length;
      const item = thumbnails[index];
      const url = new URL(item.dataset.src || item.getAttribute("href"), location.href);
      if (!["http:", "https:", "file:"].includes(url.protocol))
        throw Error("Unsupported image URL");
      c.attr(image, "src", url.href);
      c.attr(image, "alt", item.dataset.alt || item.querySelector("img")?.alt || "");
      text(caption, `${index + 1} / ${thumbnails.length} · ${item.dataset.caption || image.alt}`);
      c.state("loading");
      c.emit({ index });
    };
    const dismiss = () => {
      if (!dialog.open || c.root.dataset.state === "closing") return;
      const rev = ++revision;
      c.state("closing");
      c.animate(dialog, [{ opacity: getComputedStyle(dialog).opacity }, { opacity: 0 }]).then(
        (done) => {
          if (done && rev === revision) dialog.close();
        },
      );
    };
    thumbnails.forEach((item, i) =>
      c.on(item, "click", (e) => {
        e.preventDefault();
        opener = item;
        show(i);
        if (!dialog.open) {
          dialog.showModal();
          unlock = lockScroll();
        }
        const rev = ++revision;
        c.animate(dialog, [
          { opacity: 0, transform: "scale(.98)" },
          { opacity: 1, transform: "none" },
        ]).then((done) => {
          if (done && rev === revision) c.stop(dialog);
        });
      }),
    );
    c.on(image, "load", () => {
      if (c.root.dataset.state !== "closing") c.state("ready");
    });
    c.on(image, "error", () => {
      if (c.root.dataset.state !== "closing") {
        c.state("error");
        text(caption, c.message("image-error"));
      }
    });
    c.on(previous, "click", () => show(index - 1));
    c.on(next, "click", () => show(index + 1));
    c.on(closeButton, "click", dismiss);
    c.on(dialog, "cancel", (e) => {
      e.preventDefault();
      dismiss();
    });
    c.on(dialog, "keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        show(index + (e.key === "ArrowRight" ? 1 : -1));
      }
    });
    c.on(dialog, "close", () => {
      ++revision;
      c.stop(dialog);
      unlock?.();
      unlock = null;
      c.state("closed");
      if (opener?.isConnected) opener.focus();
    });
    c.cleanup(() => {
      ++revision;
      if (dialog.open) dialog.close();
      unlock?.();
    });
    return { show, close: dismiss };
  });
  const scrollEffect = (c, fn) => {
    let frame;
    const update = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          fn();
        });
    };
    c.on(window, "scroll", update, { passive: true });
    c.on(window, "resize", update);
    c.cleanup(() => cancelAnimationFrame(frame));
    fn();
    return update;
  };
  define("sticky-header", (c) => {
    let last = Math.max(0, scrollY),
      travel = 0;
    const threshold = number(c.root.dataset.threshold, 80);
    scrollEffect(c, () => {
      const y = Math.max(0, scrollY),
        delta = y - last,
        focused = c.root.contains(document.activeElement);
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      c.attr(c.root, "data-scrolled", String(y > threshold));
      if (y <= threshold || focused || travel < -4) c.state("visible");
      else if (travel > 4) c.state("hidden");
      last = y;
    });
    c.on(c.root, "focusin", () => c.state("visible"));
    return {};
  });
  define("scrollspy", (c) => {
    const links = c.all('a[href^="#"]');
    const targets = links.map((link) =>
      document.getElementById(decodeURIComponent(link.hash.slice(1))),
    );
    if (!links.length || targets.some((t) => !t))
      throw Error("Scrollspy links must target existing section IDs");
    const update = scrollEffect(c, () => {
      const offset = number(c.root.dataset.offset, 100);
      let index = 0;
      targets.forEach((target, i) => {
        if (target.getBoundingClientRect().top <= offset) index = i;
      });
      links.forEach((link, i) => c.attr(link, "aria-current", i === index ? "location" : null));
    });
    c.on(window, "hashchange", update);
    return { update };
  });
  define("back-to-top", (c) => {
    const button = c.button(c.one("[data-trigger]"));
    scrollEffect(c, () => {
      const show = scrollY > number(c.root.dataset.threshold, 300);
      if (!show && button === document.activeElement) return;
      c.show(button, show);
    });
    c.on(button, "click", () => {
      window.scrollTo({ top: 0, behavior: reduced.matches ? "instant" : "smooth" });
      const target = document.getElementById(c.root.dataset.target || "");
      if (target) {
        c.attr(target, "tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    });
    return {};
  });
  define("filter-sort", (c) => {
    const search = c.all("[data-filter-search]")[0],
      selects = c.all("[data-filter]"),
      sort = c.all("[data-sort]")[0],
      list = c.one("[data-filter-list]"),
      items = c.all("[data-filter-item]"),
      count = c.one("[data-filter-count]"),
      empty = c.one("[data-filter-empty]"),
      reset = c.button(c.one("[data-filter-reset]"));
    const prefix = c.root.dataset.queryPrefix || c.root.id || "filter";
    if (c.root.dataset.syncUrl === "true" && !c.root.id && !c.root.dataset.queryPrefix)
      throw Error("URL filters require stable id or data-query-prefix");
    const saved = [...list.childNodes];
    c.cleanup(() => list.replaceChildren(...saved));
    c.attr(count, "role", "status");
    function apply(sync = true) {
      const query = (search?.value || "").toLocaleLowerCase().trim();
      let visible = 0;
      const direction = sort?.value || "original";
      const ordered = [...items].sort((a, b) => {
        if (direction === "original") return items.indexOf(a) - items.indexOf(b);
        if (direction.startsWith("number")) {
          const x = number(a.dataset.sortValue, NaN),
            y = number(b.dataset.sortValue, NaN);
          if (!Number.isFinite(x)) return Number.isFinite(y) ? 1 : 0;
          if (!Number.isFinite(y)) return -1;
          return (x - y) * (direction.endsWith("-desc") ? -1 : 1);
        }
        return (
          (a.dataset.label || a.textContent).localeCompare(b.dataset.label || b.textContent) *
          (direction.endsWith("-desc") ? -1 : 1)
        );
      });
      ordered.forEach((item) => {
        const matches =
          (!query ||
            (item.dataset.search || item.textContent).toLocaleLowerCase().includes(query)) &&
          selects.every(
            (select) =>
              !select.value ||
              (item.getAttribute(`data-${select.dataset.filter}`) || "")
                .split(",")
                .includes(select.value),
          );
        c.show(item, matches);
        if (matches) visible++;
        list.append(item);
      });
      text(count, `${visible} / ${items.length}`);
      c.show(empty, visible === 0);
      if (sync && c.root.dataset.syncUrl === "true" && location.protocol !== "file:") {
        const url = new URL(location.href);
        const put = (k, v) =>
          v ? url.searchParams.set(`${prefix}.${k}`, v) : url.searchParams.delete(`${prefix}.${k}`);
        put("q", search?.value || "");
        selects.forEach((s) => put(s.dataset.filter, s.value));
        put("sort", sort?.value === "original" ? "" : sort?.value || "");
        history.replaceState(null, "", url);
      }
      c.emit({ count: visible });
    }
    function restore() {
      const params = new URL(location.href).searchParams;
      if (search) search.value = params.get(`${prefix}.q`) || "";
      selects.forEach((s) => {
        s.value = params.get(`${prefix}.${s.dataset.filter}`) || "";
      });
      if (sort) sort.value = params.get(`${prefix}.sort`) || "original";
      apply(false);
    }
    if (search) c.on(search, "input", () => apply());
    [...selects, ...(sort ? [sort] : [])].forEach((s) => c.on(s, "change", () => apply()));
    c.on(reset, "click", () => {
      if (search) search.value = "";
      selects.forEach((s) => (s.value = ""));
      if (sort) sort.value = "original";
      apply();
    });
    if (c.root.dataset.syncUrl === "true") {
      c.on(window, "popstate", restore);
      restore();
    } else apply(false);
    return { apply };
  });
  define("combobox", (c) => {
    const input = c.one("[data-combobox-input]"),
      list = c.one("[data-combobox-list]"),
      options = c.all("[data-option]"),
      value = c.one("[data-combobox-value]"),
      empty = c.one("[data-combobox-empty]");
    if (input.tagName !== "INPUT" || value.tagName !== "INPUT")
      throw Error("Combobox requires text and hidden inputs");
    c.attr(input, "role", "combobox");
    c.attr(input, "aria-autocomplete", "list");
    c.attr(input, "aria-controls", c.id(list));
    c.attr(input, "autocomplete", "off");
    c.attr(list, "role", "listbox");
    options.forEach((option) => {
      c.attr(option, "role", "option");
      c.attr(option, "aria-selected", "false");
      c.id(option);
    });
    let visible = [],
      active = -1,
      open = false;
    const oldValidity = input.validity.customError ? input.validationMessage : "";
    const validate = () =>
      input.setCustomValidity(input.required && !value.value ? c.message("required") : "");
    c.cleanup(() => input.setCustomValidity(oldValidity));
    validate();
    const setActive = (i) => {
      active = i;
      c.attr(input, "aria-activedescendant", visible[i]?.id || null);
      options.forEach((o) => c.attr(o, "data-active", o === visible[i] ? "true" : null));
      visible[i]?.scrollIntoView({ block: "nearest" });
    };
    const setOpen = (state) => {
      open = state;
      c.show(list, state);
      c.attr(input, "aria-expanded", String(state));
      if (!state) setActive(-1);
    };
    const filter = () => {
      const q = input.value.trim().toLocaleLowerCase();
      visible = options.filter(
        (o) => !o.hasAttribute("data-disabled") && o.textContent.toLocaleLowerCase().includes(q),
      );
      options.forEach((o) => c.show(o, visible.includes(o)));
      c.show(empty, !visible.length);
      setActive(-1);
      setOpen(true);
    };
    const choose = (option) => {
      if (!option) return;
      input.value = option.textContent.trim();
      value.value = option.dataset.value || input.value;
      validate();
      options.forEach((o) => c.attr(o, "aria-selected", String(o === option)));
      setOpen(false);
      input.focus();
      value.dispatchEvent(new Event("change", { bubbles: true }));
      c.emit({ value: value.value });
    };
    c.on(input, "input", () => {
      value.value = "";
      validate();
      options.forEach((o) => c.attr(o, "aria-selected", "false"));
      filter();
    });
    c.on(input, "focus", filter);
    c.on(input, "keydown", (e) => {
      if (e.isComposing) return;
      if (["ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        if (!open) filter();
        if (visible.length)
          setActive((active + (e.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length);
      } else if (e.key === "Enter" && open && active >= 0) {
        e.preventDefault();
        choose(visible[active]);
      } else if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === "Tab") setOpen(false);
    });
    c.on(list, "pointerdown", (e) => {
      if (e.target.closest("[data-option]")) e.preventDefault();
    });
    c.on(list, "click", (e) => {
      const option = e.target.closest("[data-option]");
      if (visible.includes(option)) choose(option);
    });
    c.on(document, "pointerdown", (e) => {
      if (!c.root.contains(e.target)) setOpen(false);
    });
    c.on(input, "blur", () => setOpen(false));
    if (input.form)
      c.on(input.form, "reset", () =>
        queueMicrotask(() => {
          if (!c.signal.aborted) {
            options.forEach((o) =>
              c.attr(
                o,
                "aria-selected",
                String((o.dataset.value || o.textContent.trim()) === value.value),
              ),
            );
            validate();
            setOpen(false);
          }
        }),
      );
    setOpen(false);
    return { choose };
  });
  define("load-more", (c) => {
    const button = c.button(c.one("[data-load-more]")),
      list = c.one("[data-results]"),
      template = c.one("template"),
      status = c.one("[data-status]");
    let cursor = c.root.dataset.cursor || "1",
      busy = false,
      finished = false;
    const seen = new Set(),
      created = [];
    c.attr(status, "role", "status");
    c.cleanup(() => created.forEach((node) => node.remove()));
    const load = async () => {
      if (busy || finished) return;
      busy = true;
      c.attr(button, "disabled", true);
      c.attr(list, "aria-busy", "true");
      c.state("loading");
      text(status, c.message("loading"));
      try {
        const url = endpoint(c.root.dataset.endpoint);
        url.searchParams.set("cursor", cursor);
        const data = await request(url, { signal: c.signal });
        if (c.signal.aborted) return;
        if (
          !Array.isArray(data.items) ||
          !(data.next === null || typeof data.next === "string" || typeof data.next === "number")
        )
          throw Error("Expected {items:[], next:string|number|null}");
        if (data.next !== null && String(data.next) === cursor)
          throw Error("Server returned a repeated cursor");
        const fragment = document.createDocumentFragment(),
          newIds = [];
        let added = 0;
        for (const item of data.items) {
          if (
            !item ||
            typeof item !== "object" ||
            (typeof item.id !== "string" && typeof item.id !== "number")
          )
            throw Error("Every item requires an id");
          if (seen.has(String(item.id)) || newIds.includes(String(item.id))) continue;
          const clone = template.content.cloneNode(true);
          clone
            .querySelectorAll("[data-bind]")
            .forEach((el) => text(el, item[el.dataset.bind] ?? ""));
          clone.querySelectorAll("[data-bind-href],[data-bind-src]").forEach((el) => {
            const attribute = el.hasAttribute("data-bind-href") ? "href" : "src",
              key = el.getAttribute(`data-bind-${attribute}`);
            const raw = item[key];
            if (raw) {
              const url = new URL(raw, location.href);
              if (!["http:", "https:"].includes(url.protocol)) throw Error("Unsafe item URL");
              el.setAttribute(attribute, url.href);
            }
          });
          newIds.push(String(item.id));
          fragment.append(clone);
          added++;
        }
        const nodes = [...fragment.childNodes];
        list.append(fragment);
        created.push(...nodes);
        newIds.forEach((id) => seen.add(id));
        cursor = String(data.next ?? "");
        finished = data.next === null;
        c.show(button, !finished);
        c.state(finished ? "complete" : "ready");
        text(
          status,
          added
            ? c.message(finished ? "loaded-complete" : "loaded", { count: added })
            : c.message(finished ? "complete" : "empty-page"),
        );
        if (finished && document.activeElement === button) {
          c.attr(status, "tabindex", "-1");
          status.focus();
        }
        c.emit({ added, complete: finished });
      } catch (error) {
        if (!c.signal.aborted) {
          c.state("error");
          text(status, c.message("error", { error: error.message }));
          c.emit({ error: error.message });
        }
      } finally {
        busy = false;
        if (!c.signal.aborted) {
          c.attr(button, "disabled", false);
          c.attr(list, "aria-busy", "false");
        }
      }
    };
    c.on(button, "click", load);
    return { load };
  });
  define("form", (c) => {
    const form = c.root.tagName === "FORM" ? c.root : c.one("form"),
      status = c.one("[data-status]");
    if (form.tagName !== "FORM") throw Error("Form behavior requires a form");
    c.attr(form, "novalidate", true);
    c.attr(status, "role", "status");
    let busy = false,
      key,
      lastPayload;
    const name = c.root.dataset.name || form.getAttribute("name") || form.id || "";
    // Optional: a <progress data-progress> the form fills while a file goes up.
    const bar = c.all("progress[data-progress]")[0] || null;
    if (bar) {
      c.attr(bar, "max", "100");
      c.attr(bar, "value", "0");
      c.show(bar, false);
    }
    const show = (percent) => {
      c.root.style.setProperty("--form-progress", String(percent / 100));
      if (bar) {
        c.show(bar, true);
        bar.value = percent;
      }
      text(status, c.message("uploading", { percent }));
    };
    // A field the server refused carries its sentence until it is edited.
    const refused = new Set();
    const clear = () => {
      for (const el of refused) {
        el.setCustomValidity("");
        c.attr(el, "aria-invalid", false);
      }
      refused.clear();
    };
    c.on(form, "input", (e) => {
      if (refused.has(e.target)) {
        e.target.setCustomValidity("");
        c.attr(e.target, "aria-invalid", false);
        refused.delete(e.target);
      }
    });
    const submit = async (event) => {
      event?.preventDefault();
      if (busy) return;
      clear();
      if (!form.reportValidity()) {
        text(status, c.message("invalid"));
        c.state("invalid");
        return;
      }
      const body = new FormData(form, event?.submitter);
      if (c.root.dataset.attribution === "true")
        body.set("_attribution", JSON.stringify(attribution()));
      const signature = JSON.stringify(
        [...body.entries()].map(([k, v]) => [
          k,
          typeof v === "string" ? v : `${v.name}:${v.size}:${v.lastModified}`,
        ]),
      );
      if (signature !== lastPayload || !key) {
        key = crypto.randomUUID();
        lastPayload = signature;
      }
      const buttons = [
          ...form.querySelectorAll("button[type=submit],input[type=submit],button:not([type])"),
        ],
        disabled = buttons.map((b) => b.disabled);
      buttons.forEach((b) => c.attr(b, "disabled", true));
      busy = true;
      c.attr(form, "aria-busy", "true");
      c.state("submitting");
      text(status, c.message("submitting"));
      let next = null;
      try {
        const url = c.root.dataset.endpoint || form.getAttribute("action");
        if (!url) throw Error("Missing form endpoint");
        const headers = {
          "Idempotency-Key": key,
          ...(c.root.dataset.nonce ? { "X-WP-Nonce": c.root.dataset.nonce } : {}),
        };
        // A form carrying a file reports its upload; one without keeps fetch.
        const files = [...body.values()].some((v) => typeof v !== "string" && v.size > 0);
        const data = files
          ? await watched(url, {
              body,
              headers,
              signal: c.signal,
              progress: (loaded, total) => show(Math.min(100, Math.round((loaded / total) * 100))),
            })
          : await request(url, { method: "POST", body, signal: c.signal, headers });
        if (c.signal.aborted) return;
        if (data.ok !== true) throw Error(data.message || "Server did not confirm success");
        c.state("success");
        text(status, data.message || c.message("success"));
        c.emit({ success: true, id: data.id ?? null, name });
        key = null;
        if (c.root.dataset.reset === "true") form.reset();
        const to = c.root.dataset.successUrl;
        if (to) {
          const target = new URL(to, location.href);
          if (["http:", "https:"].includes(target.protocol)) next = target.href;
        }
      } catch (error) {
        if (!c.signal.aborted) {
          const fields = error.data?.fields;
          let first = null;
          if (fields && typeof fields === "object")
            for (const [field, sentence] of Object.entries(fields)) {
              const el = form.elements.namedItem(field) ?? form.elements.namedItem(field + "[]");
              const one = el instanceof RadioNodeList ? el[0] : el;
              if (one && "setCustomValidity" in one) {
                one.setCustomValidity(String(sentence));
                c.attr(one, "aria-invalid", true);
                refused.add(one);
                first ??= one;
              }
            }
          c.state("error");
          text(status, c.message("error", { error: error.message }));
          c.emit({ error: error.message, name });
          first?.reportValidity();
        }
      } finally {
        busy = false;
        if (!c.signal.aborted) {
          buttons.forEach((b, i) => c.attr(b, "disabled", disabled[i]));
          c.attr(form, "aria-busy", "false");
          if (bar) c.show(bar, false);
          c.root.style.removeProperty("--form-progress");
        }
      }
      // After the event, so a listener (analytics) has run before the page changes.
      if (next && !c.signal.aborted) location.assign(next);
    };
    c.on(form, "submit", submit);
    c.cleanup(clear);
    c.cleanup(() => c.root.style.removeProperty("--form-progress"));
    return { submit: () => submit() };
  });
  define("file-upload", (c) => {
    const input = c.one("input[type=file]"),
      drop = c.one("[data-dropzone]"),
      list = c.one("[data-file-list]"),
      button = c.button(c.one("[data-upload]")),
      cancel = c.button(c.one("[data-upload-cancel]")),
      progress = c.one("progress"),
      status = c.one("[data-status]");
    const maxSize = number(c.root.dataset.maxBytes, 10 * 1024 * 1024),
      maxFiles = number(c.root.dataset.maxFiles, 5);
    let files = [],
      xhr,
      key,
      lastSignature,
      busy = false;
    c.attr(status, "role", "status");
    c.attr(progress, "max", "100");
    const accept = (file) =>
      !input.accept ||
      input.accept.split(",").some((raw) => {
        const rule = raw.trim().toLowerCase();
        return rule.startsWith(".")
          ? file.name.toLowerCase().endsWith(rule)
          : rule.endsWith("/*")
            ? file.type.toLowerCase().startsWith(rule.slice(0, -1))
            : file.type.toLowerCase() === rule;
      });
    const render = () => {
      list.replaceChildren(
        ...files.map((file, i) => {
          const row = document.createElement("li"),
            remove = document.createElement("button");
          row.append(
            document.createTextNode(
              c.message("file-label", { name: file.name, size: file.size }) + " ",
            ),
          );
          remove.type = "button";
          remove.textContent = c.message("remove");
          remove.dataset.remove = String(i);
          remove.disabled = busy;
          row.append(remove);
          return row;
        }),
      );
      c.attr(button, "disabled", busy || !files.length);
      c.attr(cancel, "disabled", !busy);
    };
    const add = (selection) => {
      if (busy) return;
      const next = [...files];
      for (const file of selection) {
        if (file.size > maxSize || !accept(file)) {
          c.state("invalid");
          text(status, c.message("invalid-file", { name: file.name }));
          input.value = "";
          return;
        }
        if (
          !next.some(
            (f) =>
              f.name === file.name && f.size === file.size && f.lastModified === file.lastModified,
          )
        )
          next.push(file);
      }
      if (next.length > maxFiles) {
        text(status, c.message("max-files", { count: maxFiles }));
        c.state("invalid");
        input.value = "";
        return;
      }
      files = next;
      input.value = "";
      c.state("ready");
      text(status, c.message("selected", { count: files.length }));
      render();
    };
    const upload = () => {
      if (busy || !files.length) return;
      let url;
      try {
        url = endpoint(c.root.dataset.endpoint);
      } catch (error) {
        text(status, c.message("error", { error: error.message }));
        c.state("error");
        return;
      }
      const signature = JSON.stringify(files.map((f) => [f.name, f.size, f.lastModified]));
      if (signature !== lastSignature || !key) {
        key = crypto.randomUUID();
        lastSignature = signature;
      }
      busy = true;
      c.attr(input, "disabled", true);
      c.state("uploading");
      text(status, c.message("uploading"));
      progress.value = 0;
      render();
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Idempotency-Key", key);
      if (c.root.dataset.nonce) xhr.setRequestHeader("X-WP-Nonce", c.root.dataset.nonce);
      xhr.timeout = 30000;
      const settle = (state, message) => {
        if (c.signal.aborted) return;
        busy = false;
        c.attr(input, "disabled", false);
        c.state(state);
        text(status, message);
        render();
      };
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && !c.signal.aborted)
          progress.value = (event.loaded / event.total) * 100;
      };
      xhr.onload = () => {
        if (c.signal.aborted) return;
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status < 200 || xhr.status >= 300 || data.ok !== true)
            throw Error(data.message || `HTTP ${xhr.status}`);
          key = null;
          files = [];
          progress.value = 100;
          settle("success", data.message || c.message("success"));
          c.emit({ success: true, files: data.files || [] });
        } catch (error) {
          settle("error", c.message("error", { error: error.message }));
        }
      };
      xhr.onerror = () => settle("error", c.message("network-error"));
      xhr.ontimeout = () => settle("error", c.message("timeout"));
      xhr.onabort = () => settle("cancelled", c.message("cancelled"));
      xhr.send(body);
    };
    c.on(input, "change", () => add(input.files));
    c.on(drop, "dragover", (e) => {
      e.preventDefault();
      if (!busy) c.attr(drop, "data-dragging", "true");
    });
    c.on(drop, "dragleave", () => c.attr(drop, "data-dragging", null));
    c.on(drop, "drop", (e) => {
      e.preventDefault();
      c.attr(drop, "data-dragging", null);
      add(e.dataTransfer.files);
    });
    c.on(list, "click", (e) => {
      const remove = e.target.closest("[data-remove]");
      if (remove && !busy) {
        files.splice(Number(remove.dataset.remove), 1);
        render();
      }
    });
    c.on(button, "click", upload);
    c.on(cancel, "click", () => xhr?.abort());
    c.cleanup(() => {
      xhr?.abort();
      list.replaceChildren();
    });
    render();
    return { add, upload, cancel: () => xhr?.abort() };
  });
  define("stepper", (c) => {
    const steps = c.all("[data-step]"),
      previous = c.button(c.one("[data-step-prev]")),
      next = c.button(c.one("[data-step-next]")),
      status = c.one("[data-step-status]");
    if (!steps.length) throw Error("Stepper needs steps");
    let index = 0;
    c.attr(status, "role", "status");
    const go = (value, validate = true) => {
      if (value < 0 || value >= steps.length) return false;
      if (validate && value > index) {
        for (const field of steps[index].querySelectorAll("input,select,textarea"))
          if (!field.disabled && !field.checkValidity()) {
            field.reportValidity();
            text(status, c.message("invalid"));
            return false;
          }
      }
      const focus = steps[index].contains(document.activeElement);
      index = value;
      steps.forEach((step, i) => {
        c.show(step, i === index);
        c.attr(step, "aria-current", i === index ? "step" : null);
      });
      c.attr(previous, "disabled", index === 0);
      c.show(next, index < steps.length - 1);
      text(status, `${index + 1} / ${steps.length}`);
      if (focus || validate) {
        const heading = steps[index].querySelector("h2,h3,h4");
        if (heading) {
          c.attr(heading, "tabindex", "-1");
          heading.focus();
        } else focusable(steps[index])[0]?.focus();
      }
      c.emit({ index });
      return true;
    };
    c.on(previous, "click", () => go(index - 1, false));
    c.on(next, "click", () => go(index + 1));
    go(0, false);
    return {
      go,
      get index() {
        return index;
      },
    };
  });
  define("copy", (c) => {
    const button = c.button(c.one("[data-copy]")),
      status = c.one("[data-status]");
    c.attr(status, "role", "status");
    let busy = false;
    c.on(button, "click", async () => {
      if (busy) return;
      const target = button.dataset.target ? document.getElementById(button.dataset.target) : null;
      const value =
        button.dataset.copy ||
        (target ? ("value" in target ? target.value : target.textContent) : "");
      if (!value) {
        text(status, c.message("empty"));
        return;
      }
      busy = true;
      try {
        if (!navigator.clipboard?.writeText) throw Error(c.message("unavailable"));
        await navigator.clipboard.writeText(value);
        if (!c.signal.aborted) {
          text(status, c.message("success"));
          c.emit({ success: true });
        }
      } catch (error) {
        if (!c.signal.aborted) {
          text(status, c.message("error", { error: error.message }));
          c.emit({ success: false });
        }
      } finally {
        busy = false;
      }
    });
    return {};
  });
  define("count-up", (c) => {
    const output = c.one("[data-count]"),
      target = number(output.dataset.count, NaN);
    if (!Number.isFinite(target)) throw Error("Count target must be finite");
    const from = number(output.dataset.from, 0),
      duration = Math.max(0, number(c.root.dataset.duration, 1000)),
      decimals = Math.max(0, Math.min(6, number(output.dataset.decimals, 0)));
    let frame,
      done = false,
      started;
    const original = output.textContent;
    c.cleanup(() => {
      cancelAnimationFrame(frame);
      output.textContent = original;
    });
    const format = (value) =>
      new Intl.NumberFormat(document.documentElement.lang || undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
    const finish = () => {
      done = true;
      cancelAnimationFrame(frame);
      text(output, format(target));
    };
    const start = () => {
      if (done || started !== undefined) return;
      if (reduced.matches || !duration) {
        finish();
        return;
      }
      started = performance.now();
      const tick = (now) => {
        const progress = Math.min(1, (now - started) / duration);
        text(output, format(from + (target - from) * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
        else finish();
      };
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          start();
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(output);
    c.cleanup(() => observer.disconnect());
    c.on(reduced, "change", () => {
      if (reduced.matches) finish();
    });
    return { start, finish };
  });
  // Consent: the visitor's choice, kept in a cookie the site's head reads before any tag loads
  // (wb_consent), applied to Google's consent mode and to the scripts the page holds back for it.
  const CONSENT = "wb_consent",
    CATEGORIES = ["analytics", "marketing"];
  const readConsent = () => {
    try {
      const m = document.cookie.match(/(?:^|; )wb_consent=([^;]*)/);
      if (!m) return null;
      const v = JSON.parse(decodeURIComponent(m[1]));
      return v && typeof v === "object"
        ? { analytics: !!v.analytics, marketing: !!v.marketing }
        : null;
    } catch {
      return null;
    }
  };
  function applyConsent(choice) {
    window.dataLayer = window.dataLayer || [];
    const g =
      typeof window.gtag === "function"
        ? window.gtag
        : function () {
            window.dataLayer.push(arguments);
          };
    const a = choice.analytics ? "granted" : "denied",
      m = choice.marketing ? "granted" : "denied";
    g("consent", "update", {
      analytics_storage: a,
      ad_storage: m,
      ad_user_data: m,
      ad_personalization: m,
    });
    for (const held of document.querySelectorAll(
      'script[type="text/plain"][data-consent]:not([data-consent-run])',
    )) {
      if (!choice[held.dataset.consent]) continue;
      const live = document.createElement("script");
      for (const { name, value } of held.attributes)
        if (!["type", "data-consent", "data-src"].includes(name)) live.setAttribute(name, value);
      if (held.dataset.src) live.src = held.dataset.src;
      else live.text = held.text;
      held.setAttribute("data-consent-run", "");
      held.after(live);
    }
  }
  define("consent", (c) => {
    const accept = c.all("button[data-consent-accept]"),
      reject = c.all("button[data-consent-reject]"),
      save = c.all("button[data-consent-save]"),
      boxes = c.all("input[type=checkbox][data-consent-category]");
    if (!accept.length && !reject.length && !save.length)
      throw Error(
        "Consent needs a button[data-consent-accept], [data-consent-reject] or [data-consent-save]",
      );
    if (document.querySelectorAll("[data-behavior=consent]").length > 1)
      throw Error("One consent root per page");
    for (const box of boxes)
      if (!CATEGORIES.includes(box.dataset.consentCategory))
        throw Error("data-consent-category is analytics or marketing");
    [...accept, ...reject, ...save].forEach((b) => c.button(b));
    const sync = (choice) =>
      boxes.forEach((box) => {
        box.checked = !!choice?.[box.dataset.consentCategory];
      });
    const show = (open) => {
      c.show(c.root, open);
      c.state(open ? "open" : "decided");
    };
    const set = (choice, notify = true) => {
      choice = { analytics: !!choice.analytics, marketing: !!choice.marketing };
      document.cookie = `${CONSENT}=${encodeURIComponent(JSON.stringify({ v: 1, ...choice, at: Date.now() }))}; Max-Age=15552000; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      applyConsent(choice);
      sync(choice);
      show(false);
      if (notify) c.emit({ consent: choice });
    };
    const open = () => {
      sync(readConsent());
      show(true);
      (boxes[0] || accept[0] || save[0] || reject[0])?.focus();
    };
    accept.forEach((b) => c.on(b, "click", () => set({ analytics: true, marketing: true })));
    reject.forEach((b) => c.on(b, "click", () => set({ analytics: false, marketing: false })));
    save.forEach((b) =>
      c.on(b, "click", () =>
        set(
          Object.fromEntries(
            CATEGORIES.map((k) => [
              k,
              boxes.some((box) => box.dataset.consentCategory === k && box.checked),
            ]),
          ),
        ),
      ),
    );
    c.on(document, "click", (e) => {
      const opener = e.target instanceof Element ? e.target.closest("[data-consent-open]") : null;
      if (opener) {
        e.preventDefault();
        open();
      }
    });
    const stored = readConsent();
    if (stored) {
      applyConsent(stored);
      sync(stored);
      show(false);
    } else show(true);
    return { open, set: (choice) => set(choice), choice: () => readConsent() };
  });
  // Removed roots release their global listeners, observers, requests and timers.
  const removals = new MutationObserver(() => {
    for (const [root, entry] of instances)
      if (!root.isConnected) {
        entry.c.destroy();
        instances.delete(root);
      }
  });
  const start = () => {
    captureAttribution();
    init();
    removals.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
