/**
 * 写草图配置时用的构建函数。纯函数，不碰 DOM（Node 里的 check/init 也要加载配置）。
 *
 *   section("Hero", row(col(text(1), text(2), row(action("获取报价", "/inquiry"), action("看产品", "/category", { ghost: true }))), image()))
 *
 * 只有三种东西：叶子（text/image/action/brand/nav/filters/form）、排列（col/row/grid）、生成（each）。
 * collection / facts / badges / gallery / compare / steps 都是 each 的简写，不是槽——下面每一个都只是几行 each。
 * 没有 hero/卡片这类“变体”：经典布局就是这些的组合，想复用就在配置里写个函数。
 */
import { FORMAT_VERSION } from "./schema.ts";
import type {
  Atom,
  Bind,
  Count,
  Each,
  Field,
  Fill,
  Group,
  Node,
  Option,
  Row,
  Sketch,
  Source,
  TextSize,
  Tone,
  TypeDef,
} from "./schema.ts";

// ---- 排列 ----
export const col = (...children: Node[]): Group => ({ group: children, dir: "col" });
export const row = (...children: Node[]): Group => ({ group: children, dir: "row" });
/** 横向折行、等分：一排卡片。 */
export const grid = (...children: Node[]): Group => ({ group: children, dir: "grid" });
/** 带名字的组 = 一个“框”：客户看到的板块，名字是标注，不是文案。 */
export const section = (name: string, ...children: Node[]): Group => ({
  group: children,
  dir: "col",
  name,
});
export const accent = <T extends Node>(n: T): T => ({ ...n, tone: "accent" }) as T;
/** 一张卡片（有框）。 */
export const card = (...children: Node[]): Group => ({ group: children, dir: "col", tone: "card" });
/** 一对“名 | 值”（字段表的一行）。 */
export const pair = (label: Node, value: Node): Group => ({
  group: [label, value],
  dir: "row",
  tone: "pair",
});
/** 孩子有顺序（流程）：序号和连接线由引擎画。 */
export const steps = (...children: Node[]): Group => ({ group: children, dir: "row", seq: true });
/** 孩子之间有分隔线。 */
export const ruled = <T extends Group | Each>(n: T): T => ({ ...n, rule: true }) as T;

/** 在一行里占 w 份：span(1, 侧栏), span(3, 内容)。 */
export const span = <T extends Node>(w: number, n: T): T => ({ ...n, w }) as T;

// ---- 填充 ----
export const bind = (path: string): Bind => ({ bind: path });
/** 对一个来源的计数。 */
export const count = (source: Source): Count => ({ count: source });

// ---- 叶子 ----
export const text = (size: TextSize, fill?: Fill, opts: { circle?: boolean } = {}): Atom => ({
  slot: "text",
  size,
  ...(fill === undefined ? {} : { fill }),
  ...(opts.circle ? { tone: "circle" as const } : {}),
});
export const image = (fill?: Fill): Atom => ({
  slot: "image",
  ...(fill === undefined ? {} : { fill }),
});
export const action = (
  fill?: Fill,
  to?: string,
  opts: { ghost?: boolean; with?: Record<string, string | Bind> } = {},
): Atom => ({
  slot: "action",
  ...(fill === undefined ? {} : { fill }),
  ...(to === undefined ? {} : { to }),
  ...(opts.ghost ? { ghost: true } : {}),
  ...(opts.with ? { with: opts.with } : {}),
});
/** 品牌：logo 或字标，点它回首页。没填 = 粗波浪线字标。 */
export const brand = (fill?: Fill, to = "/"): Atom => ({
  slot: "brand",
  ...(fill === undefined ? {} : { fill }),
  to,
});
export const nav = (...paths: string[]): Atom => ({ slot: "nav", paths });
/** 筛选：字段由模型推出（term/ref/choice/bool），这里只选哪些字段出现。 */
export const filters = (...fields: string[]): Atom => ({ slot: "filters", fields });
export const form = (): Atom => ({ slot: "form" });

// ---- 生成 ----
export type ArrangeOpts = {
  as?: string;
  dir?: "col" | "row" | "grid";
  name?: string;
  tone?: Tone;
  seq?: boolean;
  rule?: boolean;
};

/**
 * 对一个关系逐项生成：`each(来源, 每一项怎么画, 排列)`。来源是 records / fields / items；
 * 每一项在模板里叫 `as`（默认 it），模板里用 bind("x.字段") 取值；嵌套的 each 起不同的名字。
 */
export const each = (source: Source, item?: Node, opts: ArrangeOpts = {}): Each => ({
  each: source,
  ...(item === undefined ? {} : { item }),
  dir: opts.dir ?? "col",
  ...(opts.as ? { as: opts.as } : {}),
  ...(opts.name ? { name: opts.name } : {}),
  ...(opts.tone ? { tone: opts.tone } : {}),
  ...(opts.seq ? { seq: true } : {}),
  ...(opts.rule ? { rule: true } : {}),
});

/** 某个类型的记录（可带条件）。 */
export const records = (
  type: string,
  opts: { where?: Record<string, string>; limit?: number; notSelf?: boolean } = {},
): Source => ({ records: type, ...opts });
/** 某条记录的字段（默认当前记录）：每一项有 label 和 value；kv 列表展开成一项一行参数。 */
export const fields = (
  opts: { of?: string; type?: string; only?: string[]; skip?: string[] } = {},
): Source => ({ fields: opts });
/** 一个多值字段里的各项（term/ref 的各条记录、图片、列表的各行）。 */
export const items = (path: string): Source => ({ items: path });

// ---- 简写：都只是几行 each ----

/** 一排某类型的记录卡片（用那个类型的 card，点进详情页）。 */
export const collection = (
  type: string,
  opts: { where?: Record<string, string>; limit?: number; notSelf?: boolean } = {},
): Each => each(records(type, opts), undefined, { dir: "grid" });

/** 当前记录的字段表。skip = 去掉哪些；only = 只要哪些（按这个顺序）。一页想分成几个板块，就每个板块写自己的 only。 */
export const facts = (opts: { skip?: string[]; only?: string[] } = {}): Each =>
  each(fields(opts), pair(text(3, bind("e.label")), text(3, bind("e.value"))), {
    as: "e",
    dir: "col",
    rule: true,
  });

/** 多值 term/ref 字段的一圈圆圈标签。 */
export const badges = (field: string): Each =>
  each(items(field), text(3, bind("it.@title"), { circle: true }), { dir: "row" });

/** 图片字段的图库（点开放大）。 */
export const gallery = (field: string): Each =>
  each(items(field), image(bind("it")), { dir: "row" });

/**
 * 对比表：一个类型的几个字段（行）× 若干条记录（列）。字段名是行头，每一格是那条记录的那个字段——
 * 两层 each：外层逐个字段，内层逐条记录。
 */
export const compare = (
  type: string,
  rows: string[],
  of: { where?: Record<string, string>; limit?: number; header?: Node } = {},
): Each =>
  each(
    fields({ type, only: rows }),
    row(
      text(3, bind("f.label")),
      each(records(type, { where: of.where, limit: of.limit }), text(3, bind("p.{f.field}")), {
        as: "p",
        dir: "row",
      }),
    ),
    { as: "f", dir: "col", rule: true },
  );

// ---- 字段 ----
export const f = {
  text: (
    label: string,
    o: { multiline?: boolean; table?: boolean; detail?: boolean; internal?: boolean } = {},
  ): Field => ({ kind: "text", label, ...o }),
  number: (
    label: string,
    o: { table?: boolean; detail?: boolean; internal?: boolean } = {},
  ): Field => ({
    kind: "number",
    label,
    ...o,
  }),
  bool: (
    label: string,
    o: { table?: boolean; detail?: boolean; internal?: boolean } = {},
  ): Field => ({
    kind: "bool",
    label,
    ...o,
  }),
  choice: (
    label: string,
    options: Option[],
    o: { radio?: boolean; table?: boolean; detail?: boolean; internal?: boolean } = {},
  ): Field => ({ kind: "choice", label, options, ...o }),
  /** 引用词表里的条目；multiple 多选。 */
  term: (
    label: string,
    to: string,
    o: { multiple?: boolean; table?: boolean; detail?: boolean; internal?: boolean } = {},
  ): Field => ({ kind: "term", label, to, ...o }),
  /** 引用另一个内容类型的记录（相关产品、相关案例）；存对方的主键，multiple 多选。详情页的 facts 里显示成指向它的链接。 */
  ref: (
    label: string,
    to: string,
    o: { multiple?: boolean; table?: boolean; detail?: boolean; internal?: boolean } = {},
  ): Field => ({ kind: "ref", label, to, ...o }),
  media: (label: string, o: { detail?: boolean; internal?: boolean } = {}): Field => ({
    kind: "media",
    label,
    multiple: true,
    ...o,
  }),
  /** 每个型号自己的可变长结构：行数和列名都是数据。kv=true 时第一列当名、第二列当值。 */
  list: (
    label: string,
    columns: Record<string, string>,
    o: { kv?: boolean; detail?: boolean; internal?: boolean } = {},
  ): Field => ({ kind: "list", label, columns, ...o }),
};

// ---- 类型 ----
export const defType = (
  label: string,
  def: Omit<TypeDef, "label" | "seed"> & { seed?: Row[] },
): TypeDef => ({ label, seed: [], ...def });

/** 词表：有限、多条目共用，被 term 引用。条目：字符串（id = label）、[id, 名称]、或带额外文字字段的对象。id 会进网址，别用中文。 */
export const vocab = (
  label: string,
  entries: Array<
    string | [id: string, label: string] | ({ id: string; label: string } & Record<string, string>)
  >,
): TypeDef => {
  const rows = entries.map((e) =>
    typeof e === "string" ? { id: e, label: e } : Array.isArray(e) ? { id: e[0], label: e[1] } : e,
  );
  const extras = new Set<string>();
  for (const r of rows)
    for (const k of Object.keys(r)) if (k !== "id" && k !== "label") extras.add(k);
  return {
    label,
    vocab: true,
    key: "id",
    title: "label",
    fields: {
      id: f.text("编码"),
      label: f.text("名称", { table: true }),
      ...Object.fromEntries([...extras].map((k) => [k, f.text(k)])),
    },
    seed: rows,
  };
};

/** 一份草图的入口：补上格式版本。写配置的人不用关心 v。 */
export const defineSketch = (s: Omit<Sketch, "v">): Sketch => ({ v: FORMAT_VERSION, ...s });
