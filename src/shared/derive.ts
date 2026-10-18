/**
 * 页面是模型的影子：每个类型自动得到列表页、详情页（或公开的新增表单页），词表得到“按条目筛选”的页，
 * 作者只写偏离默认的部分（首页这类无法推出的单例页，以及想换排布的模板）。
 * 纯函数、不碰 DOM：浏览器里的引擎和 Node 里的 check/verify 用同一份推导。
 */
import {
  badges,
  bind,
  collection,
  embed,
  facts,
  form,
  gallery,
  section,
  text,
} from "./builders.ts";
import { factFields } from "./facts.ts";
import type { Node, Page, Sketch } from "./schema.ts";

export const keyOf = (s: Sketch, type: string) => s.model[type]!.key;
export const titleFieldOf = (s: Sketch, type: string) => s.model[type]!.title ?? s.model[type]!.key;

/** 引用某个词表的 (类型, 字段)：词表条目页要列出“用到它的记录”。 */
export const referrersOf = (s: Sketch, vocabType: string) =>
  Object.entries(s.model).flatMap(([t, def]) =>
    Object.entries(def.fields)
      .filter(([, fd]) => fd.kind === "term" && fd.to === vocabType)
      .map(([field]) => ({ type: t, field })),
  );

const defaultDetail = (s: Sketch, type: string): Node[] => {
  const def = s.model[type]!;
  const body: Node[] = [];
  const media = Object.entries(def.fields).find(([, fd]) => fd.kind === "media");
  if (media) body.push(section("图库", gallery(media[0])));
  // 没有能列的字段（比如只有标题和一个正文树）就只放标题，不放一个空的字段表
  body.push(
    section(
      "基本信息",
      text(1, bind(titleFieldOf(s, type))),
      ...(factFields(s, type).length ? [facts()] : []),
    ),
  );
  for (const [name, fd] of Object.entries(def.fields)) {
    if (fd.kind === "term" && fd.multiple && fd.detail === false)
      body.push(section(fd.label, badges(name)));
    // 内容是一棵树的字段（文章正文）：详情页自己渲染它
    if (fd.kind === "blocks" && fd.internal !== true)
      body.push(section(fd.label, embed(bind(name))));
  }
  return body;
};

export const pagesOf = (s: Sketch): Record<string, Page & { derived?: boolean }> => {
  const out: Record<string, Page & { derived?: boolean }> = {};
  for (const [type, def] of Object.entries(s.model)) {
    if (def.vocab) {
      // 被 term 字段引用的词表有自己的条目页（单值、多值都一样：where 对数组字段按“包含”匹配）；
      // 一个词表被几个字段引用时，单值优先（一条记录属于一类），其余按模型顺序
      const refs = referrersOf(s, type);
      const ref = refs.find((r) => !s.model[r.type]!.fields[r.field]!.multiple) ?? refs[0];
      if (ref) {
        out[`/${type}`] = {
          name: def.label,
          ctx: null,
          body: [section(def.label, collection(type, { limit: 24 }))],
          derived: true,
        };
        out[`/${type}/:id`] = {
          name: def.label,
          ctx: { type: ref.type, many: true, where: { [ref.field]: ":id" } },
          body: [
            section(
              s.model[ref.type]!.label,
              collection(ref.type, { where: { [ref.field]: ":id" }, limit: 24 }),
            ),
          ],
          derived: true,
        };
      }
    } else if (def.public) {
      out[`/${type}`] = {
        name: def.label,
        ctx: { type, create: true },
        body: [section(def.label, form())],
        derived: true,
      };
    } else {
      out[`/${type}`] = {
        name: def.label,
        ctx: { type, many: true },
        body: [section(def.label, collection(type, { limit: 24 }))],
        derived: true,
      };
      out[`/${type}/:id`] = {
        name: def.label,
        ctx: { type },
        body: defaultDetail(s, type),
        derived: true,
      };
    }
  }
  for (const [pattern, page] of Object.entries(s.pages)) out[pattern] = page; // 同名路由 = 覆盖
  return out;
};

export type Params = Record<string, string>;
export const matchRoute = (
  patterns: string[],
  path: string,
): { pattern: string; params: Params } | null => {
  const segs = path.split("/").filter(Boolean);
  let best: { pattern: string; params: Params; score: number } | null = null;
  for (const pattern of patterns) {
    const ps = pattern.split("/").filter(Boolean);
    if (ps.length !== segs.length) continue;
    const params: Params = {};
    let score = 0;
    let ok = true;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i]!.startsWith(":")) params[ps[i]!.slice(1)] = decodeURIComponent(segs[i]!);
      else if (ps[i] === segs[i]) score++;
      else {
        ok = false;
        break;
      }
    }
    if (ok && (!best || score > best.score)) best = { pattern, params, score };
  }
  return best && { pattern: best.pattern, params: best.params };
};
