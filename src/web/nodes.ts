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
import { applySel, facetsOf, toQuery, type Sel } from "./facets.ts";
import { display, esc, isEmpty, recordTitle } from "./fmt.ts";
import { factFields, parseOrder, searchFields, sortable } from "../shared/facts.ts";
import { clampPage, compareKeys, pageCount, sortKey } from "../shared/order.ts";
import { isMultiParam, parsePath } from "../shared/scope.ts";
import { scalar } from "../shared/scalar.ts";
import type {
  Atom,
  Each,
  Field,
  Fill,
  Group,
  Node,
  Page,
  ParamDecl,
  RecordsSource,
  Row,
  Sketch,
  Source,
} from "../shared/schema.ts";
import { strings } from "../shared/strings.ts";

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
  | { kind: "empty" }
  /** facets 来源的一项：一个筛选字段和它的各个选项。 */
  | { kind: "facet"; field: string; label: string; options: OptionVar[] }
  /** 一个选项（筛选字段的某个值，或状态参数的某个取值）。count = 再选它还剩几个（状态参数没有）。 */
  | OptionVar;
export type OptionVar = {
  kind: "option";
  value: string;
  label: string;
  count?: number;
  on: boolean;
};

export type RC = {
  s: Sketch;
  db: Db;
  fid: Fidelity;
  pages: Record<string, Page>;
  params: Record<string, string>;
  /** 环境：变量名 → 值；it = 当前记录的变量名。 */
  vars: ReadonlyMap<string, RVar>;
  it?: string;
  /** 这个页面能用的状态参数（页面自己声明的 + 会话级的）；筛选的参数不用声明。 */
  state: Readonly<Record<string, ParamDecl>>;
  /** 会话级参数在浏览器里存着的值（换页不丢）。地址里有就以地址为准。 */
  stored?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** 新增表单页：在新增哪个类型（form 要知道）。 */
  createType?: string;
  /** 列表页在列哪个类型（filters 要知道）。 */
  listType?: string;
  /** 列表页自己的固定条件（ctx.where），筛选的“全集”就是它。 */
  listWhere?: Record<string, string>;
  /** 当前选中的筛选/初始值（来自地址的 ?query）和当前路径（筛选链接要回到这一页）。 */
  sel: Sel;
  path: string;
  /** 正在渲染一个 embed 里的树：里面不再展开 embed。 */
  inEmbed?: boolean;
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
  // ui.xxx：引擎自带的文案（按草图的 locale）——标注，不是作者的文案
  if (first && "lit" in first && first.lit === "ui" && !rc.vars.has("ui")) {
    const k = segs[1];
    const table = strings(rc.s.locale) as unknown as Record<string, unknown>;
    return k && "lit" in k && typeof table[k.lit] === "string"
      ? { kind: "text", v: table[k.lit] as string, data: false }
      : NONE;
  }
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
    case "facet":
      // 筛选字段的名字是标注（字段名）：两档都显示
      if (name === "label") return { kind: "text", v: v.label, data: false };
      if (name === "field") return { kind: "text", v: v.field, data: false };
      return NONE;
    case "option":
      if (name === "label") return { kind: "text", v: v.label, data: true };
      if (name === "value") return { kind: "text", v: v.value, data: true };
      if (name === "count")
        return { kind: "text", v: v.count === undefined ? "" : String(v.count), data: true };
      return NONE;
    default:
      return NONE;
  }
};

// ---- 状态：参数、条件出现、链接 ----

const isSession = (rc: RC, name: string): boolean => rc.s.session?.[name] !== undefined;

/** 一个参数现在的值：地址里有就用地址的；会话级参数其次用浏览器里存着的；单选参数最后取 default。 */
const paramNow = (rc: RC, name: string): string[] => {
  const given = rc.sel[name];
  if (given && given.length) return given;
  const kept = rc.stored?.[name];
  if (kept && kept.length) return [...kept];
  const d = rc.state[name]?.default;
  return d !== undefined ? [d] : [];
};

const paramMulti = (rc: RC, name: string): boolean =>
  isMultiParam({ vars: new Map(), it: undefined, state: rc.state }, name);

export const shown = (
  rc: RC,
  w: { param: string | ReadonlyArray<string>; is?: string } | undefined,
): boolean => {
  if (!w) return true;
  const names = typeof w.param === "string" ? [w.param] : [...w.param];
  return names.some((p) => {
    const now = paramNow(rc, p);
    return w.is === undefined ? now.length > 0 : now.includes(w.is);
  });
};

/** set 的键/值里的 {f.field} 和 bind，按环境求成字符串。 */
const setEntries = (
  rc: RC,
  set: Readonly<Record<string, string | { bind: string }>>,
): Array<[string, string]> =>
  Object.entries(set).map(([k, v]) => {
    const key = k.startsWith("{") && k.endsWith("}") ? rawText(evalBind(rc, k.slice(1, -1))) : k;
    return [key, typeof v === "string" ? v : rawText(evalBind(rc, v.bind))];
  });

/** 改参数后的地址：单选是“设成”（等于 default 就省掉），多选是“切换”，空串清掉；其余参数原样带着。 */
const hrefSet = (rc: RC, set: Readonly<Record<string, string | { bind: string }>>): string => {
  const next: Sel = { ...rc.sel };
  for (const [k, v] of setEntries(rc, set)) {
    // 会话级参数永远写明在地址里：省掉 default 的话，浏览器里存着的旧值会盖回来
    if (v === "") {
      if (isSession(rc, k) && rc.state[k]?.default !== undefined) next[k] = [rc.state[k]!.default!];
      else delete next[k];
    } else if (paramMulti(rc, k)) {
      const cur = next[k] ?? [];
      next[k] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      if (next[k]!.length === 0) delete next[k];
    } else if (rc.state[k]?.default === v && !isSession(rc, k)) delete next[k];
    else next[k] = [v];
  }
  const qs = toQuery(next, Object.keys(next));
  return `#${rc.path}${qs ? "?" + qs : ""}`;
};

/** 这个 set 现在是不是“选中”的（标签页的当前标签、被勾上的选项）。 */
const setActive = (rc: RC, set: Readonly<Record<string, string | { bind: string }>>): boolean => {
  const es = setEntries(rc, set).filter(([, v]) => v !== "");
  return es.length > 0 && es.every(([k, v]) => paramNow(rc, k).includes(v));
};

/** 选项“没得选”：选它会一个都不剩，而且它还没被选上。 */
const setDim = (rc: RC, set: Readonly<Record<string, string | { bind: string }>>): boolean =>
  Object.values(set).some((v) => {
    if (typeof v === "string") return false;
    const head = parsePath(v.bind)[0];
    const o = head && "lit" in head ? rc.vars.get(head.lit) : undefined;
    return o?.kind === "option" && o.count === 0 && !o.on;
  });

/** 去别的页：?query 只带 with 里写的（目标页的表单拿它们当初始值）。 */
const hrefTo = (
  rc: RC,
  to: string,
  withArgs: Readonly<Record<string, string | { bind: string }>> | undefined,
): string => {
  const args = Object.entries(withArgs ?? {})
    .map(([k, v]) => {
      const t = typeof v === "string" ? v : rawText(evalBind(rc, v.bind));
      return t === "" ? "" : `${encodeURIComponent(k)}=${encodeURIComponent(t)}`;
    })
    .filter(Boolean)
    .join("&");
  return `#${to}${args ? "?" + args : ""}`;
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
  const v = evalFold(rc, fill.fold);
  return v === null ? { kind: "none" } : { kind: "val", val: { kind: "text", v, data: true } };
};

/** 折叠：count 数项数（空集是 0）；sum/min/max/avg 对数字字段，没有数据 = null（画波浪线，不编）。 */
const evalFold = (rc: RC, f: { op: string; of: Source; field?: string }): string | null => {
  if ("distinct" in f.of)
    return f.op === "count" ? String(distinctOf(rc, f.of.distinct).length) : null;
  const rows = sourceRows(rc, f.of);
  if (f.op === "count") return String(rows.length);
  const field = f.field;
  if (!field) return null;
  const nums = rows
    .map((r) => {
      const row = (
        r && typeof r === "object" && "row" in (r as object) ? (r as { row: Row }).row : r
      ) as Row;
      const raw = row[field];
      return raw === "" || raw == null ? NaN : Number(raw);
    })
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  const total = nums.reduce((a, b) => a + b, 0);
  const out =
    f.op === "sum"
      ? total
      : f.op === "min"
        ? Math.min(...nums)
        : f.op === "max"
          ? Math.max(...nums)
          : total / nums.length;
  return String(Math.round(out * 100) / 100);
};

/** distinct：一个字段出现过的各个值（多值字段逐个展开），每项带“有这个值的记录数”。 */
const distinctOf = (rc: RC, d: { type: string; field: string }): OptionVar[] => {
  const counts = new Map<string, number>();
  for (const r of rc.db.list(d.type)) {
    const raw = r[d.field];
    for (const v of (Array.isArray(raw) ? raw : isEmpty(raw) ? [] : [raw]).map(scalar))
      counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts].map(([value, count]) => ({
    kind: "option" as const,
    value,
    label: display(rc.s, rc.db, d.type, { [d.field]: value }, d.field) || value,
    count,
    on: false,
  }));
};

// ---- 来源 ----

/** 地址里的参数里，哪些是对这个类型的字段筛选（状态参数不是）。 */
const filterKeys = (rc: RC, type: string): string[] =>
  Object.keys(rc.sel).filter((k) => !rc.state[k] && rc.s.model[type]?.fields[k] !== undefined);

/** where 里的 {x.value}：条件的值来自环境里的一个变量（分组统计里“这一组的值”）。 */
const resolveWhere = (rc: RC, where: Readonly<Record<string, string>> | undefined) =>
  where === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(where).map(([k, v]) => [
          k,
          v.startsWith("{") && v.endsWith("}") ? rawText(evalBind(rc, v.slice(1, -1))) : v,
        ]),
      );

/** 自由文本参数现在的值（搜索词）：地址里 ?q=a,b 被拆成了两段，拼回去。 */
const freeNow = (rc: RC, param: string): string => paramNow(rc, param).join(",").trim();

/** records 的排序：写死的字段，或由单选参数的值决定；值不是字段（地址被手改过）就不排。 */
const orderOf = (rc: RC, src: RecordsSource): string | undefined =>
  src.order === undefined
    ? undefined
    : typeof src.order === "string"
      ? src.order
      : paramNow(rc, src.order.param)[0];

const sortRows = (rc: RC, type: string, rows: Row[], order: string): Row[] => {
  const { field, desc } = parseOrder(order);
  const fd = rc.s.model[type]?.fields[field];
  if (!fd || !sortable(rc.s, type, field)) return rows;
  const key = new Map(
    rows.map((r) => [r, sortKey(fd.kind, r[field], display(rc.s, rc.db, type, r, field))]),
  );
  return [...rows].sort((a, b) => compareKeys(key.get(a)!, key.get(b)!, desc));
};

/** 搜索：词（不分大小写）出现在可搜字段的显示文字里。 */
const searchRows = (rc: RC, type: string, rows: Row[], term: string): Row[] => {
  const t = term.toLowerCase();
  const names = searchFields(rc.s, type);
  return t === ""
    ? rows
    : rows.filter((r) =>
        names.some((n) => display(rc.s, rc.db, type, r, n).toLowerCase().includes(t)),
      );
};

const pageNow = (rc: RC, src: RecordsSource, total: number): number =>
  clampPage(freeNow(rc, src.page!.param), total);

const sourceRows = (rc: RC, src: Source): unknown[] => {
  if ("pages" in src) return sourceRows(rc, src.pages);
  if ("records" in src) {
    let rows = query(
      rc.db,
      src.records,
      resolveWhere(rc, src.where),
      { params: rc.params, record: pageRecord(rc) },
      (t) => keyOf(rc.s, t),
      !!src.notSelf,
    );
    if (src.records === rc.listType) rows = applySel(rows, rc.sel, filterKeys(rc, src.records));
    if (src.search) rows = searchRows(rc, src.records, rows, freeNow(rc, src.search.param));
    const order = orderOf(rc, src);
    if (order) rows = sortRows(rc, src.records, rows, order);
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
  // set：改当前页的状态参数（标签头、手风琴标题）；选中的那个实心
  const on = n.set && setActive(rc, n.set);
  const cls = `btn${n.ghost && !on ? " ghost" : ""}${on ? " on" : ""}`;
  if (n.set)
    return `<a class="${cls}" data-rough="btn" data-seed="${seed(rc)}" href="${esc(hrefSet(rc, n.set))}">${label}</a>`;
  if (!n.to) return `<span class="${cls}" data-rough="btn" data-seed="${seed(rc)}">${label}</span>`;
  // with：把环境的一部分带去目标页（写进地址的 ?query，目标页的表单拿它当初始值）
  return `<a class="${cls}" data-rough="btn" data-seed="${seed(rc)}" href="${esc(hrefTo(rc, n.to, n.with))}">${label}</a>`;
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
    case "embed": {
      // 把字段里存的树渲染出来；树里不能再有 embed / form / nav / brand（校验已经挡了，这里再保一道：一定终止）
      if (rc.inEmbed) return "";
      const r = fillText(rc, n.fill);
      const val = r.kind === "val" ? r.val : NONE;
      const raw = val.kind === "field" ? val.row[val.field] : undefined;
      const kids = Array.isArray(raw) ? (raw as Node[]) : [];
      const inner = kids
        .map((k) => (k && typeof k === "object" ? node(k, { ...rc, inEmbed: true }) : ""))
        .join("");
      return `<div class="embed">${inner}</div>`;
    }
    case "search": {
      // 回车把输入的文字写进参数（mount.ts 听 [data-search]）；data-base 是“清掉这个参数”的地址，别的参数原样带着
      const r = fillText(rc, n.fill);
      const hint = rc.fid === "words" && r.kind === "val" && r.val.kind === "text" ? r.val.v : "";
      const base = hrefSet(rc, { [n.param]: "" });
      return `<label class="search" data-rough="frame" data-seed="${seed(rc)}"><input type="search" data-search="${esc(n.param)}" data-base="${esc(base)}" value="${esc(freeNow(rc, n.param))}" placeholder="${esc(hint || " ")}"${hint ? " data-copy" : ""}>${hint ? "" : `<span class="sq in" data-rough="sq" data-seed="${seed(rc)}" data-lines="100" data-t="3" style="width:96px;height:12px"></span>`}</label>`;
    }
    case "form":
      return rc.createType ? renderForm(rc.s, rc.db, rc.createType, null, "public", rc.sel) : "";
  }
};

// ---- 排列 ----

type Arrange = Pick<Group, "dir" | "name" | "tone" | "seq" | "rule" | "w" | "link">;

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
  // 可选项带一个手绘的勾选框；选中与否由参数推出
  const cb =
    a.tone === "opt" ? `<span class="cb" data-rough="frame" data-seed="${seed(rc)}"></span>` : "";
  if (a.link) {
    const set = a.link.set;
    const href = set ? hrefSet(rc, set) : a.link.to ? hrefTo(rc, a.link.to, a.link.with) : "#";
    const state = `${set && setActive(rc, set) ? " on" : ""}${set && setDim(rc, set) ? " dim" : ""}`;
    return `<a class="${cls}${state}" href="${esc(href)}">${cb}${body}</a>`;
  }
  return a.name
    ? `<section class="${cls}" data-section="${esc(a.name)}"${frame}><span class="block-tag">${esc(a.name)}</span>${cb}${body}</section>`
    : `<div class="${cls}"${frame}>${cb}${body}</div>`;
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
    const per = src.limit ?? 6;
    const p = src.page ? pageNow(rc, src, pageCount(all.length, per)) : 1;
    const shown = all.slice((p - 1) * per, p * per);
    if (!shown.length) {
      const filtered = filterKeys(rc, src.records).some((k) => rc.sel[k]?.length);
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
    if (!n.item && !src.page && all.length > shown.length)
      footer = `<div class="more">${esc(L.more(all.length))}</div>`;
  } else if ("pages" in src) {
    if (!n.item) return "";
    const per = src.pages.limit ?? 6;
    const total = pageCount(sourceRows(rc, src.pages).length, per);
    if (total <= 1) return "";
    const now = pageNow(rc, src.pages, total);
    kids = Array.from({ length: total }, (_, i) => String(i + 1)).map((v) => ({
      html: node(
        n.item!,
        withVars(rc, as, { kind: "option", value: v, label: v, on: Number(v) === now }),
      ),
    }));
  } else if ("fields" in src) {
    if (!n.item) return "";
    kids = fieldEntries(rc, src).map((e) => ({ html: node(n.item!, withVars(rc, as, e)) }));
  } else if ("facets" in src) {
    // 筛选面：每个字段一项（选项不足两个的字段不出现），每项带自己的各个选项
    const t = rc.listType ?? pageType(rc);
    if (!t || !n.item) return "";
    const base = query(rc.db, t, rc.listWhere, { params: rc.params }, (x) => keyOf(rc.s, x));
    const found = facetsOf(rc.s, rc.db, t, src.facets, base, rc.sel, L);
    kids = found.map((f) => ({
      html: node(
        n.item!,
        withVars(rc, as, {
          kind: "facet",
          field: f.field,
          label: f.label,
          options: f.options.map((o) => ({ kind: "option", ...o })),
        }),
      ),
    }));
  } else if ("options" in src) {
    const f = rc.vars.get(src.options);
    if (f?.kind !== "facet" || !n.item) return "";
    kids = f.options.map((o) => ({ html: node(n.item!, withVars(rc, as, o)) }));
  } else if ("distinct" in src) {
    if (!n.item) return "";
    kids = distinctOf(rc, src.distinct).map((o) => ({ html: node(n.item!, withVars(rc, as, o)) }));
  } else if ("param" in src) {
    const decl = rc.state[src.param];
    if (!decl || !n.item) return "";
    const now = paramNow(rc, src.param);
    kids = decl.values.map((v) => ({
      html: node(
        n.item!,
        withVars(rc, as, { kind: "option", value: v, label: v, on: now.includes(v) }),
      ),
    }));
  } else if ("items" in src) {
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
  if (!shown(rc, n.when)) return "";
  if ("group" in n)
    return arrangeHtml(
      n,
      n.group.map((c) => ({ html: node(c, rc), w: c.w })),
      rc,
    );
  if ("each" in n) return eachNode(n, rc);
  return atom(n, rc);
};
