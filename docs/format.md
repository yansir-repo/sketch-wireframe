# 草图格式（给 agent 读：怎么表达一个网站的结构）

手绘风格的结构草图：页面怎么组织、放什么、数据长什么样。**只表达“放什么”，不表达“长什么样”**——字体、配色、间距、像素都不可表达，客户无处可纠结。
草图是潦草的，但内容要对。它是真的能点、能增删改的小网站（数据存在访客自己的浏览器里，没有后端）。

## 一个生成式

```
Node   = 叶子 | 排列 | 生成
叶子   = text | image | media | action | brand | nav | form | embed | search
排列   = Group(dir, Node[])                  dir ∈ col | row | grid；任何节点可带 when（条件出现）；组可以是 link（可点）
生成   = Each(dir, x ∈ 来源) → Node          来源 = records | pages | fields | items | distinct | facets | options | param
fill   = ∅（粗波浪线）| "文案" | bind(路径) | fold(op, 来源, 字段)        op ∈ count | sum | min | max | avg
Page   = 路由 × 环境 → Node                  环境 = 命名绑定（页面记录叫 page、each 里的 x……）+ 状态参数（地址里的 ?query；会话级的存在浏览器里）
```

写法有两种，等价：写 TS 配置（`defineSketch`，由 CLI 求值成 JSON），或直接提交 JSON（`get_schema` 给 JSON Schema）。范例见 `get_example`。

**记住两件事，其余都是组合：**

1. **列表、字段表、徽章、图库、对比表、流程都不是槽，是 `each` 的不同写法。** `collection / facts / badges / gallery / compare / steps` 只是 DSL 里几行 `each` 的简写（下面都写出来了）。需要新排法时，先问：这是对哪个关系、逐项生成什么？
2. **状态也只有一个家：地址。** 标签页、手风琴、轮播、筛选、“谁在看”都是**状态参数**（有限取值，在地址里 `?名=值`）；控制它的是**链接**（`action(…, {set:{tab:"b"}})`，或把一个组变成链接），显示由 **`when`** 决定。所以每个状态都能被分享、回退、被验证器逐个点到。
3. **链接带着环境走。** `action(…, "/inquiry", { with: { product: bind("code") } })` 把当前型号写进目标地址的 `?product=…`，目标页的表单拿它当初始值——和筛选状态是同一个机制（地址即状态）。

### 叶子

| 叶子 | 意思 | 填什么 |
|---|---|---|
| `text(1\|2\|3, fill?)` | 一段文字（1 标题 / 2 副标题 / 3 正文）；`{circle:true}` = 圆圈里的一个词（徽章） | 没填 = 粗波浪线；绑的字段在这条记录上没有值 = 一条粗短线 |
| `image(fill?)` | 图片占位（叉框）；绑到图片字段显示第一张真图；绑到 `items` 的一张图 = 点开放大 | |
| `media(kind, fill?)` | **不是图片**的占位：`kind` ∈ `video` `map` `chart` `icon` `file`（视频、地图、图表、图标、可下载的文件）。引擎按 kind 画一个符号；`fill` = 一句说明（不写 = 无，不编）。内容（地址、数据、文件）是开发阶段的事。**别用 `image("VIDEO")` 凑**，体检会提醒 | |
| `action(fill?, to?, {ghost?, with?, set?})` | 按钮；`to` 是路由；`with` 把环境带去目标页；`set` 改当前页的状态参数（单选是“设成”、多选是“切换”、值写空串是清掉；选中的那个实心） | |
| `brand(fill?, to?)` | logo / 字标，点它回首页。**别用 `action` 做 logo**，那会是按钮 | 没填 = 粗波浪线字标 |
| `nav(...paths)` | 导航，名字取自各路由的页面名。放不下时引擎自动收进手绘的菜单按钮 | |
| `embed(fill)` | 把一个 `blocks` 字段里存的那棵树渲染出来（文章正文）。树里不能再有 embed / form / nav / brand | 必须绑一个 blocks 字段 |
| `form()` | 新增表单（页面上下文是“新增 T”时）；地址里 `?字段=值` 是初始值 | |
| `search(参数, fill?)` | 搜索框：回车把输入的文字写进自由文本参数（`?q=…`），列表的 `search` 读它。页面壳，不能放进 blocks 的树里 | `fill` = 框里的提示字，不写 = 波浪线 |

### 排列

- `col(...)` / `row(...)` / `grid(...)`：纵向 / 横向 / 横向折行等分。
- `section("名字", ...)`：带名字的组 = 一个框，名字是标注。**每个页面的顶层板块都要有名字。**
- `card(...)` 一张有框的卡片；`pair(名, 值)` 字段表的一行；`accent(node)` 强调色；`ruled(node)` 孩子之间有分隔线。
- `span(份数, node)`：一行里的相对宽度，如 `row(span(1, filters("a")), span(3, collection("t")))`。是份数，不是像素。
- `when("tab=specs", node)`：条件出现。`"open=q1"` 对多选参数是“包含”，`"a|b"` = 几个参数里任意一个有值，只写参数名 = 有值。
- `linked(组, {to?, with?, set?})`：让一个组成为链接；选中与否由地址里的参数推出（选项勾上、没得选的变淡）。
- `steps(...)`：**孩子有顺序**（流程）。结构里只声明“顺序有意义”，序号和连接线由引擎画。
- 没有 hero / 卡片网格 / 对比表 这类变体：经典布局是这些的组合；想复用就在配置里写函数。嵌套超过 5 层会警告。

### 生成：`each(来源, 每一项怎么画, {as?, dir?, seq?, rule?})`

每一项在模板里叫 `as`（默认 `it`）；模板里用 `bind("x.字段")` 取值，**嵌套的 each 要起不同的名字**。

| 来源 | 逐项生成什么 | 每一项有 |
|---|---|---|
| `records("类型", {where?, limit?, notSelf?, order?, search?, page?})` | 某类型的记录（`where` 的值：`":param"` 路由参数、`"$field"` 页面记录的字段、字面量）；`order` / `search` / `page` 见下面“排序、搜索、分页” | 这条记录的字段，`@title` = 显示名。`item` 可以不写：用那个类型的 `card`（没有就是 图 + 显示名），并链到详情页 |
| `fields({of?, type?, only?, skip?})` | 一条记录的字段（默认当前记录；kv 列表展开成一行行参数） | `label` `value` `field`。客户页不摆空字段，整块都空时把字段名全摆出来，值是波浪线。`type` 不带 `of` = 只要字段名（对比表的行头） |
| `distinct(类型, 字段)` | 这个字段出现过的各个值（多值字段逐个展开） | `label` `value` `count`（有这个值的记录数）：分组统计 |
| `facets(字段[])` / `options("x")` | 列表页这些字段的筛选面 / 某一项的各个选项 | facets 项：`label` `field`；选项：`label` `value` `count`（“再选它还剩几个”）|
| `pages(records 来源)` | 一个分页的各页（只有一页时什么都不生成） | `label` `value`（页码） |
| `param("名")` | 页面声明的一个状态参数的各个取值 | `label` `value` |
| `items("字段")` | 一个多值字段的各项：term/ref → 对方的记录；media → 图片；list → 每一行 | 对应的记录 / 图 / 行 |

**bind 路径**：`字段`（当前记录）、`变量.字段`、`变量.@title`（显示名）、`变量.{另一变量.field}`（字段名本身来自数据）。页面记录（详情页）的变量叫 `page`，也是“当前记录”。
**`ui.xxx`**：引擎自带的文案（`ui.clearFilters`、`ui.menu`……），跟着 `locale`；不是作者的文案。
**fold**：`text(2, count(records("product", {where: {category: ":id"}})))` = 本分类的型号数；`min / max / sum / avg(来源, "数字字段")`。空集的 count 是 0；其余没有数据时画波浪线，**不编**。
**where 的值**：`":param"` 路由参数、`"$field"` 页面记录的字段、`"{x.value}"` 环境里某个变量的值（分组统计：每一组里再 fold）、字面量。

### 简写（DSL 里都只是几行 each）

```ts
collection(type, opts)  = each(records(type, opts), undefined, { dir: "grid" })
filters(...字段)        = 每个字段一组选项；选项 = 改状态参数的链接（参数名就是字段名，多选取并集），数字 = 再选它还剩几个；“清除”只在有选择时出现
tabs(参数, [[值, 标签, ...内容]]) / accordion(参数, [[值, 标题, ...内容]])   // 标签头/标题是改参数的链接，内容是 when(参数=值)
facts({only?, skip?})   = each(fields(opts), pair(text(3, bind("e.label")), text(3, bind("e.value"))), { as: "e", rule: true })
badges(field)           = each(items(field), text(3, bind("it.@title"), { circle: true }), { dir: "row" })
gallery(field)          = each(items(field), image(bind("it")), { dir: "row" })
compare(type, 字段[], {where?, limit?})        // 对比表：外层逐个字段（行），内层逐条记录（列）
  = each(fields({type, only}), row(text(bind("f.label")), each(records(type,…), text(bind("p.{f.field}")), {as:"p", dir:"row"})), {as:"f", rule:true})
```

没填的一律是粗波浪线（见下）。

### 排序、搜索、分页（`records` 的三个可选项）

三者都是**地址里的参数**——和筛选、标签页同一个机制，所以每个状态都可分享、可回退、被验证器点到：

```ts
const LIST = records("product", {
  limit: 6,                       // 分页时 limit 就是每页几条
  order: { param: "sort" },       // 或写死："-moq"（倒序）、"name"（正序）
  search: { param: "q" },         // 参数里的词（不分大小写）出现在记录自己的可显示文字里才留下
  page: { param: "page" },        // 页码；越界停在最后一页，不是数字当第 1 页
});
state: { sort: oneOf(["code", "-moq"]), q: free(), page: free("1") },   // 搜索词和页码是自由文本参数（free），排序是有限取值
row(search("q"), sortMenu("sort", [["code", "型号"], ["-moq", "起订量从高到低"]])),
each(LIST, undefined, { dir: "grid" }),
pager(LIST),                      // 同一个 records 来源：页数由它筛出的条数和 limit 算
```

- **排序**：数字按数值、其余按显示文字（term/choice 按显示名）、`date` 按 ISO 日期；**空值永远排最后**。图片/列表/内容树/internal 字段不能当排序依据。`order` 的参数必须是有限取值的单选，每个取值都是一种排序（字段名，`-` 开头 = 倒序）。
- **搜索**：找 text / choice / term / number / date 字段的显示文字（不含 internal，不含只当主键的字段，不含 ref——别的记录的名字不算这一条的）。没有后端：纯文本包含匹配，不做相关性排序。
- **分页**：`pager` 只有一页时不出现。过滤（筛选、搜索）变了，页数跟着变，页码自动夹到范围内。
- 自由文本参数 `free()` 没有有限的取值，验证器只抽样（该列表第一条记录名里的一个词，和 `?page=2`）。`facts` 想分成几个板块，就每个板块写自己的 `only`，别重复同一个 `facts()`。

### 没填的一律是粗波浪线

槽没写 `fill`、`bind` 的字段在这条记录上没有值（比如显示名留空、只留主键）、`kv` 参数行没有值，都画成粗波浪线（“此处有文字”）。
`locale`（顶层）：`"zh"`（默认）或 `"en"`——引擎自带、客户会看到的文案（面包屑、空状态、“更多”、菜单、清除筛选、公开表单的按钮和提示）用哪种语言。**英文站必须写 `locale: "en"`**；体检会提醒。后台（`#/_model`）始终是中文。
`fidelity`（顶层）：`"words"`（默认）= 写了的文案照写；`"lines"` = 所有文案（含取自模型的值）都画成线条，只表达结构。

## 状态（页面内的、会话级的）

- 页面声明自己的参数：`state: { tab: oneOf(["specs", "related"]) }`（单选，没有值时取 default，默认第一个）、`state: { faq: manyOf(["q1", "q2"]) }`（多选，默认一个都没有）。筛选的参数不用声明：它们就是列表页类型的字段名。
- **会话级参数**写在草图顶层：`session: { viewer: oneOf(["visitor", "member"]) }`——页眉页脚和每个页面都认识它，切换后一直生效（存在浏览器里，换页不丢；地址里写了以地址为准）。它是“谁在看”的表达：**不是认证**，不存密码、不管权限；真正挡人的仍然只有地址里的 key。
- 自由文本参数：`free()`（搜索词）、`free("1")`（页码，不写时是 1）。取值不是有限集合，所以不写 values / multi。
- 名字不能重复：页面参数不能和会话参数、列表页类型的字段重名。

## 模型（数据结构，照 zeroY 的 shape 词汇）

```
model: { 类型名: TypeDef }
TypeDef = { label, key, fields, seed, vocab?, public?, title?, unlisted?, card? }
```

| 意图 | 写法 |
|---|---|
| 有限集合、很多条目共用（分类、认证） | `vocab("名称", [["id","显示名"], …])`；记录里用 `f.term(label, "vocab 类型名", {multiple?})` 存 **id** |
| 封闭单选 | `f.choice(label, options, {radio?})` |
| 关系：相关产品、相关案例 | `f.ref(label, "另一个内容类型", {multiple?})`，存对方的主键。详情页用 `facts({only:["related"]})` 显示成链接；集合里用 `where` 查关系（如 `collection("case", {where:{products:"$slug"}})` = 提到当前产品的案例）。引用词表用 `term`，引用内容用 `ref` |
| 只给后台的字段（审核状态、负责人、核实时间） | `{ internal: true }`：任何客户页面都不能展示它（绑定、facts、筛选、徽章都会被体检拦），公开表单里也没有；后台表格和表单里有 |
| 可变长、每个记录自己的结构（技术参数） | `f.list(label, {key:"参数名", value:"参数值"}, {kv:true})`，每行带稳定的 `row_id`（不是下标） |
| 内容本身是一棵树（文章正文） | `f.blocks(label)`：值是一串节点（和页面同一套语法写成数据，不能含 embed / form / nav / brand），详情页用 `embed(bind("body"))` 渲染；后台里是 JSON 文本框，保存时校验 |
| 日期 | `f.date(label)`：ISO（`2026-10-17`），表单里是日期输入，能排序 |
| 图片 | `f.media(label)`（后台可上传，浏览器里压到长边 ≤800px） |
| 访客可提交（询盘） | `defType(label, {public:true, …})` → 自动得到公开表单页，提交的记录出现在后台 |
| 草稿对客户不可见 | `unlisted: {status:"草稿"}` |
| 列表卡片 | `card: col(image(bind("photos")), text(3, bind("code")))` |

- 类型名和主键值会进路由，只能用 `[A-Za-z0-9._-]`。
- 跨记录关联存对方的标识，渲染时现查，不复制对方的字段。

## 页面（模型的影子）

每个类型自动得到列表页 `/type`、详情页 `/type/:id`；`public` 类型得到新增表单页；只有被单值 term 字段引用的词表才有“按条目筛选”页。
`pages` 里写同名路由 = 覆盖。必须有首页 `/`。

## 筛选

`filters("category", "materials")`：同一字段内多选取并集、不同字段取交集；选项旁的数字 = “在其余条件都满足时，再选它还剩几个”，剩 0 个变淡；
选中状态在地址里（`#/product?materials=metal`，可分享、可回退）；不足两个有记录的值的字段自动不出现。

## 数据结构图与后台

`#/_model`：由模型直接画出的结构图（类型框、字段、选词箭头），点框进到真·CRUD 表格（搜索、筛选、分页、编辑、删除、重置）。
**客户页面上没有入口**（客户看不懂），只有知道地址的人进得去。状态存浏览器 localStorage，换设备就没了。

## 红线（公开预览）

草图地址公开、不过 Access（只靠地址里的随机 key）。**不能放真实价格、账号密码、令牌、合同金额。** `check_sketch` 会拦。
邮箱、手机号只警告。为演示造出来的“示意数据”也会被客户看到，别让它看起来像真参数，并在配置里注明。

## 流程

1. `describe_format`（本文 + JSON Schema）→ 2. `get_example` 看标准答案 → 3. 写草图 → 4. `check_sketch` 直到 `ok` →
5. `publish_sketch`（需要运营凭证）→ 6. 把返回的 `url` 发给客户；改了再 `publish_sketch` 一次，同一个编号地址不变。

## 体检会提醒的设计问题（不拦发布，但多半该改）

- **导航 >7 项**：引擎会收进菜单，但这说明信息架构该合并或分组了。
- **字段从来没出现在任何客户页面上**：要么加进页面，要么标 `internal: true`；没人看的字段不用建。名字像后台流程的字段（审核/核实状态……）出现在客户页上也会提醒。
- **同一页里两个 `facts` 显示完全相同的字段**：用 `only` 把字段分给不同板块。
- **详情页里的集合没有 `where`**：显示的是所有记录，不是“相关的”。
- **占位或解释性文案**（placeholder、for testing、demo only、待填写……）：客户会读到它；没有资料依据的内容留空（波浪线），别写说明。
- **记录太少（<4）**：列表、筛选、“相关”演示不出来。**字段太多（>25）**：多半是一段段的文字，那是页面里的内容，不是数据结构。**一页顶层板块 >9**。
- **英文文案没设 `locale`**。**页眉第一个东西是回首页的 `action`**：logo 用 `brand()`。

## 词表条目的额外文字

`vocab("名称", [{ id: "lace", label: "蕾丝", en: "Lace" }])`：除 `id` 和 `label` 之外的键（这里的 `en`）会成为这个词表的额外文字字段，后台里能编辑，页面里能 `bind`。

## 面包屑

详情页的面包屑是 首页 / **这个类型自己的列表页** / 记录名。只有当“某个单值 term 字段指向的词表条目页，列的就是这个类型的记录”时（如 产品分类 → 三辊闸 → 型号），才改成 首页 / 词表页 / 条目 / 记录名。

## 现在表达不了的（别硬凑）

按“生成空间”的边界，剩下的是这几类，遇到时用最接近的写法并在配置里注明，不要为它们另造槽：

- **不进地址的瞬时状态**：悬停、滚动位置、拖动、动画和自动轮播的节奏。这些按定义不是结构；
- **fold 这一簇之外的计算**：中位数、日期运算（日期只能排序，不能算差）、字符串处理。声明“这个值是算出来的”，没有数据就画波浪线；
- **真正的认证和权限**：`session` 只表达“不同的人看到不同的结构”，不验证任何人；
- **页面之外的行为**：支付、搜索引擎、邮件。草图表达结构，这些在网站开发阶段接。
