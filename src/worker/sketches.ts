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
  /** 有没有已上线的版本：只暂存过（stage）还没 promote 的草图，version 为 0，公开地址 404。 */
  readonly live: boolean;
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
  live: num(r, "version") > 0 && !(num(r, "deleted_at") > 0),
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

/**
 * 校验 → 写成新版本（内容和**最新版本**一样就不加版本）。key 第一次出现时铸，之后永远复用；下线后重新发布也还是原来那个。
 *
 * `live: true`（默认）= 写完立刻上线；`live: false` = 只暂存：版本存进去，公开地址 `?v=<版本>` 能预览它，
 * 但正在对外的版本不变（新草图则还没有对外的版本）。“验证通过才上线”就是 stage → 验证 → promote。
 */
export const publish = (input: unknown, actor: string, options: { readonly live?: boolean } = {}) =>
  Effect.gen(function* () {
    const goLive = options.live !== false;
    const report = checkSketch(input);
    if (!report.ok || !report.sketch)
      return yield* new SketchInvalid({ errors: report.errors, message: report.errors.join("\n") });
    const sketch = report.sketch;
    const slug = slugOf(sketch.code);
    const json = JSON.stringify(sketch);
    const db = yield* Db;
    const now = yield* nowSeconds;
    const existing = yield* row(slug);

    const top = yield* db.first(
      "SELECT v.version AS version, v.json AS json FROM sketch_versions v WHERE v.code = ? ORDER BY v.version DESC LIMIT 1",
      [slug],
    );
    const sameAsLatest = top !== undefined && str(top, "json") === json;
    const version = sameAsLatest ? num(top, "version") : (top ? num(top, "version") : 0) + 1;
    if (!sameAsLatest)
      yield* db.run(
        "INSERT INTO sketch_versions (code, version, json, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
        [slug, version, json, now, actor],
      );

    if (!existing) {
      const key = yield* randomKey;
      yield* db.run(
        "INSERT INTO sketches (code, key, version, title, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [slug, key, goLive ? version : 0, sketch.title, now, now, actor],
      );
    } else if (goLive) {
      // 上线（含下线后复活）。已经上线且就是这一版 = 没有变化。
      const unchanged = num(existing, "deleted_at") === 0 && num(existing, "version") === version;
      if (!unchanged)
        yield* db.run(
          "UPDATE sketches SET version = ?, title = ?, updated_at = ?, updated_by = ?, deleted_at = NULL WHERE code = ?",
          [version, sketch.title, now, actor, slug],
        );
      const after = yield* row(slug);
      return { ...meta(after!), unchanged, staged: version, warnings: report.warnings };
    }
    const after = yield* row(slug);
    return { ...meta(after!), unchanged: sameAsLatest, staged: version, warnings: report.warnings };
  });

export const list = Effect.gen(function* () {
  const db = yield* Db;
  return (yield* db.all("SELECT * FROM sketches ORDER BY updated_at DESC")).map(meta);
});

/** 元数据 + 一份 JSON：默认是正在对外的版本，也可以指定任意版本（包括只暂存、还没上线的）。 */
export const get = (code: string, version?: number) =>
  Effect.gen(function* () {
    const slug = slugOf(code);
    const r = yield* live(slug);
    const want = version ?? num(r, "version");
    if (want === 0)
      return yield* new SketchNotFound({
        what: `${slug}（还没有上线的版本，用 version 指定一个暂存的）`,
      });
    const db = yield* Db;
    const v = yield* db.first("SELECT json FROM sketch_versions WHERE code = ? AND version = ?", [
      slug,
      want,
    ]);
    if (!v) return yield* new SketchNotFound({ what: `${slug} v${want}` });
    return { ...meta(r), shown: want, sketch: JSON.parse(str(v, "json")) as unknown };
  });

export const versions = (code: string) =>
  Effect.gen(function* () {
    const slug = slugOf(code);
    const current = num(yield* live(slug), "version");
    const db = yield* Db;
    return (yield* db.all(
      "SELECT version, created_at, created_by FROM sketch_versions WHERE code = ? ORDER BY version DESC",
      [slug],
    )).map((r) => ({
      version: num(r, "version"),
      live: num(r, "version") === current,
      createdAt: num(r, "created_at"),
      createdBy: str(r, "created_by"),
    }));
  });

/** 让某个版本成为对外的版本——上线一个暂存的版本，或者退回旧版本，是同一个动作；地址不变。 */
export const promote = (code: string, version: number, actor: string) =>
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

/**
 * 公开读：code + key 都对才给；对错同一种结果（null）。不带 version = 正在对外的版本（还没上线 = null）；
 * 带 version = 预览那一版（暂存的也行）——闸门仍是同一个 key。
 */
export const serve = (slug: string, key: string, version?: number) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const r = yield* db.first(
      "SELECT s.key AS key, s.deleted_at AS deleted_at, v.json AS json FROM sketches s JOIN sketch_versions v ON v.code = s.code AND v.version = COALESCE(?, s.version) WHERE s.code = ?",
      [version ?? null, slug],
    );
    if (!r || num(r, "deleted_at") > 0 || !sameKey(str(r, "key"), key)) return null;
    return str(r, "json");
  });
