/** 客户意见的共用部分（Worker 收、浏览器发，说的是同一件事）：上限和页面地址的写法。纯函数。 */

export const MAX_NOTE_CHARS = 2000;

/** 地址里的 `#/a/b?x=1` → `/a/b`（意见记在页面地址上，不带筛选参数）。 */
export const pathOf = (raw: string): string => {
  const p = raw.replace(/^#/, "").split("?")[0]!.trim();
  return p === "" ? "/" : p.startsWith("/") ? p : `/${p}`;
};
