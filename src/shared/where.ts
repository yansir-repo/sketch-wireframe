/**
 * 集合的 where：值是 ":参数"（路由参数）、"$字段"（当前记录的字段）或字面量；数组字段按“包含”匹配。
 * 引擎查询（web/db.ts）和体检（“这个集合在每条种子记录上都是空的”）问的是同一个问题，答案只在这里。
 */
import type { Row } from "./schema.ts";
import { scalar } from "./scalar.ts";

export type WhereScope = { params: Record<string, string>; record?: Row };

export const matchesWhere = (
  r: Row,
  where: Readonly<Record<string, string>> | undefined,
  scope: WhereScope,
): boolean =>
  Object.entries(where ?? {}).every(([field, v]) => {
    const want = v.startsWith(":")
      ? (scope.params[v.slice(1)] ?? "")
      : v.startsWith("$")
        ? scalar(scope.record?.[v.slice(1)])
        : v;
    return Array.isArray(r[field])
      ? (r[field] as unknown[]).map(scalar).includes(want)
      : scalar(r[field]) === want;
  });
