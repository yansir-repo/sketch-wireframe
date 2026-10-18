/**
 * 草图（Sketch）的唯一定义。整个表达只有一个生成式：
 *
 *   Node   = Atom | Group | Each
 *   Atom   = text | image | action | brand | nav | filters | form          （叶子：一个“放在这里的东西”）
 *   Group  = dir × Node[]                                                  （排列）
 *   Each   = dir × (x ∈ Source) → Node                                     （排列，但孩子是对一个关系逐项生成的）
 *   Source = records(类型, 条件) | fields(某条记录的字段) | items(某个多值字段里的各项)
 *   fill   = ∅（粗波浪线）| "文案" | bind(路径) | fold(op, Source, 字段)          op ∈ count | sum | min | max | avg
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

/** Sketch JSON 的格式版本。4 = count 成了 fold（count/sum/min/max/avg）的一个特例，多了 distinct 来源；3 = 状态（param）+ 条件出现（when）+ 可点的组（link），filters 槽成了它们的特例；2 = 生成器（Each）取代了 collection/facts/badges/gallery 槽 。旧格式没有迁移代码（见 AGENTS.md）。 */
export const FORMAT_VERSION = 4;

// ---- 来源（Each 逐项生成的那个关系）----

/**
 * records：一个类型的记录。除了 where（筛），还能排序、搜索、分页——三者都是“地址里的参数”（和筛选、标签页同一个机制），
 * 所以每一种状态都是可分享、可回退的页面：
 *   order  "-date" = 按 date 倒序（"name" = 正序）；{ param } = 由页面参数决定，参数的取值就是这种写法的字段名；
 *   search { param } = 参数里的文字出现在这条记录的可显示字段里才留下；
 *   page   { param } = 页码参数；每页多少条是 limit（分页必须写 limit）。
 */
const RecordsSource = Schema.Struct({
  records: Schema.String,
  where: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  limit: Schema.optionalKey(Schema.Number),
  notSelf: Schema.optionalKey(Schema.Boolean),
  order: Schema.optionalKey(Schema.Union([Schema.String, Schema.Struct({ param: Schema.String })])),
  search: Schema.optionalKey(Schema.Struct({ param: Schema.String })),
  page: Schema.optionalKey(Schema.Struct({ param: Schema.String })),
});
export type RecordsSource = typeof RecordsSource.Type;
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
/** 列表页上这些字段的筛选面：每个字段一项（选项不足两个的字段不出现）。 */
const FacetsSource = Schema.Struct({ facets: Schema.Array(Schema.String) });
/** 某个 facets 项（变量名）的各个选项：每项有 label / value / count（“再选它还剩几个”）/ on。 */
const OptionsSource = Schema.Struct({ options: Schema.String });
/** 页面声明的一个状态参数的取值：每项有 label / value / on。标签页的标签头就是它。 */
const ParamSource = Schema.Struct({ param: Schema.String });
/** 某个类型的某个字段出现过的各个值（多值字段逐个展开）：每项有 label / value / count（有这个值的记录数）——分组统计。 */
const DistinctSource = Schema.Struct({
  distinct: Schema.Struct({ type: Schema.String, field: Schema.String }),
});
/** 一个分页的各页：每页一项，有 label / value（页码）/ on。写的是同一个 records 来源（分页的那个），页数由它筛出的条数和 limit 算。 */
const PagesSource = Schema.Struct({ pages: RecordsSource });
export const SourceSchema = Schema.Union([
  RecordsSource,
  PagesSource,
  FieldsSource,
  ItemsSource,
  FacetsSource,
  OptionsSource,
  ParamSource,
  DistinctSource,
]);
export type Source = typeof SourceSchema.Type;

// ---- 填充 ----

/** ↦ 环境里的一个值：`字段`（= 当前记录的字段）、`变量.字段`、`变量.{另一个变量.字段}`（字段名本身来自数据）、`记录.@title`（显示名）。 */
export const Bind = Schema.Struct({ bind: Schema.String });
export type Bind = typeof Bind.Type;
/**
 * 对一个来源折叠成一个值：count 数项数；sum / min / max / avg 对某个数字字段（records 的字段、items 里列表的列）。
 * 这一簇是可结合的运算，故意封闭：别的计算（中位数、日期运算）不在这里——声明“这个值是算出来的”，没数据就画波浪线。
 */
export const FOLD_OPS = ["count", "sum", "min", "max", "avg"] as const;
export type FoldOp = (typeof FOLD_OPS)[number];
export const Fold = Schema.Struct({
  fold: Schema.Struct({
    op: Schema.Literals(FOLD_OPS),
    of: SourceSchema,
    field: Schema.optionalKey(Schema.String),
  }),
});
export type Fold = typeof Fold.Type;

/** 槽里填什么：没有 = ∅，渲染成“此处有文字”的粗波浪线；字符串 = 文案；Bind = 取自环境；Fold = 折叠出来的值。 */
const Fill = Schema.optionalKey(Schema.Union([Schema.String, Bind, Fold]));
export type Fill = string | Bind | Fold | undefined;

export const TextSize = Schema.Literals([1, 2, 3]);
export type TextSize = typeof TextSize.Type;

/** 在一行里占的份数（相对比例，默认 1）：“侧栏 : 内容 = 1 : 3”这种结构意图，不是像素。 */
const Weight = Schema.optionalKey(Schema.Number);

/**
 * 条件出现：参数（一个，或几个里任意一个）有值才出现；写了 is 就要等于（多选参数是“包含”）。
 * 状态只有一个家：地址里的 ?query——所以每一个状态都是可分享、可回退、可被验证器逐个点到的。
 */
export const When = Schema.Struct({
  param: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  is: Schema.optionalKey(Schema.String),
});
export type When = typeof When.Type;

/** 改当前页的状态参数：单选参数是“设成”，多选参数是“切换”；值写空串 = 清掉这个参数。 */
const SetArgs = Schema.Record(Schema.String, Schema.Union([Schema.String, Bind]));
const common = { w: Weight, when: Schema.optionalKey(When) };

// ---- 叶子 ----

const text = Schema.Struct({
  slot: Schema.Literal("text"),
  size: TextSize,
  fill: Fill,
  /** circle = 圆圈里的一个词（徽章）。 */
  tone: Schema.optionalKey(Schema.Literal("circle")),
  ...common,
});
const image = Schema.Struct({ slot: Schema.Literal("image"), fill: Fill, ...common });
/**
 * 一个“不是图片”的媒体占位：视频、地图、图表、图标、可下载的文件。只表达“这里有这种东西”（画法由 kind 决定），
 * 内容（地址、数据、文件）是开发阶段的事——草图里没有这些数据，就不编。fill = 一句说明（不写 = 无）。
 */
export const MEDIA_KINDS = ["video", "map", "chart", "icon", "file"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
const media = Schema.Struct({
  slot: Schema.Literal("media"),
  kind: Schema.Literals(MEDIA_KINDS),
  fill: Fill,
  ...common,
});
const action = Schema.Struct({
  slot: Schema.Literal("action"),
  fill: Fill,
  to: Schema.optionalKey(Schema.String),
  ghost: Schema.optionalKey(Schema.Boolean),
  /** 链接带去目标页的环境：写进目标地址的 ?query，目标页的表单用它们当初始值。 */
  with: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([Schema.String, Bind]))),
  /** 改当前页的状态参数（不换页）。 */
  set: Schema.optionalKey(SetArgs),
  ...common,
});
const brand = Schema.Struct({
  slot: Schema.Literal("brand"),
  fill: Fill,
  to: Schema.optionalKey(Schema.String),
  ...common,
});
const nav = Schema.Struct({
  slot: Schema.Literal("nav"),
  paths: Schema.Array(Schema.String),
  ...common,
});
const form = Schema.Struct({ slot: Schema.Literal("form"), ...common });
/**
 * 搜索框：唯一需要“输入”的控件。回车把输入的文字写进页面的一个自由文本参数（地址里 ?q=…），列表用 search 读它。
 * fill = 框里的提示字（不写 = 波浪线）。
 */
const search = Schema.Struct({
  slot: Schema.Literal("search"),
  param: Schema.String,
  fill: Fill,
  ...common,
});
/**
 * 把一个 blocks 字段里存的那棵树渲染出来（文章正文）。树用同一套语法写，所以语言对“数据里存着语言的句子”是封闭的；
 * 为了一定能终止，被嵌进去的树里不能再有 embed / form / nav / brand（它们是页面的壳，不是内容）。
 */
const embed = Schema.Struct({ slot: Schema.Literal("embed"), fill: Fill, ...common });

export const SLOT_KINDS = [
  "text",
  "image",
  "media",
  "action",
  "brand",
  "nav",
  "form",
  "embed",
  "search",
] as const;
const Atom = Schema.Union([text, image, media, action, brand, nav, form, embed, search]);
export type Atom = typeof Atom.Type;

// ---- 节点（递归）----

export const TONES = ["accent", "card", "pair", "opt", "facet", "facets", "clear"] as const;
export type Tone = (typeof TONES)[number];

/** 排列：col 纵向、row 横向、grid 横向折行等分。 */
export const DIRS = ["col", "row", "grid"] as const;
export type Dir = (typeof DIRS)[number];

type Arrange = {
  readonly dir: Dir;
  readonly name?: string;
  /**
   * 引擎的外观词汇（不是结构）：accent 强调色；card 一张卡片；pair 字段表的一行；
   * opt 一个可选项（带勾选框，选中/没得选会变样）；facet 一组选项；facets 全部筛选面；clear 一个“清除”链接。
   */
  readonly tone?: Tone;
  /** 在一行里占的份数（相对比例，默认 1）。 */
  readonly w?: number;
  /** 孩子是有顺序的（流程）：引擎画序号和连接线。顺序有意义是结构，怎么画是引擎的事。 */
  readonly seq?: boolean;
  /** 孩子之间有分隔线（字段表、列表）。 */
  readonly rule?: boolean;
  /** 条件出现。 */
  readonly when?: When;
  /** 给后续开发者的批注（“这块第二期做”“按角色分流”）：不渲染给客户，运营视图（#/_model/_notes）里列出。不是文案，不进“线条档零文案”的检查。 */
  readonly note?: string;
  /** 这个组本身是一个链接：去 to（带上 with），或者改当前页的状态参数（set）。选中的状态由地址里的参数推出，不用另写。 */
  readonly link?: {
    readonly to?: string;
    readonly with?: Readonly<Record<string, string | Bind>>;
    readonly set?: Readonly<Record<string, string | Bind>>;
  };
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
  when: Schema.optionalKey(When),
  note: Schema.optionalKey(Schema.String),
  link: Schema.optionalKey(
    Schema.Struct({
      to: Schema.optionalKey(Schema.String),
      with: Schema.optionalKey(SetArgs),
      set: Schema.optionalKey(SetArgs),
    }),
  ),
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
  "date",
  "bool",
  "choice",
  "term",
  "ref",
  "media",
  "list",
  "blocks",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** blocks：字段的值是一棵 Node 树（和页面同一套语法），用 embed 渲染。 */

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

/**
 * 一个状态参数：取值是一个有限的集合（标签页的各个标签、手风琴的各个条目）；multi = 可以同时有几个（手风琴），否则单选。
 * free = 取值不是有限集合（搜索词、页码）：values 留空，什么字符串都行；验证器对它只抽样。
 */
export const ParamDecl = Schema.Struct({
  values: Schema.Array(Schema.String),
  multi: Schema.optionalKey(Schema.Boolean),
  default: Schema.optionalKey(Schema.String),
  free: Schema.optionalKey(Schema.Boolean),
});
export type ParamDecl = typeof ParamDecl.Type;

export const Page = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  /** 给后续开发者的批注，同组的 note：不渲染给客户。 */
  note: Schema.optionalKey(Schema.String),
  ctx: Schema.optionalKey(Ctx),
  /** 这个页面的状态参数（地址里 ?名=值）。筛选的参数不用声明：它们就是列表页类型的字段。 */
  state: Schema.optionalKey(Schema.Record(Schema.String, ParamDecl)),
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
  /**
   * 会话级的状态参数（“谁在看”：访客 / 会员 / 管理员，或者选了哪个城市）：页眉页脚和每个页面都认识它，
   * 切换后一直生效（存在浏览器里，换页不丢），也可以直接写在地址里（?viewer=member，方便分享和验证）。
   * 这不是认证：没有密码，也不管权限——它只让草图能表达“不同的人看到不同的结构”。真正挡人的仍然只有地址里的 key。
   */
  session: Schema.optionalKey(Schema.Record(Schema.String, ParamDecl)),
  model: Schema.Record(Schema.String, TypeDef),
  header: NodeSchema,
  footer: NodeSchema,
  /** 路由模式 → 页面。模型会推导出每个类型的列表/详情/新增页；这里写同名路由就是覆盖。 */
  pages: Schema.Record(Schema.String, Page),
});
export type Sketch = typeof Sketch.Type;
