/**
 * 边界：JSON → Sketch。过 Schema：多余的键、缺的键、写错的类型都在这里挡掉。
 */
import { Schema } from "effect";
import { NodeSchema, Sketch, type Node } from "./schema.ts";

const decode = Schema.decodeUnknownResult(Sketch, { onExcessProperty: "error" });

/** 发布/加载的入口。失败返回人能读的行。 */
export const parseSketch = (
  input: unknown,
): { ok: true; sketch: Sketch } | { ok: false; errors: string[] } => {
  const r = decode(input);
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

const decodeNodes = Schema.decodeUnknownResult(Schema.Array(NodeSchema), {
  onExcessProperty: "error",
});

/** 一个 blocks 字段里存的树：必须是一串合法的节点（和页面同一份 Schema）。 */
export const parseNodes = (
  input: unknown,
): { ok: true; nodes: ReadonlyArray<Node> } | { ok: false; error: string } => {
  const r = decodeNodes(input);
  return r._tag === "Success"
    ? { ok: true, nodes: r.success }
    : {
        ok: false,
        error: String(r.failure)
          .replace(/^SchemaError\(/, "")
          .replace(/\)$/, "")
          .split("\n")
          .slice(0, 4)
          .join(" "),
      };
};
