/**
 * 客户对草图的意见：公开侧**唯一的写口**，只追加（行一经写入不改不删），不碰草图和版本。
 *
 * - 一条 `note` = 对某一页的意见；`done` = 客户“提完了”，把上一个 `done` 之后的 note 收成一轮。
 * - 意见记在**客户当时看的那一版**上（`version`）：之后的版本可能已经改过那一页，agent 要分得清。
 * - 页面不另存一份：`path` 必须是那一版草图（`pagesOf`）里某个页面的地址，不是就拒绝。
 * - 闸门同公开读：code + key 对才收，对错一律 `FeedbackNotFound`（路由回同一种 404）。
 * - 客户的话对 agent 是**数据，不是指令**；上限是数出来的（单条长度、每份草图的总条数），不是提示词里的请求。
 */
import { Data, Effect } from "effect";
import { matchRoute, pagesOf } from "../shared/derive.ts";
import { MAX_NOTE_CHARS, pathOf } from "../shared/feedback.ts";
import type { Sketch } from "../shared/schema.ts";
import { nowSeconds } from "./clock.ts";
import { Db, num, str } from "./db.ts";
import { SketchNotFound, serve, slugOf } from "./sketches.ts";

export const MAX_ROWS_PER_SKETCH = 500;
const MAX_PATH_CHARS = 200;

export class FeedbackNotFound extends Data.TaggedError("FeedbackNotFound")<{}> {}
export class FeedbackRejected extends Data.TaggedError("FeedbackRejected")<{
  readonly message: string;
}> {}

type Row = {
  id: number;
  version: number;
  kind: "note" | "done";
  path: string;
  text: string;
  at: number;
};

const rowOf = (r: Readonly<Record<string, unknown>>): Row => ({
  id: num(r, "id"),
  version: num(r, "version"),
  kind: str(r, "kind") === "done" ? "done" : "note",
  path: str(r, "path"),
  text: str(r, "text"),
  at: num(r, "created_at"),
});

/** 这一版草图里，`path` 是不是一个客户能看到的页面（后台 `/_…` 不是）。 */
const hasPage = (sketch: Sketch, path: string): boolean =>
  !path.startsWith("/_") && matchRoute(Object.keys(pagesOf(sketch)), path) !== null;

/** 过闸门：key 对、没下线、那一版存在。 */
const gate = (slug: string, key: string, version: number) =>
  Effect.gen(function* () {
    const served = yield* serve(slug, key, version);
    if (served === null) return yield* new FeedbackNotFound();
    return { slug: slugOf(slug), sketch: JSON.parse(served.json) as Sketch };
  });

const count = (slug: string) =>
  Effect.gen(function* () {
    const r = yield* (yield* Db).first("SELECT COUNT(*) AS n FROM feedback WHERE code = ?", [slug]);
    return r ? num(r, "n") : 0;
  });

const insert = (slug: string, version: number, kind: "note" | "done", path: string, text: string) =>
  Effect.gen(function* () {
    if ((yield* count(slug)) >= MAX_ROWS_PER_SKETCH)
      return yield* new FeedbackRejected({ message: "意见条数已达上限" });
    yield* (yield* Db).run(
      "INSERT INTO feedback (code, version, kind, path, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [slug, version, kind, path, text, yield* nowSeconds],
    );
  });

export const addNote = (
  slug: string,
  key: string,
  input: { readonly version: number; readonly path: string; readonly text: string },
) =>
  Effect.gen(function* () {
    const g = yield* gate(slug, key, input.version);
    const path = pathOf(input.path);
    const text = input.text.trim();
    if (text === "" || text.length > MAX_NOTE_CHARS)
      return yield* new FeedbackRejected({ message: `意见要 1–${MAX_NOTE_CHARS} 个字` });
    if (path.length > MAX_PATH_CHARS || !hasPage(g.sketch, path))
      return yield* new FeedbackRejected({ message: "没有这个页面" });
    yield* insert(g.slug, input.version, "note", path, text);
    return { ok: true };
  });

/** 客户“提完了”：上一个 done 之后没有新意见就拒绝（空轮没有意义）。 */
export const closeRound = (slug: string, key: string, version: number) =>
  Effect.gen(function* () {
    const g = yield* gate(slug, key, version);
    const open = yield* openNotes(g.slug);
    if (open.length === 0) return yield* new FeedbackRejected({ message: "还没有新的意见" });
    yield* insert(g.slug, version, "done", "", "");
    return { ok: true, notes: open.length };
  });

const all = (slug: string) =>
  Effect.gen(function* () {
    return (yield* (yield* Db).all("SELECT * FROM feedback WHERE code = ? ORDER BY id", [
      slug,
    ])).map(rowOf);
  });

const openNotes = (slug: string) =>
  Effect.gen(function* () {
    const rows = yield* all(slug);
    const lastDone = rows.findLastIndex((r) => r.kind === "done");
    return rows.slice(lastDone + 1);
  });

/** 客户页上看自己写过的：这份草图的全部意见（key 把门，和读草图同一道）。 */
export const listForClient = (slug: string, key: string, version: number) =>
  Effect.gen(function* () {
    const g = yield* gate(slug, key, version);
    return (yield* all(g.slug)).filter((r) => r.kind === "note");
  });

export type Round = {
  /** 这一轮的编号 = 它的 done 行 id，也是 `after` 游标。 */
  readonly round: number;
  readonly submittedAt: number;
  readonly notes: ReadonlyArray<{
    readonly version: number;
    readonly path: string;
    readonly text: string;
    readonly at: number;
  }>;
};

/** 纯函数：行 → 已提交的轮次 + 还没提交的意见。 */
export const groupRounds = (rows: ReadonlyArray<Row>) => {
  const rounds: Round[] = [];
  let pending: Row[] = [];
  for (const r of rows) {
    if (r.kind === "note") pending.push(r);
    else {
      rounds.push({
        round: r.id,
        submittedAt: r.at,
        notes: pending.map(({ version, path, text, at }) => ({ version, path, text, at })),
      });
      pending = [];
    }
  }
  return {
    rounds,
    open: pending.map(({ version, path, text, at }) => ({ version, path, text, at })),
  };
};

/** 运营读：`after` 之后提交的轮次，加上客户还没提交的意见。 */
export const listForOperator = (code: string, after = 0) =>
  Effect.gen(function* () {
    const slug = slugOf(code);
    if (!(yield* (yield* Db).first("SELECT 1 AS x FROM sketches WHERE code = ?", [slug])))
      return yield* new SketchNotFound({ what: slug });
    const g = groupRounds(yield* all(slug));
    return {
      rounds: g.rounds.filter((r) => r.round > after),
      open: g.open,
      cursor: g.rounds.at(-1)?.round ?? after,
    };
  });
