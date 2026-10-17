/**
 * 节点 → HTML。整个渲染只有两条规矩：
 *  1. 槽的内容有三种来源——没填（波浪线）、文案、取自模型；
 *  2. 保真度是渲染时的旋钮：lines 档下所有“文案”（含取自模型的值）都画成波浪线，只留结构；words 档才显示文字。
 *     板块名、导航名、字段名是结构上的标注，两档都显示。凡是显示了文案的元素都带 data-copy，验证器据此确认 lines 档里一个字都没漏。
 */
import { crossedBoxSrc } from "./draw.ts";
import type { Db } from "./db.ts";
import { query } from "./db.ts";
import { keyOf, titleFieldOf } from "../shared/derive.ts";
import { renderForm } from "./fields.ts";
import { applySel, facetHtml, facetsOf, toQuery, type Sel } from "./facets.ts";
import { display, esc, isEmpty, titleField } from "./fmt.ts";
import { col, image, text } from "../shared/dsl.ts";
import type { Fill, Node, Page, Row, Sketch, Slot } from "../shared/schema.ts";
import { factFields } from "../shared/facts.ts";
import { scalar } from "../shared/scalar.ts";
import { strings } from "./strings.ts";

export type Fidelity = "lines" | "words";

export type RC = {
  s: Sketch;
  db: Db;
  fid: Fidelity;
  pages: Record<string, Page>;
  params: Record<string, string>;
  /** 当前记录及其类型（详情页、卡片里）。 */
  type?: string;
  record?: Row;
  /** 列表页在列哪个类型（filters 要知道）。 */
  listType?: string;
  /** 列表页自己的固定条件（ctx.where），筛选的“全集”就是它。 */
  listWhere?: Record<string, string>;
  /** 当前选中的筛选（来自地址的 ?query）和当前路径（筛选链接要回到这一页）。 */
  sel: Sel;
  path: string;
  /** 递增的种子，给每个手绘元素固定的形状。 */
  seq: { n: number };
  /** 图片查看器的图集：gid → 图片地址。 */
  viewer: Map<string, string[]>;
};

type Resolved = { kind: "none" } | { kind: "val"; v: string };

const resolve = (fill: Fill, rc: RC): Resolved => {
  if (fill === undefined) return { kind: "none" };
  if (typeof fill === "string") return { kind: "val", v: fill };
  const head = fill.bind.split(".")[0]!;
  if (!rc.type || !rc.record) return { kind: "none" };
  // 绑定的字段没有值 = 和“没填”同一个规矩：粗波浪线（作者可以把显示名留空，只留主键）
  if (isEmpty(rc.record[head])) return { kind: "none" };
  return { kind: "val", v: display(rc.s, rc.db, rc.type, rc.record, head) };
};

const seed = (rc: RC) => ++rc.seq.n;

const sq = (rc: RC, pcts: number[], t: number, cls = "", style = "") =>
  `<div class="sq ${cls}" data-rough="sq" data-seed="${seed(rc)}" data-lines="${pcts.join(",")}" data-t="${t}" style="height:${pcts.length * (t + 10)}px;${style}"></div>`;

const NONE_LINES: Record<number, number[]> = { 1: [60], 2: [45], 3: [100, 92, 60] };
const THICK: Record<number, number> = { 1: 7, 2: 4.5, 3: 3 };
/** lines 档下有值的槽：线长跟着文字长度走，一眼能看出“这里是个短标题还是一段话”。 */
const lineFor = (v: string, size: number) => [
  Math.max(24, Math.min(100, Math.round(v.length * (size === 1 ? 7 : size === 2 ? 5 : 3.6)))),
];

const pageName = (rc: RC, pattern: string): string => {
  const p = rc.pages[pattern];
  return p?.name ?? (p?.ctx?.type ? rc.s.model[p.ctx.type]?.label : undefined) ?? pattern;
};

const hasPage = (rc: RC, pattern: string) => pattern in rc.pages;

const slot = (n: Slot, rc: RC): string => {
  switch (n.slot) {
    case "text": {
      const r = resolve(n.fill, rc);
      if (rc.fid === "lines" || r.kind === "none") {
        const pcts = r.kind === "none" ? NONE_LINES[n.size]! : lineFor(r.v, n.size);
        return sq(rc, pcts, THICK[n.size]!, `s${n.size}`);
      }
      return r.v === "" ? "" : `<div class="tx s${n.size}" data-copy>${esc(r.v)}</div>`;
    }

    case "image": {
      let photos: Array<{ dataUrl: string }> = [];
      if (n.fill && typeof n.fill === "object" && rc.record) {
        const v = rc.record[n.fill.bind.split(".")[0]!];
        if (Array.isArray(v)) photos = v as Array<{ dataUrl: string }>;
      }
      if (rc.fid === "words" && photos.length)
        return `<div class="xbox has-img" data-rough="frame" data-seed="${seed(rc)}"><img src="${esc(photos[0]!.dataUrl)}" alt=""></div>`;
      const cap =
        typeof n.fill === "string" && rc.fid === "words"
          ? `<span class="cap" data-copy>${esc(n.fill)}</span>`
          : "";
      return `<div class="xbox" data-rough="x" data-seed="${seed(rc)}">${cap}</div>`;
    }

    case "action": {
      const r = resolve(n.fill, rc);
      const label =
        rc.fid === "words" && r.kind === "val" && r.v !== ""
          ? `<span data-copy>${esc(r.v)}</span>`
          : `<span class="sq in" data-rough="sq" data-seed="${seed(rc)}" data-lines="100" data-t="3" style="width:64px;height:14px"></span>`;
      const cls = `btn${n.ghost ? " ghost" : ""}`;
      return n.to
        ? `<a class="${cls}" data-rough="btn" data-seed="${seed(rc)}" href="#${esc(n.to)}">${label}</a>`
        : `<span class="${cls}" data-rough="btn" data-seed="${seed(rc)}">${label}</span>`;
    }

    case "brand": {
      const r = resolve(n.fill, rc);
      const label =
        rc.fid === "words" && r.kind === "val" && r.v !== ""
          ? `<span class="wm" data-copy>${esc(r.v)}</span>`
          : `<span class="sq in" data-rough="sq" data-seed="${seed(rc)}" data-lines="100" data-t="5" style="width:120px;height:16px"></span>`;
      return `<a class="brand" data-rough="frame" data-seed="${seed(rc)}" href="#${esc(n.to ?? "/")}">${label}</a>`;
    }

    case "nav": {
      // 导航项多（>7）或窄屏：收进一个手绘的菜单按钮——怎么收是引擎的事，作者只写“有哪些页面”。
      const links = n.paths
        .map((p) => `<a href="#${esc(p)}" data-nav="${esc(p)}">${esc(pageName(rc, p))}</a>`)
        .join("");
      return `<nav class="nav"><button type="button" class="btn small nav-toggle" data-rough="btn" data-seed="${seed(rc)}" data-act="nav-toggle">☰ ${esc(strings(rc.s.locale).menu)}</button><div class="nav-links">${links}</div></nav>`;
    }

    case "collection": {
      const L = strings(rc.s.locale);
      const def = rc.s.model[n.type]!;
      let all = query(
        rc.db,
        n.type,
        n.where,
        { params: rc.params, record: rc.record },
        (t) => keyOf(rc.s, t),
        !!n.notSelf,
      );
      if (n.type === rc.listType) all = applySel(all, rc.sel, Object.keys(rc.sel));
      const shown = all.slice(0, n.limit ?? 6);
      // 每个槽只输出一个根元素：槽放进 row 里是一个 flex 项，输出两个并列元素会被拆开
      if (!shown.length)
        return `<div class="coll"><div class="empty">${esc(Object.values(rc.sel).some((v) => v.length) ? L.emptyFiltered(def.label) : L.empty(def.label))}</div></div>`;
      const card = def.card ?? col(image(), text(3, { bind: titleField(rc.s, n.type) }));
      const linkable = hasPage(rc, `/${n.type}/:id`);
      const cards = shown
        .map((r) => {
          const inner = node(card, { ...rc, type: n.type, record: r, listType: undefined });
          const attrs = `class="card" data-rough="frame" data-seed="${seed(rc)}"`;
          return linkable
            ? `<a ${attrs} href="#/${esc(n.type)}/${encodeURIComponent(String(r[def.key]))}">${inner}</a>`
            : `<div ${attrs}>${inner}</div>`;
        })
        .join("");
      return `<div class="coll"><div class="grid">${cards}</div>${all.length > shown.length ? `<div class="more">${esc(L.more(all.length))}</div>` : ""}</div>`;
    }

    case "facts": {
      if (!rc.type || !rc.record) return "";
      const def = rc.s.model[rc.type]!;
      const rows: string[] = [];
      // 客户页不摆空字段——但整块都是空的就不能留一条光秃秃的线：那时把字段都摆出来，值是波浪线（结构还在）
      const emptyRows: string[] = [];
      // 没填的值 = 粗波浪线（和槽的“没填”同一个规矩）：表里的具体数据不用编，客户也无从纠结
      const valueHtml = (v: string) =>
        rc.fid === "lines" || v === ""
          ? sq(rc, v === "" ? [70] : lineFor(v, 3), v === "" ? 5 : 3, "in", "width:110px")
          : `<span data-copy>${esc(v)}</span>`;
      const row = (k: string, v: string) =>
        `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
      const placeholder = (k: string) => row(k, sq(rc, [70], 5, "in", "width:110px"));
      for (const name of factFields(rc.s, rc.type, n)) {
        const fd = def.fields[name]!;
        const raw = rc.record[name];
        if (fd.kind === "list" && fd.kv) {
          const [kc, vc] = Object.keys(fd.columns!);
          // 一行参数都没有：这块是“一张参数表”，摆三行波浪线的名/值示意（只在整块都空时才用）
          if (isEmpty(raw))
            for (let i = 0; i < 3; i++)
              emptyRows.push(
                `<div class="fact"><div class="k">${sq(rc, [60], 3, "in", "width:70px")}</div><div class="v">${valueHtml("")}</div></div>`,
              );
          for (const r of (raw as Row[] | undefined) ?? []) {
            const k = scalar(r[kc!]);
            const v = scalar(r[vc!]);
            if (rc.fid === "words" && !k) continue;
            rows.push(
              `<div class="fact"><div class="k">${rc.fid === "lines" ? sq(rc, lineFor(k, 3), 3, "in", "width:70px") : `<span data-copy>${esc(k)}</span>`}</div><div class="v">${valueHtml(v)}</div></div>`,
            );
          }
          continue;
        }
        if (fd.kind === "list") {
          // 普通列表：每行一条，各列用 · 连起来；没有内容 = 客户页不摆（lines 档摆两条波浪线表示“这里有一串”）
          const items = ((raw as Row[] | undefined) ?? [])
            .map((r) =>
              Object.keys(fd.columns!)
                .map((c) => scalar(r[c]))
                .filter(Boolean)
                .join(" · "),
            )
            .filter(Boolean);
          if (rc.fid === "lines") rows.push(row(fd.label, sq(rc, [90, 60], 3, "in")));
          else if (!items.length) emptyRows.push(placeholder(fd.label));
          else if (items.length)
            rows.push(
              row(
                fd.label,
                `<ul class="items">${items.map((i) => `<li data-copy>${esc(i)}</li>`).join("")}</ul>`,
              ),
            );
          continue;
        }
        if (rc.fid === "words" && isEmpty(raw)) {
          emptyRows.push(placeholder(fd.label));
          continue;
        }
        if (fd.kind === "ref" && fd.to && !isEmpty(raw)) {
          // 关系：显示对方的显示名，能点过去的就是链接
          const to = fd.to;
          const ids = (Array.isArray(raw) ? raw : [raw]).map(scalar);
          const linkable = hasPage(rc, `/${to}/:id`);
          const links = ids
            .map((id) => {
              const hit = rc.db.find(to, id);
              if (!hit) return null;
              const label = esc(scalar(hit[titleFieldOf(rc.s, to)] ?? id));
              return linkable
                ? `<a href="#/${esc(to)}/${encodeURIComponent(id)}" data-copy>${label}</a>`
                : `<span data-copy>${label}</span>`;
            })
            .filter((x): x is string => x !== null);
          rows.push(
            row(
              fd.label,
              rc.fid === "lines" ? sq(rc, [70], 3, "in", "width:110px") : links.join(" / "),
            ),
          );
          continue;
        }
        const v = isEmpty(raw) ? "" : display(rc.s, rc.db, rc.type, rc.record, name);
        rows.push(row(fd.label, valueHtml(v)));
      }
      return `<div class="facts">${(rows.length ? rows : emptyRows).join("")}</div>`;
    }

    case "badges": {
      if (!rc.type || !rc.record) return "";
      const fd = rc.s.model[rc.type]!.fields[n.field]!;
      const raw = rc.record[n.field];
      const ids = (Array.isArray(raw) ? raw : isEmpty(raw) ? [] : [raw]).map(scalar);
      const real = ids.map((id) => {
        const hit = rc.db.find(fd.to!, id);
        return hit ? scalar(hit[titleFieldOf(rc.s, fd.to!)] ?? id) : id;
      });
      const count = rc.fid === "lines" ? Math.max(3, real.length) : real.length;
      return `<div class="badges">${Array.from(
        { length: count },
        (_, i) =>
          `<span class="circle" data-rough="circle" data-seed="${seed(rc)}">${rc.fid === "words" ? `<span data-copy>${esc(real[i])}</span>` : ""}</span>`,
      ).join("")}</div>`;
    }

    case "gallery": {
      const v = rc.record?.[n.field];
      const photos = (Array.isArray(v) ? v : []) as Array<{ dataUrl: string }>;
      const real = rc.fid === "words" && photos.length > 0;
      const gid = `g${seed(rc)}`;
      const srcs = real
        ? photos.map((p) => p.dataUrl)
        : [crossedBoxSrc(), crossedBoxSrc(), crossedBoxSrc()];
      rc.viewer.set(gid, srcs);
      return `<div class="gallery">${srcs
        .map(
          (src, i) =>
            `<a href="#" class="thumb" data-act="view" data-gid="${gid}" data-i="${i}"><div class="xbox${real ? " has-img" : ""}" data-rough="${real ? "frame" : "x"}" data-seed="${seed(rc)}">${real ? `<img src="${esc(src)}" alt="">` : ""}</div></a>`,
        )
        .join("")}</div>`;
    }

    case "filters": {
      const t = rc.listType ?? rc.type;
      if (!t) return "";
      const base = query(rc.db, t, rc.listWhere, { params: rc.params }, (x) => keyOf(rc.s, x));
      const facets = facetsOf(rc.s, rc.db, t, n.fields, base, rc.sel);
      const href = (next: Sel) => {
        const qs = toQuery(next, n.fields);
        return `#${rc.path}${qs ? "?" + qs : ""}`;
      };
      return facetHtml(facets, rc.sel, {
        variant: "side",
        words: rc.fid === "words",
        clear: strings(rc.s.locale).clearFilters,
        seed: () => seed(rc),
        href,
      });
    }

    case "form":
      return rc.type ? renderForm(rc.s, rc.db, rc.type, null, "public") : "";
  }
};

export const node = (n: Node, rc: RC): string => {
  if ("group" in n) {
    const weighted = n.dir === "row" && n.group.some((c) => c.w);
    const cls = [
      "grp",
      n.dir,
      weighted ? "weighted" : "",
      n.name ? "sec" : "",
      n.tone === "accent" ? "accent" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const inner = n.group
      .map((c) =>
        weighted
          ? `<div class="cell" style="flex:${c.w ?? 1} 1 0">${node(c, rc)}</div>`
          : node(c, rc),
      )
      .join("");
    return n.name
      ? `<section class="${cls}" data-section="${esc(n.name)}"><span class="block-tag">${esc(n.name)}</span>${inner}</section>`
      : `<div class="${cls}">${inner}</div>`;
  }
  return slot(n, rc);
};
