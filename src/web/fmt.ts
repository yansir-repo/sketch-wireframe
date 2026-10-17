/** 把记录里的值变成给人看的字符串：term 查词表名称，choice 查选项名称——存的是 id，显示的是名称。 */
import type { Field, Option, Row, Sketch } from "../shared/schema.ts";
import type { Db } from "./db.ts";
import { scalar } from "../shared/scalar.ts";

export const esc = (s: unknown): string =>
  scalar(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** 空值：没填。choice 里“未填写”这种选项的 value 是空串，显示成文字不等于它有值——判空看原始值，不看显示出来的字。 */
export const isEmpty = (v: unknown): boolean =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

export const asOption = (o: Option): { value: string; label: string } =>
  typeof o === "string" ? { value: o, label: o } : o;

export const titleField = (s: Sketch, type: string) => s.model[type]!.title ?? s.model[type]!.key;

export const recordTitle = (s: Sketch, db: Db, type: string, r: Row): string =>
  display(s, db, type, r, titleField(s, type));

export const vocabLabel = (s: Sketch, db: Db, vocab: string, id: string): string => {
  const hit = db.find(vocab, id);
  return hit ? scalar(hit[titleField(s, vocab)] ?? id) : id;
};

export const display = (s: Sketch, db: Db, type: string, r: Row, name: string): string => {
  const fd: Field | undefined = s.model[type]?.fields[name];
  const v = r[name];
  if (!fd) return scalar(v);
  switch (fd.kind) {
    case "term": {
      const ids = (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String);
      return ids.map((id) => vocabLabel(s, db, fd.to!, id)).join(" / ");
    }
    case "choice": {
      const hit = (fd.options ?? []).map(asOption).find((o) => o.value === scalar(v));
      return hit ? hit.label : scalar(v);
    }
    case "bool":
      return v ? "是" : "否";
    case "media":
      return Array.isArray(v) && v.length ? `${v.length} 张` : "";
    case "list":
      return Array.isArray(v) && v.length ? `${v.length} 行` : "";
    default:
      return scalar(v);
  }
};
