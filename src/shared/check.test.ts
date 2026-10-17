import { describe, expect, it } from "vitest";
import example from "../../examples/catalog.config.ts";
import { checkSketch } from "./check.ts";
import { pagesOf } from "./derive.ts";
import { FORMAT_VERSION, parseSketch, sketchJsonSchema } from "./schema.ts";

const fresh = () => JSON.parse(JSON.stringify(example)) as Record<string, any>; // eslint-disable-line

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

  it("rejects an unknown slot kind and a text size outside 1–3", () => {
    const a = fresh();
    a["header"] = { slot: "hero" };
    expect(parseSketch(a).ok).toBe(false);
    const b = fresh();
    b["header"] = { slot: "text", size: 4 };
    expect(parseSketch(b).ok).toBe(false);
  });

  it("produces a JSON Schema for describe_format", () => {
    const doc = sketchJsonSchema() as { schema: { properties: Record<string, unknown> } };
    expect(Object.keys(doc.schema.properties)).toEqual(
      expect.arrayContaining(["v", "code", "model", "pages", "header", "footer"]),
    );
  });
});

describe("semantics (validate)", () => {
  it("catches references that don't resolve, with a path to fix", () => {
    const s = fresh();
    s["pages"]["/product"].body[0].group[0].group[0].fields = ["nope"];
    const r = checkSketch(s);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toContain("nope");
  });

  it("catches a term pointing at a missing vocabulary and a seed id the vocabulary lacks", () => {
    const a = fresh();
    a["model"]["product"].fields["category"].to = "ghost";
    expect(checkSketch(a).errors.join("\n")).toContain("ghost");
    const b = fresh();
    b["model"]["product"].seed[0].category = "not-a-category";
    expect(checkSketch(b).ok).toBe(false);
  });

  it("requires a home page and a valid project code", () => {
    const a = fresh();
    delete a["pages"]["/"];
    expect(checkSketch(a).ok).toBe(false);
    expect(checkSketch({ ...fresh(), code: "bad code!" }).ok).toBe(false);
  });

  it("rejects a non-positive span", () => {
    const a = fresh();
    a["pages"]["/product"].body[0].group[0].w = 0;
    expect(checkSketch(a).ok).toBe(false);
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

describe("internal (back-office-only) fields", () => {
  it("cannot be bound, filtered, shown as badges or listed in facts.only", () => {
    const bind = fresh();
    bind["pages"]["/product/:id"].body[1].group[0] = {
      slot: "text",
      size: 3,
      fill: { bind: "status" },
    };
    expect(checkSketch(bind).errors.join("\n")).toContain("internal");
    const only = fresh();
    only["pages"]["/product/:id"].body[1].group[1].only = ["status"];
    expect(checkSketch(only).errors.join("\n")).toContain("internal");
    const filter = fresh();
    filter["pages"]["/product"].body[0].group[0].group[0].fields = ["status"];
    expect(checkSketch(filter).errors.join("\n")).toContain("internal");
  });
});

describe("facts(only / skip) and ref", () => {
  it("only and skip are exclusive; only must name real, showable fields", () => {
    const both = fresh();
    both["pages"]["/product/:id"].body[1].group[1] = {
      slot: "facts",
      only: ["category"],
      skip: ["specs"],
    };
    expect(checkSketch(both).ok).toBe(false);
    const ghost = fresh();
    ghost["pages"]["/product/:id"].body[1].group[1] = { slot: "facts", only: ["nope"] };
    expect(checkSketch(ghost).errors.join("\n")).toContain("nope");
    const media = fresh();
    media["pages"]["/product/:id"].body[1].group[1] = { slot: "facts", only: ["photos"] };
    expect(checkSketch(media).ok).toBe(false);
  });

  it("a ref must point at a content type (not a vocabulary) and at records that exist", () => {
    const toVocab = fresh();
    toVocab["model"]["product"].fields["related"].to = "category";
    expect(checkSketch(toVocab).errors.join("\n")).toContain("词表");
    const dangling = fresh();
    dangling["model"]["product"].seed[0].related = ["NOPE"];
    expect(checkSketch(dangling).errors.join("\n")).toContain("NOPE");
  });
});

describe("design-quality warnings (do not block publishing)", () => {
  const warnings = (s: Record<string, any>) => checkSketch(s).warnings.join("\n"); // eslint-disable-line

  it("warns when a nav has more than 7 entries", () => {
    const s = fresh();
    s["header"].group[1].paths = Array.from({ length: 8 }, () => "/");
    expect(warnings(s)).toContain("导航有 8 项");
  });

  it("warns about fields no client page ever shows, and lets internal ones be", () => {
    const s = fresh();
    s["model"]["product"].fields["note"] = { kind: "text", label: "备注" };
    expect(warnings(s)).toContain("note");
    s["model"]["product"].fields["note"].internal = true;
    expect(warnings(s)).not.toContain("note");
  });

  it("warns when two facts on one page show the same fields", () => {
    const s = fresh();
    s["pages"]["/product/:id"].body.push({
      group: [{ slot: "facts", only: ["category", "materials"] }],
      dir: "col",
      name: "again",
    });
    expect(warnings(s)).toContain("显示完全相同的字段");
  });

  it("warns when a collection on a detail page has no where (shows everything, not related)", () => {
    const s = fresh();
    s["pages"]["/product/:id"].body.push({
      group: [{ slot: "collection", type: "product", limit: 3 }],
      dir: "col",
      name: "x",
    });
    expect(warnings(s)).toContain("没有 where");
  });

  it("warns on placeholder / explanatory copy and on a back-office-looking field shown to clients", () => {
    const s = fresh();
    s["model"]["product"].seed[0].specs[0].value = "A placeholder used only for testing";
    expect(warnings(s)).toContain("placeholder-copy");
    const t = fresh();
    t["model"]["product"].fields["verification_status"] = { kind: "text", label: "核实" };
    t["pages"]["/product/:id"].body[1].group[1] = { slot: "facts" };
    expect(warnings(t)).toContain("verification_status");
  });

  it("warns on thin data, a bloated model, an overloaded page and a logo built as an action", () => {
    const thin = fresh();
    thin["model"]["product"].seed = thin["model"]["product"].seed.slice(0, 2);
    for (const r of thin["model"]["product"].seed) r.related = []; // the neighbours are gone: keep refs valid
    expect(warnings(thin)).toContain("只有 2 条记录");
    const bloated = fresh();
    for (let i = 0; i < 26; i++)
      bloated["model"]["product"].fields[`f${i}`] = {
        kind: "text",
        label: `F${i}`,
        internal: true,
      };
    expect(warnings(bloated)).toContain("个字段（>25）");
    const heavy = fresh();
    heavy["pages"]["/"].body = Array.from({ length: 10 }, (_, i) => ({
      group: [{ slot: "text", size: 3 }],
      dir: "col",
      name: `s${i}`,
    }));
    expect(warnings(heavy)).toContain("10 个顶层板块");
    const logo = fresh();
    logo["header"].group[0] = { slot: "action", fill: "ACME", to: "/" };
    expect(warnings(logo)).toContain("brand()");
  });

  it("warns when the copy is English but no locale is set — and not when it is", () => {
    const s = fresh();
    type N = { group?: N[]; fill?: unknown };
    const english = (n: N) => {
      // eslint-disable-line
      if (n.group) n.group.forEach(english);
      else if (typeof n.fill === "string")
        n.fill = "Request a quote for custom products made to your specification";
    };
    for (const p of Object.values<any>(s["pages"])) p.body.forEach(english); // eslint-disable-line
    english(s["header"]);
    english(s["footer"]);
    expect(warnings(s)).toContain("locale");
    s["locale"] = "en";
    expect(warnings(s)).not.toContain("locale");
  });
});
