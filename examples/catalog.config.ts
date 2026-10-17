/**
 * 范例：一个目录 + 询盘的网站（虚构的文具厂）。这是“标准答案”：词表、带筛选的列表、参数表详情、公开询盘表单。
 * 没有资料依据的数据一律不写（留空 = 粗波浪线）；为演示筛选而造的差异用确定性公式，并注明是示意。
 */
import {
  action,
  badges,
  bind,
  col,
  collection,
  defineSketch,
  defType,
  f,
  facts,
  filters,
  form,
  gallery,
  image,
  nav,
  row,
  section,
  span,
  text,
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
    specs: f.list("技术参数", { key: "参数名", value: "参数值" }, { kv: true }),
    photos: f.media("型号图片"),
    status: f.choice("上架状态", ["草稿", "上架"], { radio: true, table: true, detail: false }),
  },
  card: col(image(bind("photos")), text(3, bind("code"))),
  seed: [
    ...items("pens", ["P101", "P102", "P203", "P204", "P305"], 0),
    ...items("notebooks", ["N11", "N12", "N23", "N24"], 5),
    ...items("folders", ["F01", "F02", "F03"], 9),
    ...items("desk", ["D7", "D8", "D9", "D10"], 12),
  ],
});

// 询盘：访客填写、我们收到——公开的“新增”表单，也是模型视图里的一张表
const inquiry = defType("获取报价", {
  key: "id",
  public: true,
  title: "contact",
  fields: {
    id: f.text("编号"),
    quantity: f.text("数量"),
    notes: f.text("说明", { multiline: true }),
    contact: f.text("联系方式", { table: true }),
  },
});

export default defineSketch({
  code: "EX-CATALOG",
  title: "范例 · 文具目录站",
  model: { category, material, cert, product, inquiry },

  header: row(
    image("LOGO"),
    nav("/", "/category", "/product", "/inquiry"),
    action("获取报价", "/inquiry"),
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
      ],
    },

    // 左栏筛选 : 右栏产品 = 1 : 3。筛选的字段由模型推出，这里只选哪些出现
    "/category/:id": {
      ctx: { type: "product", many: true, where: { category: ":id" } },
      body: [
        section(
          "产品",
          row(
            span(1, filters("materials", "certs")),
            span(3, collection("product", { where: { category: ":id" }, limit: 24 })),
          ),
        ),
      ],
    },

    "/product": {
      name: "全部型号",
      ctx: { type: "product", many: true },
      body: [
        section(
          "产品",
          row(
            span(1, filters("category", "materials", "certs")),
            span(3, collection("product", { limit: 60 })),
          ),
        ),
      ],
    },

    "/product/:id": {
      ctx: { type: "product" },
      body: [
        section("图库", gallery("photos")),
        section("基本信息", text(1, bind("code")), facts()),
        section("认证与报价", row(badges("certs"), action("获取报价", "/inquiry"))),
        section(
          "同类型号",
          collection("product", { where: { category: "$category" }, notSelf: true, limit: 4 }),
        ),
      ],
    },

    "/inquiry": {
      name: "获取报价",
      ctx: { type: "inquiry", create: true },
      body: [section("表单", form())],
    },
  },
});
