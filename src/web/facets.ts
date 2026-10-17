/**
 * 筛选（facet）：由模型字段推出来——term/choice/bool 字段天然是“有限个值里选”。
 * 一个事实一处：客户页的 filters 槽和模型视图的表格共用这里，选择状态只存在地址的 ?query 里（可分享、可回退、验证器能直接点）。
 * 语义：同一字段内多选 = 并集，不同字段之间 = 交集；选项旁的数字 = “在其余条件都满足的前提下，再选它会剩几个”。
 */
import type { Db } from "./db.ts";
import { keyOf, titleFieldOf } from "../shared/derive.ts";
import { asOption, esc } from "./fmt.ts";
import type { Row, Sketch } from "../shared/schema.ts";
import { scalar } from "../shared/scalar.ts";

export type Sel = Record<string, string[]>;

export const parseQuery = (qs: string): Sel => {
  const out: Sel = {};
  for (const [k, v] of new URLSearchParams(qs)) out[k] = v.split(",").filter(Boolean);
  return out;
};

/** 只序列化 keep 里的键（别的键，如搜索词、页码，由调用方自己拼）。 */
export const toQuery = (sel: Sel, keep: ReadonlyArray<string>): string =>
  keep
    .filter((k) => sel[k]?.length)
    .map((k) => `${k}=${sel[k]!.map(encodeURIComponent).join(",")}`)
    .join("&");

const has = (r: Row, field: string, v: string) =>
  Array.isArray(r[field])
    ? (r[field] as unknown[]).map(String).includes(v)
    : scalar(r[field]) === v;
const hit = (r: Row, field: string, vals: string[]) =>
  vals.length === 0 || vals.some((v) => has(r, field, v));

export const applySel = (
  rows: Row[],
  sel: Sel,
  fields: ReadonlyArray<string>,
  except?: string,
): Row[] => rows.filter((r) => fields.every((f) => f === except || hit(r, f, sel[f] ?? [])));

export type Facet = {
  field: string;
  label: string;
  options: Array<{ value: string; label: string; count: number; on: boolean }>;
};

const optionsOf = (
  s: Sketch,
  db: Db,
  type: string,
  field: string,
): Array<{ value: string; label: string }> => {
  const fd = s.model[type]!.fields[field]!;
  if (fd.kind === "term")
    return db.all(fd.to!).map((r) => ({
      value: String(r[keyOf(s, fd.to!)]),
      label: scalar(r[titleFieldOf(s, fd.to!)]),
    }));
  if (fd.kind === "choice") return (fd.options ?? []).map(asOption).filter((o) => o.value !== "");
  return [
    { value: "true", label: "是" },
    { value: "false", label: "否" },
  ];
};

/** base = 这个列表在不加任何筛选时的全部记录。选项一个都没有区分度（不足两个有记录的值）的字段不出现——没得选就别摆。 */
export const facetsOf = (
  s: Sketch,
  db: Db,
  type: string,
  fields: ReadonlyArray<string>,
  base: Row[],
  sel: Sel,
): Facet[] =>
  fields.flatMap((field) => {
    const others = applySel(base, sel, fields, field);
    const options = optionsOf(s, db, type, field)
      .filter((o) => base.some((r) => has(r, field, o.value)))
      .map((o) => ({
        ...o,
        count: others.filter((r) => has(r, field, o.value)).length,
        on: (sel[field] ?? []).includes(o.value),
      }));
    return options.length >= 2
      ? [{ field, label: s.model[type]!.fields[field]!.label, options }]
      : [];
  });

export const toggled = (sel: Sel, field: string, value: string): Sel => {
  const cur = sel[field] ?? [];
  return {
    ...sel,
    [field]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
  };
};

/** 渲染。href 由调用方给（地址怎么拼是页面的事）；words=false 时选项文字画成线条。 */
export const facetHtml = (
  facets: Facet[],
  sel: Sel,
  o: { variant: "side" | "bar"; words: boolean; seed: () => number; href: (next: Sel) => string },
): string => {
  const any = Object.values(sel).some((v) => v.length);
  const groups = facets
    .map((f) => {
      const opts = f.options
        .map((op) => {
          const label = o.words
            ? `<span data-copy>${esc(op.label)} <i>${op.count}</i></span>`
            : `<span class="sq in" data-rough="sq" data-seed="${o.seed()}" data-lines="100" data-t="2.5" style="width:46px;height:12px"></span>`;
          return `<a class="opt${op.on ? " on" : ""}${op.count === 0 && !op.on ? " dim" : ""}" href="${esc(o.href(toggled(sel, f.field, op.value)))}"><span class="cb" data-rough="frame" data-seed="${o.seed()}"></span>${label}</a>`;
        })
        .join("");
      return `<div class="facet"><div class="fh">${esc(f.label)}</div><div class="opts">${opts}</div></div>`;
    })
    .join("");
  const clear = any
    ? `<a class="clear" href="${esc(o.href(Object.fromEntries(Object.keys(sel).map((k) => [k, []]))))}">清除筛选</a>`
    : "";
  return `<div class="facets ${o.variant}" data-facets>${groups}${clear}</div>`;
};
