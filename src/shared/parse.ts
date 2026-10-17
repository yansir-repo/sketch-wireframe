/**
 * 边界：JSON → Sketch。旧格式（v:1）先升级成 2，再过 Schema（多余的键、缺的键、写错的类型都在这里挡掉）。
 */
import { Schema } from "effect";
import { migrateSketch } from "./migrate.ts";
import { Sketch } from "./schema.ts";

const decode = Schema.decodeUnknownResult(Sketch, { onExcessProperty: "error" });

/** 发布/加载的入口。失败返回人能读的行。 */
export const parseSketch = (
  input: unknown,
): { ok: true; sketch: Sketch } | { ok: false; errors: string[] } => {
  const r = decode(migrateSketch(input));
  if (r._tag === "Success") return { ok: true, sketch: r.success };
  return {
    ok: false,
    errors: [
      String(r.failure)
        .replace(/^SchemaError\(/, "")
        .replace(/\)$/, "")
        .split("\n")
        .slice(0, 16)
        .join("\n"),
    ],
  };
};

/** JSON Schema，给 get_schema 用。 */
export const sketchJsonSchema = (): unknown => Schema.toJsonSchemaDocument(Sketch);
