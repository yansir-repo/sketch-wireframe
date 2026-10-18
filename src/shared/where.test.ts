import { describe, expect, it } from "vitest";
import { matchesWhere } from "./where.ts";

describe("where: a match means the two sides intersect", () => {
  it("a literal or :param against a scalar or an array field", () => {
    expect(matchesWhere({ c: "a" }, { c: "a" }, { params: {} })).toBe(true);
    expect(matchesWhere({ c: ["a", "b"] }, { c: ":id" }, { params: { id: "b" } })).toBe(true);
    expect(matchesWhere({ c: ["a"] }, { c: ":id" }, { params: { id: "z" } })).toBe(false);
  });

  it("$field on a scalar current record", () => {
    expect(matchesWhere({ c: "a" }, { c: "$k" }, { params: {}, record: { k: "a" } })).toBe(true);
    expect(matchesWhere({ c: ["a", "b"] }, { c: "$k" }, { params: {}, record: { k: "b" } })).toBe(
      true,
    );
  });

  it("$field on an array of the current record (forward ref/term): any member matches", () => {
    const record = { related: ["s1", "s2"] };
    expect(matchesWhere({ slug: "s2" }, { slug: "$related" }, { params: {}, record })).toBe(true);
    expect(matchesWhere({ slug: "s3" }, { slug: "$related" }, { params: {}, record })).toBe(false);
    expect(matchesWhere({ tags: ["x", "s1"] }, { tags: "$related" }, { params: {}, record })).toBe(
      true,
    );
  });

  it("an empty array on the current record matches nothing (not the records whose field is empty)", () => {
    expect(
      matchesWhere({ slug: "" }, { slug: "$related" }, { params: {}, record: { related: [] } }),
    ).toBe(false);
  });
});
