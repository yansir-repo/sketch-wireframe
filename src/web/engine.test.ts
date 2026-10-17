import { describe, expect, it } from "vitest";
import example from "../../examples/catalog.config.ts";
import { matchRoute, pagesOf } from "../shared/derive.ts";
import type { Sketch } from "../shared/schema.ts";
import { createDb, query, type Store } from "./db.ts";
import { applySel, facetsOf, parseQuery, toQuery, toggled } from "./facets.ts";
import { renderForm } from "./fields.ts";
import { node, type RC, type RVar } from "./nodes.ts";
import {
  accordion,
  action,
  badges,
  bind,
  collection,
  compare,
  count,
  distinct,
  each,
  embed,
  facts,
  fields,
  filters,
  gallery,
  image,
  items,
  max,
  min,
  nav,
  records,
  row,
  steps,
  sum,
  avg,
  tabs,
  text,
  when,
} from "../shared/dsl.ts";

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

// ---- 渲染 ----

const memoryStore = () => memory();

/** 一个渲染环境。page = 详情页的那条记录；其余按需。 */
const rcOf = (
  s: Sketch,
  o: {
    fid?: "lines" | "words";
    state?: RC["state"];
    page?: { type: string; row: Record<string, unknown> };
    params?: Record<string, string>;
    sel?: Record<string, string[]>;
    createType?: string;
    listType?: string;
  } = {},
): RC => ({
  s,
  db: createDb(s, memoryStore()),
  fid: o.fid ?? "words",
  pages: pagesOf(s),
  params: o.params ?? {},
  state: o.state ?? {},
  vars: new Map<string, RVar>(
    o.page ? [["page", { kind: "record", type: o.page.type, row: o.page.row }]] : [],
  ),
  ...(o.page ? { it: "page" } : {}),
  ...(o.createType ? { createType: o.createType } : {}),
  ...(o.listType ? { listType: o.listType } : {}),
  seq: { n: 0 },
  viewer: new Map(),
  sel: o.sel ?? {},
  path: "/",
});
const detail = (s: Sketch, code: string, o: Parameters<typeof rcOf>[1] = {}): RC => {
  const rc0 = rcOf(s, o);
  return rcOf(s, { ...o, page: { type: "product", row: rc0.db.find("product", code)! } });
};

describe("rendering (pure: Sketch + state → HTML)", () => {
  const pages = pagesOf(example);

  it("renders every page without throwing, in both fidelities", () => {
    for (const fid of ["words", "lines"] as const) {
      for (const [pattern, page] of Object.entries(pages)) {
        const m = matchRoute([pattern], pattern.replace(":id", "pens"));
        expect(m, pattern).not.toBeNull();
        const base = rcOf(example, { fid, params: m!.params });
        const c = page.ctx;
        const row = c && !c.many && !c.create ? base.db.all(c.type)[0] : undefined;
        const rc = rcOf(example, {
          fid,
          params: m!.params,
          ...(c?.many ? { listType: c.type } : {}),
          ...(c?.create ? { createType: c.type } : {}),
          ...(row ? { page: { type: c!.type, row } } : {}),
        });
        const html = page.body.map((n) => node(n, rc)).join("");
        expect(html.length, `${fid} ${pattern}`).toBeGreaterThan(0);
      }
    }
  });

  it("lines fidelity leaks no copy: nothing marked data-copy, and the unfilled slots are scribbles", () => {
    const home = pages["/"]!.body.map((n) => node(n, rcOf(example, { fid: "lines" }))).join("");
    expect(home).not.toContain("data-copy");
    expect(home).toContain('data-rough="sq"');
  });

  it("words fidelity shows written copy and still draws unwritten slots as scribbles", () => {
    const home = pages["/"]!.body.map((n) => node(n, rcOf(example))).join("");
    expect(home).toContain("获取报价");
    expect(home).toContain('data-rough="sq"');
  });
});

/** 一段 HTML 顶层有几个元素：节点放进 row 里就是一个 flex 项，必须恰好一个。 */
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

describe("every node renders exactly one root element", () => {
  const detailRc = (fid: "words" | "lines") => detail(example, "P101", { fid });
  const cases: Array<[string, Parameters<typeof node>[0], (fid: "words" | "lines") => RC]> = [
    ["text", text(2, "x"), (f) => rcOf(example, { fid: f })],
    ["text (bound)", text(3, bind("code")), detailRc],
    ["text (count)", text(2, count(records("product"))), (f) => rcOf(example, { fid: f })],
    ["image", image(), (f) => rcOf(example, { fid: f })],
    ["action", action("Go", "/"), (f) => rcOf(example, { fid: f })],
    ["action (with)", action("Go", "/inquiry", { with: { product: bind("code") } }), detailRc],
    ["nav", nav("/", "/product"), (f) => rcOf(example, { fid: f })],
    ["collection", collection("product", { limit: 2 }), (f) => rcOf(example, { fid: f })],
    [
      "collection (empty)",
      collection("product", { where: { category: "nope" } }),
      (f) => rcOf(example, { fid: f }),
    ],
    [
      "collection (truncated)",
      collection("product", { limit: 1 }),
      (f) => rcOf(example, { fid: f }),
    ],
    ["facts", facts({ only: ["category", "specs", "related"] }), detailRc],
    ["badges", badges("certs"), detailRc],
    ["gallery", gallery("photos"), detailRc],
    [
      "compare",
      compare("product", ["materials", "certs"], { limit: 3 }),
      (f) => rcOf(example, { fid: f }),
    ],
    ["steps", steps(text(2, "a"), text(2, "b")), (f) => rcOf(example, { fid: f })],
    [
      "each (items, empty)",
      each(items("related"), text(3, bind("it.@title"))),
      (f) => detail(example, "P101", { fid: f }),
    ],
    [
      "filters",
      filters("category", "materials"),
      (f) => rcOf(example, { fid: f, listType: "product" }),
    ],
    [
      "filters (selected)",
      filters("category", "materials"),
      (f) => rcOf(example, { fid: f, listType: "product", sel: { materials: ["metal"] } }),
    ],
    ["form", { slot: "form" }, (f) => rcOf(example, { fid: f, createType: "inquiry" })],
  ];
  for (const fid of ["words", "lines"] as const)
    for (const [name, n, mk] of cases)
      it(`${name} (${fid})`, () => expect(rootCount(node(n, mk(fid)))).toBe(1));
});

describe("facts (each over fields): only, lists, refs, internal", () => {
  it("only picks the fields, in that order, and never shows internal ones", () => {
    const rc = detail(example, "P101");
    const html = node(facts({ only: ["materials", "category"] }), rc);
    expect(html.indexOf("材质")).toBeLessThan(html.indexOf("分类"));
    expect(html).not.toContain("技术参数");
    expect(node(facts(), rc)).not.toContain("上架状态");
  });

  it("renders a ref as links to the target's detail page", () => {
    expect(node(facts({ only: ["related"] }), detail(example, "P101"))).toContain(
      'href="#/product/P102"',
    );
  });

  it("renders a plain list as rows (one per item), not nothing", () => {
    const s = JSON.parse(JSON.stringify(example));
    s.model.product.fields.steps = { kind: "list", label: "步骤", columns: { a: "一", b: "二" } };
    s.model.product.seed[0].steps = [
      { row_id: "r1", a: "切", b: "5mm" },
      { row_id: "r2", a: "压", b: "" },
    ];
    const html = node(facts({ only: ["steps"] }), detail(s, "P101"));
    expect(html).toContain("<li");
    expect(html).toContain("切 · 5mm");
    expect(html).toContain("压");
  });

  it("an internal field is not in the public form but is in the back-office form", () => {
    const rc = rcOf(example);
    const form = (mode: "public" | "model") => renderForm(example, rc.db, "product", null, mode);
    expect(form("public")).not.toContain('data-field="status"');
    expect(form("model")).toContain('data-field="status"');
  });

  it("a facts block whose fields are all empty still shows its field names, with scribbles for values", () => {
    const rc = rcOf(example, {
      page: { type: "product", row: { code: "X", materials: [], certs: [] } },
    });
    const html = node(facts({ only: ["materials", "certs"] }), rc);
    expect(html).toContain("材质");
    expect(html).toContain('data-rough="sq"');
    expect(html.match(/grp row pair/g)?.length).toBe(2);
  });

  it("a facts block with some values hides the empty ones", () => {
    const rc = rcOf(example, {
      page: { type: "product", row: { code: "X", materials: ["metal"], certs: [] } },
    });
    const html = node(facts({ only: ["materials", "certs"] }), rc);
    expect(html).toContain("材质");
    expect(html).not.toContain("认证");
  });

  it("an empty kv list (a spec table with no rows yet) shows a few scribbled name/value rows", () => {
    const rc = rcOf(example, { page: { type: "product", row: { code: "X", specs: [] } } });
    expect(node(facts({ only: ["specs"] }), rc).match(/grp row pair/g)?.length).toBe(3);
  });
});

describe("empty values are scribbles, not nothing", () => {
  it("a bound field with no value on this record draws a scribble (the author may leave a display name empty)", () => {
    const html = node(
      text(3, bind("code")),
      rcOf(example, { page: { type: "product", row: { code: "" } } }),
    );
    expect(html).toContain('data-rough="sq"');
    expect(html).not.toContain("data-copy");
  });
});

describe("locale: engine-owned copy follows the sketch", () => {
  it("English sketches get English empty states and menu; the default stays Chinese", () => {
    const en: Sketch = { ...JSON.parse(JSON.stringify(example)), locale: "en" };
    const empty = collection("product", { where: { category: "nope" } });
    expect(node(empty, rcOf(en))).toContain("No 型号 yet");
    expect(node(empty, rcOf(example))).toContain("还没有型号");
    expect(node(nav("/"), rcOf(en))).toContain("Menu");
    expect(node(nav("/"), rcOf(example))).toContain("菜单");
  });
});

describe("nav and brand", () => {
  it("a nav renders its links plus a menu button; collapsing is decided by the browser from what fits", () => {
    const html = node(nav("/", "/product"), rcOf(example));
    expect(html).toContain("nav-toggle");
    expect(html).toContain("nav-links");
    expect(html).not.toContain("collapsed");
  });
  it("a brand is a link home, drawn as a frame, not a button", () => {
    const html = node({ slot: "brand", fill: "Acme" }, rcOf(example));
    expect(html).toContain('class="brand"');
    expect(html).toContain('href="#/"');
    expect(html).not.toContain('class="btn');
  });
});

describe("the generator (each) and the environment", () => {
  it("binds each item to its name; nested each can reach the outer item by name", () => {
    const n = each(
      records("category"),
      row(
        text(3, bind("c.label")),
        each(records("product", { limit: 1 }), text(3, bind("p.code")), { as: "p", dir: "row" }),
      ),
      { as: "c", dir: "col" },
    );
    const html = node(n, rcOf(example));
    expect(html).toContain("笔类");
    expect(html).toContain("P101");
  });

  it("compare = fields (rows) × records (columns): a row per field, a cell per record", () => {
    const html = node(
      compare("product", ["category", "materials"], { where: { category: "pens" }, limit: 3 }),
      rcOf(example),
    );
    // 2 个字段行；每行 3 格
    expect(html.match(/分类/g)?.length).toBe(1);
    expect(html.match(/材质/g)?.length).toBe(1);
    expect(html).toContain("笔类");
    expect(html).toContain("塑料");
    expect(html).not.toContain("共"); // 格子不带“共 N 个”
  });

  it("steps number their children and draw connectors; the order is the structure", () => {
    const html = node(steps(text(2, "a"), text(2, "b"), text(2, "c")), rcOf(example));
    expect(html.match(/class="stepno"/g)?.length).toBe(3);
    expect(html.match(/class="stepsep"/g)?.length).toBe(2);
  });

  it("an action's with writes the environment into the target address, and a form reads it as initial values", () => {
    const rc = detail(example, "P102");
    const link = node(action("Go", "/inquiry", { with: { product: bind("code") } }), rc);
    expect(link).toContain('href="#/inquiry?product=P102"');
    const form = node(
      { slot: "form" },
      rcOf(example, { createType: "inquiry", sel: { product: ["P102"] } }),
    );
    expect(form).toContain('selected="P102"');
  });

  it("count counts a source", () => {
    const n = text(2, count(records("product", { where: { category: "pens" } })));
    expect(node(n, rcOf(example))).toContain(">5<");
  });

  it("items over a media field with no photos shows placeholders that open the viewer", () => {
    const rc = detail(example, "P101");
    const html = node(gallery("photos"), rc);
    expect(html.match(/data-act="view"/g)?.length).toBe(3);
    expect([...rc.viewer.values()][0]?.length).toBe(3);
  });

  it("badges over a multi-valued term show one circle per value", () => {
    const html = node(badges("certs"), detail(example, "P101"));
    expect(html.match(/class="circle"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("fields({type}) with no record yields field names only (a comparison's row heads)", () => {
    const html = node(
      each(fields({ type: "product", only: ["materials"] }), text(3, bind("f.label")), { as: "f" }),
      rcOf(example),
    );
    expect(html).toContain("材质");
  });
});

describe("filters = links that edit state (each over facets × options)", () => {
  const list = (sel: Record<string, string[]> = {}, fid: "words" | "lines" = "words") =>
    node(filters("category", "materials"), rcOf(example, { listType: "product", sel, fid }));

  it("every option is a link to the same page with that parameter toggled; the clear link appears only with a selection", () => {
    const none = list();
    expect(none).toContain('href="#/?materials=metal"');
    expect(none).not.toContain("clear");
    const some = list({ materials: ["metal"] });
    expect(some).toContain('href="#/"'); // 取消 metal = 回到没有参数的地址
    expect(some).toContain('href="#/?materials=metal,paper"');
    expect(some).toContain("清除筛选");
  });

  it("the selected option is marked on, an option that would leave nothing is dimmed", () => {
    const rc0 = rcOf(example, { listType: "product" });
    const sel = { category: ["pens"] };
    const facets = facetsOf(
      example,
      rc0.db,
      "product",
      ["category", "materials"],
      rc0.db.list("product"),
      sel,
    );
    const zero = facets.flatMap((f) => f.options).some((o) => o.count === 0 && !o.on);
    const html = list(sel);
    expect(html).toMatch(/opt on/);
    if (zero) expect(html).toMatch(/opt dim/);
    // 构造一个一定有“没得选”的：选一个词表条目，再看别的类目
    const cats = facets.find((f) => f.field === "category")!.options.filter((o) => !o.on);
    expect(cats.length).toBeGreaterThan(0);
  });

  it("counts are the same facet semantics as before: what choosing the option would leave", () => {
    const rc = rcOf(example, { listType: "product", sel: { category: ["pens"] } });
    const html = node(filters("category", "materials"), rc);
    const expected = rc.db
      .list("product")
      .filter(
        (r) => r["category"] === "pens" && (r["materials"] as string[]).includes("metal"),
      ).length;
    const metal = html.slice(html.indexOf("materials=metal") - 200);
    expect(metal).toContain(`>${expected}<`);
  });

  it("the clear label is the engine's, in the sketch's language; lines fidelity draws option names as scribbles", () => {
    const en: Sketch = { ...JSON.parse(JSON.stringify(example)), locale: "en" };
    expect(
      node(filters("materials"), rcOf(en, { listType: "product", sel: { materials: ["metal"] } })),
    ).toContain("Clear filters");
    expect(list({}, "lines")).not.toContain("data-copy");
  });

  it("other parameters in the address are carried along when an option is toggled", () => {
    const html = node(
      filters("materials"),
      rcOf(example, {
        listType: "product",
        sel: { tab: ["specs"] },
        state: { tab: { values: ["a", "specs"] } },
      }),
    );
    expect(html).toContain("tab=specs&amp;materials=metal");
  });
});

describe("state (param + when)", () => {
  const state = {
    tab: { values: ["overview", "specs"], default: "overview" },
    faq: { values: ["a", "b"], multi: true },
  };
  const page = (sel: Record<string, string[]> = {}) => rcOf(example, { state, sel });

  it("when shows a node only while the parameter has the value; a single parameter falls back to its default", () => {
    const n = when("tab=specs", text(2, "SPECS"));
    expect(node(n, page())).toBe("");
    expect(node(n, page({ tab: ["specs"] }))).toContain("SPECS");
    expect(node(when("tab=overview", text(2, "OVER")), page())).toContain("OVER");
  });

  it("when without a value means 'has any value'; a|b means any of those parameters", () => {
    expect(node(when("faq", text(2, "X")), page())).toBe("");
    expect(node(when("faq", text(2, "X")), page({ faq: ["a"] }))).toContain("X");
    expect(node(when("tab|faq", text(2, "Y")), page())).toContain("Y"); // tab 有默认值
  });

  it("tabs: the header for the current tab is filled, the others are ghosts; headers set the parameter", () => {
    const html = node(
      tabs("tab", [
        ["overview", "概述", text(3, "O")],
        ["specs", "参数", text(3, "S")],
      ]),
      page({ tab: ["specs"] }),
    );
    expect(html).toContain("S");
    expect(html).not.toContain(">O<");
    expect(html).toMatch(/class="btn on"[^>]*href="#\/\?tab=specs"|href="#\/"[^>]*>/); // 点 overview 回到默认（地址里没有参数）
    expect(html.match(/class="btn ghost"/g)?.length).toBe(1);
  });

  it("accordion: multi-valued, each title toggles its own entry", () => {
    const rc = page({ faq: ["a"] });
    const html = node(
      accordion("faq", [
        ["a", "Q1", text(3, "ANS1")],
        ["b", "Q2", text(3, "ANS2")],
      ]),
      rc,
    );
    expect(html).toContain("ANS1");
    expect(html).not.toContain("ANS2");
    expect(html).toContain('href="#/?faq=a,b"'); // 展开 b，a 保持
    expect(html).toContain('href="#/"'); // 收起 a
  });

  it("a state parameter is not mistaken for a field filter: records with ?tab= in the address are not filtered away", () => {
    const rc = rcOf(example, { listType: "product", state, sel: { tab: ["specs"] } });
    expect(node(collection("product", { limit: 2 }), rc)).toContain("P101");
  });

  it("param source yields one item per declared value, marked on when current", () => {
    const html = node(
      each({ param: "tab" }, text(3, bind("t.value")), { as: "t", dir: "row" }),
      page({ tab: ["specs"] }),
    );
    expect(html).toContain("overview");
    expect(html).toContain("specs");
  });
});

describe("fold (count / sum / min / max / avg) and distinct", () => {
  const rc = () => rcOf(example);
  const moqs = (cat: string) =>
    rc()
      .db.list("product")
      .filter((r) => r["category"] === cat)
      .map((r) => Number(r["moq"]));
  const src = records("product", { where: { category: "pens" } });
  const shownText = (n: ReturnType<typeof text>) => node(n, rc());

  it("computes each op over a numeric field of the records", () => {
    const v = moqs("pens");
    expect(shownText(text(2, sum(src, "moq")))).toContain(`>${v.reduce((a, b) => a + b, 0)}<`);
    expect(shownText(text(2, min(src, "moq")))).toContain(`>${Math.min(...v)}<`);
    expect(shownText(text(2, max(src, "moq")))).toContain(`>${Math.max(...v)}<`);
    expect(shownText(text(2, avg(src, "moq")))).toContain(
      `>${v.reduce((a, b) => a + b, 0) / v.length}<`,
    );
    expect(shownText(text(2, count(src)))).toContain(`>${v.length}<`);
  });

  it("count of nothing is 0; sum/min/max/avg of nothing is a scribble (never invented)", () => {
    const none = records("product", { where: { category: "nope" } });
    expect(shownText(text(2, count(none)))).toContain(">0<");
    for (const op of [sum, min, max, avg]) {
      const html = shownText(text(2, op(none, "moq")));
      expect(html).toContain('data-rough="sq"');
      expect(html).not.toContain("data-copy");
    }
  });

  it("distinct yields each value that occurs with the number of records having it (group-by)", () => {
    const html = node(
      each(
        distinct("product", "category"),
        row(text(3, bind("o.label")), text(3, bind("o.count"))),
        { as: "o", dir: "col" },
      ),
      rc(),
    );
    expect(html).toContain("笔类");
    expect(html).toContain(">5<");
  });

  it("distinct expands a multi-valued field value by value", () => {
    const html = node(
      each(distinct("product", "materials"), text(3, bind("o.label")), { as: "o", dir: "row" }),
      rc(),
    );
    for (const m of ["塑料", "金属", "纸", "竹"]) expect(html).toContain(m);
  });

  it("a where can take its value from the item of an outer each: sum per group", () => {
    const html = node(
      each(
        distinct("product", "category"),
        row(
          text(3, bind("o.value")),
          text(3, sum(records("product", { where: { category: "{o.value}" } }), "moq")),
        ),
        { as: "o", dir: "col" },
      ),
      rc(),
    );
    expect(html).toContain(`>${moqs("pens").reduce((a, b) => a + b, 0)}<`);
  });
});

describe("embed (a field whose value is a tree)", () => {
  const art = (body: unknown) =>
    rcOf(example, { page: { type: "article", row: { slug: "x", title: "T", body } } });
  it("renders the tree stored in a blocks field, with the same grammar as a page; one root", () => {
    const body = JSON.parse(JSON.stringify([text(2, "HEAD"), steps(text(3, "s1"), text(3, "s2"))]));
    const html = node(embed(bind("body")), art(body));
    expect(rootCount(html)).toBe(1);
    expect(html).toContain("HEAD");
    expect(html.match(/class="stepno"/g)?.length).toBe(2);
  });

  it("an embed inside an embedded tree renders nothing (termination is guaranteed, not hoped for)", () => {
    const body = JSON.parse(JSON.stringify([text(2, "OUTER"), embed(bind("body"))]));
    const html = node(embed(bind("body")), art(body));
    expect(html).toContain("OUTER");
    expect(html.match(/class="embed"/g)?.length).toBe(1);
  });

  it("an empty or missing tree is an empty embed, not a crash; lines fidelity leaks no copy", () => {
    expect(node(embed(bind("body")), art([]))).toContain('class="embed"');
    const lines = rcOf(example, {
      fid: "lines",
      page: {
        type: "article",
        row: { slug: "x", title: "T", body: JSON.parse(JSON.stringify([text(2, "HEAD")])) },
      },
    });
    expect(node(embed(bind("body")), lines)).not.toContain("data-copy");
  });

  it("the default detail page of a type with a blocks field renders its body", () => {
    const rc = art(JSON.parse(JSON.stringify([text(2, "BODYTEXT")])));
    const page = pagesOf(example)["/article/:id"]!;
    expect(page.body.map((n) => node(n, rc)).join("")).toContain("BODYTEXT");
  });
});

describe("session parameters (who is looking)", () => {
  const session = { viewer: { values: ["visitor", "member"], default: "visitor" } };
  const sk: Sketch = { ...JSON.parse(JSON.stringify(example)), session };
  const rc = (
    o: { sel?: Record<string, string[]>; stored?: Record<string, string[]> } = {},
  ): RC => ({
    ...rcOf(sk, { state: session, sel: o.sel ?? {} }),
    ...(o.stored ? { stored: o.stored } : {}),
  });

  it("falls back to the default, then to what the browser kept, and the address wins over both", () => {
    const only = when("viewer=member", text(3, "SECRET"));
    expect(node(only, rc())).toBe("");
    expect(node(only, rc({ stored: { viewer: ["member"] } }))).toContain("SECRET");
    expect(node(only, rc({ stored: { viewer: ["member"] }, sel: { viewer: ["visitor"] } }))).toBe(
      "",
    );
  });

  it("a link that sets a session parameter always writes it into the address (default included), so a kept value cannot override it", () => {
    const html = node(
      action("out", undefined, { set: { viewer: "visitor" } }),
      rc({ stored: { viewer: ["member"] } }),
    );
    expect(html).toContain("viewer=visitor");
  });
});
