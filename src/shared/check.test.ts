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
