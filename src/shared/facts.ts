/**
 * facts 槽到底显示哪些字段：引擎渲染和体检（“哪些字段从来没出现在任何页面上”）问的是同一个问题，答案只在这里。
 *  - only：只要这些，按这个顺序（internal 和 media 不会出现——图片走 gallery/image，后台字段不给客户看）；
 *  - 否则：除主键、显示名、媒体、detail:false、internal、skip 之外的全部字段。
 */
import type { Sketch } from "./schema.ts";

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
