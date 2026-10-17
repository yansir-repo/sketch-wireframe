/**
 * 写草图配置时用的构建函数。纯函数，不碰 DOM（Node 里的 check/init 也要加载配置）。
 *
 *   section("Hero", row(col(text(1), text(2), row(action("获取报价", "/inquiry"), action("看产品", "/category", { ghost: true }))), image()))
 *
 * 没有 hero/卡片/网格这类“变体”：经典布局就是这些原子的组合，想复用就在配置里写个函数。
 */
import { FORMAT_VERSION } from "./schema.ts";
import type {
  Bind,
  Fill,
  Field,
  Group,
  Node,
  Option,
  Row,
  Sketch,
  Slot,
  TextSize,
  TypeDef,
} from "./schema.ts";

// ---- 组 ----
export const col = (...children: Node[]): Group => ({ group: children, dir: "col" });
export const row = (...children: Node[]): Group => ({ group: children, dir: "row" });
/** 带名字的组 = 一个“框”：客户看到的板块，名字是标注，不是文案。 */
export const section = (name: string, ...children: Node[]): Group => ({
  group: children,
  dir: "col",
  name,
});
export const accent = <T extends Node>(n: T): T => ({ ...n, tone: "accent" }) as T;

/** 在一行里占 w 份：span(1, 侧栏), span(3, 内容)。 */
export const span = <T extends Node>(w: number, n: T): T => ({ ...n, w }) as T;

// ---- 填充 ----
export const bind = (path: string): Bind => ({ bind: path });

// ---- 槽 ----
export const text = (size: TextSize, fill?: Fill): Slot => ({
  slot: "text",
  size,
  ...(fill === undefined ? {} : { fill }),
});
export const image = (fill?: Fill): Slot => ({
  slot: "image",
  ...(fill === undefined ? {} : { fill }),
});
export const action = (fill?: Fill, to?: string, opts: { ghost?: boolean } = {}): Slot => ({
  slot: "action",
  ...(fill === undefined ? {} : { fill }),
  ...(to === undefined ? {} : { to }),
  ...(opts.ghost ? { ghost: true } : {}),
});
/** 品牌：logo 或字标，点它回首页。没填 = 粗波浪线字标。 */
export const brand = (fill?: Fill, to = "/"): Slot => ({
  slot: "brand",
  ...(fill === undefined ? {} : { fill }),
  to,
});
export const nav = (...paths: string[]): Slot => ({ slot: "nav", paths });
export const collection = (
  type: string,
  opts: { where?: Record<string, string>; limit?: number; notSelf?: boolean } = {},
): Slot => ({ slot: "collection", type, ...opts });
/** 当前记录的字段表。skip = 去掉哪些；only = 只要哪些（按这个顺序）。一页里想分成几个板块，就每个板块写自己的 only。 */
export const facts = (opts: { skip?: string[]; only?: string[] } = {}): Slot => ({
  slot: "facts",
  ...opts,
});
export const badges = (field: string): Slot => ({ slot: "badges", field });
export const gallery = (field: string): Slot => ({ slot: "gallery", field });
/** 筛选：字段由模型推出（term/choice/bool），这里只选哪些字段出现。 */
export const filters = (...fields: string[]): Slot => ({ slot: "filters", fields });
export const form = (): Slot => ({ slot: "form" });

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
