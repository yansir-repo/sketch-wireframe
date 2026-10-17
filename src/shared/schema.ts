/**
 * 草图（Sketch）的唯一定义。整个表达只有一个生成式：
 *
 *   Node   = Atom | Group | Each
 *   Atom   = text | image | action | brand | nav | filters | form          （叶子：一个“放在这里的东西”）
 *   Group  = dir × Node[]                                                  （排列）
 *   Each   = dir × (x ∈ Source) → Node                                     （排列，但孩子是对一个关系逐项生成的）
 *   Source = records(类型, 条件) | fields(某条记录的字段) | items(某个多值字段里的各项)
 *   fill   = ∅（粗波浪线）| "文案" | bind(路径) | count(Source)
 *   Page   = 路由 × 环境 → Node         环境 = 一组命名绑定（页面记录、each 里的 x、……）+ 地址里的 ?query
 *
 * 列表、字段表、徽章、图库、对比表、流程……都不是槽，而是 Each 的不同写法（dsl.ts 里是它们的简写）。
 * 链接把环境带过去：action 的 with 写进目标地址的 ?query，目标页的表单从那里读初始值（和筛选的状态同一个机制）。
 * 外观（像素、对齐、比例、响应式）不在词汇里——结构可以任意表达，外观完全不可表达，客户无处可纠结。
 *
 * 这一份 Schema 同时是：TS 类型（`typeof Sketch.Type`）、发布时 JSON 的结构校验、MCP 工具的输入 JSON Schema。
 * 语义检查（字段引用、变量作用域、路由是否存在……）是跨节点的，在 validate.ts。
 * 客户端引擎只 `import type` 这里的类型，effect 不会进浏览器包。
 */
import { Schema } from "effect";

/** Sketch JSON 的格式版本。2 = 生成器（Each）取代了 collection/facts/badges/gallery 槽；旧的 1 由 migrate.ts 读时升级。 */
export const FORMAT_VERSION = 2;

// ---- 来源（Each 逐项生成的那个关系）----

const RecordsSource = Schema.Struct({
  records: Schema.String,
  where: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  limit: Schema.optionalKey(Schema.Number),
  notSelf: Schema.optionalKey(Schema.Boolean),
});
const FieldsSource = Schema.Struct({
  fields: Schema.Struct({
    /** 取哪条记录的字段（变量名）；不写 = 当前记录。 */
    of: Schema.optionalKey(Schema.String),
    /** 不取某条记录、只要某个类型的字段名（对比表的行头）：产生的项只有 label 和 field，没有值。 */
    type: Schema.optionalKey(Schema.String),
    only: Schema.optionalKey(Schema.Array(Schema.String)),
    skip: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
});
const ItemsSource = Schema.Struct({ items: Schema.String });
export const SourceSchema = Schema.Union([RecordsSource, FieldsSource, ItemsSource]);
export type Source = typeof SourceSchema.Type;

// ---- 填充 ----

/** ↦ 环境里的一个值：`字段`（= 当前记录的字段）、`变量.字段`、`变量.{另一个变量.字段}`（字段名本身来自数据）、`记录.@title`（显示名）。 */
export const Bind = Schema.Struct({ bind: Schema.String });
export type Bind = typeof Bind.Type;
/** 对一个来源的计数（“本分类共 12 个型号”）。 */
export const Count = Schema.Struct({ count: SourceSchema });
export type Count = typeof Count.Type;

/** 槽里填什么：没有 = ∅，渲染成“此处有文字”的粗波浪线；字符串 = 文案；Bind = 取自环境；Count = 计数。 */
const Fill = Schema.optionalKey(Schema.Union([Schema.String, Bind, Count]));
export type Fill = string | Bind | Count | undefined;

export const TextSize = Schema.Literals([1, 2, 3]);
export type TextSize = typeof TextSize.Type;

/** 在一行里占的份数（相对比例，默认 1）：“侧栏 : 内容 = 1 : 3”这种结构意图，不是像素。 */
const Weight = Schema.optionalKey(Schema.Number);

// ---- 叶子 ----

const text = Schema.Struct({
  slot: Schema.Literal("text"),
  size: TextSize,
  fill: Fill,
  /** circle = 圆圈里的一个词（徽章）。 */
  tone: Schema.optionalKey(Schema.Literal("circle")),
  w: Weight,
});
const image = Schema.Struct({ slot: Schema.Literal("image"), fill: Fill, w: Weight });
const action = Schema.Struct({
  slot: Schema.Literal("action"),
  fill: Fill,
  to: Schema.optionalKey(Schema.String),
  ghost: Schema.optionalKey(Schema.Boolean),
  /** 链接带去目标页的环境：写进目标地址的 ?query，目标页的表单用它们当初始值。 */
  with: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([Schema.String, Bind]))),
  w: Weight,
});
const brand = Schema.Struct({
  slot: Schema.Literal("brand"),
  fill: Fill,
  to: Schema.optionalKey(Schema.String),
  w: Weight,
});
const nav = Schema.Struct({
  slot: Schema.Literal("nav"),
  paths: Schema.Array(Schema.String),
  w: Weight,
});
const filters = Schema.Struct({
  slot: Schema.Literal("filters"),
  fields: Schema.Array(Schema.String),
  w: Weight,
});
const form = Schema.Struct({ slot: Schema.Literal("form"), w: Weight });

export const SLOT_KINDS = ["text", "image", "action", "brand", "nav", "filters", "form"] as const;
const Atom = Schema.Union([text, image, action, brand, nav, filters, form]);
export type Atom = typeof Atom.Type;

// ---- 节点（递归）----

export const TONES = ["accent", "card", "pair"] as const;
export type Tone = (typeof TONES)[number];

/** 排列：col 纵向、row 横向、grid 横向折行等分。 */
export const DIRS = ["col", "row", "grid"] as const;
export type Dir = (typeof DIRS)[number];

type Arrange = {
  readonly dir: Dir;
  readonly name?: string;
  /** accent 强调色；card 一张卡片（有框）；pair 一对“名 | 值”（字段表的一行）。 */
  readonly tone?: Tone;
  /** 在一行里占的份数（相对比例，默认 1）。 */
  readonly w?: number;
  /** 孩子是有顺序的（流程）：引擎画序号和连接线。顺序有意义是结构，怎么画是引擎的事。 */
  readonly seq?: boolean;
  /** 孩子之间有分隔线（字段表、列表）。 */
  readonly rule?: boolean;
};
export type Group = Arrange & { readonly group: ReadonlyArray<Node> };
export type Each = Arrange & {
  readonly each: Source;
  /** 每一项在模板里叫什么，默认 it。嵌套的 each 要起不同的名字。 */
  readonly as?: string;
  /** 每一项怎么画。records 来源可以不写：用那个类型的 card（没有就是 图 + 显示名），并链到它的详情页。 */
  readonly item?: Node;
};
export type Node = Atom | Group | Each;

const arrange = {
  dir: Schema.Literals(DIRS),
  name: Schema.optionalKey(Schema.String),
  tone: Schema.optionalKey(Schema.Literals(TONES)),
  w: Weight,
  seq: Schema.optionalKey(Schema.Boolean),
  rule: Schema.optionalKey(Schema.Boolean),
};
const GroupSchema: Schema.Codec<Group> = Schema.Struct({
  group: Schema.Array(Schema.suspend((): Schema.Codec<Node> => NodeSchema)),
  ...arrange,
});
const EachSchema: Schema.Codec<Each> = Schema.Struct({
  each: SourceSchema,
  as: Schema.optionalKey(Schema.String),
  item: Schema.optionalKey(Schema.suspend((): Schema.Codec<Node> => NodeSchema)),
  ...arrange,
});
export const NodeSchema: Schema.Codec<Node> = Schema.Union([GroupSchema, EachSchema, Atom]);

// ---- 模型 ----

export const Option = Schema.Union([
  Schema.String,
  Schema.Struct({ value: Schema.String, label: Schema.String }),
]);
export type Option = typeof Option.Type;

export const FIELD_KINDS = [
  "text",
  "number",
  "bool",
  "choice",
  "term",
  "ref",
  "media",
  "list",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** 存 id（或 id 数组）、指向另一个类型的记录的字段：term 指向词表，ref 指向内容类型。存储、表单、筛选是同一套。 */
export const isLinkKind = (k: FieldKind): boolean => k === "term" || k === "ref";

export const Field = Schema.Struct({
  kind: Schema.Literals(FIELD_KINDS),
  label: Schema.String,
  /** term / media 可多选。 */
  multiple: Schema.optionalKey(Schema.Boolean),
  multiline: Schema.optionalKey(Schema.Boolean),
  /** choice 的选项。 */
  options: Schema.optionalKey(Schema.Array(Option)),
  radio: Schema.optionalKey(Schema.Boolean),
  /** term 引用的词表类型；ref 引用的内容类型。 */
  to: Schema.optionalKey(Schema.String),
  /** list：每行的列（列名 → 显示名）；kv=true 时第一列当名、第二列当值，在 facts 里展开成行。 */
  columns: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  kv: Schema.optionalKey(Schema.Boolean),
  /** 进模型视图列表的列。 */
  table: Schema.optionalKey(Schema.Boolean),
  /** false = 不进 facts（客户看的规格里不摆）。 */
  detail: Schema.optionalKey(Schema.Boolean),
  /** true = 只给后台（运营、审核流程用的字段）：任何客户页面都不能展示它，公开表单里也没有；后台表格和表单里有。 */
  internal: Schema.optionalKey(Schema.Boolean),
});
export type Field = typeof Field.Type;

export type Row = Record<string, unknown>;
const RowSchema = Schema.Record(Schema.String, Schema.Unknown);

export const TypeDef = Schema.Struct({
  label: Schema.String,
  /** 主键字段名；"id" 且字段里没声明 = 自动生成。 */
  key: Schema.String,
  /** 词表：有限、多条目共用，只被 term 引用。 */
  vocab: Schema.optionalKey(Schema.Boolean),
  /** 访客可以创建这个类型的记录（询盘）：推导出一个公开的表单页。 */
  public: Schema.optionalKey(Schema.Boolean),
  /** 显示名字段（默认 = key）。 */
  title: Schema.optionalKey(Schema.String),
  /** 命中这些字段值的记录对客户“不存在”（列表里没有、详情页 404），只在模型视图里管理——草稿就是这么来的。 */
  unlisted: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  fields: Schema.Record(Schema.String, Field),
  /** 集合里每条记录的卡片；没写就按 title 推一个默认的。 */
  card: Schema.optionalKey(NodeSchema),
  seed: Schema.Array(RowSchema),
});
export type TypeDef = typeof TypeDef.Type;

// ---- 页面 ----

export const Ctx = Schema.NullOr(
  Schema.Struct({
    type: Schema.String,
    many: Schema.optionalKey(Schema.Boolean),
    where: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    create: Schema.optionalKey(Schema.Boolean),
  }),
);
export type Ctx = typeof Ctx.Type;

export const Page = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  ctx: Schema.optionalKey(Ctx),
  body: Schema.Array(NodeSchema),
});
export type Page = typeof Page.Type;

export const Fidelity = Schema.Literals(["lines", "words"]);
export type Fidelity = typeof Fidelity.Type;

export const Sketch = Schema.Struct({
  /** 格式版本，见 FORMAT_VERSION。 */
  v: Schema.Literal(FORMAT_VERSION),
  /** 项目编号：发布地址、本机存储键都从它来，只在这里写一次。 */
  code: Schema.String,
  title: Schema.String,
  /** 文案保真度：lines = 所有文案画成线条（只表达结构），words = 写了的文案照写（没写的仍是线条）。默认 words。 */
  fidelity: Schema.optionalKey(Fidelity),
  /** 引擎自带的、客户会看到的文案（面包屑、空状态、“更多”、菜单……）用哪种语言。默认 zh；英文站写 "en"。后台（#/_model）始终是中文。 */
  locale: Schema.optionalKey(Schema.Literals(["zh", "en"])),
  model: Schema.Record(Schema.String, TypeDef),
  header: NodeSchema,
  footer: NodeSchema,
  /** 路由模式 → 页面。模型会推导出每个类型的列表/详情/新增页；这里写同名路由就是覆盖。 */
  pages: Schema.Record(Schema.String, Page),
});
export type Sketch = typeof Sketch.Type;
