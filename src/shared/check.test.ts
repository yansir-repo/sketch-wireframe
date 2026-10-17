import { describe, expect, it } from "vitest";
import example from "../../examples/catalog.config.ts";
import v1 from "./fixtures/catalog.v1.json";
import { checkSketch } from "./check.ts";
import {
  action,
  bind,
  collection,
  count,
  each,
  facts,
  fields,
  items,
  records,
  section,
  text,
} from "./dsl.ts";
import { migrateSketch, upgradeStored } from "./migrate.ts";
import { parseSketch, sketchJsonSchema } from "./parse.ts";
import { pagesOf } from "./derive.ts";
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

  it("count counts records or items, not fields", () => {
    expect(
      errorsOf(addTo(fresh(), "/", text(2, count({ fields: { type: "product" } })))),
    ).toContain("count");
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
    const filter = fresh();
    filter["pages"]["/product"].body[0].group[0].group[0].fields = ["status"];
    expect(errorsOf(filter)).toContain("internal");
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

describe("design-quality warnings (do not block publishing)", () => {
  it("warns when a nav has more than 7 entries", () => {
    const s = fresh();
    s["header"].group[1].paths = Array.from({ length: 8 }, () => "/");
    expect(warningsOf(s)).toContain("导航有 8 项");
  });

  it("warns about fields no client page ever shows, and lets internal ones be", () => {
    const s = fresh();
    s["model"]["product"].fields["note"] = { kind: "text", label: "备注" };
    expect(warningsOf(s)).toContain("note");
    s["model"]["product"].fields["note"].internal = true;
    expect(warningsOf(s)).not.toContain("note");
  });

  it("counts a field as shown when it is bound, in a fields source, an items source or a computed path", () => {
    const s = fresh();
    s["model"]["product"].fields["note"] = { kind: "text", label: "备注" };
    addTo(s, "/product/:id", text(3, bind("note")));
    expect(warningsOf(s)).not.toContain("note");
  });

  it("warns when two facts on one page show the same fields", () => {
    const s = addTo(fresh(), "/product/:id", facts({ only: ["category", "materials"] }));
    expect(warningsOf(s)).toContain("显示完全相同的字段");
  });

  it("warns when a collection on a detail page has no where (shows everything, not related)", () => {
    expect(
      warningsOf(addTo(fresh(), "/product/:id", collection("product", { limit: 3 }))),
    ).toContain("没有 where");
  });

  it("warns on placeholder / explanatory copy and on a back-office-looking field shown to clients", () => {
    const s = fresh();
    s["model"]["product"].seed[0].specs[0].value = "A placeholder used only for testing";
    expect(warningsOf(s)).toContain("placeholder-copy");
    const t = fresh();
    t["model"]["product"].fields["verification_status"] = { kind: "text", label: "核实" };
    addTo(t, "/product/:id", facts({ only: ["verification_status"] }));
    expect(warningsOf(t)).toContain("verification_status");
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

  it("warns when a $field where matches nothing on any seed record, and stays quiet when records are related", () => {
    const rel = collection("product", { where: { category: "$category" }, notSelf: true });
    expect(warningsOf(addTo(fresh(), "/product/:id", rel))).not.toContain("永远是空的");
    const lonely = fresh();
    (lonely["model"]["product"].seed as Rec[]).forEach((r, i) => {
      r["category"] = ["pens", "notebooks", "folders", "desk"][i % 4];
    });
    lonely["model"]["product"].seed = (lonely["model"]["product"].seed as Rec[]).filter(
      (r, i, all) => all.findIndex((x) => x["category"] === r["category"]) === i,
    );
    for (const r of lonely["model"]["product"].seed as Rec[]) r["related"] = [];
    expect(warningsOf(addTo(lonely, "/product/:id", rel))).toContain("永远是空的");
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

describe("format 1 → 2 (the old slots are each in disguise)", () => {
  it("the old example, written in the old language, upgrades to a valid sketch", () => {
    const up = migrateSketch(v1) as Json;
    expect(up["v"]).toBe(2);
    const r = checkSketch(up);
    expect(r.errors).toEqual([]);
    expect(JSON.stringify(up)).not.toMatch(/"slot":"(collection|facts|badges|gallery)"/);
  });

  it("an old sketch can still be loaded through parseSketch, and stored JSON is upgraded on read", () => {
    expect(parseSketch(v1).ok).toBe(true);
    const stored = JSON.stringify(v1);
    expect(JSON.parse(upgradeStored(stored))["v"]).toBe(2);
    const current = JSON.stringify(example);
    expect(upgradeStored(current)).toBe(current);
  });

  it("each old slot becomes exactly what the DSL shorthand writes now", () => {
    const old = {
      ...(v1 as Json),
      pages: {
        "/": {
          body: [{ slot: "collection", type: "product", limit: 2, where: { category: "pens" } }],
        },
      },
    };
    const up = migrateSketch(old) as Json;
    expect(up["pages"]["/"].body[0]).toEqual(
      plain(collection("product", { limit: 2, where: { category: "pens" } })),
    );
  });
});
