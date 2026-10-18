/**
 * 批注（Group / Each / Page 的 note）：写给后续开发者的话，不是客户要读的文案。
 * 所以“文案该有的检查”（占位说明、线条档零文案）不看它；运营视图把它们列出来。
 * 但它仍在草图 JSON 里、客户的浏览器拿得到——价格、密钥这类红线照扫。
 */
import { pagesOf } from "./derive.ts";
import type { Node, Sketch } from "./schema.ts";

export type Note = { readonly at: string; readonly note: string };

const isNode = (x: unknown): x is Node =>
  typeof x === "object" && x !== null && ("group" in x || "each" in x);

/** 草图里所有的批注，带着它在哪（页面路由 + 板块名）。 */
export const notesOf = (s: Sketch): Note[] => {
  const out: Note[] = [];
  const walk = (n: Node, at: string): void => {
    if (!("group" in n) && !("each" in n)) return; // 叶子没有批注
    const label = n.name ? `${at} › ${n.name}` : at;
    if (n.note) out.push({ at: label, note: n.note });
    if ("group" in n) n.group.forEach((c) => walk(c, label));
    else if (n.item) walk(n.item, label);
  };
  for (const [route, p] of Object.entries(pagesOf(s))) {
    if (p.note) out.push({ at: route, note: p.note });
    p.body.forEach((b) => walk(b, route));
  }
  walk(s.header, "header");
  walk(s.footer, "footer");
  return out;
};

/** 去掉批注后的草图（供“文案”类检查扫描）：只动节点和页面上的 note，字段值里叫 note 的东西不碰。 */
export const withoutNotes = (s: Sketch): unknown => {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (typeof x !== "object" || x === null) return x;
    const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, strip(v)]));
    if (isNode(x)) delete o["note"];
    return o;
  };
  const out = strip(s) as { pages?: Record<string, Record<string, unknown>> };
  for (const p of Object.values(out.pages ?? {})) delete p["note"];
  return out;
};
