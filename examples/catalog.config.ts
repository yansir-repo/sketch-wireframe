/**
 * 范例：一个目录 + 询盘的网站（虚构的文具厂）。这是“标准答案”：词表、带筛选的列表、参数表详情、公开询盘表单。
 * 没有资料依据的数据一律不写（留空 = 粗波浪线）；为演示筛选而造的差异用确定性公式，并注明是示意。
 */
import {
  accordion,
  action,
  badges,
  brand,
  bind,
  col,
  collection,
  compare,
  count,
  defineSketch,
  defType,
  distinct,
  each,
  f,
  facts,
  filters,
  form,
  free,
  gallery,
  manyOf,
  media,
  min,
  oneOf,
  pair,
  image,
  nav,
  pager,
  records,
  row,
  search,
  section,
  sortMenu,
  span,
  steps,
  tabs,
  text,
  when,
  vocab,
} from "sketch-wireframe";

// 词表：有限、多条目共用。记录里存 id，显示时查名称。
const category = vocab("产品分类", [
  { id: "pens", label: "笔类", en: "Pens" },
  { id: "notebooks", label: "本册", en: "Notebooks" },
  { id: "folders", label: "文件夹", en: "Folders" },
  { id: "desk", label: "桌面收纳", en: "Desk Organisers" },
]);
const material = vocab("材质", [
  ["plastic", "塑料"],
  ["metal", "金属"],
  ["paper", "纸"],
  ["bamboo", "竹"],
]);
const cert = vocab("认证", [
  ["fsc", "FSC"],
  ["iso9001", "ISO9001"],
  ["reach", "REACH"],
]);

// 示意数据：序号决定材质/认证，只为让筛选有变化可看——不是真实参数。
const MATERIALS = ["plastic", "metal", "paper", "bamboo"];
const items = (c: string, codes: string[], start: number) =>
  codes.map((code, i) => {
    const n = start + i;
    return {
      code,
      category: c,
      materials: [MATERIALS[n % 4]!, ...(n % 3 === 0 ? [MATERIALS[(n + 1) % 4]!] : [])],
      certs: ["iso9001", ...(n % 2 === 0 ? ["fsc"] : []), ...(n % 5 === 0 ? ["reach"] : [])],
      photos: [],
      related: [codes[(i + 1) % codes.length]!], // 同类里的下一个：演示 ref（相关型号）
      moq: 100 * ((n % 5) + 1), // 示意：让 fold（最低起订量）有数可算
      status: "上架",
      specs: ["尺寸", "重量", "包装"].map((key, k) => ({ row_id: `r${k + 1}`, key, value: "" })), // 没填 = 波浪线
    };
  });

const product = defType("型号", {
  key: "code",
  unlisted: { status: "草稿" },
  fields: {
    code: f.text("型号编码"),
    category: f.term("分类", "category", { table: true }),
    materials: f.term("材质", "material", { multiple: true }),
    certs: f.term("认证", "cert", { multiple: true, detail: false }),
    related: f.ref("相关型号", "product", { multiple: true }),
    moq: f.number("起订量（示意）"),
    specs: f.list("技术参数", { key: "参数名", value: "参数值" }, { kv: true }),
    photos: f.media("型号图片"),
    // 运营用的上架状态：只给后台（internal），客户页面和公开表单里都没有它
    status: f.choice("上架状态", ["草稿", "上架"], { radio: true, table: true, internal: true }),
  },
  card: col(image(bind("photos")), text(3, bind("code"))),
  seed: [
    ...items("pens", ["P101", "P102", "P203", "P204", "P305"], 0),
    ...items("notebooks", ["N11", "N12", "N23", "N24"], 5),
    ...items("folders", ["F01", "F02", "F03"], 9),
    ...items("desk", ["D7", "D8", "D9", "D10"], 12),
  ],
});

// 文章：正文是一棵树（blocks 字段）——和页面同一套语法写成数据，详情页用 embed 渲染它。内容是示意。
const article = defType("文章", {
  key: "slug",
  title: "title",
  fields: {
    slug: f.text("地址名"),
    title: f.text("标题", { table: true }),
    published: f.date("发布日期", { table: true }),
    body: f.blocks("正文"),
  },
  seed: ["a1", "a2", "a3", "a4"].map((slug, i) => ({
    slug,
    title: `示意文章 ${i + 1}`,
    published: ["2026-03-02", "2026-01-15", "2026-05-20", "2026-02-08"][i]!, // 示意：让“最新在前”有顺序可看
    body: JSON.parse(
      JSON.stringify([
        text(2, "这一段是小标题"),
        text(3),
        i % 2 === 0 ? image() : steps(text(3, "第一步"), text(3, "第二步"), text(3, "第三步")),
        text(3),
      ]),
    ),
  })),
});

// 询盘：访客填写、我们收到——公开的“新增”表单，也是模型视图里的一张表
const inquiry = defType("获取报价", {
  key: "id",
  public: true,
  title: "contact",
  fields: {
    id: f.text("编号"),
    product: f.ref("意向型号", "product"),
    quantity: f.text("数量"),
    notes: f.text("说明", { multiline: true }),
    contact: f.text("联系方式", { table: true }),
  },
});

// 型号列表：每页 6 条，按 sort 参数排，按 q 搜；页码读 page 参数
const PRODUCT_LIST = records("product", {
  limit: 6,
  order: { param: "sort" },
  search: { param: "q" },
  page: { param: "page" },
});

export default defineSketch({
  code: "EX-CATALOG",
  title: "范例 · 文具目录站",
  // 会话级参数：“谁在看”。切换后一直生效（换页不丢），也能写在地址里（?viewer=member）。不是认证，只表达“不同的人看到不同的结构”
  session: { viewer: oneOf(["visitor", "member"]) },
  model: { category, material, cert, product, article, inquiry },

  header: row(
    brand("示例文具"),
    nav("/", "/category", "/product", "/article", "/compare", "/inquiry"),
    row(
      when(
        "viewer=visitor",
        action("会员登录", undefined, { ghost: true, set: { viewer: "member" } }),
      ),
      when(
        "viewer=member",
        action("退出登录", undefined, { ghost: true, set: { viewer: "visitor" } }),
      ),
      action("获取报价", "/inquiry"),
    ),
  ),
  footer: row(text(3, "联系方式"), text(3, "版权")),

  pages: {
    "/": {
      name: "首页",
      body: [
        // 标题/副标题还没定——不写，画成波浪线
        section(
          "Hero",
          row(
            col(
              text(1),
              text(2),
              row(action("获取报价", "/inquiry"), action("查看产品", "/category", { ghost: true })),
            ),
            image(),
          ),
        ),
        section("产品分类入口", collection("category", { limit: 8 })),
        section("热门型号", collection("product", { limit: 4 })),
        // media：不是图片的占位（视频、地图、图表、图标、文件下载）——内容是开发阶段的事，草图里不编
        section("品牌视频", media("video")),
        section(
          "产能",
          row(media("chart"), col(row(media("icon"), text(3)), row(media("icon"), text(3)))),
        ),
        // distinct：一个字段出现过的各个值，每项自带“有这个值的记录数”——分组统计
        section(
          "各分类型号数",
          each(
            distinct("product", "category"),
            pair(text(3, bind("o.label")), text(3, bind("o.count"))),
            {
              as: "o",
              dir: "col",
              rule: true,
            },
          ),
        ),
        // 有顺序的流程：序号和连接线由引擎画，这里只声明“顺序有意义”
        section(
          "下单流程",
          steps(text(2, "咨询"), text(2, "报价"), text(2, "打样"), text(2, "交付")),
        ),
      ],
    },

    // 左栏筛选 : 右栏产品 = 1 : 3。筛选的字段由模型推出，这里只选哪些出现
    "/category/:id": {
      ctx: { type: "product", many: true, where: { category: ":id" } },
      body: [
        // fold：对一个来源折叠出一个值。没有数据时画波浪线，不编
        section(
          "概览",
          row(
            text(2, count(records("product", { where: { category: ":id" } }))),
            pair(
              text(3, "最低起订量"),
              text(3, min(records("product", { where: { category: ":id" } }), "moq")),
            ),
          ),
        ),
        section(
          "产品",
          row(
            span(1, filters("materials", "certs")),
            span(3, collection("product", { where: { category: ":id" }, limit: 24 })),
          ),
        ),
      ],
    },

    // 排序 / 搜索 / 分页：三者都是地址里的参数（?sort=-moq&q=P1&page=2），和筛选、标签页同一个机制；
    // 每页 6 条，列表和页码写的是同一个 records 来源
    "/product": {
      name: "全部型号",
      ctx: { type: "product", many: true },
      state: { sort: oneOf(["code", "-moq", "moq"]), q: free(), page: free("1") },
      body: [
        section(
          "产品",
          row(
            span(1, filters("category", "materials", "certs")),
            span(
              3,
              col(
                row(
                  search("q"),
                  sortMenu("sort", [
                    ["code", "型号"],
                    ["-moq", "起订量从高到低"],
                    ["moq", "起订量从低到高"],
                  ]),
                ),
                each(PRODUCT_LIST, undefined, { dir: "grid" }),
                pager(PRODUCT_LIST),
              ),
            ),
          ),
        ),
      ],
    },

    // 文章：最新在前（发布日期是 date 字段，order 写成 "-published"）
    "/article": {
      name: "文章",
      ctx: { type: "article", many: true },
      body: [section("文章", collection("article", { limit: 24, order: "-published" }))],
    },

    // 对比表：几个字段（行）× 几条记录（列）——两层 each，不是新的槽
    "/compare": {
      name: "对比",
      body: [
        section(
          "笔类对比",
          compare("product", ["materials", "certs", "related"], {
            where: { category: "pens" },
            limit: 3,
          }),
        ),
      ],
    },

    "/product/:id": {
      ctx: { type: "product" },
      // 标签页的状态就是地址里的 ?tab=…：每个标签都能被分享、被验证器逐个点到
      state: { tab: oneOf(["specs", "related"]) },
      body: [
        section("图库", gallery("photos")),
        section("基本信息", text(1, bind("code")), facts({ only: ["category", "materials"] })),
        section(
          "详情",
          tabs("tab", [
            ["specs", "技术参数", facts({ only: ["specs"] })],
            ["related", "相关型号", facts({ only: ["related"] })],
          ]),
        ),
        // with：把当前型号带去报价表单——表单里“意向型号”已经选好
        section("规格书", row(media("file"), text(3, "产品规格书（PDF）"))),
        section(
          "认证与报价",
          row(
            badges("certs"),
            action("为这款获取报价", "/inquiry", { with: { product: bind("code") } }),
          ),
        ),
        // 只有会员看得到的一块：条件出现，条件是会话参数
        when("viewer=member", section("会员资料", text(3), text(3))),
        section(
          "同类型号",
          collection("product", { where: { category: "$category" }, notSelf: true, limit: 4 }),
        ),
      ],
    },

    "/inquiry": {
      name: "获取报价",
      ctx: { type: "inquiry", create: true },
      // 手风琴：多选参数，点标题展开/收起各自那一条
      state: { faq: manyOf(["lead", "pack"]) },
      body: [
        section(
          "常见问题",
          accordion("faq", [
            ["lead", "交期多久？", text(3)],
            ["pack", "怎么包装？", text(3)],
          ]),
        ),
        section("到访我们", media("map")),
        section("表单", form()),
      ],
    },
  },
});
