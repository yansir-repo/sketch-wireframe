import { describe, expect, it } from "vitest";
import example from "../../examples/catalog.config.ts";
import { checkSketch } from "./check.ts";
import {
  action,
  badges,
  cta,
  detailPage,
  section,
  featureCols,
  formPage,
  hero,
  listPage,
  related,
  siteHeader,
  split,
} from "./dsl.ts";
import type { Page, Sketch } from "./schema.ts";

type Json = Record<string, any>; // eslint-disable-line
const plain = (n: unknown) => JSON.parse(JSON.stringify(n)) as Json;
const withPage = (route: string, page: Page): Sketch => {
  const s = plain(example) as Json;
  s["pages"][route] = plain(page);
  return s as Sketch;
};
const problems = (s: Sketch) => {
  const r = checkSketch(s);
  return [...r.errors, ...r.warnings];
};

describe("patterns expand to ordinary nodes (nothing new in the language)", () => {
  it("never invent copy: with nothing given, no string fill appears anywhere", () => {
    for (const n of [hero(), cta({ actions: [] }), featureCols({}, {}, { body: false }), split([])])
      expect(JSON.stringify(n)).not.toMatch(/"fill":"/);
  });

  it("split is a row of (copy column, side); the side defaults to an image placeholder", () => {
    const n = split([]);
    expect(n.dir).toBe("row");
    expect(JSON.stringify(n)).toContain('"slot":"image"');
  });

  it("hero = split(title, sub, actions): the actions only appear when given", () => {
    const withActions = plain(hero({ actions: [action("Go", "/")] }));
    const without = plain(hero());
    expect(JSON.stringify(withActions)).toContain('"Go"');
    expect(withActions.group[0].group.length).toBe(3);
    expect(without.group[0].group.length).toBe(2);
  });

  it("featureCols: title / body false drops that part; image adds a picture on top", () => {
    const cols = plain(featureCols({ title: "A", body: false }, { image: true }));
    expect(cols.group[0].group.length).toBe(1);
    expect(cols.group[1].group.length).toBe(3);
  });

  it("cta: the sentence is optional", () => {
    expect(plain(cta({ actions: [action("Go", "/")] })).group.length).toBe(1);
    expect(plain(cta({ text: "Ready?", actions: [action("Go", "/")] })).group.length).toBe(2);
  });

  it("related lists the same-typed records that share a field, never the record itself", () => {
    const n = plain(related("product", "category", 3));
    expect(n.each.records).toBe("product");
    expect(n.each.where).toEqual({ category: "$category" });
    expect(n.each.notSelf).toBe(true);
    expect(n.each.limit).toBe(3);
  });
});

describe("listPage wires filter, search, sort and paging in one place", () => {
  const full = listPage("product", {
    name: "All",
    title: "Products",
    filters: ["category", "materials"],
    search: true,
    sort: [
      ["code", "A"],
      ["-moq", "B"],
    ],
    per: 6,
  });

  it("declares exactly the parameters it uses, and the page parameter is a free one that defaults to 1", () => {
    expect(Object.keys(full.state!).sort()).toEqual(["page", "q", "sort"]);
    expect(full.state!["page"]).toEqual({ values: [], free: true, default: "1" });
    expect(full.state!["sort"]!.values).toEqual(["code", "-moq"]);
    const bare = listPage("article", { title: "Articles" });
    expect(Object.keys(bare.state!)).toEqual(["page"]);
  });

  it("is a valid page with no warnings, as a list of all records and as a list under a route parameter", () => {
    expect(problems(withPage("/lab", full))).toEqual([]);
    const byCategory = listPage("product", {
      title: "Products",
      where: { category: ":id" },
      filters: ["materials"],
    });
    expect(byCategory.ctx).toEqual({ type: "product", many: true, where: { category: ":id" } });
    expect(problems(withPage("/lab/:id", byCategory))).toEqual([]);
  });

  it("without filters there is no side column; with a fixed order there is no sort menu", () => {
    const p = plain(listPage("article", { title: "A", order: "-published" }));
    expect(JSON.stringify(p.body)).not.toContain('"facets"');
    expect(JSON.stringify(p.body)).toContain('"order":"-published"');
    expect(Object.keys(p.state)).toEqual(["page"]);
  });

  it("a single sort value has nothing to choose: no menu, no sort parameter, a fixed order", () => {
    const p = plain(listPage("product", { title: "P", sort: [["-moq", "B"]] }));
    expect(JSON.stringify(p.body)).not.toContain('"sortMenu"');
    expect(JSON.stringify(p.body)).toContain('"order":"-moq"');
    expect(Object.keys(p.state)).toEqual(["page"]);
  });

  it("before / after add sections around the list", () => {
    const p = listPage("article", {
      title: "A",
      before: [section("H", hero())],
      after: [section("C", cta({ actions: [] }))],
    });
    expect(p.body.length).toBe(3);
  });
});

describe("formPage and siteHeader", () => {
  it("formPage is the create page of a type: a named section with the form, extras around it", () => {
    const p = formPage("inquiry", {
      name: "Quote",
      title: "Tell us",
      before: [section("Hero", hero())],
    });
    expect(p.ctx).toEqual({ type: "inquiry", create: true });
    expect(p.body.length).toBe(2);
    expect(problems(withPage("/lab", p))).toEqual([]);
  });

  it("siteHeader is brand + nav + actions in a row, and a valid header", () => {
    const h = siteHeader({ nav: ["/", "/product"], actions: [action("Quote", "/inquiry")] });
    const s = plain(example) as Json;
    s["header"] = plain(h);
    expect(problems(s as Sketch)).toEqual([]);
    expect((plain(h).group as unknown[]).length).toBe(3);
  });
});

describe("detailPage", () => {
  const page = detailPage("product", {
    overview: { title: "Overview", heading: "code", gallery: "photos" },
    sections: [
      { title: "Classification", only: ["category", "materials"] },
      { title: "Specs", only: ["related", "moq", "specs"] },
    ],
    related: [{ title: "Same category", type: "product", by: "category", limit: 3 }],
    after: [section("Certificates", badges("certs"))],
  });

  it("is the detail page of a type: overview, one facts section per group, related, extras", () => {
    expect(page.ctx).toEqual({ type: "product" });
    expect(page.body.length).toBe(5);
    expect(JSON.stringify(plain(page).body[1])).toContain('"only":["category","materials"]');
  });

  it("with every field shown exactly once it is a valid page with no problems", () => {
    expect(problems(withPage("/lab/:id", page))).toEqual([]);
  });

  it("a field nobody shows, or one shown twice, is stopped by the checkup — that is what replaces skip", () => {
    const missing = detailPage("product", {
      sections: [{ title: "Only one", only: ["category"] }],
    });
    // 覆盖同名路由（/product/:id）：默认详情页让位，字段才真的“没人显示”
    expect(problems(withPage("/product/:id", missing)).join("\n")).toContain("没出现过");
    const twice = detailPage("product", {
      sections: [
        { title: "A", only: ["category", "materials"] },
        { title: "B", only: ["category", "materials"] },
      ],
    });
    expect(problems(withPage("/product/:id", twice)).join("\n")).toContain("显示完全相同");
  });
});
