/**
 * facts 槽到底显示哪些字段：引擎渲染和体检（“哪些字段从来没出现在任何页面上”）问的是同一个问题，答案只在这里。
 *  - only：只要这些，按这个顺序（internal 和 media 不会出现——图片走 gallery/image，后台字段不给客户看）；
 *  - 否则：除主键、显示名、媒体、detail:false、internal、skip 之外的全部字段。
 */
import type { Sketch } from "./schema.ts";

/**
 * 搜索框在一条记录的哪些字段里找：客户看得到、属于这条记录自己的文字（text/choice/term/number/date；ref 指向别的内容，搜它会把“相关型号”的名字当成这条的；不含 internal、不含只当主键用的字段）。
 * 引擎的匹配和体检（“这个类型没有可搜的字段”）问同一个问题，答案只在这里。
 */
export const SEARCHABLE_KINDS = ["text", "choice", "term", "number", "date"];
export const searchFields = (s: Sketch, type: string): string[] => {
  const def = s.model[type];
  if (!def) return [];
  const title = def.title ?? def.key;
  return Object.entries(def.fields)
    .filter(
      ([n, fd]) =>
        SEARCHABLE_KINDS.includes(fd.kind) &&
        fd.internal !== true &&
        (n !== def.key || n === title),
    )
    .map(([n]) => n);
};

/** 一个 order 值的字段名和方向：“-date” = date 倒序。 */
export const parseOrder = (o: string): { field: string; desc: boolean } =>
  o.startsWith("-") ? { field: o.slice(1), desc: true } : { field: o, desc: false };

/** 能当排序依据的字段：有大小可比的标量（不含图片、列表、树、internal）。 */
export const sortable = (s: Sketch, type: string, field: string): boolean => {
  const fd = s.model[type]?.fields[field];
  return fd !== undefined && fd.internal !== true && !["media", "list", "blocks"].includes(fd.kind);
};

export const factFields = (
  s: Sketch,
  type: string,
  opts: { readonly skip?: ReadonlyArray<string>; readonly only?: ReadonlyArray<string> } = {},
): string[] => {
  const def = s.model[type];
  if (!def) return [];
  const title = def.title ?? def.key;
  if (opts.only)
    return opts.only.filter((n) => {
      const fd = def.fields[n];
      return (
        fd !== undefined && fd.kind !== "media" && fd.kind !== "blocks" && fd.internal !== true
      );
    });
  return Object.entries(def.fields)
    .filter(
      ([n, fd]) =>
        n !== def.key &&
        n !== title &&
        fd.kind !== "media" &&
        fd.kind !== "blocks" &&
        fd.detail !== false &&
        fd.internal !== true &&
        !(opts.skip ?? []).includes(n),
    )
    .map(([n]) => n);
};
