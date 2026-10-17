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
  Fold,
  FoldOp,
  Each,
  Field,
  Fill,
  Group,
  Node,
  ParamDecl,
  MediaKind,
  Option,
  RecordsSource,
  Row,
  Sketch,
  Source,
  TextSize,
  Tone,
  TypeDef,
  When,
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
/** 对一个来源折叠成一个值。 */
export const fold = (op: FoldOp, of: Source, field?: string): Fold => ({
  fold: { op, of, ...(field === undefined ? {} : { field }) },
});
/** 数项数（“本分类共 12 个型号”）。 */
export const count = (of: Source): Fold => fold("count", of);
export const sum = (of: Source, field: string): Fold => fold("sum", of, field);
export const min = (of: Source, field: string): Fold => fold("min", of, field);
export const max = (of: Source, field: string): Fold => fold("max", of, field);
export const avg = (of: Source, field: string): Fold => fold("avg", of, field);

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
  opts: {
    ghost?: boolean;
    with?: Record<string, string | Bind>;
    set?: Record<string, string | Bind>;
  } = {},
): Atom => ({
  slot: "action",
  ...(fill === undefined ? {} : { fill }),
  ...(to === undefined ? {} : { to }),
  ...(opts.ghost ? { ghost: true } : {}),
  ...(opts.with ? { with: opts.with } : {}),
  ...(opts.set ? { set: opts.set } : {}),
});
/** 视频、地图、图表、图标、文件下载的占位（不是图片）：`media("video")`。fill = 一句说明，不写 = 无。 */
export const media = (kind: MediaKind, fill?: Fill): Atom => ({
  slot: "media",
  kind,
  ...(fill === undefined ? {} : { fill }),
});
/** 品牌：logo 或字标，点它回首页。没填 = 粗波浪线字标。 */
export const brand = (fill?: Fill, to = "/"): Atom => ({
  slot: "brand",
  ...(fill === undefined ? {} : { fill }),
  to,
});
export const nav = (...paths: string[]): Atom => ({ slot: "nav", paths });
export const form = (): Atom => ({ slot: "form" });
/** 搜索框：回车把输入的文字写进自由文本参数 param（?q=…），列表的 search 读它。fill = 框里的提示字（不写 = 波浪线）。 */
export const search = (param: string, fill?: Fill): Atom => ({
  slot: "search",
  param,
  ...(fill === undefined ? {} : { fill }),
});
/** 渲染一个 blocks 字段里存的树（文章正文）。 */
export const embed = (fill?: Fill): Atom => ({
  slot: "embed",
  ...(fill === undefined ? {} : { fill }),
});

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

/**
 * 某个类型的记录（可带条件）。order：`"-date"` 倒序 / `"name"` 正序 / `{ param }` 由页面参数决定；
 * search / page：`{ param }`，搜索词和页码来自页面的自由文本参数（free()）；page 要和 limit 一起写（每页几条）。
 */
export type RecordsOpts = {
  where?: Record<string, string>;
  limit?: number;
  notSelf?: boolean;
  order?: string | { param: string };
  search?: { param: string };
  page?: { param: string };
};
export const records = (type: string, opts: RecordsOpts = {}): RecordsSource => ({
  records: type,
  ...opts,
});
/** 一个分页的各页：每页一项（label / value / on）。传的就是列表用的那个 records 来源。 */
export const pages = (of: RecordsSource): Source => ({ pages: of });
/** 某条记录的字段（默认当前记录）：每一项有 label 和 value；kv 列表展开成一项一行参数。 */
export const fields = (
  opts: { of?: string; type?: string; only?: string[]; skip?: string[] } = {},
): Source => ({ fields: opts });
/** 某个类型的某个字段出现过的各个值，每项有 label / value / count（有这个值的记录数）：分组统计。 */
export const distinct = (type: string, field: string): Source => ({ distinct: { type, field } });
/** 一个多值字段里的各项（term/ref 的各条记录、图片、列表的各行）。 */
export const items = (path: string): Source => ({ items: path });

// ---- 状态：参数 + 条件出现 + 可点的组 ----

/** 单选的状态参数（标签页）：取值有限，没有值时取 default（默认第一个）。 */
export const oneOf = (values: string[], dflt?: string): ParamDecl => ({
  values,
  default: dflt ?? values[0],
});
/** 多选的状态参数（手风琴）：可以同时有几个值，默认一个都没有。 */
export const manyOf = (values: string[]): ParamDecl => ({ values, multi: true });

/** 自由文本的状态参数（搜索词、页码）：取值不是有限集合，验证器只抽样；default 是不写时的值（页码 "1"）。 */
export const free = (dflt?: string): ParamDecl => ({
  values: [],
  free: true,
  ...(dflt === undefined ? {} : { default: dflt }),
});

/** 条件出现。`"tab=specs"` = tab 等于 specs；`"open=q1"` 对多选参数是“包含”；`"a|b"` = 几个参数里任意一个有值。 */
export const when = <T extends Node>(cond: string | When, n: T): T => {
  const w: When =
    typeof cond !== "string"
      ? cond
      : (() => {
          const [p, is] = cond.split("=");
          const names = p!.split("|");
          return {
            param: names.length === 1 ? names[0]! : names,
            ...(is === undefined ? {} : { is }),
          };
        })();
  return { ...n, when: w } as T;
};

/** 让一个组成为链接：去 to（带上 with），或者改当前页的状态参数（set）。选中与否由地址里的参数推出。 */
export const linked = <T extends Group | Each>(
  n: T,
  link: { to?: string; with?: Record<string, string | Bind>; set?: Record<string, string | Bind> },
): T => ({ ...n, link }) as T;

/**
 * 标签页：一排标签头（点它改参数）+ 每个标签自己的内容（参数等于它才出现）。状态参数要在页面的 state 里声明
 * （`state: { tab: oneOf(["a", "b"]) }`）。每个状态都在地址里（?tab=b），所以每个标签都能被分享、被验证器逐个点到。
 */
export const tabs = (
  param: string,
  items: Array<[value: string, label: string, ...body: Node[]]>,
): Group =>
  col(
    row(
      ...items.map(([v, label]) => action(label, undefined, { ghost: true, set: { [param]: v } })),
    ),
    ...items.map(([v, , ...body]) => when({ param, is: v }, col(...body))),
  );

/** 手风琴：每一条有标题（点它切换展开）和内容（展开了才出现）。参数是多选的：`state: { faq: manyOf([...]) }`。 */
export const accordion = (
  param: string,
  items: Array<[value: string, title: string, ...body: Node[]]>,
): Group =>
  col(
    ...items.flatMap(([v, title, ...body]) => [
      action(title, undefined, { ghost: true, set: { [param]: v } }),
      when({ param, is: v }, col(...body)),
    ]),
  );

// ---- 简写：都只是几行 each ----

/** 一排某类型的记录卡片（用那个类型的 card，点进详情页）。 */
export const collection = (type: string, opts: RecordsOpts = {}): Each =>
  each(records(type, opts), undefined, { dir: "grid" });

/**
 * 排序菜单：一排“改排序参数”的链接，选中的那个实心。参数是有限取值的单选，取值写成 order 的写法（"-date" / "name"）：
 * `state: { sort: oneOf(["-date", "name"]) }` + `records(…, { order: { param: "sort" } })` + `sortMenu("sort", [["-date", "Newest"], ["name", "A–Z"]])`。
 */
export const sortMenu = (param: string, items: Array<[value: string, label: string]>): Group =>
  row(...items.map(([v, label]) => action(label, undefined, { ghost: true, set: { [param]: v } })));

/** 页码：每页一个链接（改页码参数），当前页实心。传的是列表用的那个 records 来源（要写了 page 和 limit）。 */
export const pager = (of: RecordsSource): Each => {
  const param = of.page?.param ?? "page";
  return each(
    pages(of),
    action(bind("o.label"), undefined, { ghost: true, set: { [param]: bind("o.value") } }),
    { as: "o", dir: "row" },
  );
};

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
 * 筛选：列表页上这些字段的筛选面。**不是槽**：每个选项是一个“改状态参数”的链接（参数名就是字段名，多选取并集），
 * 选项旁的数字是“再选它还剩几个”，选中/没得选的样子由参数推出；“清除”是把这几个参数清掉的链接，只在有选择时出现。
 * 文字“清除筛选”来自 ui（引擎自带、跟着 locale）。
 */
export const filters = (...fields: string[]): Group => ({
  group: [
    each(
      { facets: fields },
      {
        group: [
          text(3, bind("f.label")),
          each(
            { options: "f" },
            linked(
              {
                group: [text(3, bind("o.label")), text(3, bind("o.count"))],
                dir: "row",
                tone: "opt",
              },
              { set: { "{f.field}": bind("o.value") } },
            ),
            { as: "o", dir: "col" },
          ),
        ],
        dir: "col",
        tone: "facet",
      },
      { as: "f", dir: "col" },
    ),
    when(
      { param: fields },
      linked(
        { group: [text(3, bind("ui.clearFilters"))], dir: "row", tone: "clear" },
        { set: Object.fromEntries(fields.map((f) => [f, ""])) },
      ),
    ),
  ],
  dir: "col",
  tone: "facets",
});

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
  /** 日期（ISO，2026-10-17）：能排序、表单里是日期输入。 */
  date: (
    label: string,
    o: { table?: boolean; detail?: boolean; internal?: boolean } = {},
  ): Field => ({ kind: "date", label, ...o }),
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
  /** 值是一棵树（和页面同一套语法）：文章正文这类“内容本身有结构”的字段。用 embed(bind("字段")) 渲染。 */
  blocks: (label: string, o: { detail?: boolean; internal?: boolean } = {}): Field => ({
    kind: "blocks",
    label,
    ...o,
  }),
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
