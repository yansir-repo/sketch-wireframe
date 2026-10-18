/**
 * 集合的 where：值是 ":参数"（路由参数）、"$字段"（当前记录的字段）或字面量。
 * 两边都可能是多值（数组）：匹配的意思是“有交集”——候选记录的字段是数组，按“包含”；
 * 当前记录的字段是数组（正向的 ref/term 多选），候选记录的字段（单值或数组）与它有交集即可。
 * 引擎查询（web/db.ts）和体检（“这个集合在每条种子记录上都是空的”）问的是同一个问题，答案只在这里。
 */
import type { Row } from "./schema.ts";
import { scalar } from "./scalar.ts";

export type WhereScope = { params: Record<string, string>; record?: Row };

const wanted = (v: string, scope: WhereScope): ReadonlyArray<string> => {
  if (v.startsWith(":")) return [scope.params[v.slice(1)] ?? ""];
  if (v.startsWith("$")) {
    const x = scope.record?.[v.slice(1)];
    return Array.isArray(x) ? x.map(scalar) : [scalar(x)];
  }
  return [v];
};

export const matchesWhere = (
  r: Row,
  where: Readonly<Record<string, string>> | undefined,
  scope: WhereScope,
): boolean =>
  Object.entries(where ?? {}).every(([field, v]) => {
    const want = wanted(v, scope);
    const have = Array.isArray(r[field]) ? (r[field] as unknown[]).map(scalar) : [scalar(r[field])];
    return have.some((h) => want.includes(h));
  });
