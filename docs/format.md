# 草图格式（给 agent 读：怎么表达一个网站的结构）

手绘风格的结构草图：页面怎么组织、放什么、数据长什么样。**只表达“放什么”，不表达“长什么样”**——字体、配色、间距、像素都不可表达，客户无处可纠结。
草图是潦草的，但内容要对。它是真的能点、能增删改的小网站（数据存在访客自己的浏览器里，没有后端）。

## 一个生成式

```
Node   = 叶子 | 排列 | 生成
叶子   = text | image | action | brand | nav | filters | form
排列   = Group(dir, Node[])                  dir ∈ col | row | grid
生成   = Each(dir, x ∈ 来源) → Node          来源 = records(类型, 条件) | fields(一条记录的字段) | items(一个多值字段的各项)
fill   = ∅（粗波浪线）| "文案" | bind(路径) | count(来源)
Page   = 路由 × 环境 → Node                  环境 = 一组命名绑定（页面记录叫 page、each 里的 x……）+ 地址里的 ?query
```

写法有两种，等价：写 TS 配置（`defineSketch`，由 CLI 求值成 JSON），或直接提交 JSON（`get_schema` 给 JSON Schema）。范例见 `get_example`。

**记住两件事，其余都是组合：**

1. **列表、字段表、徽章、图库、对比表、流程都不是槽，是 `each` 的不同写法。** `collection / facts / badges / gallery / compare / steps` 只是 DSL 里几行 `each` 的简写（下面都写出来了）。需要新排法时，先问：这是对哪个关系、逐项生成什么？
2. **链接带着环境走。** `action(…, "/inquiry", { with: { product: bind("code") } })` 把当前型号写进目标地址的 `?product=…`，目标页的表单拿它当初始值——和筛选状态是同一个机制（地址即状态）。

### 叶子

| 叶子 | 意思 | 填什么 |
|---|---|---|
| `text(1\|2\|3, fill?)` | 一段文字（1 标题 / 2 副标题 / 3 正文）；`{circle:true}` = 圆圈里的一个词（徽章） | 没填 = 粗波浪线；绑的字段在这条记录上没有值 = 一条粗短线 |
| `image(fill?)` | 图片占位（叉框）；绑到图片字段显示第一张真图；绑到 `items` 的一张图 = 点开放大 | |
| `action(fill?, to?, {ghost?, with?})` | 按钮；`to` 是路由；`with` 把环境带去目标页（见上） | |
| `brand(fill?, to?)` | logo / 字标，点它回首页。**别用 `action` 做 logo**，那会是按钮 | 没填 = 粗波浪线字标 |
| `nav(...paths)` | 导航，名字取自各路由的页面名。放不下时引擎自动收进手绘的菜单按钮 | |
| `filters(...fields)` | 筛选（term / ref / choice / bool 字段）。字段由模型推出，这里只选哪些出现 | |
| `form()` | 新增表单（页面上下文是“新增 T”时）；地址里 `?字段=值` 是初始值 | |

### 排列

- `col(...)` / `row(...)` / `grid(...)`：纵向 / 横向 / 横向折行等分。
- `section("名字", ...)`：带名字的组 = 一个框，名字是标注。**每个页面的顶层板块都要有名字。**
- `card(...)` 一张有框的卡片；`pair(名, 值)` 字段表的一行；`accent(node)` 强调色；`ruled(node)` 孩子之间有分隔线。
- `span(份数, node)`：一行里的相对宽度，如 `row(span(1, filters("a")), span(3, collection("t")))`。是份数，不是像素。
- `steps(...)`：**孩子有顺序**（流程）。结构里只声明“顺序有意义”，序号和连接线由引擎画。
- 没有 hero / 卡片网格 / 对比表 这类变体：经典布局是这些的组合；想复用就在配置里写函数。嵌套超过 5 层会警告。

### 生成：`each(来源, 每一项怎么画, {as?, dir?, seq?, rule?})`

每一项在模板里叫 `as`（默认 `it`）；模板里用 `bind("x.字段")` 取值，**嵌套的 each 要起不同的名字**。

| 来源 | 逐项生成什么 | 每一项有 |
|---|---|---|
| `records("类型", {where?, limit?, notSelf?})` | 某类型的记录（`where` 的值：`":param"` 路由参数、`"$field"` 页面记录的字段、字面量） | 这条记录的字段，`@title` = 显示名。`item` 可以不写：用那个类型的 `card`（没有就是 图 + 显示名），并链到详情页 |
| `fields({of?, type?, only?, skip?})` | 一条记录的字段（默认当前记录；kv 列表展开成一行行参数） | `label` `value` `field`。客户页不摆空字段，整块都空时把字段名全摆出来，值是波浪线。`type` 不带 `of` = 只要字段名（对比表的行头） |
| `items("字段")` | 一个多值字段的各项：term/ref → 对方的记录；media → 图片；list → 每一行 | 对应的记录 / 图 / 行 |

**bind 路径**：`字段`（当前记录）、`变量.字段`、`变量.@title`（显示名）、`变量.{另一变量.field}`（字段名本身来自数据）。页面记录（详情页）的变量叫 `page`，也是“当前记录”。
**count**：`text(2, count(records("product", {where: {category: ":id"}})))` = 本分类的型号数。

### 简写（DSL 里都只是几行 each）

```ts
collection(type, opts)  = each(records(type, opts), undefined, { dir: "grid" })
facts({only?, skip?})   = each(fields(opts), pair(text(3, bind("e.label")), text(3, bind("e.value"))), { as: "e", rule: true })
badges(field)           = each(items(field), text(3, bind("it.@title"), { circle: true }), { dir: "row" })
gallery(field)          = each(items(field), image(bind("it")), { dir: "row" })
compare(type, 字段[], {where?, limit?})        // 对比表：外层逐个字段（行），内层逐条记录（列）
  = each(fields({type, only}), row(text(bind("f.label")), each(records(type,…), text(bind("p.{f.field}")), {as:"p", dir:"row"})), {as:"f", rule:true})
```

没填的一律是粗波浪线（见下）。`facts` 想分成几个板块，就每个板块写自己的 `only`，别重复同一个 `facts()`。

### 没填的一律是粗波浪线

槽没写 `fill`、`bind` 的字段在这条记录上没有值（比如显示名留空、只留主键）、`kv` 参数行没有值，都画成粗波浪线（“此处有文字”）。
`locale`（顶层）：`"zh"`（默认）或 `"en"`——引擎自带、客户会看到的文案（面包屑、空状态、“更多”、菜单、清除筛选、公开表单的按钮和提示）用哪种语言。**英文站必须写 `locale: "en"`**；体检会提醒。后台（`#/_model`）始终是中文。
`fidelity`（顶层）：`"words"`（默认）= 写了的文案照写；`"lines"` = 所有文案（含取自模型的值）都画成线条，只表达结构。

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

- **只活在内存里的页面内状态**：标签页、手风琴、轮播、多步向导。状态能放进地址（`?tab=2`）的才是环境的一部分——目前还没有“按地址里的值切换显示哪个孩子”的节点；
- **计数之外的计算**：总和、平均、“还剩 N 天”。目前只有 `count`；
- **内容本身是一棵树**：一篇带小标题和嵌入的文章。现在文章正文只能是一段文字字段；
- **用户相关**：登录、个性化、权限。草图没有“用户”这个维度，这是有意的。
