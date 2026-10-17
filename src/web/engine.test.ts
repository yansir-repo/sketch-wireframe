import { describe, expect, it } from "vitest";
import example from "../../examples/catalog.config.ts";
import { matchRoute, pagesOf } from "../shared/derive.ts";
import type { Sketch } from "../shared/schema.ts";
import { createDb, query, type Store } from "./db.ts";
import { applySel, facetsOf, parseQuery, toQuery, toggled } from "./facets.ts";
import { renderForm } from "./fields.ts";
import { node, type RC } from "./nodes.ts";

const memory = (): Store & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};
const keyOf = (t: string) => example.model[t]!.key;

describe("db (state of a running sketch)", () => {
  it("starts from the seed, persists edits through the store and resets", () => {
    const store = memory();
    const db = createDb(example, store);
    const n = db.all("product").length;
    expect(n).toBeGreaterThan(10);
    expect(db.put("product", { ...db.find("product", "P101")!, code: "ZZ1" })).toBe(true);
    expect(db.all("product").length).toBe(n + 1);
    expect(createDb(example, store).all("product").length).toBe(n + 1); // a new page load sees it
    db.reset();
    expect(db.all("product").length).toBe(n);
    expect(createDb(example, store).all("product").length).toBe(n);
  });

  it("rolls back a put that does not fit the storage, and says so", () => {
    const full: Store = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    const db = createDb(example, full);
    const n = db.all("product").length;
    expect(db.put("product", { code: "ZZ1", category: "pens" })).toBe(false);
    expect(db.all("product").length).toBe(n);
  });

  it("keys storage by the sketch's shape and seed, so a re-published sketch drops stale local data", () => {
    const a = createDb(example, memory());
    const changed = JSON.parse(JSON.stringify(example));
    changed.model.product.seed.pop();
    expect(createDb(changed, memory()).storageKey).not.toBe(a.storageKey);
  });

  it("hides unlisted (draft) records from the client but keeps them in the model view", () => {
    const db = createDb(example, memory());
    const row = { ...db.find("product", "P101")!, code: "DRAFT1", status: "草稿" };
    db.put("product", row);
    expect(db.list("product").some((r) => r["code"] === "DRAFT1")).toBe(false);
    expect(db.all("product").some((r) => r["code"] === "DRAFT1")).toBe(true);
  });

  it("queries by route param and by a field of the current record, never returning the record itself", () => {
    const db = createDb(example, memory());
    const pens = query(db, "product", { category: ":id" }, { params: { id: "pens" } }, keyOf);
    expect(pens.every((r) => r["category"] === "pens")).toBe(true);
    const self = db.find("product", "P101")!;
    const similar = query(
      db,
      "product",
      { category: "$category" },
      { params: {}, record: self },
      keyOf,
      true,
    );
    expect(similar.some((r) => r["code"] === "P101")).toBe(false);
    expect(similar.length).toBe(pens.length - 1);
  });
});

describe("facets (filters derived from the model)", () => {
  const db = createDb(example, memory());
  const all = db.list("product");
  const fields = ["category", "materials", "certs"];

  it("unions within a field, intersects across fields", () => {
    const metal = applySel(all, { materials: ["metal"] }, fields);
    const metalPaper = applySel(all, { materials: ["metal", "paper"] }, fields);
    const both = applySel(all, { materials: ["metal", "paper"], certs: ["reach"] }, fields);
    expect(metal.length).toBeGreaterThan(0);
    expect(metalPaper.length).toBeGreaterThan(metal.length);
    expect(both.length).toBeLessThan(metalPaper.length);
    expect(both.every((r) => (r["certs"] as string[]).includes("reach"))).toBe(true);
  });

  it("counts what choosing an option would leave, given the other fields' selection", () => {
    const facets = facetsOf(example, db, "product", fields, all, { certs: ["reach"] });
    const materials = facets.find((f) => f.field === "materials")!;
    for (const o of materials.options) {
      expect(o.count).toBe(
        all.filter(
          (r) =>
            (r["certs"] as string[]).includes("reach") &&
            (r["materials"] as string[]).includes(o.value),
        ).length,
      );
    }
  });

  it("drops a field with fewer than two values to choose from", () => {
    const pens = all.filter((r) => r["category"] === "pens");
    const facets = facetsOf(example, db, "product", ["category"], pens, {});
    expect(facets).toEqual([]);
  });

  it("round-trips the selection through the address", () => {
    const sel = toggled(toggled({}, "materials", "metal"), "materials", "paper");
    expect(toQuery(sel, fields)).toBe("materials=metal,paper");
    expect(parseQuery("materials=metal,paper&certs=fsc")).toEqual({
      materials: ["metal", "paper"],
      certs: ["fsc"],
    });
    expect(toggled(sel, "materials", "metal")["materials"]).toEqual(["paper"]);
  });
});

describe("rendering (pure: Sketch + state → HTML)", () => {
  const pages = pagesOf(example);
  const rcFor = (
    fid: "lines" | "words",
    params: Record<string, string>,
    extra: Partial<RC> = {},
  ): RC => ({
    s: example,
    db: createDb(example, memory()),
    fid,
    pages,
    params,
    seq: { n: 0 },
    viewer: new Map(),
    sel: {},
    path: "/",
    ...extra,
  });

  it("renders every page without throwing, in both fidelities", () => {
    for (const fid of ["words", "lines"] as const) {
      for (const [pattern, page] of Object.entries(pages)) {
        const m = matchRoute([pattern], pattern.replace(":id", "pens"));
        expect(m, pattern).not.toBeNull();
        const rc = rcFor(fid, m!.params, page.ctx?.many ? { listType: page.ctx.type } : {});
        const html = page.body.map((n) => node(n, rc)).join("");
        expect(html.length, `${fid} ${pattern}`).toBeGreaterThan(0);
      }
    }
  });

  it("lines fidelity leaks no copy: nothing marked data-copy, and the unfilled slots are scribbles", () => {
    const rc = rcFor("lines", {});
    const home = pages["/"]!.body.map((n) => node(n, rc)).join("");
    expect(home).not.toContain("data-copy");
    expect(home).toContain('data-rough="sq"');
  });

  it("words fidelity shows written copy and still draws unwritten slots as scribbles", () => {
    const rc = rcFor("words", {});
    const home = pages["/"]!.body.map((n) => node(n, rc)).join("");
    expect(home).toContain("获取报价");
    expect(home).toContain('data-rough="sq"');
  });
});

/** 一段 HTML 顶层有几个元素：槽放进 row 里就是一个 flex 项，必须恰好一个。 */
const rootCount = (html: string): number => {
  let depth = 0;
  let roots = 0;
  const VOID = new Set(["img", "input", "br", "hr"]);
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const [, close, tag, selfClose] = m;
    if (VOID.has(tag!.toLowerCase()) || selfClose) {
      if (depth === 0) roots++;
    } else if (close) depth--;
    else {
      if (depth === 0) roots++;
      depth++;
    }
  }
  return roots;
};

describe("slots render exactly one root element", () => {
  const pages = pagesOf(example);
  const db = createDb(example, memory());
  const rc = (extra: Partial<RC>): RC => ({
    s: example,
    db,
    fid: "words",
    pages,
    params: {},
    seq: { n: 0 },
    viewer: new Map(),
    sel: {},
    path: "/",
    ...extra,
  });
  const record = db.find("product", "P101")!;
  const slots: Array<[string, Parameters<typeof node>[0], Partial<RC>]> = [
    ["text", { slot: "text", size: 2, fill: "x" }, {}],
    ["image", { slot: "image" }, {}],
    ["action", { slot: "action", fill: "Go", to: "/" }, {}],
    ["brand", { slot: "brand", fill: "Acme" }, {}],
    ["nav", { slot: "nav", paths: ["/", "/product"] }, {}],
    ["collection", { slot: "collection", type: "product", limit: 2 }, {}],
    [
      "collection (empty)",
      { slot: "collection", type: "product", where: { category: "nope" } },
      {},
    ],
    ["collection (truncated)", { slot: "collection", type: "product", limit: 1 }, {}],
    [
      "facts",
      { slot: "facts", only: ["category", "specs", "related"] },
      { type: "product", record },
    ],
    ["badges", { slot: "badges", field: "certs" }, { type: "product", record }],
    ["gallery", { slot: "gallery", field: "photos" }, { type: "product", record }],
    ["filters", { slot: "filters", fields: ["category", "materials"] }, { listType: "product" }],
    ["form", { slot: "form" }, { type: "inquiry" }],
  ];
  for (const fid of ["words", "lines"] as const)
    for (const [name, n, extra] of slots)
      it(`${name} (${fid})`, () => expect(rootCount(node(n, rc({ fid, ...extra })))).toBe(1));
});

describe("facts: only, lists, refs, internal", () => {
  const db = createDb(example, memory());
  const pages = pagesOf(example);
  const rc = (extra: Partial<RC> = {}): RC => ({
    s: example,
    db,
    fid: "words",
    pages,
    params: {},
    seq: { n: 0 },
    viewer: new Map(),
    sel: {},
    path: "/",
    type: "product",
    record: db.find("product", "P101")!,
    ...extra,
  });

  it("only picks the fields, in that order, and never shows internal ones", () => {
    const html = node({ slot: "facts", only: ["materials", "category"] }, rc());
    expect(html.indexOf("材质")).toBeLessThan(html.indexOf("分类"));
    expect(html).not.toContain("技术参数");
    expect(node({ slot: "facts" }, rc())).not.toContain("上架状态");
  });

  it("renders a ref as links to the target's detail page", () => {
    const html = node({ slot: "facts", only: ["related"] }, rc());
    expect(html).toContain('href="#/product/P102"');
  });

  it("renders a plain list as rows (one per item), not nothing", () => {
    const s = JSON.parse(JSON.stringify(example));
    s.model.product.fields.steps = { kind: "list", label: "步骤", columns: { a: "一", b: "二" } };
    s.model.product.seed[0].steps = [
      { row_id: "r1", a: "切", b: "5mm" },
      { row_id: "r2", a: "压", b: "" },
    ];
    const db2 = createDb(s, memory());
    const html = node(
      { slot: "facts", only: ["steps"] },
      { ...rc(), s, db: db2, record: db2.find("product", "P101")! },
    );
    expect(html).toContain("<li");
    expect(html).toContain("切 · 5mm");
    expect(html).toContain("压");
  });

  it("an internal field is not in the public form but is in the back-office form", () => {
    const form = (mode: "public" | "model") => renderForm(example, db, "product", null, mode);
    expect(form("public")).not.toContain('data-field="status"');
    expect(form("model")).toContain('data-field="status"');
  });
});

describe("locale: engine-owned copy follows the sketch", () => {
  it("English sketches get English empty states, nav menu and filter reset; the default stays Chinese", () => {
    const en = { ...JSON.parse(JSON.stringify(example)), locale: "en" };
    const rcOf = (s: Sketch): RC => ({
      s,
      db: createDb(s, memory()),
      fid: "words",
      pages: pagesOf(s),
      params: {},
      seq: { n: 0 },
      viewer: new Map(),
      sel: {},
      path: "/",
    });
    const empty = { slot: "collection", type: "product", where: { category: "nope" } } as const;
    expect(node(empty, rcOf(en))).toContain("No 型号 yet");
    expect(node(empty, rcOf(example))).toContain("还没有型号");
    expect(node({ slot: "nav", paths: ["/"] }, rcOf(en))).toContain("Menu");
    expect(node({ slot: "nav", paths: ["/"] }, rcOf(example))).toContain("菜单");
  });
});

describe("nav and brand", () => {
  const db = createDb(example, memory());
  const rc: RC = {
    s: example,
    db,
    fid: "words",
    pages: pagesOf(example),
    params: {},
    seq: { n: 0 },
    viewer: new Map(),
    sel: {},
    path: "/",
  };
  it("a long nav is collapsed behind a menu button; a short one is not", () => {
    const many = node({ slot: "nav", paths: Array.from({ length: 8 }, () => "/") }, rc);
    expect(many).toContain('class="nav many"');
    expect(node({ slot: "nav", paths: ["/", "/product"] }, rc)).not.toContain("many");
  });
  it("a brand is a link home, drawn as a frame, not a button", () => {
    const html = node({ slot: "brand", fill: "Acme" }, rc);
    expect(html).toContain('class="brand"');
    expect(html).toContain('href="#/"');
    expect(html).not.toContain('class="btn');
  });
});
