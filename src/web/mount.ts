/**
 * 引擎入口：把一份 Sketch 配置变成能点的网站。
 * 路由（hash）→ 页面（模板 × 上下文）→ 节点树 → HTML → 手绘叠加层。其余都是壳子：保真度开关、toast、确认框、图片查看器。
 */
import "../../vendor/wp-behaviors/behaviors.js";
import "wired-checkbox";
import "wired-combo";
import "wired-input";
import "wired-item";
import "wired-radio";
import "wired-radio-group";
import "wired-textarea";
import "./style.css";
import { parseQuery } from "./facets.ts";
import { createDb } from "./db.ts";
import { matchRoute, pagesOf, referrersOf } from "../shared/derive.ts";
import { drawAll, rowLineSrc } from "./draw.ts";
import { strings, ZH } from "./strings.ts";
import { collectRow, listRowHtml, MAX_PHOTOS, photoHtml, shrinkImage } from "./fields.ts";
import { esc, recordTitle, titleField, vocabLabel } from "./fmt.ts";
import { renderModelView } from "./model-view.ts";
import { node, type Fidelity, type RC } from "./nodes.ts";
import type { Sketch } from "../shared/schema.ts";
import { validate } from "../shared/validate.ts";
import { scalar } from "../shared/scalar.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

declare global {
  interface Window {
    WPBehaviors?: { get(root: Element): { notify(msg: string, ms?: number): void } | undefined };
    __sketch?: unknown;
  }
}

export const mount = (sketch: Sketch): void => {
  const report = validate(sketch);
  if (report.errors.length) {
    $("#app").innerHTML =
      `<section class="grp col sec" data-fatal><span class="block-tag">配置有错误</span><pre>${esc(report.errors.join("\n"))}</pre></section>`;
    window.__sketch = { code: sketch.code, ready: false, errors: report.errors };
    return;
  }
  for (const w of report.warnings) console.warn("[sketch]", w);

  const db = createDb(sketch, localStorage);
  const pages = pagesOf(sketch);
  const patterns = Object.keys(pages);
  const viewer = new Map<string, string[]>();

  // 保真度由草图配置定（agent 的决定），不是访客的开关；?fidelity= 只给验证器两档都过一遍用。
  const readFid = (): Fidelity => {
    const v = new URLSearchParams(location.search).get("fidelity") ?? sketch.fidelity;
    return v === "lines" ? "lines" : "words";
  };
  let fid: Fidelity = readFid();
  let pendingToast: string | null = null;

  const rcFor = (extra: Partial<RC> = {}): RC => ({
    s: sketch,
    db,
    fid,
    pages,
    params: {},
    seq: { n: 0 },
    viewer,
    sel: parseQuery(loc().qs),
    path: loc().path,
    ...extra,
  });

  // ---- 壳子 ----
  document.title = sketch.title;
  document.documentElement.style.setProperty("--rowline", `url("${rowLineSrc()}")`);
  /** 导航放不下就收起：量一量链接排了几行——不靠项数猜。 */
  const fitNavs = () => {
    document.querySelectorAll<HTMLElement>("nav.nav").forEach((nav) => {
      nav.classList.remove("collapsed", "open");
      const links = nav.querySelector<HTMLElement>(".nav-links");
      const first = links?.querySelector<HTMLElement>("a");
      if (
        links &&
        first &&
        links.offsetParent !== null &&
        links.offsetHeight > first.offsetHeight * 1.7
      )
        nav.classList.add("collapsed");
    });
  };

  const renderChrome = () => {
    $("#header-body").innerHTML = node(sketch.header, rcFor());
    $("#footer-body").innerHTML = node(sketch.footer, rcFor());
  };

  const toast = (msg: string) => window.WPBehaviors?.get($("#toast-root"))?.notify(msg, 3200);
  let confirmYes: (() => void) | null = null;
  const askConfirm = (msg: string, yes: () => void) => {
    $("#confirm-msg").textContent = msg;
    confirmYes = yes;
    $<HTMLButtonElement>("#confirm-root [data-dialog-open]").click();
  };
  const closeDialog = (root: string) => $<HTMLButtonElement>(`${root} [data-dialog-close]`).click();

  // ---- 路由 ----
  // 地址 = #路径?筛选。路径决定页面，?query 只是页面内的状态（筛选、搜索、页码）。
  const loc = () => {
    const raw = location.hash.replace(/^#/, "");
    const i = raw.indexOf("?");
    const p = decodeURI(i < 0 ? raw : raw.slice(0, i)).replace(/\/+$/, "");
    return { path: p.startsWith("/") ? p : "/" + p, qs: i < 0 ? "" : raw.slice(i + 1) };
  };

  // 客户页面的 404 跟着草图的 locale；后台（#/_model）永远是中文
  const notFound = (L = strings(sketch.locale)) =>
    `<section class="grp col sec" data-notfound><span class="block-tag">404</span><div>${esc(L.notFound)}</div><a class="btn" data-rough="btn" data-seed="5" href="#/">${esc(L.backHome)}</a></section>`;

  type Rendered = { html: string; title: string; pattern?: string };

  const crumbs = (items: Array<[string, string?]>) =>
    `<div class="crumb">${items.map(([l, h]) => (h ? `<a href="#${esc(h)}">${esc(l)}</a>` : `<span>${esc(l)}</span>`)).join(" / ")}</div>`;

  const renderRoute = (): Rendered => {
    const { path: p, qs } = loc();
    if (p === "/_model" || p.startsWith("/_model/")) {
      const mv = renderModelView(sketch, db, p.split("/").filter(Boolean).slice(1), qs);
      return mv.notFound
        ? { html: notFound(ZH), title: "404" }
        : { html: mv.html, title: mv.title };
    }
    const m = matchRoute(patterns, p);
    if (!m) return { html: notFound(), title: "404" };
    const page = pages[m.pattern]!;
    const ctx = page.ctx ?? null;
    let rc = rcFor({ params: m.params });
    let title = page.name ?? (ctx ? sketch.model[ctx.type]?.label : undefined) ?? m.pattern;
    // 面包屑的根：首页自己的名字（作者起的），没起才用引擎的默认词
    let trail: Array<[string, string?]> = [[pages["/"]?.name ?? strings(sketch.locale).home, "/"]];

    if (ctx) {
      const def = sketch.model[ctx.type]!;
      if (ctx.many) {
        rc = { ...rc, listType: ctx.type, listWhere: ctx.where };
        for (const [field, v] of Object.entries(ctx.where ?? {})) {
          const fd = def.fields[field]!;
          if (v.startsWith(":") && fd.kind === "term") {
            const id = m.params[v.slice(1)]!;
            if (!db.find(fd.to!, id)) return { html: notFound(), title: "404" };
            title = vocabLabel(sketch, db, fd.to!, id);
            if (pages[`/${fd.to}`])
              trail.push([pages[`/${fd.to}`]!.name ?? sketch.model[fd.to!]!.label, `/${fd.to}`]);
            trail.push([title]);
          }
        }
        if (trail.length === 1) trail.push([String(title)]);
      } else if (ctx.create) {
        rc = { ...rc, type: ctx.type };
        trail.push([String(title)]);
      } else {
        const rec = db.find(ctx.type, m.params.id!);
        if (!rec || !db.visible(ctx.type, rec)) return { html: notFound(), title: "404" };
        rc = { ...rc, type: ctx.type, record: rec };
        title = recordTitle(sketch, db, ctx.type, rec);
        // 分类面包屑只在“那个词表条目页列的就是这个类型”时用（首页 / 产品分类 / 三辊闸 / A106）；
        // 否则是这个类型自己的列表页（首页 / 案例 / case-01）——不能把案例挂到别的栏目名下
        const lists = (to: string | undefined) => {
          const c = to ? pages[`/${to}/:id`]?.ctx : undefined;
          return !!c && c.many === true && c.type === ctx.type;
        };
        const cls = Object.entries(def.fields).find(
          ([, fd]) => fd.kind === "term" && !fd.multiple && lists(fd.to),
        );
        if (cls) {
          const [name, fd] = cls;
          if (pages[`/${fd.to}`])
            trail.push([pages[`/${fd.to}`]!.name ?? sketch.model[fd.to!]!.label, `/${fd.to}`]);
          const id = scalar(rec[name]);
          if (id)
            trail.push([vocabLabel(sketch, db, fd.to!, id), `/${fd.to}/${encodeURIComponent(id)}`]);
        }
        if (!cls && pages[`/${ctx.type}`])
          trail.push([pages[`/${ctx.type}`]!.name ?? def.label, `/${ctx.type}`]);
        trail.push([String(title)]);
      }
    } else if (m.pattern !== "/") trail.push([String(title)]);

    const body = page.body.map((n) => node(n, rc)).join("");
    return {
      html: (m.pattern === "/" ? "" : crumbs(trail)) + body,
      title: String(title),
      pattern: m.pattern,
    };
  };

  const render = () => {
    const r = renderRoute();
    const app = $("#app");
    app.innerHTML = r.html;
    document.title = `${sketch.code} · ${r.title}`;
    document.querySelectorAll<HTMLElement>("[data-nav]").forEach((a) => {
      const pat = a.dataset.nav!;
      a.classList.toggle(
        "on",
        !!r.pattern && (r.pattern === pat || (pat !== "/" && r.pattern.startsWith(pat + "/"))),
      );
    });
    requestAnimationFrame(() => drawAll(app));
    if (pendingToast) {
      const msg = pendingToast;
      pendingToast = null;
      toast(msg);
    }
  };

  const rerenderAll = () => {
    renderChrome();
    requestAnimationFrame(fitNavs);
    render();
    requestAnimationFrame(() => drawAll(document.body));
  };

  const setFidelity = (v: Fidelity) => {
    fid = v;
    rerenderAll();
  };

  // ---- 事件（动作，不是导航：导航走 <a href="#/...">）----
  let viewerState: { srcs: string[]; i: number } = { srcs: [], i: 0 };
  const showViewer = () => {
    $<HTMLImageElement>("#viewer-img").src = viewerState.srcs[viewerState.i]!;
    $("#viewer-pos").textContent = `${viewerState.i + 1} / ${viewerState.srcs.length}`;
  };

  // 点导航里的任何链接都收起菜单——包括指向当前页的那个（它不会触发 hashchange）
  document.addEventListener("click", (e) => {
    if ((e.target as Element).closest(".nav-links a"))
      document.querySelectorAll("nav.open").forEach((x) => x.classList.remove("open"));
  });

  document.addEventListener("click", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!el) return;
    const act = el.dataset.act!;
    if (el.tagName === "A") e.preventDefault();
    switch (act) {
      case "nav-toggle":
        el.closest("nav")?.classList.toggle("open");
        break;
      case "view": {
        viewerState = { srcs: viewer.get(el.dataset.gid!) ?? [], i: Number(el.dataset.i) || 0 };
        if (!viewerState.srcs.length) break;
        showViewer();
        $<HTMLButtonElement>("#viewer-root [data-dialog-open]").click();
        break;
      }
      case "viewer-prev":
      case "viewer-next": {
        const n = viewerState.srcs.length;
        viewerState.i = (viewerState.i + (act === "viewer-next" ? 1 : -1) + n) % n;
        showViewer();
        break;
      }
      case "confirm-yes": {
        const cb = confirmYes;
        confirmYes = null;
        closeDialog("#confirm-root");
        cb?.();
        break;
      }
      case "del": {
        const { type, key } = el.dataset as { type: string; key: string };
        askConfirm(`删除 ${key}？`, () => {
          db.remove(type, key);
          pendingToast = `已删除 ${key}`;
          render();
        });
        break;
      }
      case "reset":
        askConfirm("重置为初始数据？新增/编辑/删除的内容都会丢失。", () => {
          db.reset();
          pendingToast = "已重置为初始数据";
          render();
        });
        break;
      case "pick-photos":
        el.closest("[data-media]")!.querySelector<HTMLInputElement>("input[type=file]")!.click();
        break;
      case "photo-del":
        el.closest(".pv")!.remove();
        break;
      case "add-row": {
        const list = el.closest<HTMLElement>("[data-list]")!;
        el.insertAdjacentHTML(
          "beforebegin",
          listRowHtml(
            JSON.parse(list.dataset.columns!),
            {},
            strings(el.closest<HTMLElement>("[data-form]")?.dataset.lang === "en" ? "en" : "zh"),
          ),
        );
        break;
      }
      case "del-row":
        el.closest(".lrow")!.remove();
        break;
      case "submit": {
        const form = el.closest<HTMLElement>("[data-form]")!;
        const { type, editing, mode } = form.dataset as {
          type: string;
          editing: string;
          mode: string;
        };
        const L = mode === "public" ? strings(sketch.locale) : ZH;
        const res = collectRow(sketch, db, type, form, editing, L);
        if (!res.ok) return toast(res.message);
        if (!db.put(type, res.row)) return toast(L.storageFull);
        if (mode === "public") {
          pendingToast = L.demoSubmitted;
          render();
        } else {
          pendingToast = editing ? `已保存 ${editing}` : "已新增";
          location.hash = `#/_model/${type}`;
        }
        break;
      }
    }
  });

  document.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.matches?.("input[data-search]")) {
      const parts = [
        input.value.trim() ? `q=${encodeURIComponent(input.value.trim())}` : "",
        input.dataset.keep ?? "",
      ].filter(Boolean);
      location.hash = input.dataset.base! + (parts.length ? "?" + parts.join("&") : "");
      return;
    }
    if (!input.matches?.("input[data-photo-input]")) return;
    const pvs = input.closest("[data-media]")!.querySelector(".pvs")!;
    const L = strings(
      input.closest<HTMLElement>("[data-form]")?.dataset.lang === "en" ? "en" : "zh",
    );
    for (const file of input.files ?? []) {
      if (pvs.querySelectorAll("[data-photo]").length >= MAX_PHOTOS) {
        toast(L.maxPhotos(MAX_PHOTOS));
        break;
      }
      try {
        pvs.insertAdjacentHTML(
          "beforeend",
          photoHtml({ dataUrl: await shrinkImage(file), caption: file.name }, L),
        );
      } catch {
        toast(L.photoUnreadable(file.name));
      }
    }
    input.value = "";
  });

  let lastPath = loc().path;
  // 只有换了页面才回到顶部；同一页里改筛选/翻页不该把人弹回去
  window.addEventListener("hashchange", () => {
    document.querySelectorAll("nav.open").forEach((x) => x.classList.remove("open"));
    render();
    if (loc().path !== lastPath) window.scrollTo(0, 0);
    lastPath = loc().path;
  });
  let t: number | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      fitNavs();
      drawAll(document.body);
    }, 200);
  });
  const settle = () => {
    fitNavs();
    drawAll(document.body);
  };
  void document.fonts?.ready.then(settle);
  window.addEventListener("load", () => setTimeout(settle, 400));

  // ---- 给验证器的口子：每个路由模式给出真实可访问的路径 ----
  const sampleRoutes = (): string[] => {
    const out: string[] = [];
    for (const [pattern, page] of Object.entries(pages)) {
      if (!pattern.includes(":")) {
        out.push(pattern);
        continue;
      }
      const ctx = page.ctx;
      if (!ctx) continue;
      if (ctx.many) {
        const [field, v] = Object.entries(ctx.where ?? {})[0] ?? [];
        const fd = field ? sketch.model[ctx.type]!.fields[field] : undefined;
        if (fd?.to)
          for (const r of db.all(fd.to).slice(0, 2))
            out.push(pattern.replace(v!, String(r[sketch.model[fd.to]!.key])));
      } else {
        for (const r of db.list(ctx.type).slice(0, 2))
          out.push(
            pattern.replace(":id", encodeURIComponent(String(r[sketch.model[ctx.type]!.key]))),
          );
      }
    }
    out.push("/_model");
    for (const [t2, def] of Object.entries(sketch.model)) {
      out.push(`/_model/${t2}`, `/_model/${t2}/new`);
      const first = db.all(t2)[0];
      if (first) out.push(`/_model/${t2}/${encodeURIComponent(String(first[def.key]))}/edit`);
    }
    return out;
  };

  window.__sketch = {
    code: sketch.code,
    ready: true,
    errors: [],
    warnings: report.warnings,
    patterns,
    sampleRoutes,
    fidelity: () => fid,
    setFidelity,
    db,
    referrersOf: (v: string) => referrersOf(sketch, v),
    titleField: (t2: string) => titleField(sketch, t2),
  };

  renderChrome();
  render();
  requestAnimationFrame(settle);
};
