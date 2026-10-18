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
  promote,
  publish,
  remove,
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

/** The JSON of what `serve` answers (tests that only care about the content). */
const serveJson = (slug: string, key: string, version?: number) =>
  serve(slug, key, version).pipe(Effect.map((r) => r?.json ?? null));

const NOW = 1_790_000_000;
const atNow = <A, E, R>(e: Effect.Effect<A, E, R>) =>
  TestClock.setTime(NOW * 1000).pipe(Effect.andThen(e));
const sketch = () => JSON.parse(JSON.stringify(example)) as Record<string, unknown>;

describe("sketch store (real SQL)", () => {
  it.effect("publishes, reuses the key, and only adds a version when the content changed", () =>
    Effect.gen(function* () {
      const a = yield* atNow(publish(sketch()));
      expect(a.key).toMatch(/^[0-9a-f]{16}$/);
      expect(a.version).toBe(1);
      expect(a.path).toBe(`/s/ex-catalog.${a.key}`);

      const same = yield* atNow(publish(sketch()));
      expect(same.unchanged).toBe(true);
      expect(same.version).toBe(1);

      const edited = { ...sketch(), title: "改过的标题" };
      const b = yield* atNow(publish(edited));
      expect(b.unchanged).toBe(false);
      expect(b.version).toBe(2);
      expect(b.key).toBe(a.key);
      expect((yield* versions("EX-CATALOG")).map((v) => v.version)).toEqual([2, 1]);
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect("refuses an invalid sketch and writes nothing", () =>
    Effect.gen(function* () {
      const bad = { ...sketch(), model: {} };
      const exit = yield* Effect.exit(atNow(publish(bad)));
      expect(exit._tag).toBe("Failure");
      expect(yield* list).toEqual([]);
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect("refuses a price in the text (public-preview red line)", () =>
    Effect.gen(function* () {
      const s = sketch();
      (s["footer"] as { group: Array<{ fill?: string }> }).group[0]!.fill = "报价 ¥1200 起";
      const exit = yield* Effect.exit(atNow(publish(s)));
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect(
    "serves only to the right code + key; wrong key, wrong code and removed look the same (null)",
    () =>
      Effect.gen(function* () {
        const p = yield* atNow(publish(sketch()));
        expect(yield* serveJson("ex-catalog", p.key)).toContain('"code":"EX-CATALOG"');
        expect(yield* serveJson("ex-catalog", "0000000000000000")).toBeNull();
        expect(yield* serveJson("nope", p.key)).toBeNull();
        yield* atNow(remove("EX-CATALOG"));
        expect(yield* serveJson("ex-catalog", p.key)).toBeNull();
      }).pipe(Effect.provide(freshDb())),
  );

  it.effect("re-publishing a removed code revives the same URL", () =>
    Effect.gen(function* () {
      const p = yield* atNow(publish(sketch()));
      yield* atNow(remove("ex-catalog"));
      const again = yield* atNow(publish(sketch()));
      expect(again.key).toBe(p.key);
      expect(again.version).toBe(1); // same content as the latest version: revived, no new version
      expect(yield* serveJson("ex-catalog", p.key)).not.toBeNull();
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect("rotating the key kills the old URL at once", () =>
    Effect.gen(function* () {
      const p = yield* atNow(publish(sketch()));
      const r = yield* atNow(rotateKey("EX-CATALOG"));
      expect(r.key).not.toBe(p.key);
      expect(yield* serveJson("ex-catalog", p.key)).toBeNull();
      expect(yield* serveJson("ex-catalog", r.key)).not.toBeNull();
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect(
    "stages without going live: the live URL stays 404 for a new sketch, previews serve the staged version, promote puts it live",
    () =>
      Effect.gen(function* () {
        const staged = yield* atNow(publish(sketch(), { live: false }));
        expect(staged.live).toBe(false);
        expect(staged.staged).toBe(1);
        expect(yield* serveJson("ex-catalog", staged.key)).toBeNull(); // not live yet
        expect(yield* serveJson("ex-catalog", staged.key, 1)).toContain('"code":"EX-CATALOG"'); // but previewable
        expect(yield* serveJson("ex-catalog", "0000000000000000", 1)).toBeNull(); // the key is still the gate

        const live = yield* atNow(promote("EX-CATALOG", 1));
        expect(live.live).toBe(true);
        expect(yield* serveJson("ex-catalog", staged.key)).not.toBeNull();
      }).pipe(Effect.provide(freshDb())),
  );

  it.effect(
    "staging a change leaves the live version serving until it is promoted; promote can also go back",
    () =>
      Effect.gen(function* () {
        const p = yield* atNow(publish(sketch())); // v1 live
        const s2 = yield* atNow(publish({ ...sketch(), title: "v2" }, { live: false }));
        expect(s2.staged).toBe(2);
        expect(s2.version).toBe(1); // still serving v1
        expect(JSON.parse((yield* serveJson("ex-catalog", p.key))!).title).toBe(
          "范例 · 文具目录站",
        );
        expect(JSON.parse((yield* serveJson("ex-catalog", p.key, 2))!).title).toBe("v2");
        expect((yield* versions("EX-CATALOG")).map((v) => [v.version, v.live])).toEqual([
          [2, false],
          [1, true],
        ]);

        yield* atNow(promote("EX-CATALOG", 2));
        expect(JSON.parse((yield* serveJson("ex-catalog", p.key))!).title).toBe("v2");
        const back = yield* atNow(promote("EX-CATALOG", 1));
        expect(back.version).toBe(1);
        expect(back.key).toBe(p.key);
        expect(((yield* get("EX-CATALOG")).sketch as { title: string }).title).toBe(
          "范例 · 文具目录站",
        );
        expect((yield* Effect.exit(atNow(promote("EX-CATALOG", 9))))._tag).toBe("Failure");
      }).pipe(Effect.provide(freshDb())),
  );

  it.effect("re-staging identical content adds no version", () =>
    Effect.gen(function* () {
      yield* atNow(publish(sketch(), { live: false }));
      const again = yield* atNow(publish(sketch(), { live: false }));
      expect(again.staged).toBe(1);
      expect((yield* versions("EX-CATALOG")).length).toBe(1);
    }).pipe(Effect.provide(freshDb())),
  );
});

describe("sketch paths", () => {
  it("parses only /s/<slug>.<16 hex> and its sketch.json", () => {
    expect(parseSketchPath("/s/ab-007.0123456789abcdef")).toEqual({
      slug: "ab-007",
      key: "0123456789abcdef",
      resource: "page",
    });
    expect(parseSketchPath("/s/ab-007.0123456789abcdef/")?.resource).toBe("page");
    for (const r of ["sketch.json", "feedback.json", "feedback", "feedback/done"])
      expect(parseSketchPath(`/s/ab-007.0123456789abcdef/${r}`)?.resource).toBe(r);
    for (const bad of [
      "/s/ab-007",
      "/s/ab-007.xyz",
      "/s/EX-CATALOG.0123456789abcdef",
      "/s/ab-007.0123456789abcdef/other",
      "/s/../etc",
    ])
      expect(parseSketchPath(bad)).toBeNull();
  });
});
