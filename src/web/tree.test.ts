import { describe, expect, it } from "vitest";
import { treeBody, treeEditorHtml } from "./tree-editor.ts";
import { add, fresh, isGroup, looksLikeTree, move, remove, update, type Tree } from "./tree-ops.ts";

const sample = (): Tree => [
  { slot: "text", size: 2, fill: "HEAD" },
  { group: [{ slot: "text", size: 3, fill: "inner" }, { slot: "image" }], dir: "col", name: "box" },
  { each: { records: "x" }, dir: "col" },
];

describe("tree operations (pure)", () => {
  it("adds a node to the root or into a group, and never mutates the input", () => {
    const t = sample();
    const before = JSON.stringify(t);
    const root = add(t, [], "image");
    expect(root.length).toBe(4);
    expect(JSON.stringify(t)).toBe(before);
    const inner = add(t, [1], "text");
    expect((inner[1] as { group: unknown[] }).group.length).toBe(3);
    expect(add(t, [0], "text")).toBe(t); // 文字不是组：加不进去，原样返回
  });

  it("creates the right fresh node for each kind", () => {
    expect(fresh("text")).toEqual({ slot: "text", size: 3 });
    expect(fresh("steps")).toEqual({ group: [], dir: "row", seq: true });
    expect(fresh("grid")).toEqual({ group: [], dir: "grid" });
    expect(isGroup(fresh("col"))).toBe(true);
  });

  it("removes and moves among siblings, at any depth; out-of-range moves are no-ops", () => {
    const t = sample();
    expect(remove(t, [0]).length).toBe(2);
    expect((remove(t, [1, 0])[1] as { group: unknown[] }).group.length).toBe(1);
    expect((move(t, [0], 1)[1] as { slot: string }).slot).toBe("text");
    expect(move(t, [0], -1)).toBe(t);
    expect(move(t, [2], 1)).toBe(t);
    expect(remove(t, [9])).toBe(t);
    const moved = move(t, [1, 0], 1);
    expect((moved[1] as { group: Array<{ slot: string }> }).group[0]!.slot).toBe("image");
  });

  it("updates one property; an empty value removes it (unfilled = scribble); size becomes a number; seq is a flag", () => {
    const t = sample();
    expect((update(t, [0], "fill", "NEW")[0] as { fill: string }).fill).toBe("NEW");
    expect("fill" in update(t, [0], "fill", "")[0]!).toBe(false);
    expect((update(t, [0], "size", "1")[0] as { size: number }).size).toBe(1);
    expect((update(t, [1], "seq", true)[1] as { seq: boolean }).seq).toBe(true);
    expect("seq" in update(update(t, [1], "seq", true), [1], "seq", false)[1]!).toBe(false);
    expect(update(t, [7], "fill", "x")).toBe(t);
  });

  it("recognises something that looks like a tree", () => {
    expect(looksLikeTree(sample())).toBe(true);
    expect(looksLikeTree([])).toBe(true);
    expect(looksLikeTree([{ nope: 1 }])).toBe(false);
    expect(looksLikeTree("x")).toBe(false);
    expect(looksLikeTree([1])).toBe(false);
  });
});

describe("tree editor (outline)", () => {
  it("draws one row per node with its controls; groups indent their children; unknown nodes are kept and say so", () => {
    const html = treeBody(sample());
    expect(html.match(/class="tree-node"/g)?.length).toBe(5); // 文字、组、组内两个、each
    expect(html).toContain('data-path="1.0"');
    expect(html).toContain("用下面的 JSON 改它");
    expect(html.match(/data-act="tree-del"/g)?.length).toBe(4 + 1);
  });

  it("escapes what it shows and carries the whole tree in data-tree (the single truth the form reads)", () => {
    const html = treeEditorHtml([{ slot: "text", size: 3, fill: '"><script>x</script>' }]);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("data-tree=");
    expect(html).toContain("data-tree-raw");
  });
});

describe("media nodes in the editor", () => {
  it("a fresh media node is a valid node, its kind is editable, and the outline offers the kinds", () => {
    expect(fresh("media")).toEqual({ slot: "media", kind: "video" });
    const t = update([fresh("media")], [0], "kind", "map");
    expect(t[0]).toEqual({ slot: "media", kind: "map" });
    const html = treeBody(t);
    expect(html).toContain("媒体");
    expect(html).toContain('data-tree-set="kind"');
  });
});
