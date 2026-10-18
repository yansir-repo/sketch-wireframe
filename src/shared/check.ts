/**
 * 一份草图能不能发布，只有一个判断：结构（Schema）→ 语义（validate）→ 质量（quality）→ 红线（redlines）。
 * validate 只回答“引擎渲染得了吗”（浏览器里也跑它）；质量与红线只在这里，所以新规则不会让线上存量草图白屏。
 * CLI、MCP 的 check_sketch、发布时的服务端都调这一个函数，所以三处的结论不会不一样。
 */
import { parseSketch } from "./parse.ts";
import type { Sketch } from "./schema.ts";
import { withoutNotes } from "./notes.ts";
import { quality } from "./quality.ts";
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
  // 结构都不对时，质量问题没有意义
  const gate = semantic.errors.length === 0 ? quality(sketch) : { errors: [], warnings: [] };
  // 红线（价格、密钥）扫整份——批注也在客户拿到的字节里；占位说明只扫文案，批注本来就是说明
  const copyRule = "placeholder-copy";
  const red = [
    ...scanText(JSON.stringify(sketch)).filter((f) => f.rule !== copyRule),
    ...scanText(JSON.stringify(withoutNotes(sketch))).filter((f) => f.rule === copyRule),
  ];
  const errors = [
    ...semantic.errors,
    ...gate.errors,
    ...red.filter((f) => f.level === "error").map((f) => `红线[${f.rule}] ${f.message}`),
  ];
  // 同一句话重复几十遍（每条种子都命中）没有信息量：去重。
  const warnings = [
    ...new Set([
      ...semantic.warnings,
      ...gate.warnings,
      ...red.filter((f) => f.level === "warn").map((f) => `[${f.rule}] ${f.message}`),
    ]),
  ];
  return { ok: errors.length === 0, errors, warnings, sketch };
};
