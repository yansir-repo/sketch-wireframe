/**
 * 排序与分页的算术：一个值怎么比大小、分几页。引擎（客户页、后台表格）问这里，别处不另写（“空值排最后”“页码越界停在最后一页”只在这里定一次）。
 * 数字按数值比；其余（文字、日期 ISO、choice/term 的显示名）按文字比；空的永远排最后，不管升降。
 */
import type { FieldKind } from "./schema.ts";

export type SortKey = number | string | null;

export const sortKey = (kind: FieldKind, raw: unknown, shown: string): SortKey => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (kind === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return shown === "" ? null : shown;
};

/** 分页：共几页（至少 1 页），和“第几页”（不是正整数当第 1 页，超出停在最后一页——搜索词一变页数就变了）。 */
export const pageCount = (count: number, per: number): number =>
  Math.max(1, Math.ceil(count / per));
export const clampPage = (raw: unknown, total: number): number => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, total) : 1;
};

export const compareKeys = (a: SortKey, b: SortKey, desc: boolean): number => {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const c =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true });
  return desc ? -c : c;
};
