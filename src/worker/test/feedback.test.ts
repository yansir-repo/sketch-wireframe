import { describe, expect, it } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { readFileSync, readdirSync } from "node:fs";
import example from "../../../examples/catalog.config.ts";
import { Db, type Row } from "../db.ts";
import {
  MAX_ROWS_PER_SKETCH,
  addNote,
  closeRound,
  groupRounds,
  listForClient,
  listForOperator,
} from "../feedback.ts";
import { OperatorGate, OperatorGateLive } from "../operator.ts";
import { publish } from "../sketches.ts";
import { MAX_NOTE_CHARS } from "../../shared/feedback.ts";

/** Real SQLite with the real migrations, as sketches.test.ts. */
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

/** A published sketch (v1 live): its slug and key. */
const published = Effect.gen(function* () {
  const p = yield* atNow(publish(sketch()));
  return { slug: "ex-catalog", key: p.key };
});

const tag = <A, E, R>(e: Effect.Effect<A, E, R>) =>
  e.pipe(
    Effect.map(() => "ok"),
    Effect.catch((err) => Effect.succeed((err as { _tag: string })._tag)),
  );

describe("client feedback (real SQL)", () => {
  it.effect("a note is kept on the version the client saw, and the client can read it back", () =>
    Effect.gen(function* () {
      const { slug, key } = yield* published;
      yield* atNow(addNote(slug, key, { version: 1, path: "#/?q=x", text: "  标题太小  " }));
      const mine = yield* listForClient(slug, key, 1);
      expect(mine.map((n) => [n.version, n.path, n.text])).toEqual([[1, "/", "标题太小"]]);
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect(
    "only a page of that version takes a note: not an unknown page, not the back office",
    () =>
      Effect.gen(function* () {
        const { slug, key } = yield* published;
        const note = (path: string) =>
          tag(atNow(addNote(slug, key, { version: 1, path, text: "x" })));
        expect(yield* note("/no/such/page/at/all")).toBe("FeedbackRejected");
        expect(yield* note("/_model")).toBe("FeedbackRejected");
        expect(yield* note("/")).toBe("ok");
      }).pipe(Effect.provide(freshDb())),
  );

  it.effect(
    "the key is the gate, and a wrong key / unknown version / removed sketch all look alike",
    () =>
      Effect.gen(function* () {
        const { slug, key } = yield* published;
        const write = (k: string, v: number) =>
          tag(atNow(addNote(slug, k, { version: v, path: "/", text: "x" })));
        expect(yield* write("0000000000000000", 1)).toBe("FeedbackNotFound");
        expect(yield* write(key, 9)).toBe("FeedbackNotFound");
        expect(yield* tag(listForClient(slug, "0000000000000000", 1))).toBe("FeedbackNotFound");
        expect(yield* tag(closeRound("nope", key, 1))).toBe("FeedbackNotFound");
      }).pipe(Effect.provide(freshDb())),
  );

  it.effect("empty and oversized notes are refused", () =>
    Effect.gen(function* () {
      const { slug, key } = yield* published;
      const text = (t: string) =>
        tag(atNow(addNote(slug, key, { version: 1, path: "/", text: t })));
      expect(yield* text("   ")).toBe("FeedbackRejected");
      expect(yield* text("x".repeat(MAX_NOTE_CHARS + 1))).toBe("FeedbackRejected");
      expect(yield* text("x".repeat(MAX_NOTE_CHARS))).toBe("ok");
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect("a sketch takes at most MAX_ROWS_PER_SKETCH rows", () =>
    Effect.gen(function* () {
      const { slug, key } = yield* published;
      yield* Effect.forEach(
        Array.from({ length: MAX_ROWS_PER_SKETCH }),
        () => atNow(addNote(slug, key, { version: 1, path: "/", text: "x" })),
        { discard: true },
      );
      expect(yield* tag(atNow(addNote(slug, key, { version: 1, path: "/", text: "x" })))).toBe(
        "FeedbackRejected",
      );
    }).pipe(Effect.provide(freshDb())),
  );

  it.effect(
    "rounds: notes are open until the client closes the round; an empty round is refused",
    () =>
      Effect.gen(function* () {
        const { slug, key } = yield* published;
        expect(yield* tag(atNow(closeRound(slug, key, 1)))).toBe("FeedbackRejected");
        yield* atNow(addNote(slug, key, { version: 1, path: "/", text: "a" }));
        yield* atNow(addNote(slug, key, { version: 1, path: "/", text: "b" }));

        const before = yield* listForOperator("EX-CATALOG");
        expect(before.rounds).toEqual([]);
        expect(before.open.map((n) => n.text)).toEqual(["a", "b"]);

        yield* atNow(closeRound(slug, key, 1));
        yield* atNow(addNote(slug, key, { version: 1, path: "/", text: "c" }));

        const after = yield* listForOperator("EX-CATALOG");
        expect(after.rounds.map((r) => r.notes.map((n) => n.text))).toEqual([["a", "b"]]);
        expect(after.open.map((n) => n.text)).toEqual(["c"]);

        // the cursor skips what the agent has already read
        const next = yield* listForOperator("EX-CATALOG", after.cursor);
        expect(next.rounds).toEqual([]);
        expect(next.open.map((n) => n.text)).toEqual(["c"]);
      }).pipe(Effect.provide(freshDb())),
  );

  it.effect("the operator asking about an unknown code is told so, not given an empty answer", () =>
    Effect.gen(function* () {
      expect(yield* tag(listForOperator("nope"))).toBe("SketchNotFound");
    }).pipe(Effect.provide(freshDb())),
  );
});

describe("groupRounds", () => {
  const n = (id: number, text: string) => ({
    id,
    version: 1,
    kind: "note" as const,
    path: "/",
    text,
    at: id,
  });
  const d = (id: number) => ({ id, version: 1, kind: "done" as const, path: "", text: "", at: id });
  it("splits at each done and leaves the tail open", () => {
    const g = groupRounds([n(1, "a"), d(2), n(3, "b"), n(4, "c"), d(5), n(6, "d")]);
    expect(g.rounds.map((r) => [r.round, r.notes.map((x) => x.text)])).toEqual([
      [2, ["a"]],
      [5, ["b", "c"]],
    ]);
    expect(g.open.map((x) => x.text)).toEqual(["d"]);
  });
});

describe("operator gate", () => {
  const allows = (token: string | undefined, header: string | undefined) =>
    Effect.gen(function* () {
      return yield* (yield* OperatorGate).allows(header);
    }).pipe(Effect.provide(OperatorGateLive(token)));

  it.effect("admits only the exact Bearer token, and nobody when none is configured", () =>
    Effect.gen(function* () {
      expect(yield* allows("s3cret", "Bearer s3cret")).toBe(true);
      expect(yield* allows("s3cret", "Bearer s3cre")).toBe(false);
      expect(yield* allows("s3cret", "s3cret")).toBe(false);
      expect(yield* allows("s3cret", undefined)).toBe(false);
      expect(yield* allows(undefined, "Bearer ")).toBe(false);
      expect(yield* allows("", "Bearer x")).toBe(false);
    }),
  );
});
