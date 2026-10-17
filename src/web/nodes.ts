/**
 * 节点 → HTML。渲染只有三条规矩：
 *  1. 槽的内容有三种来源——没填（波浪线）、文案、取自环境（bind / count）；
 *  2. 保真度是渲染时的旋钮：lines 档下所有“文案”（含取自模型的值）都画成波浪线，只留结构；words 档才显示文字。
 *     板块名、导航名、字段名是结构上的标注，两档都显示。凡是显示了文案的元素都带 data-copy，验证器据此确认 lines 档里一个字都没漏；
 *  3. 每个节点只输出一个根元素——放进 row 里它就是一个 flex 项，输出两个并列元素会被拆开。
 *
 * 环境（rc.vars）是一组命名绑定：页面记录叫 page，each 里的每一项叫它的 as（默认 it）。bind 路径的语法在 shared/scope.ts，
 * 这里在运行时对同一套路径求值。each 对一个关系逐项生成：records（查记录）、fields（一条记录的字段）、items（一个多值字段的各项）。
 */
import { crossedBoxSrc } from "./draw.ts";
import type { Db } from "./db.ts";
import { query } from "./db.ts";
import { keyOf, titleFieldOf } from "../shared/derive.ts";
import { renderForm } from "./fields.ts";
import { applySel, facetHtml, facetsOf, toQuery, type Sel } from "./facets.ts";
import { display, esc, isEmpty, recordTitle } from "./fmt.ts";
import { factFields } from "../shared/facts.ts";
import { parsePath } from "../shared/scope.ts";
import { scalar } from "../shared/scalar.ts";
import type {
  Atom,
  Each,
  Field,
  Fill,
  Group,
  Node,
  Page,
  Row,
  Sketch,
  Source,
} from "../shared/schema.ts";
import { strings } from "./strings.ts";

export type Fidelity = "lines" | "words";

/** 环境里的一个值。 */
export type RVar =
  | { kind: "record"; type: string; row: Row }
  /** fields 来源的一项。有 type/row/field = 一条记录的一个字段；否则（kv 行、占位）只有 label 和 text。 */
  | {
      kind: "entry";
      label: string;
      /** label 是数据（kv 的参数名）还是标注（字段名）。lines 档里数据画成线，标注照写。 */
      labelIsData: boolean;
      field?: string;
      type?: string;
      row?: Row;
      /** kv 行的值。 */
      text?: string;
      /** 对比表的行头：只有字段名，没有值。 */
      headOnly?: boolean;
    }
  | { kind: "photo"; dataUrl: string; gid: string; i: number; placeholder: boolean }
  | { kind: "row"; row: Row }
  /** 占位：generator 没有项、但结构上该有几项时用（画波浪线/叉框/空圆圈）。 */
  | { kind: "empty" };

export type RC = {
  s: Sketch;
  db: Db;
  fid: Fidelity;
  pages: Record<string, Page>;
  params: Record<string, string>;
  /** 环境：变量名 → 值；it = 当前记录的变量名。 */
  vars: ReadonlyMap<string, RVar>;
  it?: string;
  /** 新增表单页：在新增哪个类型（form 要知道）。 */
  createType?: string;
  /** 列表页在列哪个类型（filters 要知道）。 */
  listType?: string;
  /** 列表页自己的固定条件（ctx.where），筛选的“全集”就是它。 */
  listWhere?: Record<string, string>;
  /** 当前选中的筛选/初始值（来自地址的 ?query）和当前路径（筛选链接要回到这一页）。 */
  sel: Sel;
  path: string;
  /** 递增的种子，给每个手绘元素固定的形状。 */
  seq: { n: number };
  /** 图片查看器的图集：gid → 图片地址。 */
  viewer: Map<string, string[]>;
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

export const withVars = (rc: RC, name: string, v: RVar): RC => {
  const vars = new Map(rc.vars);
  vars.set(name, v);
  return { ...rc, vars, it: v.kind === "record" ? name : rc.it };
};

const pageRecord = (rc: RC): Row | undefined => {
  const v = rc.vars.get("page");
  return v?.kind === "record" ? v.row : undefined;
};
const pageType = (rc: RC): string | undefined => {
  const v = rc.vars.get("page");
  return v?.kind === "record" ? v.type : undefined;
};

// ---- 求值：bind / count ----

/** bind 的结果：什么都没有、一个字符串、一条记录的一个字段（按字段类型渲染）、一张图。 */
type Val =
  | { kind: "none" }
  | { kind: "text"; v: string; data: boolean }
  | { kind: "field"; type: string; row: Row; field: string }
  | { kind: "photo"; v: Extract<RVar, { kind: "photo" }> };

const NONE: Val = { kind: "none" };

export const evalBind = (rc: RC, path: string): Val => {
  const segs = parsePath(path);
  let rest = segs;
  let v: RVar | undefined;
  const first = segs[0];
  if (first && "lit" in first && rc.vars.has(first.lit)) {
    v = rc.vars.get(first.lit);
    rest = segs.slice(1);
  } else if (rc.it) v = rc.vars.get(rc.it);
  if (!v || v.kind === "empty") return NONE;
  if (rest.length === 0) {
    if (v.kind === "photo") return { kind: "photo", v };
    if (v.kind === "record")
      return { kind: "text", v: recordTitle(rc.s, rc.db, v.type, v.row), data: true };
    return NONE;
  }
  let seg = rest[0]!;
  if ("dyn" in seg) {
    const inner = evalBind(rc, seg.dyn);
    if (inner.kind !== "text") return NONE;
    seg = { lit: inner.v };
  }
  const name = seg.lit;
  switch (v.kind) {
    case "record":
      if (name === "@title")
        return { kind: "text", v: recordTitle(rc.s, rc.db, v.type, v.row), data: true };
      return { kind: "field", type: v.type, row: v.row, field: name };
    case "entry":
      if (name === "label") return { kind: "text", v: v.label, data: v.labelIsData };
      if (name === "field") return { kind: "text", v: v.field ?? "", data: false };
      if (name === "value") {
        if (v.headOnly) return NONE;
        if (v.text !== undefined) return { kind: "text", v: v.text, data: true };
        if (v.type && v.row && v.field)
          return { kind: "field", type: v.type, row: v.row, field: v.field };
      }
      return NONE;
    case "row":
      return { kind: "text", v: scalar(v.row[name]), data: true };
    default:
      return NONE;
  }
};

/** 一个值的“原始”文字（链接带过去的初始值用它：存的是 id/编码，不是显示名）。 */
const rawText = (val: Val): string => {
  if (val.kind === "text") return val.v;
  if (val.kind !== "field") return "";
  const raw = val.row[val.field];
  return Array.isArray(raw) ? raw.map(scalar).join(",") : scalar(raw);
};

const fillText = (rc: RC, fill: Fill): { kind: "none" } | { kind: "val"; val: Val } => {
  if (fill === undefined) return { kind: "none" };
  if (typeof fill === "string") return { kind: "val", val: { kind: "text", v: fill, data: true } };
  if ("bind" in fill) return { kind: "val", val: evalBind(rc, fill.bind) };
  return {
    kind: "val",
    val: { kind: "text", v: String(sourceRows(rc, fill.count).length), data: true },
  };
};

// ---- 来源 ----

const sourceRows = (rc: RC, src: Source): unknown[] => {
  if ("records" in src) {
    let rows = query(
      rc.db,
      src.records,
      src.where,
      { params: rc.params, record: pageRecord(rc) },
      (t) => keyOf(rc.s, t),
      !!src.notSelf,
    );
    if (src.records === rc.listType) rows = applySel(rows, rc.sel, Object.keys(rc.sel));
    return rows;
  }
  if ("items" in src) return itemsOf(rc, src.items);
  return [];
};

const itemsOf = (rc: RC, path: string): unknown[] => {
  const val = evalBind(rc, path);
  if (val.kind !== "field") return [];
  const fd = rc.s.model[val.type]?.fields[val.field];
  const raw = val.row[val.field];
  if (!fd || isEmpty(raw)) return [];
  if (fd.kind === "term" || fd.kind === "ref") {
    const ids = (Array.isArray(raw) ? raw : [raw]).map(scalar);
    return ids.flatMap((id) => {
      const hit = rc.db.find(fd.to!, id);
      return hit ? [{ type: fd.to!, row: hit }] : [];
    });
  }
  if (fd.kind === "media" || fd.kind === "list") return Array.isArray(raw) ? raw : [];
  return [];
};

/** fields 来源：把一条记录的字段（kv 列表展开）变成一项项。客户页不摆空字段——整块都空时才把字段名全摆出来，值是波浪线。 */
const fieldEntries = (rc: RC, src: Extract<Source, { fields: unknown }>): RVar[] => {
  const f = src.fields;
  const of = f.of ? rc.vars.get(f.of) : rc.it ? rc.vars.get(rc.it) : undefined;
  const type = f.type ?? (of?.kind === "record" ? of.type : undefined);
  if (!type) return [];
  const names = factFields(rc.s, type, f);
  const def = rc.s.model[type]!;
  if (f.type !== undefined && f.of === undefined)
    return names.map((n) => ({
      kind: "entry",
      label: def.fields[n]!.label,
      labelIsData: false,
      field: n,
      type,
      headOnly: true,
    }));
  const row = of?.kind === "record" ? of.row : undefined;
  if (!row) return [];
  const filled: RVar[] = [];
  const all: RVar[] = [];
  for (const name of names) {
    const fd = def.fields[name]!;
    const raw = row[name];
    if (fd.kind === "list" && fd.kv) {
      const [kc, vc] = Object.keys(fd.columns!);
      const rows = (Array.isArray(raw) ? raw : []) as Row[];
      for (const r of rows) {
        const k = scalar(r[kc!]);
        if (!k) continue;
        const e: RVar = { kind: "entry", label: k, labelIsData: true, text: scalar(r[vc!]) };
        filled.push(e);
        all.push(e);
      }
      if (rows.length === 0)
        for (let i = 0; i < 3; i++)
          all.push({ kind: "entry", label: "", labelIsData: true, text: "" });
      continue;
    }
    const e: RVar = { kind: "entry", label: fd.label, labelIsData: false, field: name, type, row };
    all.push(e);
    if (!isEmpty(raw)) filled.push(e);
  }
  return rc.fid === "lines" ? all : filled.length ? filled : all;
};

// ---- 叶子 ----

/** 一条记录的一个字段，按字段类型渲染成 HTML（空 = 空串，由调用方画波浪线）。 */
const fieldHtml = (rc: RC, type: string, row: Row, name: string): string => {
  const fd: Field | undefined = rc.s.model[type]?.fields[name];
  const raw = row[name];
  if (!fd || isEmpty(raw)) return "";
  if (fd.kind === "ref" && fd.to) {
    const to = fd.to;
    const linkable = hasPage(rc, `/${to}/:id`);
    return (Array.isArray(raw) ? raw : [raw])
      .map(scalar)
      .flatMap((id) => {
        const hit = rc.db.find(to, id);
        if (!hit) return [];
        const label = esc(scalar(hit[titleFieldOf(rc.s, to)] ?? id));
        return [
          linkable
            ? `<a href="#/${esc(to)}/${encodeURIComponent(id)}" data-copy>${label}</a>`
            : `<span data-copy>${label}</span>`,
        ];
      })
      .join(" / ");
  }
  if (fd.kind === "list" && !fd.kv) {
    const items = ((Array.isArray(raw) ? raw : []) as Row[])
      .map((r) =>
        Object.keys(fd.columns!)
          .map((c) => scalar(r[c]))
          .filter(Boolean)
          .join(" · "),
      )
      .filter(Boolean);
    return items.length
      ? `<ul class="items">${items.map((i) => `<li data-copy>${esc(i)}</li>`).join("")}</ul>`
      : "";
  }
  const v = display(rc.s, rc.db, type, row, name);
  return v === "" ? "" : `<span data-copy>${esc(v)}</span>`;
};

const textAtom = (n: Extract<Atom, { slot: "text" }>, rc: RC): string => {
  const r = fillText(rc, n.fill);
  const circle = n.tone === "circle";
  const wrap = (inner: string) =>
    circle
      ? `<span class="circle" data-rough="circle" data-seed="${seed(rc)}">${inner}</span>`
      : inner;
  // 没填的段落 = 三行线；绑定了字段、但这条记录没有值 = 一个值的位置：一条粗短线（表里的空参数就是这个）
  const bound = typeof n.fill === "object";
  const none = () =>
    circle
      ? wrap("")
      : bound && n.size === 3
        ? sq(rc, [70], 5, "in", "width:110px")
        : sq(rc, NONE_LINES[n.size]!, THICK[n.size]!, `s${n.size}`);
  if (r.kind === "none" || r.val.kind === "none" || r.val.kind === "photo") return none();
  const val = r.val;
  // 标注（字段名）两档都显示；数据在 lines 档画成线条
  if (val.kind === "text" && !val.data)
    return val.v === "" ? none() : `<div class="tx s${n.size}">${esc(val.v)}</div>`;
  if (rc.fid === "lines") {
    if (circle) return wrap("");
    const len = val.kind === "text" ? val.v : "";
    return sq(rc, len ? lineFor(len, n.size) : NONE_LINES[n.size]!, THICK[n.size]!, `s${n.size}`);
  }
  if (val.kind === "text")
    return val.v === ""
      ? none()
      : circle
        ? wrap(`<span data-copy>${esc(val.v)}</span>`)
        : `<div class="tx s${n.size}" data-copy>${esc(val.v)}</div>`;
  const html = fieldHtml(rc, val.type, val.row, val.field);
  if (html === "") return none();
  return circle ? wrap(html) : `<div class="tx s${n.size}">${html}</div>`;
};

const imageAtom = (n: Extract<Atom, { slot: "image" }>, rc: RC): string => {
  const r = fillText(rc, n.fill);
  const val = r.kind === "val" ? r.val : NONE;
  if (val.kind === "photo") {
    const p = val.v;
    const inner = p.placeholder
      ? `<div class="xbox" data-rough="x" data-seed="${seed(rc)}"></div>`
      : `<div class="xbox has-img" data-rough="frame" data-seed="${seed(rc)}"><img src="${esc(p.dataUrl)}" alt=""></div>`;
    return `<a href="#" class="thumb" data-act="view" data-gid="${p.gid}" data-i="${p.i}">${inner}</a>`;
  }
  // 卡片里的缩略图：绑到一个图片字段，取第一张
  if (val.kind === "field") {
    const raw = val.row[val.field];
    const first = Array.isArray(raw) ? (raw[0] as { dataUrl?: string } | undefined) : undefined;
    if (rc.fid === "words" && first?.dataUrl)
      return `<div class="xbox has-img" data-rough="frame" data-seed="${seed(rc)}"><img src="${esc(first.dataUrl)}" alt=""></div>`;
    return `<div class="xbox" data-rough="x" data-seed="${seed(rc)}"></div>`;
  }
  const cap =
    val.kind === "text" && val.data && rc.fid === "words" && val.v
      ? `<span class="cap" data-copy>${esc(val.v)}</span>`
      : "";
  return `<div class="xbox" data-rough="x" data-seed="${seed(rc)}">${cap}</div>`;
};

const actionAtom = (n: Extract<Atom, { slot: "action" }>, rc: RC): string => {
  const r = fillText(rc, n.fill);
  const val = r.kind === "val" ? r.val : NONE;
  const text = val.kind === "text" ? val.v : val.kind === "field" ? rawText(val) : "";
  const label =
    rc.fid === "words" && text !== ""
      ? `<span data-copy>${esc(text)}</span>`
      : `<span class="sq in" data-rough="sq" data-seed="${seed(rc)}" data-lines="100" data-t="3" style="width:64px;height:14px"></span>`;
  const cls = `btn${n.ghost ? " ghost" : ""}`;
  if (!n.to) return `<span class="${cls}" data-rough="btn" data-seed="${seed(rc)}">${label}</span>`;
  // with：把环境的一部分带去目标页（写进地址的 ?query，目标页的表单拿它当初始值）
  const args = Object.entries(n.with ?? {})
    .map(([k, v]) => {
      const t = typeof v === "string" ? v : rawText(evalBind(rc, v.bind));
      return t === "" ? "" : `${encodeURIComponent(k)}=${encodeURIComponent(t)}`;
    })
    .filter(Boolean)
    .join("&");
  return `<a class="${cls}" data-rough="btn" data-seed="${seed(rc)}" href="#${esc(n.to)}${args ? "?" + esc(args) : ""}">${label}</a>`;
};

const atom = (n: Atom, rc: RC): string => {
  switch (n.slot) {
    case "text":
      return textAtom(n, rc);
    case "image":
      return imageAtom(n, rc);
    case "action":
      return actionAtom(n, rc);
    case "brand": {
      const r = fillText(rc, n.fill);
      const t = r.kind === "val" && r.val.kind === "text" ? r.val.v : "";
      const label =
        rc.fid === "words" && t !== ""
          ? `<span class="wm" data-copy>${esc(t)}</span>`
          : `<span class="sq in" data-rough="sq" data-seed="${seed(rc)}" data-lines="100" data-t="5" style="width:120px;height:16px"></span>`;
      return `<a class="brand" data-rough="frame" data-seed="${seed(rc)}" href="#${esc(n.to ?? "/")}">${label}</a>`;
    }
    case "nav": {
      // 放不下就收进一个手绘的菜单按钮——收不收是浏览器量出来的（mount.ts 的 fitNavs），作者只写“有哪些页面”。
      const links = n.paths
        .map((p) => `<a href="#${esc(p)}" data-nav="${esc(p)}">${esc(pageName(rc, p))}</a>`)
        .join("");
      return `<nav class="nav"><button type="button" class="btn small nav-toggle" data-rough="btn" data-seed="${seed(rc)}" data-act="nav-toggle">☰ ${esc(strings(rc.s.locale).menu)}</button><div class="nav-links">${links}</div></nav>`;
    }
    case "filters": {
      const t = rc.listType ?? pageType(rc);
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
      return rc.createType ? renderForm(rc.s, rc.db, rc.createType, null, "public", rc.sel) : "";
  }
};

// ---- 排列 ----

type Arrange = Pick<Group, "dir" | "name" | "tone" | "seq" | "rule" | "w">;

const arrangeHtml = (
  a: Arrange,
  kids: Array<{ html: string; w?: number }>,
  rc: RC,
  extraCls = "",
): string => {
  const weighted = a.dir === "row" && kids.some((k) => k.w);
  const cls = [
    "grp",
    a.dir,
    weighted ? "weighted" : "",
    a.name ? "sec" : "",
    a.tone ?? "",
    a.rule ? "ruled" : "",
    a.seq ? "seq" : "",
    extraCls,
  ]
    .filter(Boolean)
    .join(" ");
  const sep = a.dir === "col" ? "↓" : "→";
  const body = kids
    .map((k, i) => {
      const cell = weighted
        ? `<div class="cell" style="flex:${k.w ?? 1} 1 0">${k.html}</div>`
        : k.html;
      if (!a.seq) return cell;
      return `${i > 0 ? `<span class="stepsep">${sep}</span>` : ""}<div class="step"><span class="stepno" data-rough="circle" data-seed="${seed(rc)}">${i + 1}</span><div class="stepbody">${cell}</div></div>`;
    })
    .join("");
  const frame = a.tone === "card" ? ` data-rough="frame" data-seed="${seed(rc)}"` : "";
  return a.name
    ? `<section class="${cls}" data-section="${esc(a.name)}"${frame}><span class="block-tag">${esc(a.name)}</span>${body}</section>`
    : `<div class="${cls}"${frame}>${body}</div>`;
};

const eachNode = (n: Each, rc: RC): string => {
  const L = strings(rc.s.locale);
  const src = n.each;
  const as = n.as ?? "it";
  const arr: Arrange = n;
  let kids: Array<{ html: string; w?: number }> = [];
  let footer = "";

  if ("records" in src) {
    const def = rc.s.model[src.records]!;
    const all = sourceRows(rc, src) as Row[];
    const shown = all.slice(0, src.limit ?? 6);
    if (!shown.length) {
      const filtered = Object.values(rc.sel).some((v) => v.length);
      return `<div class="coll"><div class="empty">${esc(filtered ? L.emptyFiltered(def.label) : L.empty(def.label))}</div></div>`;
    }
    kids = shown.map((r) => {
      const inner = withVars(rc, as, { kind: "record", type: src.records, row: r });
      if (n.item) return { html: node(n.item, inner) };
      // 没写 item：这个类型自己的 card（没有就是 图 + 显示名），链到它的详情页
      const card = def.card ?? defaultCard(rc.s, src.records);
      const attrs = `class="card" data-rough="frame" data-seed="${seed(rc)}"`;
      const body = node(
        card,
        withVars({ ...rc, listType: undefined }, "it", {
          kind: "record",
          type: src.records,
          row: r,
        }),
      );
      return {
        html: hasPage(rc, `/${src.records}/:id`)
          ? `<a ${attrs} href="#/${esc(src.records)}/${encodeURIComponent(String(r[def.key]))}">${body}</a>`
          : `<div ${attrs}>${body}</div>`,
      };
    });
    // “共 N 个”只属于默认的卡片列表；自己写了 item 的（对比表的一列格子）不带它
    if (!n.item && all.length > shown.length)
      footer = `<div class="more">${esc(L.more(all.length))}</div>`;
  } else if ("fields" in src) {
    if (!n.item) return "";
    kids = fieldEntries(rc, src).map((e) => ({ html: node(n.item!, withVars(rc, as, e)) }));
  } else {
    // items：term/ref 的各条记录、图片、列表的各行。没有项时摆几个占位，让结构读得出来
    const rows = itemsOf(rc, src.items);
    const first = rows[0] as { dataUrl?: string; type?: string } | undefined;
    const isPhoto = first ? "dataUrl" in first : evalBindIsMedia(rc, src.items);
    const gid = `g${seed(rc)}`;
    if (isPhoto) {
      const real = rc.fid === "words" && rows.length > 0;
      const srcs = real
        ? (rows as Array<{ dataUrl: string }>).map((p) => p.dataUrl)
        : [crossedBoxSrc(), crossedBoxSrc(), crossedBoxSrc()];
      rc.viewer.set(gid, srcs);
      kids = srcs.map((u, i) => ({
        html: n.item
          ? node(
              n.item,
              withVars(rc, as, { kind: "photo", dataUrl: u, gid, i, placeholder: !real }),
            )
          : "",
      }));
    } else if (rows.length === 0 || rc.fid === "lines") {
      const count = rc.fid === "lines" ? Math.max(3, rows.length) : 0;
      kids = Array.from({ length: count }, () => ({
        html: n.item ? node(n.item, withVars(rc, as, { kind: "empty" })) : "",
      }));
      if (rows.length > 0 && rc.fid === "lines") kids = kids.slice(0, rows.length || 3);
    } else {
      kids = rows.map((r) => {
        const v: RVar =
          "type" in (r as object) && "row" in (r as object)
            ? { kind: "record", type: (r as { type: string }).type, row: (r as { row: Row }).row }
            : { kind: "row", row: r as Row };
        return { html: n.item ? node(n.item, withVars(rc, as, v)) : "" };
      });
    }
  }
  const html = arrangeHtml(
    arr,
    kids.map((k) => ({ ...k })),
    rc,
    "each",
  );
  return footer ? `<div class="coll">${html}${footer}</div>` : html;
};

/** items 来源指向的是图片字段吗（没有项时也要知道该摆叉框还是圆圈）。 */
const evalBindIsMedia = (rc: RC, path: string): boolean => {
  const val = evalBind(rc, path);
  return val.kind === "field" && rc.s.model[val.type]?.fields[val.field]?.kind === "media";
};

/** 没写 card 的类型：图 + 显示名。 */
const defaultCard = (s: Sketch, type: string): Node => ({
  group: [
    { slot: "image" },
    { slot: "text", size: 3, fill: { bind: `it.${s.model[type]!.title ?? s.model[type]!.key}` } },
  ],
  dir: "col",
});

export const node = (n: Node, rc: RC): string => {
  if ("group" in n)
    return arrangeHtml(
      n,
      n.group.map((c) => ({ html: node(c, rc), w: c.w })),
      rc,
    );
  if ("each" in n) return eachNode(n, rc);
  return atom(n, rc);
};
