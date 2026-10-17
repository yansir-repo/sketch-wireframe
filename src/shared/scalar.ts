/**
 * 记录里的值是 unknown（JSON）。要把它当文字用时，只有一种说法：null/undefined → ""，标量 → 字符串，其余（对象/数组）→ JSON。
 * 一处定义，所以“[object Object]”不可能再出现在页面上。
 */
export const scalar = (v: unknown): string =>
  v == null
    ? ""
    : typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean" || typeof v === "bigint"
        ? String(v)
        : JSON.stringify(v);
