# 草图格式（给 agent 读：怎么表达一个网站的结构）

手绘风格的结构草图：页面怎么组织、放什么、数据长什么样。**只表达“放什么”，不表达“长什么样”**——字体、配色、间距、像素都不可表达，客户无处可纠结。
草图是潦草的，但内容要对。它是真的能点、能增删改的小网站（数据存在访客自己的浏览器里，没有后端）。

## 一个生成式

```
Node  = Slot(kind, fill?) | Group(dir, name?, Node[])        （可带 w：在一行里占几份）
fill  = ∅（粗波浪线）| "文案" | bind("字段")
Page  = 路由 × 上下文 × Group     上下文 ∈ { 无, 集合 T[]（可带 where）, 记录 T, 新增 T }
```

写法有两种，等价：直接提交 JSON（`check_sketch` / `publish_sketch`），或者写一份 TS 配置（`defineSketch`），由 CLI 求值成 JSON。
范例见 `get_example`（完整的 JSON + TS 源码）。

### 槽（Slot）

| 槽 | 意思 | 填什么 |
|---|---|---|
| `text(1\|2\|3, fill?)` | 一段文字（1 标题 / 2 副标题 / 3 正文） | 没填 = 粗波浪线 |
| `image(fill?)` | 图片占位（叉框）；`bind("photos")` 显示上传的真图 | |
| `action(fill?, to?, {ghost?})` | 按钮；`to` 是路由 | |
| `nav(...paths)` | 导航，名字取自各路由的页面名 | |
| `collection(type, {where?, limit?, notSelf?})` | 某类型的记录卡片网格 | `where` 的值：`":param"`（路由参数）、`"$field"`（当前记录的字段）、字面量 |
| `facts({skip?})` | 当前记录的字段表（`kv` 列表展开成参数行） | 没有值的参数 = 粗波浪线 |
| `badges(field)` | 多选 term 字段的圆圈标签 | |
| `gallery(field)` | `media` 字段的图库 | |
| `filters(...fields)` | 筛选（term / choice / bool 字段） | 字段由模型推出，这里只选哪些出现 |
| `form()` | 新增表单（上下文是“新增 T”时） | |

### 组（Group）

- `col(...)` / `row(...)`：纵向 / 横向排列。
- `section("名字", ...)`：带名字的组 = 一个框，名字是标注（渲染成紧贴框顶的小标签）。**每个页面的顶层板块都要有名字。**
- `accent(node)`：强调色。
- `span(份数, node)`：一行里的相对宽度，如 `row(span(1, filters("a")), span(3, collection("t")))`。是份数，不是像素。
- **没有 hero / 卡片 / 网格这类变体。** 经典布局是原子的组合：Hero = `row(col(text(1), text(2), row(action(), action())), image())`。
  想复用就在配置里写函数。组嵌套超过 4 层会警告。

### 没填的一律是粗波浪线

槽没写 `fill`、`kv` 参数行没有值，都画成粗波浪线（“此处有文字”）。**宁可波浪线，也不要编数据**——客户不会纠结，seed 也不用造。
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
