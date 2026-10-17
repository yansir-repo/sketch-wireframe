/**
 * 一份草图能不能发布，只有一个判断：结构（Schema）→ 语义（validate）→ 红线（redlines）。
 * CLI、MCP 的 check_sketch、发布时的服务端都调这一个函数，所以三处的结论不会不一样。
 */
import { parseSketch, type Sketch } from "./schema.ts";
import { scanText } from "./redlines.ts";
import { validate } from "./validate.ts";

export type Report = {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly sketch?: Sketch;
};

export const checkSketch = (input: unknown): Report => {
  const parsed = parseSketch(input);
  if (!parsed.ok)
    return { ok: false, errors: parsed.errors.map((e) => `结构：${e}`), warnings: [] };
  const sketch = parsed.sketch;
  const semantic = validate(sketch);
  const red = scanText(JSON.stringify(sketch));
  const errors = [
    ...semantic.errors,
    ...red.filter((f) => f.level === "error").map((f) => `红线[${f.rule}] ${f.message}`),
  ];
  const warnings = [
    ...semantic.warnings,
    ...red.filter((f) => f.level === "warn").map((f) => `[${f.rule}] ${f.message}`),
  ];
  return { ok: errors.length === 0, errors, warnings, sketch };
};
