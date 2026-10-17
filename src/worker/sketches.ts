/**
 * 已发布的草图，一个事实一处：D1。`sketches` 一行一个项目（key 就存在这里——账号里没有“每项目一个 Worker”，
 * 所以不存在“key 丢了从哪找回”），`sketch_versions` 一行一个版本。发布 = 校验后写进去，引擎是同一份。
 *
 * 公开读（`serve`）只回答“这个 code + key 对不对”，对错一律同一种 404，不泄露哪个 code 存在。
 */
import { Data, Effect } from "effect";
import { checkSketch } from "../shared/check.ts";
import { nowSeconds } from "./clock.ts";
import { Db, num, str } from "./db.ts";

export class SketchInvalid extends Data.TaggedError("SketchInvalid")<{
  readonly errors: ReadonlyArray<string>;
  readonly message: string;
}> {}
export class SketchNotFound extends Data.TaggedError("SketchNotFound")<{ readonly what: string }> {}

/** 项目编号 → 路径里的 slug：小写，只留字母数字横线。 */
export const slugOf = (code: string): string => code.trim().toLowerCase();

export const sketchPath = (code: string, key: string): string => `/s/${slugOf(code)}.${key}`;

/** 公开路径：`/s/<slug>.<16 hex>` 与它下面的 `/sketch.json`。 */
export const parseSketchPath = (
  pathname: string,
): { slug: string; key: string; json: boolean } | null => {
  const m = /^\/s\/([a-z0-9][a-z0-9-]{1,30})\.([0-9a-f]{16})(\/sketch\.json|\/)?$/.exec(pathname);
  return m ? { slug: m[1]!, key: m[2]!, json: m[3] === "/sketch.json" } : null;
};

const randomKey = Effect.sync(() =>
  [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(""),
);

/** 常量时间比较，key 不靠比较耗时泄露。 */
const sameKey = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export type Meta = {
  readonly code: string;
  readonly title: string;
  readonly key: string;
  readonly version: number;
  readonly path: string;
  readonly updatedAt: number;
  readonly updatedBy: string;
  readonly deleted: boolean;
};

const meta = (r: Readonly<Record<string, unknown>>): Meta => ({
  code: str(r, "code"),
  title: str(r, "title"),
  key: str(r, "key"),
  version: num(r, "version"),
  path: sketchPath(str(r, "code"), str(r, "key")),
  updatedAt: num(r, "updated_at"),
  updatedBy: str(r, "updated_by"),
  deleted: num(r, "deleted_at") > 0,
});

const row = (slug: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db.first("SELECT * FROM sketches WHERE code = ?", [slug]);
  });

const live = (slug: string) =>
  Effect.gen(function* () {
    const r = yield* row(slug);
    if (!r || num(r, "deleted_at") > 0) return yield* new SketchNotFound({ what: slug });
    return r;
  });

/** 校验 → 写成新版本（内容没变就不加版本）。key 第一次发布时铸，之后永远复用；下线后重新发布也还是原来那个。 */
export const publish = (input: unknown, actor: string) =>
  Effect.gen(function* () {
    const report = checkSketch(input);
    if (!report.ok || !report.sketch)
      return yield* new SketchInvalid({ errors: report.errors, message: report.errors.join("\n") });
    const sketch = report.sketch;
    const slug = slugOf(sketch.code);
    const json = JSON.stringify(sketch);
    const db = yield* Db;
    const now = yield* nowSeconds;
    const existing = yield* row(slug);

    if (existing && num(existing, "deleted_at") === 0) {
      const current = yield* db.first(
        "SELECT json FROM sketch_versions WHERE code = ? AND version = ?",
        [slug, num(existing, "version")],
      );
      if (current && str(current, "json") === json)
        return { ...meta(existing), unchanged: true, warnings: report.warnings };
    }
    const top = yield* db.first("SELECT MAX(version) AS v FROM sketch_versions WHERE code = ?", [
      slug,
    ]);
    const version = (top ? num(top, "v") : 0) + 1;
    yield* db.run(
      "INSERT INTO sketch_versions (code, version, json, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
      [slug, version, json, now, actor],
    );
    if (existing) {
      yield* db.run(
        "UPDATE sketches SET version = ?, title = ?, updated_at = ?, updated_by = ?, deleted_at = NULL WHERE code = ?",
        [version, sketch.title, now, actor, slug],
      );
    } else {
      const key = yield* randomKey;
      yield* db.run(
        "INSERT INTO sketches (code, key, version, title, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [slug, key, version, sketch.title, now, now, actor],
      );
    }
    const after = yield* row(slug);
    return { ...meta(after!), unchanged: false, warnings: report.warnings };
  });

export const list = Effect.gen(function* () {
  const db = yield* Db;
  return (yield* db.all("SELECT * FROM sketches ORDER BY updated_at DESC")).map(meta);
});

export const get = (code: string) =>
  Effect.gen(function* () {
    const slug = slugOf(code);
    const r = yield* live(slug);
    const db = yield* Db;
    const v = yield* db.first("SELECT json FROM sketch_versions WHERE code = ? AND version = ?", [
      slug,
      num(r, "version"),
    ]);
    return { ...meta(r), sketch: JSON.parse(str(v ?? {}, "json") || "null") as unknown };
  });

export const versions = (code: string) =>
  Effect.gen(function* () {
    const slug = slugOf(code);
    yield* live(slug);
    const db = yield* Db;
    return (yield* db.all(
      "SELECT version, created_at, created_by FROM sketch_versions WHERE code = ? ORDER BY version DESC",
      [slug],
    )).map((r) => ({
      version: num(r, "version"),
      createdAt: num(r, "created_at"),
      createdBy: str(r, "created_by"),
    }));
  });

export const rollback = (code: string, version: number, actor: string) =>
  Effect.gen(function* () {
    const slug = slugOf(code);
    yield* live(slug);
    const db = yield* Db;
    const v = yield* db.first("SELECT json FROM sketch_versions WHERE code = ? AND version = ?", [
      slug,
      version,
    ]);
    if (!v) return yield* new SketchNotFound({ what: `${slug} v${version}` });
    const now = yield* nowSeconds;
    yield* db.run(
      "UPDATE sketches SET version = ?, updated_at = ?, updated_by = ? WHERE code = ?",
      [version, now, actor, slug],
    );
    return meta((yield* row(slug))!);
  });

/** 下线：地址立刻失效，历史保留；再发布同一个编号会复活原来的地址。 */
export const remove = (code: string, actor: string) =>
  Effect.gen(function* () {
    const slug = slugOf(code);
    yield* live(slug);
    const db = yield* Db;
    const now = yield* nowSeconds;
    yield* db.run(
      "UPDATE sketches SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE code = ?",
      [now, now, actor, slug],
    );
    return { code: slug, removed: true };
  });

/** 换 key：旧链接立刻失效（泄露了，或不想让之前发出去的人继续看）。 */
export const rotateKey = (code: string, actor: string) =>
  Effect.gen(function* () {
    const slug = slugOf(code);
    yield* live(slug);
    const db = yield* Db;
    const key = yield* randomKey;
    const now = yield* nowSeconds;
    yield* db.run("UPDATE sketches SET key = ?, updated_at = ?, updated_by = ? WHERE code = ?", [
      key,
      now,
      actor,
      slug,
    ]);
    return meta((yield* row(slug))!);
  });

/** 公开读：code + key 都对才给；对错同一种结果（null）。 */
export const serve = (slug: string, key: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const r = yield* db.first(
      "SELECT s.key AS key, s.deleted_at AS deleted_at, v.json AS json FROM sketches s JOIN sketch_versions v ON v.code = s.code AND v.version = s.version WHERE s.code = ?",
      [slug],
    );
    if (!r || num(r, "deleted_at") > 0 || !sameKey(str(r, "key"), key)) return null;
    return str(r, "json");
  });
