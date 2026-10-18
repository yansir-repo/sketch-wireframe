import { describe, expect, it } from "vitest";
import example from "../../examples/catalog.config.ts";
import { checkSketch } from "./check.ts";
import {
  accordion,
  action,
  avg,
  bind,
  collection,
  count,
  distinct,
  each,
  embed,
  fold,
  facts,
  fields,
  filters,
  items,
  linked,
  manyOf,
  media,
  nav,
  noted,
  sum,
  free,
  oneOf,
  pager,
  records,
  search,
  section,
  sortMenu,
  tabs,
  text,
  when,
} from "./dsl.ts";
import { parseSketch, sketchJsonSchema } from "./parse.ts";
import { pagesOf } from "./derive.ts";
import { notesOf } from "./notes.ts";
import { FORMAT_VERSION } from "./schema.ts";
import { parsePath } from "./scope.ts";

type Json = Record<string, any>; // eslint-disable-line
type Rec = Record<string, unknown>;
const fresh = (): Json => JSON.parse(JSON.stringify(example)) as Json;
const plain = (n: unknown) => JSON.parse(JSON.stringify(n)) as Json;

/** 往一个页面末尾加一个板块（用 DSL 写，转成 JSON）。 */
const addTo = (s: Json, route: string, ...nodes: unknown[]): Json => {
  s["pages"][route].body.push(
    plain(section("加的", ...(nodes as Parameters<typeof section>[1][]))),
  );
  return s;
};
const errorsOf = (s: Json) => checkSketch(s).errors.join("\n");
const warningsOf = (s: Json) => checkSketch(s).warnings.join("\n");

describe("the example sketch", () => {
  it("is valid, with no warnings", () => {
    const r = checkSketch(fresh());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("carries the format version", () => expect(fresh()["v"]).toBe(FORMAT_VERSION));

  it("survives a JSON round trip unchanged (a sketch is data, not code)", () => {
    expect(JSON.parse(JSON.stringify(example))).toEqual(example);
  });
});

describe("structure (Schema)", () => {
  it("rejects a missing key, an extra key, a wrong type and a function", () => {
    const missing = fresh();
    delete missing["code"];
    expect(parseSketch(missing).ok).toBe(false);
    expect(parseSketch({ ...fresh(), surprise: 1 }).ok).toBe(false);
    expect(parseSketch({ ...fresh(), title: 5 }).ok).toBe(false);
    const withFn = fresh();
    withFn["header"] = { slot: "text", size: 1, fill: () => "x" };
    expect(parseSketch(withFn).ok).toBe(false);
  });

  it("rejects an unknown slot kind, a text size outside 1–3 and the slots that no longer exist", () => {
    for (const bad of [
      { slot: "hero" },
      { slot: "text", size: 4 },
      { slot: "collection", type: "product" },
      { slot: "facts" },
    ]) {
      const s = fresh();
      s["header"] = bad;
      expect(parseSketch(s).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("produces a JSON Schema for get_schema", () => {
    const doc = sketchJsonSchema() as { schema: { properties: Record<string, unknown> } };
    expect(Object.keys(doc.schema.properties)).toEqual(
      expect.arrayContaining(["v", "code", "model", "pages", "header", "footer"]),
    );
  });
});

describe("semantics (validate)", () => {
  it("requires a home page and a valid project code", () => {
    const a = fresh();
    delete a["pages"]["/"];
    expect(checkSketch(a).ok).toBe(false);
    expect(checkSketch({ ...fresh(), code: "bad code!" }).ok).toBe(false);
  });

  it("catches a term pointing at a missing vocabulary and a seed id the vocabulary lacks", () => {
    const a = fresh();
    a["model"]["product"].fields["category"].to = "ghost";
    expect(errorsOf(a)).toContain("ghost");
    const b = fresh();
    b["model"]["product"].seed[0].category = "not-a-category";
    expect(checkSketch(b).ok).toBe(false);
  });

  it("rejects a non-positive span", () => {
    const a = fresh();
    a["pages"]["/product"].body[0].group[0].w = 0;
    expect(checkSketch(a).ok).toBe(false);
  });

  it("a ref must point at a content type (not a vocabulary) and at records that exist", () => {
    const toVocab = fresh();
    toVocab["model"]["product"].fields["related"].to = "category";
    expect(errorsOf(toVocab)).toContain("词表");
    const dangling = fresh();
    dangling["model"]["product"].seed[0].related = ["NOPE"];
    expect(errorsOf(dangling)).toContain("NOPE");
  });
});

describe("the environment: variables, paths, sources", () => {
  it("parses paths with a computed field name", () => {
    expect(parsePath("p.code")).toEqual([{ lit: "p" }, { lit: "code" }]);
    expect(parsePath("p.{f.field}")).toEqual([{ lit: "p" }, { dyn: "f.field" }]);
    expect(parsePath("it.@title")).toEqual([{ lit: "it" }, { lit: "@title" }]);
  });

  it("rejects an unknown field, an unknown variable and a path that is too long", () => {
    expect(errorsOf(addTo(fresh(), "/product/:id", text(3, bind("nope"))))).toContain("nope");
    expect(errorsOf(addTo(fresh(), "/", text(3, bind("code"))))).toContain("没有当前记录");
    expect(
      errorsOf(addTo(fresh(), "/product/:id", text(3, bind("page.category.label")))),
    ).toContain("路径太长");
  });

  it("nested each must not reuse a variable name, and the item is required for fields/items", () => {
    const clash = addTo(
      fresh(),
      "/",
      each(records("category"), each(records("product"), text(3, bind("it.code")))),
    );
    expect(errorsOf(clash)).toContain("已被外层占用");
    const noItem = addTo(fresh(), "/product/:id", each(fields({ only: ["category"] })));
    expect(errorsOf(noItem)).toContain("必须写 item");
  });

  it("a computed field name must come from a fields item and name real fields of that type", () => {
    const bad = addTo(
      fresh(),
      "/",
      each(
        fields({ type: "product", only: ["category"] }),
        each(records("category"), text(3, bind("c.{f.field}")), { as: "c" }),
        { as: "f" },
      ),
    );
    expect(errorsOf(bad)).not.toContain("{} 里要写");
    expect(
      errorsOf(addTo(fresh(), "/", each(records("product"), text(3, bind("it.{x}"))))),
    ).toContain("{} 里要写");
  });

  it("items only expands a multi-valued term/ref/media/list field", () => {
    expect(
      errorsOf(addTo(fresh(), "/product/:id", each(items("code"), text(3, bind("it.x"))))),
    ).toContain("items 只能展开");
  });

  it("scopes where: ':param' must be a route parameter, '$field' a field of the page record, notSelf needs the same type", () => {
    expect(
      errorsOf(addTo(fresh(), "/", collection("product", { where: { category: ":id" } }))),
    ).toContain(":id");
    expect(
      errorsOf(addTo(fresh(), "/", collection("product", { where: { category: "$category" } }))),
    ).toContain("没有记录可以引用");
    expect(errorsOf(addTo(fresh(), "/", collection("product", { notSelf: true })))).toContain(
      "notSelf",
    );
  });

  it("count counts records, items or distinct values, not fields", () => {
    expect(
      errorsOf(addTo(fresh(), "/", text(2, count({ fields: { type: "product" } })))),
    ).toContain("fold 只能折叠");
  });

  it("with can only carry values to a new-record form page, into fields it has", () => {
    expect(
      errorsOf(addTo(fresh(), "/product/:id", action("x", "/product", { with: { a: "1" } }))),
    ).toContain("新增表单页");
    expect(
      errorsOf(addTo(fresh(), "/product/:id", action("x", "/inquiry", { with: { nope: "1" } }))),
    ).toContain("nope");
    expect(
      errorsOf(
        addTo(
          fresh(),
          "/product/:id",
          action("x", "/inquiry", { with: { product: bind("code") } }),
        ),
      ),
    ).toBe("");
  });
});

describe("internal (back-office-only) fields", () => {
  it("cannot be bound, expanded as facts, filtered, or carried by a link", () => {
    expect(errorsOf(addTo(fresh(), "/product/:id", text(3, bind("status"))))).toContain("internal");
    expect(errorsOf(addTo(fresh(), "/product/:id", facts({ only: ["status"] })))).toContain(
      "internal",
    );
    expect(errorsOf(addTo(fresh(), "/product", filters("status")))).toContain("internal");
  });
});

describe("fields source (facts)", () => {
  it("only and skip are exclusive; only must name real, showable fields", () => {
    expect(
      checkSketch(
        addTo(
          fresh(),
          "/product/:id",
          each(fields({ only: ["category"], skip: ["specs"] }), text(3, bind("e.label"))),
        ),
      ).ok,
    ).toBe(false);
    expect(errorsOf(addTo(fresh(), "/product/:id", facts({ only: ["nope"] })))).toContain("nope");
    expect(errorsOf(addTo(fresh(), "/product/:id", facts({ only: ["photos"] })))).toContain("图片");
  });
});

describe("design-quality rules (errors block publishing, warnings do not)", () => {
  it("warns when a nav has more than 7 entries", () => {
    const s = fresh();
    s["header"].group[1].paths = Array.from({ length: 8 }, () => "/");
    expect(warningsOf(s)).toContain("导航有 8 项");
  });

  it("rejects fields no client page ever shows, and lets internal ones be", () => {
    const s = fresh();
    s["model"]["product"].fields["note"] = { kind: "text", label: "备注" };
    expect(errorsOf(s)).toContain("note");
    s["model"]["product"].fields["note"].internal = true;
    expect(errorsOf(s)).not.toContain("note");
  });

  it("counts a field as shown when it is bound, in a fields source, an items source or a computed path", () => {
    const s = fresh();
    s["model"]["product"].fields["note"] = { kind: "text", label: "备注" };
    addTo(s, "/product/:id", text(3, bind("note")));
    expect(errorsOf(s)).not.toContain("note");
  });

  it("rejects two facts on one page that show the same fields", () => {
    const s = addTo(fresh(), "/product/:id", facts({ only: ["category", "materials"] }));
    expect(errorsOf(s)).toContain("显示完全相同的字段");
  });

  it("rejects a collection on a detail page with no where (shows everything, not related)", () => {
    expect(errorsOf(addTo(fresh(), "/product/:id", collection("product", { limit: 3 })))).toContain(
      "没有 where",
    );
  });

  it("rejects placeholder / explanatory copy and a back-office-looking field shown to clients", () => {
    for (const copy of [
      "A placeholder used only for testing",
      "Synthetic row for the blog route",
      "Demo only; no delivery promise",
      "Demo Hoodie Base",
    ]) {
      const s = fresh();
      s["model"]["product"].seed[0].specs[0].value = copy;
      expect(errorsOf(s)).toContain("placeholder-copy");
    }
    const t = fresh();
    t["model"]["product"].fields["verification_status"] = { kind: "text", label: "核实" };
    addTo(t, "/product/:id", facts({ only: ["verification_status"] }));
    expect(errorsOf(t)).toContain("verification_status");
  });

  it("warns on thin data, a bloated model, an overloaded page and a logo built as an action", () => {
    const thin = fresh();
    thin["model"]["product"].seed = (thin["model"]["product"].seed as Rec[]).slice(0, 2);
    for (const r of thin["model"]["product"].seed as Rec[]) r["related"] = [];
    expect(warningsOf(thin)).toContain("只有 2 条记录");
    const bloated = fresh();
    for (let i = 0; i < 26; i++)
      bloated["model"]["product"].fields[`f${i}`] = {
        kind: "text",
        label: `F${i}`,
        internal: true,
      };
    expect(warningsOf(bloated)).toContain("个字段（>25）");
    const heavy = fresh();
    heavy["pages"]["/"].body = Array.from({ length: 10 }, (_, i) =>
      plain(section(`s${i}`, text(3))),
    );
    expect(warningsOf(heavy)).toContain("10 个顶层板块");
    const logo = fresh();
    logo["header"].group[0] = { slot: "action", fill: "ACME", to: "/" };
    expect(warningsOf(logo)).toContain("brand()");
  });

  it("warns when the copy is English but no locale is set — and not when it is", () => {
    const s = fresh();
    type N = { group?: N[]; item?: N; fill?: unknown };
    const english = (n: N) => {
      n.group?.forEach(english);
      if (n.item) english(n.item);
      if (typeof n.fill === "string")
        n.fill = "Request a quote for custom products made to your specification";
    };
    for (const p of Object.values(s["pages"]) as Array<{ body: N[] }>) p.body.forEach(english);
    english(s["header"]);
    english(s["footer"]);
    expect(warningsOf(s)).toContain("locale");
    s["locale"] = "en";
    expect(warningsOf(s)).not.toContain("locale");
  });

  it("rejects a $field where that matches nothing on any seed record, and stays quiet when records are related", () => {
    const rel = collection("product", { where: { category: "$category" }, notSelf: true });
    expect(errorsOf(addTo(fresh(), "/product/:id", rel))).not.toContain("永远是空的");
    const lonely = fresh();
    (lonely["model"]["product"].seed as Rec[]).forEach((r, i) => {
      r["category"] = ["pens", "notebooks", "folders", "desk"][i % 4];
    });
    lonely["model"]["product"].seed = (lonely["model"]["product"].seed as Rec[]).filter(
      (r, i, all) => all.findIndex((x) => x["category"] === r["category"]) === i,
    );
    for (const r of lonely["model"]["product"].seed as Rec[]) r["related"] = [];
    expect(errorsOf(addTo(lonely, "/product/:id", rel))).toContain("永远是空的");
  });
});

describe("red lines", () => {
  const withFooter = (fill: string) => {
    const s = fresh();
    s["footer"].group[0].fill = fill;
    return checkSketch(s);
  };
  it("blocks prices, passwords and tokens", () => {
    for (const bad of [
      "报价 ¥1200 起",
      "单价: 35",
      "$ 99",
      "100 元",
      "密码: hunter2",
      "password=abc12345",
      "Bearer abcdefghijklmnop1234",
      "sk-abcdefghijklmnopqrstuvwx",
    ]) {
      expect(withFooter(bad).ok, bad).toBe(false);
    }
  });
  it("only warns on contact details", () => {
    const r = withFooter("a@b.com / 13812345678");
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBe(2);
  });
  it("lets ordinary copy through", () => expect(withFooter("联系我们 · 版权所有").ok).toBe(true));
});

describe("derived pages", () => {
  it("every type gets a list and a detail page; a public type gets a form page; the config overrides by route", () => {
    const pages = pagesOf(example);
    expect(Object.keys(pages)).toEqual(
      expect.arrayContaining(["/", "/product", "/product/:id", "/inquiry", "/category/:id"]),
    );
    expect(pages["/product"]?.name).toBe("全部型号");
  });
});

describe("state: params, when, links", () => {
  const withState = (route: string, state: Json, ...nodes: unknown[]): Json => {
    const s = addTo(fresh(), route, ...nodes);
    s["pages"][route].state = state;
    return s;
  };
  const tabState = { tab: plain(oneOf(["a", "b"])) };

  it("a tab strip and its panels check out when the parameter is declared", () => {
    expect(
      errorsOf(
        withState(
          "/",
          tabState,
          tabs("tab", [
            ["a", "A", text(3, "x")],
            ["b", "B", text(3, "y")],
          ]),
        ),
      ),
    ).toBe("");
  });

  it("when / set must name a declared parameter, and values must be in its domain", () => {
    expect(errorsOf(addTo(fresh(), "/", when("tab=a", text(3, "x"))))).toContain(
      "没有在这个页面的 state 里声明",
    );
    expect(errorsOf(withState("/", tabState, when("tab=zzz", text(3, "x"))))).toContain("取值只有");
    expect(
      errorsOf(withState("/", tabState, action("x", undefined, { set: { tab: "zzz" } }))),
    ).toContain("取值只有");
    expect(
      errorsOf(withState("/", tabState, action("x", undefined, { set: { nope: "a" } }))),
    ).toContain("nope");
  });

  it("set and to are exclusive; with needs a to", () => {
    expect(
      errorsOf(withState("/", tabState, action("x", "/inquiry", { set: { tab: "a" } }))),
    ).toContain("只能写一个");
    expect(errorsOf(addTo(fresh(), "/", action("x", undefined, { with: { a: "1" } })))).toContain(
      "with 要和 to 一起写",
    );
  });

  it("a state declaration needs values, a valid default, no default for multi, and must not collide with a field", () => {
    expect(errorsOf(withState("/", { t: { values: [] } }, text(3, "x")))).toContain("取值不能为空");
    expect(
      errorsOf(withState("/", { t: { values: ["a"], default: "z" } }, text(3, "x"))),
    ).toContain("default");
    expect(
      errorsOf(withState("/", { t: { values: ["a"], multi: true, default: "a" } }, text(3, "x"))),
    ).toContain("没有 default");
    const clash = fresh();
    clash["pages"]["/product"].state = { category: plain(oneOf(["a", "b"])) };
    expect(errorsOf(clash)).toContain("重名");
  });

  it("an accordion needs a multi-valued parameter's values; a multi parameter is allowed to have none selected", () => {
    const s = withState(
      "/",
      { faq: plain(manyOf(["q1", "q2"])) },
      accordion("faq", [
        ["q1", "Q1", text(3, "a")],
        ["q2", "Q2", text(3, "b")],
      ]),
    );
    expect(errorsOf(s)).toBe("");
  });

  it("a group can be a link: to a route, or setting a parameter", () => {
    const s = withState(
      "/",
      tabState,
      linked(plain(section("x", text(3, "y"))) as never, { set: { tab: "b" } }),
    );
    expect(errorsOf(s)).toBe("");
  });

  it("facets only on a list page (or a detail page) and only over filterable, non-internal fields", () => {
    expect(errorsOf(addTo(fresh(), "/", filters("category")))).toContain("才知道在哪个类型上筛选");
    expect(errorsOf(addTo(fresh(), "/product", filters("code")))).toContain("只能筛");
    expect(errorsOf(addTo(fresh(), "/product", filters("nope")))).toContain("nope");
  });

  it("options must come from a facets item; param must be declared", () => {
    expect(
      errorsOf(
        addTo(fresh(), "/product", each({ options: "zzz" }, text(3, bind("o.label")), { as: "o" })),
      ),
    ).toContain("不是一个 facets 项");
    expect(
      errorsOf(addTo(fresh(), "/", each({ param: "nope" }, text(3, bind("o.label")), { as: "o" }))),
    ).toContain("没有在这个页面的 state 里声明");
  });

  it("ui.xxx is the engine's own copy; an unknown key is an error", () => {
    expect(errorsOf(addTo(fresh(), "/", text(3, bind("ui.clearFilters"))))).toBe("");
    expect(errorsOf(addTo(fresh(), "/", text(3, bind("ui.nope"))))).toContain("ui 里没有这个键");
  });

  it("the nesting warning counts layout groups only: tone/link/each carry meaning (a filter panel is not 'deep')", () => {
    expect(warningsOf(addTo(fresh(), "/product", filters("category", "materials")))).not.toContain(
      "嵌套超过",
    );
  });
});

describe("fold and distinct", () => {
  const at = (n: unknown) => errorsOf(addTo(fresh(), "/", n));
  it("sum/min/max/avg need a number field of the records; count needs none", () => {
    expect(at(text(3, sum(records("product"), "moq")))).toBe("");
    expect(at(text(3, count(records("product"))))).toBe("");
    expect(at(text(3, fold("sum", records("product"))))).toContain("需要 field");
    expect(at(text(3, sum(records("product"), "code")))).toContain("要对数字字段折叠");
    expect(at(text(3, sum(records("product"), "nope")))).toContain("nope");
    expect(at(text(3, fold("count", records("product"), "moq")))).toContain("count 不需要 field");
  });

  it("fold only folds records / items / distinct; sum of distinct is meaningless", () => {
    expect(at(text(3, count({ fields: { type: "product" } })))).toContain("fold 只能折叠");
    expect(at(text(3, sum(distinct("product", "category"), "moq")))).toContain(
      "不能对 distinct 折叠",
    );
  });

  it("distinct needs a real, non-internal, scalar field", () => {
    expect(
      at(each(distinct("ghost", "category"), text(3, bind("o.label")), { as: "o" })),
    ).toContain("ghost");
    expect(at(each(distinct("product", "nope"), text(3, bind("o.label")), { as: "o" }))).toContain(
      "nope",
    );
    expect(
      at(each(distinct("product", "status"), text(3, bind("o.label")), { as: "o" })),
    ).toContain("internal");
    expect(
      at(each(distinct("product", "photos"), text(3, bind("o.label")), { as: "o" })),
    ).toContain("不能数");
  });

  it("a where value {x.value} must resolve in the environment", () => {
    const ok = each(
      distinct("product", "category"),
      text(3, count(records("product", { where: { category: "{o.value}" } }))),
      { as: "o" },
    );
    expect(at(ok)).toBe("");
    expect(
      at(text(3, count(records("product", { where: { category: "{nope.value}" } })))),
    ).toContain("where 的");
  });

  it("a number field that only a fold shows is counted as shown (no 'never shown' warning)", () => {
    const s = fresh();
    s["model"]["product"].fields["price_hint"] = { kind: "number", label: "x" };
    expect(errorsOf(s)).toContain("price_hint");
    expect(errorsOf(addTo(s, "/", text(3, avg(records("product"), "price_hint"))))).not.toContain(
      "price_hint",
    );
  });
});

describe("embed and blocks", () => {
  const withArticle = (body: unknown): Json => {
    const s = fresh();
    s["model"]["article"].seed[0].body = body;
    return s;
  };
  it("a blocks value must be a valid node tree in the same grammar as a page", () => {
    expect(errorsOf(withArticle(plain([text(3, "ok")])))).toBe("");
    expect(errorsOf(withArticle([{ slot: "hero" }]))).toContain("不是合法的节点树");
    expect(errorsOf(withArticle("not a tree"))).toContain("不是合法的节点树");
  });

  it("the tree is content, not chrome: no embed / form / nav / brand inside, and binds must resolve against the record", () => {
    expect(errorsOf(withArticle(plain([embed(bind("body"))])))).toContain("不能放 embed");
    expect(errorsOf(withArticle(plain([nav("/")])))).toContain("不能放 nav");
    expect(errorsOf(withArticle(plain([text(3, bind("nope"))])))).toContain("nope");
    expect(errorsOf(withArticle(plain([text(3, bind("title"))])))).toBe("");
  });

  const articlePage = (...nodes: unknown[]): Json => {
    const s = fresh();
    s["pages"]["/article/:id"] = {
      ctx: { type: "article" },
      // published 也得有人显示（否则“从未展示”是 error）；这里只关心 body 和 title 的去向
      body: [
        plain(
          section("x", text(3, bind("published")), ...(nodes as Parameters<typeof section>[1][])),
        ),
      ],
    };
    return s;
  };
  it("embed binds a blocks field, not any other", () => {
    expect(errorsOf(articlePage(embed(bind("body"))))).toBe("");
    expect(errorsOf(articlePage(embed(bind("title"))))).toContain("embed 要绑 blocks 字段");
    expect(errorsOf(articlePage(embed()))).toContain("embed 要绑");
  });

  it("a blocks field is not a facts row (it has its own renderer), and counts as shown when embedded", () => {
    expect(errorsOf(articlePage(text(1, bind("title"))))).toContain("body"); // 没人 embed 它：拦
    expect(errorsOf(fresh())).not.toContain("body");
  });
});

describe("session parameters", () => {
  const withSession = (extra: Json): Json => {
    const s = fresh();
    s["session"] = { ...(s["session"] as Json), ...extra };
    return s;
  };
  it("a session parameter is known in the header, the footer and every page", () => {
    expect(errorsOf(fresh())).toBe("");
    const s = withSession({ city: plain(oneOf(["a", "b"])) });
    s["footer"] = plain(when("city=a", text(3, "x")));
    s["pages"]["/"].body.push(plain(when("city=b", section("c", text(3, "y")))));
    expect(errorsOf(s)).toBe("");
    const bare = fresh();
    bare["footer"] = plain(when("city=a", text(3, "x")));
    expect(errorsOf(bare)).toContain("没有在这个页面的 state 里声明");
  });

  it("declaration rules: values, default, multi, name; and a page may not redeclare it", () => {
    expect(errorsOf(withSession({ v: { values: [] } }))).toContain("取值不能为空");
    expect(errorsOf(withSession({ v: { values: ["a"], default: "z" } }))).toContain("default");
    const s = withSession({ tab: plain(oneOf(["a", "b"])) });
    s["pages"]["/"].state = { tab: plain(oneOf(["a", "b"])) };
    expect(errorsOf(s)).toContain("重名");
  });
});

describe("query: order, search, page", () => {
  /** 在一个单独的列表页上试（不碰范例里 /product 自己的声明）。 */
  const onProducts = (state: Record<string, unknown>, body: unknown) => {
    const s = fresh();
    s["pages"]["/lab"] = {
      ctx: { type: "product", many: true },
      state,
      body: [plain(section("加的", body as Parameters<typeof section>[1]))],
    };
    return s;
  };
  const okState = {
    sort: plain(oneOf(["code", "-moq"])),
    q: plain(free()),
    page: plain(free("1")),
  };
  const list = (o: Record<string, unknown>) => each(records("product", { limit: 4, ...o }));

  it("accepts a fixed order, a parameter order, a search and a page", () => {
    const s = onProducts(
      okState,
      list({ order: "-moq", search: { param: "q" }, page: { param: "page" } }),
    );
    expect(errorsOf(s)).toBe("");
  });

  it("an order on a field that does not exist or cannot be compared is an error", () => {
    expect(errorsOf(onProducts(okState, list({ order: "nope" })))).toContain("不在类型");
    expect(errorsOf(onProducts(okState, list({ order: "photos" })))).toContain("不能排序");
    expect(errorsOf(onProducts(okState, list({ order: "-status" })))).toContain("不能排序"); // internal
  });

  it("an order parameter must be a single choice of valid orderings", () => {
    const bad = { ...okState, sort: plain(oneOf(["code", "nope"])) };
    expect(errorsOf(onProducts(bad, list({ order: { param: "sort" } })))).toContain("nope");
    expect(
      errorsOf(onProducts({ ...okState, sort: plain(free()) }, list({ order: { param: "sort" } }))),
    ).toContain("有限取值");
    expect(errorsOf(onProducts(okState, list({ order: { param: "ghost" } })))).toContain(
      "没有在这个页面",
    );
  });

  it("search and page parameters must be declared free()", () => {
    expect(errorsOf(onProducts(okState, list({ search: { param: "sort" } })))).toContain("free()");
    expect(errorsOf(onProducts({}, list({ search: { param: "q" } })))).toContain("没有在这个页面");
    expect(
      errorsOf(onProducts(okState, list({ page: { param: "q" }, limit: undefined }))),
    ).toContain("limit");
  });

  it("a search box and a pager need the same declarations; a pager needs a paged source", () => {
    expect(errorsOf(onProducts(okState, search("q")))).toBe("");
    expect(errorsOf(onProducts({}, search("q")))).toContain("没有在这个页面");
    expect(errorsOf(onProducts(okState, search("sort")))).toContain("free()");
    expect(errorsOf(onProducts(okState, pager(records("product", { limit: 4 }))))).toContain(
      "page",
    );
    expect(errorsOf(onProducts(okState, sortMenu("sort", [["code", "A"]])))).toBe("");
  });

  it("a type with nothing searchable cannot be searched", () => {
    const s = onProducts(okState, each(records("category", { limit: 4, search: { param: "q" } })));
    s["model"]["category"].fields = {}; // 词表只剩主键
    expect(errorsOf(s)).toMatch(/没有能搜的字段|主键/);
  });

  it("free parameters are declared without values; a free default is allowed (page 1), a free multi is not", () => {
    expect(errorsOf(onProducts({ q: { values: ["a"], free: true } }, text(3, "x")))).toContain(
      "free 参数不写",
    );
    expect(errorsOf(onProducts({ q: plain(free("1")) }, text(3, "x")))).toBe("");
  });

  it("a free parameter takes any value in when / set", () => {
    const s = onProducts(okState, when({ param: "q", is: "anything" }, text(3, "x")));
    expect(errorsOf(s)).toBe("");
  });

  it("a search box cannot live inside a stored tree (it is page chrome)", () => {
    const s = fresh();
    s["model"]["article"].seed[0].body = [plain(search("q"))];
    expect(errorsOf(s)).toContain("search");
  });
});

describe("media", () => {
  it("is a valid leaf anywhere a leaf is, including inside a stored tree (it is content)", () => {
    expect(errorsOf(addTo(fresh(), "/", media("video"), media("map", "Find us")))).toBe("");
    const s = fresh();
    s["model"]["article"].seed[0].body = [plain(media("chart"))];
    expect(errorsOf(s)).toBe("");
  });

  it("what the tree editor creates for a media node passes the same check as a hand-written one", () => {
    const s = fresh();
    s["model"]["article"].seed[0].body = [{ slot: "media", kind: "video" }];
    expect(errorsOf(s)).toBe("");
  });

  it("rejects a kind that does not exist (schema), and a caption bound to a missing field", () => {
    expect(parseSketch(addTo(fresh(), "/", { slot: "media", kind: "hologram" })).ok).toBe(false);
    expect(errorsOf(addTo(fresh(), "/product/:id", media("file", bind("nope"))))).toContain("nope");
  });

  it("an image whose caption names a video / map / chart is told to be a media", () => {
    expect(warningsOf(addTo(fresh(), "/", { slot: "image", fill: "VIDEO" }))).toContain("media(");
    expect(warningsOf(addTo(fresh(), "/", { slot: "image", fill: "LOGO" }))).not.toContain(
      "media(",
    );
  });
});

describe("model data consistency (errors)", () => {
  it("rejects an unlisted value the field can never hold, and an unlisted on a field it cannot compare", () => {
    const s = fresh();
    s["model"]["product"].unlisted = { status: "不存在的值" };
    expect(errorsOf(s)).toContain("不在 status 的选项里");
    const t = fresh();
    t["model"]["product"].unlisted = { moq: "0" };
    expect(errorsOf(t)).toContain("unlisted 只能比较");
    expect(errorsOf(fresh())).toBe("");
  });

  it("rejects a seed choice value outside the options, and a seed field the model does not declare", () => {
    const s = fresh();
    s["model"]["product"].seed[0].status = "Demo only";
    expect(errorsOf(s)).toContain('status 的值 "Demo only" 不在选项里');
    const t = fresh();
    t["model"]["product"].seed[0].colour = "red";
    expect(errorsOf(t)).toContain("字段 colour 没在 fields 里声明");
  });

  it("rejects a relation stored as text / list (where and links cannot use it), and a *_slug column", () => {
    const s = fresh();
    s["model"]["article"].fields["related_products"] = {
      kind: "list",
      label: "x",
      columns: { a: "A" },
    };
    s["model"]["article"].fields["related_products"].internal = true;
    expect(errorsOf(s)).toContain('f.ref("product")');
    const t = fresh();
    t["model"]["inquiry"].fields["source_product"] = { kind: "text", label: "x", internal: true };
    expect(errorsOf(t)).toContain('f.ref("product")');
    const u = fresh();
    u["model"]["article"].fields["links"] = {
      kind: "list",
      label: "x",
      internal: true,
      columns: { product_slug: "型号", role: "角色" },
    };
    expect(errorsOf(u)).toContain("列像是指向 product 的关系");
  });

  it("leaves alone fields whose name only looks related", () => {
    const s = fresh();
    s["model"]["article"].fields["source_note"] = { kind: "text", label: "x", internal: true };
    s["model"]["article"].fields["related_links"] = {
      kind: "list",
      label: "x",
      internal: true,
      columns: { url: "地址", name: "名称" },
    };
    expect(errorsOf(s)).toBe("");
  });

  it("a type's own identifier (product_id, product_code) is not a relation to itself", () => {
    const s = fresh();
    s["model"]["product"].fields["product_id"] = { kind: "text", label: "x", internal: true };
    s["model"]["product"].fields["product_code"] = { kind: "text", label: "x", internal: true };
    expect(errorsOf(s)).toBe("");
    // ……但指向别的类型的 *_id 仍是关系
    const t = fresh();
    t["model"]["article"].fields["product_id"] = { kind: "text", label: "x", internal: true };
    expect(errorsOf(t)).toContain('f.ref("product")');
  });

  it("derives an entry page for a multi-valued term vocabulary too", () => {
    const pages = pagesOf(checkSketch(fresh()).sketch!);
    expect(pages["/cert/:id"]?.ctx).toMatchObject({
      type: "product",
      many: true,
      where: { certs: ":id" },
    });
    expect(pages["/material/:id"]?.ctx).toMatchObject({ where: { materials: ":id" } });
    expect(pages["/category/:id"]?.ctx).toMatchObject({ where: { category: ":id" } }); // 单值优先
  });
});

describe("notes", () => {
  const withNote = (note: string): Json => {
    const s = fresh();
    s["pages"]["/"].body.push(plain(noted(note, section("加的", text(3, "x")))));
    return s;
  };

  it("a note may explain (not copy-checked), but price / secret red lines still apply to it", () => {
    expect(errorsOf(withNote("Demo data; second phase: wire the real catalog"))).toBe("");
    expect(errorsOf(withNote("the budget is ¥50000"))).toContain("price");
    expect(errorsOf(addTo(fresh(), "/", text(3, "Demo only; no promise")))).toContain(
      "placeholder-copy",
    );
  });

  it("a note on a field called note is just data, and does not hide placeholder copy", () => {
    const s = fresh();
    s["model"]["product"].fields["note"] = { kind: "text", label: "x", internal: true };
    s["model"]["product"].seed[0].note = "Demo only";
    expect(errorsOf(s)).toContain("placeholder-copy");
  });

  it("a titled section holding one unfilled line is the idiom for 'prose goes here' — never flagged", () => {
    expect(warningsOf(addTo(fresh(), "/", text(3)))).not.toContain("没填");
  });

  it("lists every note with where it is", () => {
    const s = withNote("later");
    s["pages"]["/"].note = "home note";
    const notes = notesOf(checkSketch(s).sketch!);
    expect(notes.map((n) => n.note)).toEqual(["home note", "later"]);
  });
});

describe("a detail page's link to a form page carries the record", () => {
  it("warns when the form has a ref to this type and the link gives it no value; quiet with it", () => {
    const missing = addTo(fresh(), "/product/:id", action("Ask", "/inquiry"));
    expect(warningsOf(missing)).toContain("没带上当前记录");
    const given = addTo(
      fresh(),
      "/product/:id",
      action("Ask", "/inquiry", { with: { product: bind("code") } }),
    );
    expect(warningsOf(given)).not.toContain("没带上当前记录");
  });
});

describe("association types", () => {
  it("are exempt from the 'too few records' warning (a row is a relationship fact; none is made up), content types are not", () => {
    const s = fresh();
    s["model"]["bundle-item"] = {
      label: "套件项",
      key: "id",
      fields: {
        id: { kind: "text", label: "编号" },
        bundle: { kind: "ref", label: "套件", to: "product" },
        part: { kind: "ref", label: "配件", to: "product" },
        role: { kind: "text", label: "角色" },
      },
      seed: [],
    };
    expect(warningsOf(s)).not.toContain("model.bundle-item.seed");
    const content = fresh();
    content["model"]["product"].seed = (content["model"]["product"].seed as Rec[]).slice(0, 1);
    for (const r of content["model"]["product"].seed as Rec[]) r["related"] = [];
    expect(warningsOf(content)).toContain("model.product.seed");
  });
});
