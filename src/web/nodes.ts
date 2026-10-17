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
import { scalar } from "../shared/scalar.ts";

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
  return {
    kind: "val",
    v: isEmpty(rc.record[head]) ? "" : display(rc.s, rc.db, rc.type, rc.record, head),
  };
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

    case "nav":
      return `<nav class="nav">${n.paths.map((p) => `<a href="#${esc(p)}" data-nav="${esc(p)}">${esc(pageName(rc, p))}</a>`).join("")}</nav>`;

    case "collection": {
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
      if (!shown.length)
        return `<div class="empty">（${Object.values(rc.sel).some((v) => v.length) ? "没有符合条件的" : "还没有"}${esc(def.label)}）</div>`;
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
      return `<div class="grid">${cards}</div>${all.length > shown.length ? `<div class="more">… 共 ${all.length} 个</div>` : ""}`;
    }

    case "facts": {
      if (!rc.type || !rc.record) return "";
      const def = rc.s.model[rc.type]!;
      const tf = titleField(rc.s, rc.type);
      const rows: string[] = [];
      // 没填的值 = 粗波浪线（和槽的“没填”同一个规矩）：表里的具体数据不用编，客户也无从纠结
      const valueHtml = (v: string) =>
        rc.fid === "lines" || v === ""
          ? sq(rc, v === "" ? [70] : lineFor(v, 3), v === "" ? 5 : 3, "in", "width:110px")
          : `<span data-copy>${esc(v)}</span>`;
      for (const [name, fd] of Object.entries(def.fields)) {
        if (
          name === def.key ||
          name === tf ||
          fd.detail === false ||
          fd.kind === "media" ||
          (n.skip ?? []).includes(name)
        )
          continue;
        if (fd.kind === "list" && fd.kv) {
          const [kc, vc] = Object.keys(fd.columns!);
          for (const r of (rc.record[name] as Row[] | undefined) ?? []) {
            const k = scalar(r[kc!]);
            const v = scalar(r[vc!]);
            if (rc.fid === "words" && !k) continue;
            rows.push(
              `<div class="fact"><div class="k">${rc.fid === "lines" ? sq(rc, lineFor(k, 3), 3, "in", "width:70px") : `<span data-copy>${esc(k)}</span>`}</div><div class="v">${valueHtml(v)}</div></div>`,
            );
          }
          continue;
        }
        const v = isEmpty(rc.record[name]) ? "" : display(rc.s, rc.db, rc.type, rc.record, name);
        if (rc.fid === "words" && v === "") continue; // 客户看的页面不摆空字段
        rows.push(
          `<div class="fact"><div class="k">${esc(fd.label)}</div><div class="v">${valueHtml(v)}</div></div>`,
        );
      }
      return `<div class="facts">${rows.join("")}</div>`;
    }

    case "badges": {
      if (!rc.type || !rc.record) return "";
      const fd = rc.s.model[rc.type]!.fields[n.field]!;
      const ids = ((rc.record[n.field] as unknown[]) ?? []).map(String);
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
