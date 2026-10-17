/**
 * 草图（Sketch）的唯一定义。整个表达只有一个生成式：
 *
 *   Node  = Slot(kind, fill?) | Group(dir, name?, Node[])         （可带 w：在一行里占几份）
 *   fill  = ∅（粗波浪线）| "文案" | bind(字段)
 *   Page  = 路由 × 上下文 × Group     上下文 ∈ { ∅, T[], T, new T }
 *
 * 外观（像素、对齐、比例、响应式）不在词汇里——结构可以任意表达，外观完全不可表达，客户无处可纠结。
 *
 * 这一份 Schema 同时是：TS 类型（`typeof Sketch.Type`）、发布时 JSON 的结构校验、MCP 工具的输入 JSON Schema
 * （`describe_format` 由它生成）。三者不会漂移。语义检查（字段引用、路由是否存在……）是跨节点的，在 validate.ts。
 * 客户端引擎只 `import type` 这里的类型，effect 不会进浏览器包。
 */
import { Schema } from "effect";

/** Sketch JSON 的格式版本。DSL 只加不改；真要不兼容升级，靠这个字段迁移。 */
export const FORMAT_VERSION = 1;

// ---- 填充 ----

/** ↦ 当前上下文里那条记录的字段（点路径）。 */
export const Bind = Schema.Struct({ bind: Schema.String });
export type Bind = typeof Bind.Type;

/** 槽里填什么：没有 = ∅，渲染成“此处有文字”的粗波浪线；字符串 = 文案；Bind = 取自模型。 */
const Fill = Schema.optionalKey(Schema.Union([Schema.String, Bind]));
export type Fill = string | Bind | undefined;

export const TextSize = Schema.Literals([1, 2, 3]);
export type TextSize = typeof TextSize.Type;

// ---- 槽 ----

/** 在一行里占的份数（相对比例，默认 1）：“侧栏 : 内容 = 1 : 3”这种结构意图，不是像素。 */
const Weight = Schema.optionalKey(Schema.Number);

const text = Schema.Struct({ slot: Schema.Literal("text"), size: TextSize, fill: Fill, w: Weight });
const image = Schema.Struct({ slot: Schema.Literal("image"), fill: Fill, w: Weight });
const action = Schema.Struct({
  slot: Schema.Literal("action"),
  fill: Fill,
  to: Schema.optionalKey(Schema.String),
  ghost: Schema.optionalKey(Schema.Boolean),
  w: Weight,
});
const nav = Schema.Struct({
  slot: Schema.Literal("nav"),
  paths: Schema.Array(Schema.String),
  w: Weight,
});
const collection = Schema.Struct({
  slot: Schema.Literal("collection"),
  type: Schema.String,
  where: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  limit: Schema.optionalKey(Schema.Number),
  notSelf: Schema.optionalKey(Schema.Boolean),
  w: Weight,
});
const brand = Schema.Struct({
  slot: Schema.Literal("brand"),
  fill: Fill,
  to: Schema.optionalKey(Schema.String),
  w: Weight,
});
const facts = Schema.Struct({
  slot: Schema.Literal("facts"),
  skip: Schema.optionalKey(Schema.Array(Schema.String)),
  only: Schema.optionalKey(Schema.Array(Schema.String)),
  w: Weight,
});
const badges = Schema.Struct({ slot: Schema.Literal("badges"), field: Schema.String, w: Weight });
const gallery = Schema.Struct({ slot: Schema.Literal("gallery"), field: Schema.String, w: Weight });
const filters = Schema.Struct({
  slot: Schema.Literal("filters"),
  fields: Schema.Array(Schema.String),
  w: Weight,
});
const form = Schema.Struct({ slot: Schema.Literal("form"), w: Weight });

export const SLOT_KINDS = [
  "brand",
  "text",
  "image",
  "action",
  "nav",
  "collection",
  "facts",
  "badges",
  "gallery",
  "filters",
  "form",
] as const;

// ---- 节点（递归）----

const Tone = Schema.Literal("accent");
const Slot = Schema.Union([
  text,
  image,
  action,
  brand,
  nav,
  collection,
  facts,
  badges,
  gallery,
  filters,
  form,
]);
export type Slot = typeof Slot.Type;

export type Group = {
  readonly group: ReadonlyArray<Node>;
  readonly dir: "col" | "row";
  readonly name?: string;
  readonly tone?: "accent";
  /** 在一行里占的份数（相对比例，默认 1）：“侧栏 : 内容 = 1 : 3”这种结构意图，不是像素。 */
  readonly w?: number;
};
export type Node = Group | Slot;

const GroupSchema: Schema.Codec<Group> = Schema.Struct({
  group: Schema.Array(Schema.suspend((): Schema.Codec<Node> => NodeSchema)),
  dir: Schema.Literals(["col", "row"]),
  name: Schema.optionalKey(Schema.String),
  tone: Schema.optionalKey(Tone),
  w: Weight,
});
export const NodeSchema: Schema.Codec<Node> = Schema.Union([GroupSchema, Slot]);

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

// ---- 边界：JSON → Sketch ----

const decode = Schema.decodeUnknownResult(Sketch, { onExcessProperty: "error" });

/** 发布/加载的入口：多余的键、缺的键、写错的类型都在这里挡掉。失败返回人能读的行。 */
export const parseSketch = (
  input: unknown,
): { ok: true; sketch: Sketch } | { ok: false; errors: string[] } => {
  const r = decode(input);
  if (r._tag === "Success") return { ok: true, sketch: r.success };
  return {
    ok: false,
    errors: [
      String(r.failure)
        .replace(/^SchemaError\(/, "")
        .replace(/\)$/, "")
        .split("\n")
        .slice(0, 16)
        .join("\n"),
    ],
  };
};

/** JSON Schema，给 describe_format 和 MCP 工具的 inputSchema 用。 */
export const sketchJsonSchema = (): unknown => Schema.toJsonSchemaDocument(Sketch);
