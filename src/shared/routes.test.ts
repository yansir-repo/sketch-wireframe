import { describe, expect, it } from "vitest";
import { pagesOf } from "./derive.ts";
import { parseSketch } from "./parse.ts";
import { checkSketch } from "./check.ts";
import { collection, section, text } from "./dsl.ts";
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
