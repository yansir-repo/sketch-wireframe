import { describe, expect, it } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { readFileSync, readdirSync } from "node:fs";
import example from "../../../examples/catalog.config.ts";
import { Db, type Row } from "../db.ts";
import {
  get,
  list,
  parseSketchPath,
  publish,
  remove,
  rollback,
  rotateKey,
  serve,
  versions,
} from "../sketches.ts";

/** Real SQLite with the real migrations: a fake Db could not tell a correct WHERE clause from a wrong one. */
const freshDb = () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  return Layer.succeed(Db, {
    all: (sql: string, params: ReadonlyArray<unknown> = []) =>
      Effect.sync(() => sqlite.prepare(sql).all(...(params as never[])) as unknown as Row[]),
    first: (sql: string, params: ReadonlyArray<unknown> = []) =>
      Effect.sync(
        () => (sqlite.prepare(sql).get(...(params as never[])) ?? undefined) as Row | undefined,
      ),
    run: (sql: string, params: ReadonlyArray<unknown> = []) =>
      Effect.sync(() => Number(sqlite.prepare(sql).run(...(params as never[])).changes)),
  });
};

const NOW = 1_790_000_000;
const atNow = <A, E, R>(e: Effect.Effect<A, E, R>) =>
  TestClock.setTime(NOW * 1000).pipe(Effect.andThen(e));
const sketch = () => JSON.parse(JSON.stringify(example)) as Record<string, unknown>;

describe("sketch store (real SQL)", () => {
  it.effect("publishes, reuses the key, and only adds a version when the content changed", () =>
    Effect.gen(function* () {
      const a = yield* atNow(publish(sketch(), "tester"));
      expect(a.key).toMatch(/^[0-9a-f]{16}$/);
      expect(a.version).toBe(1);
      expect(a.path).toBe(`/s/ex-catalog.${a.key}`);

      const same = yield* atNow(publish(sketch(), "tester"));
      expect(same.unchanged).toBe(true);
      expect(same.version).toBe(1);

      const edited = { ...sketch(), title: "改过的标题" };
      const b = yield* atNow(publish(edited, "tester"));
      expect(b.unchanged).toBe(false);
      expect(b.version).toBe(2);
      expect(b.key).toBe(a.key);
      expect((yield* versions("EX-CATALOG")).map((v) => v.version)).toEqual([2, 1]);
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect("refuses an invalid sketch and writes nothing", () =>
    Effect.gen(function* () {
      const bad = { ...sketch(), model: {} };
      const exit = yield* Effect.exit(atNow(publish(bad, "tester")));
      expect(exit._tag).toBe("Failure");
      expect(yield* list).toEqual([]);
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect("refuses a price in the text (public-preview red line)", () =>
    Effect.gen(function* () {
      const s = sketch();
      (s["footer"] as { group: Array<{ fill?: string }> }).group[0]!.fill = "报价 ¥1200 起";
      const exit = yield* Effect.exit(atNow(publish(s, "tester")));
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect(
    "serves only to the right code + key; wrong key, wrong code and removed look the same (null)",
    () =>
      Effect.gen(function* () {
        const p = yield* atNow(publish(sketch(), "tester"));
        expect(yield* serve("ex-catalog", p.key)).toContain('"code":"EX-CATALOG"');
        expect(yield* serve("ex-catalog", "0000000000000000")).toBeNull();
        expect(yield* serve("nope", p.key)).toBeNull();
        yield* atNow(remove("EX-CATALOG", "tester"));
        expect(yield* serve("ex-catalog", p.key)).toBeNull();
      }).pipe(Effect.provide(freshDb())),
  );

  it.effect("re-publishing a removed code revives the same URL", () =>
    Effect.gen(function* () {
      const p = yield* atNow(publish(sketch(), "tester"));
      yield* atNow(remove("ex-catalog", "tester"));
      const again = yield* atNow(publish(sketch(), "tester"));
      expect(again.key).toBe(p.key);
      expect(again.version).toBe(2);
      expect(yield* serve("ex-catalog", p.key)).not.toBeNull();
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect("rotating the key kills the old URL at once", () =>
    Effect.gen(function* () {
      const p = yield* atNow(publish(sketch(), "tester"));
      const r = yield* atNow(rotateKey("EX-CATALOG", "tester"));
      expect(r.key).not.toBe(p.key);
      expect(yield* serve("ex-catalog", p.key)).toBeNull();
      expect(yield* serve("ex-catalog", r.key)).not.toBeNull();
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect("rolls back to an earlier version without changing the URL", () =>
    Effect.gen(function* () {
      const p = yield* atNow(publish(sketch(), "tester"));
      yield* atNow(publish({ ...sketch(), title: "v2" }, "tester"));
      const back = yield* atNow(rollback("EX-CATALOG", 1, "tester"));
      expect(back.version).toBe(1);
      expect(back.key).toBe(p.key);
      const g = yield* get("EX-CATALOG");
      expect((g.sketch as { title: string }).title).toBe("范例 · 文具目录站");
      expect((yield* Effect.exit(atNow(rollback("EX-CATALOG", 9, "tester"))))._tag).toBe("Failure");
    }).pipe(Effect.provide(freshDb())),
  );
});

describe("sketch paths", () => {
  it("parses only /s/<slug>.<16 hex> and its sketch.json", () => {
    expect(parseSketchPath("/s/mz-007.0123456789abcdef")).toEqual({
      slug: "mz-007",
      key: "0123456789abcdef",
      json: false,
    });
    expect(parseSketchPath("/s/mz-007.0123456789abcdef/")?.json).toBe(false);
    expect(parseSketchPath("/s/mz-007.0123456789abcdef/sketch.json")?.json).toBe(true);
    for (const bad of [
      "/s/mz-007",
      "/s/mz-007.xyz",
      "/s/EX-CATALOG.0123456789abcdef",
      "/s/mz-007.0123456789abcdef/other",
      "/s/../etc",
    ])
      expect(parseSketchPath(bad)).toBeNull();
  });
});
