import { describe, expect, it } from "vitest";
import { pagesOf } from "./derive.ts";
import { parseSketch } from "./parse.ts";
import { checkSketch } from "./check.ts";
import { action, collection, section, text } from "./dsl.ts";
import example from "../../examples/catalog.config.ts";
import type { Sketch } from "./schema.ts";

const fresh = (): Sketch => ({
  v: 4,
  code: "ROUTES-TEST",
  title: "Routes",
  model: {
    file: {
      label: "File",
      key: "id",
      fields: { id: { kind: "text", label: "File" } },
      seed: [1, 2, 3, 4].map((n) => ({ id: `f${n}` })),
    },
  },
  header: text(3),
  footer: text(3),
  pages: { "/": { body: [section("Files", collection("file"))] } },
});

describe("optional derived routes", () => {
  it("preserves omitted switches and explicit true byte-for-byte", () => {
    const original = fresh();
    const enabled = fresh();
    const withSwitches = {
      ...enabled,
      model: { file: { ...enabled.model.file!, routes: { list: true, detail: true } } },
    };
    expect(pagesOf(withSwitches)).toEqual(pagesOf(original));
    expect(Object.keys(pagesOf(original))).toEqual(["/file", "/file/:id", "/"]);
  });

  it("disables each default route independently without removing records", () => {
    for (const route of ["list", "detail"] as const) {
      const original = fresh();
      const s = {
        ...original,
        model: { file: { ...original.model.file!, routes: { [route]: false } } },
      };
      const pages = pagesOf(s);
      expect(pages[route === "list" ? "/file" : "/file/:id"]).toBeUndefined();
      expect(pages[route === "list" ? "/file/:id" : "/file"]).toBeDefined();
      expect(s.model.file.seed).toHaveLength(4);
      expect(checkSketch(s).ok).toBe(true);
    }
  });

  it("keeps explicit pages authoritative even when defaults are disabled", () => {
    const original = fresh();
    const explicit = { name: "Files", body: [section("Files", text(3))] };
    const s = {
      ...original,
      model: { file: { ...original.model.file!, routes: { list: false, detail: false } } },
      pages: { ...original.pages, "/file": explicit, "/file/:id": explicit },
    };
    expect(pagesOf(s)["/file"]).toEqual(explicit);
    expect(pagesOf(s)["/file/:id"]).toEqual(explicit);
  });

  it("accepts booleans only and rejects unknown switches", () => {
    const s = fresh();
    for (const routes of [{ detail: "false" }, { admin: false }]) {
      expect(parseSketch({ ...s, model: { file: { ...s.model.file, routes } } }).ok).toBe(false);
    }
  });
});

describe("what the switches remove on public and vocab types", () => {
  const without = (...drop: string[]): Sketch => ({
    ...example,
    pages: Object.fromEntries(Object.entries(example.pages).filter(([p]) => !drop.includes(p))),
  });
  const withRoutes = (s: Sketch, type: string, routes: { list?: boolean; detail?: boolean }) => ({
    ...s,
    model: { ...s.model, [type]: { ...s.model[type]!, routes } },
  });

  it("on a public type, list: false removes the derived create form; detail has nothing to remove", () => {
    const base = without("/inquiry");
    expect(pagesOf(base)["/inquiry"]?.ctx).toMatchObject({ type: "inquiry", create: true });
    expect(pagesOf(base)["/inquiry/:id"]).toBeUndefined();
    expect(pagesOf(withRoutes(base, "inquiry", { list: false }))["/inquiry"]).toBeUndefined();
    expect(pagesOf(withRoutes(base, "inquiry", { detail: false }))).toEqual(pagesOf(base));
  });

  it("on a vocab type, the switches remove the derived filter pages; explicit links to them fail the check", () => {
    const base = without();
    expect(pagesOf(base)["/material/:id"]?.derived).toBe(true);
    const off = withRoutes(base, "material", { list: false, detail: false });
    expect(pagesOf(off)["/material"]).toBeUndefined();
    expect(pagesOf(off)["/material/:id"]).toBeUndefined();
    const id = String(example.model["material"]!.seed[0]!["id"]);
    const home = off.pages["/"]!;
    const linked = {
      ...off,
      pages: {
        ...off.pages,
        "/": { ...home, body: [...home.body, section("x", action("x", `/material/${id}`))] },
      },
    };
    expect(checkSketch(linked).errors.join("\n")).toContain("没有对应页面");
  });
});
