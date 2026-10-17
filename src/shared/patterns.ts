/**
 * 模式：常见网站结构的命名组合。**不是语言的一部分**——每一个都只是 builders.ts 里几行的组合，展开后是普通的节点树
 * （体检、验证、质量规则看到的就是展开后的树），所以 schema 和格式版本都不动。
 *
 * 准入：只有当至少两个站点手写了同一个结构，才抽成模式（别为“可能有用”造模式）。目前的来源：MZ-007、trial-apparel、catalog。
 * 模式不替作者写文案：不给的文字就是波浪线；板块的名字（标注）由调用方用 `section("名字", …)` 给。
 * 状态参数的名字是约定的：`sort`、`q`、`page`（和类型的字段重名时体检会报，那就别用这个模式的那一项）。
 */
import {
  brand,
  col,
  collection,
  each,
  filters,
  form,
  free,
  image,
  nav,
  oneOf,
  pager,
  records,
  row,
  search,
  section,
  sortMenu,
  span,
  text,
} from "./builders.ts";
import type { Fill, Group, Node, Page } from "./schema.ts";

/** 左边一段文案、右边一个东西（默认是图片占位）：`row(col(...文案), 右边)`。 */
export const split = (copy: Node[], side: Node = image()): Group => row(col(...copy), side);

/** 首屏：标题、副标题、一组按钮，右边是图。不给的文字是波浪线。 */
export const hero = (o: { title?: Fill; sub?: Fill; actions?: Node[]; side?: Node } = {}): Group =>
  split(
    [text(1, o.title), text(2, o.sub), ...(o.actions?.length ? [row(...o.actions)] : [])],
    o.side,
  );

/** 行动号召：一句话（可不写）+ 一组按钮，一行。 */
export const cta = (o: { text?: Fill; actions: Node[] }): Group =>
  row(...(o.text === undefined ? [] : [text(2, o.text)]), ...o.actions);

/**
 * 几列并排的要点：每列 = （图）+ 小标题 + 正文。`title` / `body` 写 `false` = 这一列没有这一项；不写 = 波浪线。
 * 对比三项、信任背书、应用场景、服务特色都是它。
 */
export type Feature = { title?: Fill | false; body?: Fill | false; image?: boolean };
export const featureCols = (...items: Feature[]): Group =>
  row(
    ...items.map((i) =>
      col(
        ...(i.image ? [image()] : []),
        ...(i.title === false ? [] : [text(2, i.title)]),
        ...(i.body === false ? [] : [text(3, i.body)]),
      ),
    ),
  );

/** “相关的”：和当前记录在 `by` 字段上相同的同类记录（不含自己）。只能放在这个类型的详情页里。 */
export const related = (type: string, by: string, limit = 4): Node =>
  collection(type, { where: { [by]: `$${by}` }, notSelf: true, limit });

/** 页眉：品牌 + 导航 + 右边的一组按钮（通常是主行动）。 */
export const siteHeader = (o: { brand?: Fill; nav: string[]; actions?: Node[] }): Group =>
  row(brand(o.brand), nav(...o.nav), ...(o.actions ?? []));

/**
 * 列表页：左边筛选，右边“搜索 + 排序 + 记录卡片 + 页码”——把筛选、排序、搜索、分页的状态参数声明和接线一次写好。
 *   filters  左栏的筛选字段（不写 = 没有左栏）          sort    排序菜单 [[值, 显示名]]，值是 order 的写法（"-date"）；order = 写死的排序
 *   search   true = 有搜索框                            per     每页几条（默认 12）
 *   where    只列这一类（同时写进页面的 ctx，如 `{category: ":id"}`）
 *   before / after  板块前后再加的板块（如分类页顶部的概览）
 */
export const listPage = (
  type: string,
  o: {
    name?: string;
    title: string;
    where?: Record<string, string>;
    filters?: string[];
    search?: boolean;
    sort?: Array<[value: string, label: string]>;
    /** 写死的排序（"-published"）；和 sort 二选一。 */
    order?: string;
    per?: number;
    before?: Node[];
    after?: Node[];
  },
): Page => {
  const list = records(type, {
    ...(o.where ? { where: o.where } : {}),
    limit: o.per ?? 12,
    ...(o.sort ? { order: { param: "sort" } } : o.order ? { order: o.order } : {}),
    ...(o.search ? { search: { param: "q" } } : {}),
    page: { param: "page" },
  });
  const bar = [...(o.search ? [search("q")] : []), ...(o.sort ? [sortMenu("sort", o.sort)] : [])];
  const main = col(
    ...(bar.length ? [row(...bar)] : []),
    each(list, undefined, { dir: "grid" }),
    pager(list),
  );
  return {
    ...(o.name ? { name: o.name } : {}),
    ctx: { type, many: true, ...(o.where ? { where: o.where } : {}) },
    state: {
      ...(o.sort ? { sort: oneOf(o.sort.map(([v]) => v)) } : {}),
      ...(o.search ? { q: free() } : {}),
      page: free("1"),
    },
    body: [
      ...(o.before ?? []),
      section(
        o.title,
        o.filters?.length ? row(span(1, filters(...o.filters)), span(3, main)) : main,
      ),
      ...(o.after ?? []),
    ],
  };
};

/** 表单页：“新增某类型”（询盘、报名）——一个带名字的板块里放表单；`before` / `after` 是前后再加的板块。 */
export const formPage = (
  type: string,
  o: { name?: string; title: string; before?: Node[]; after?: Node[] },
): Page => ({
  ...(o.name ? { name: o.name } : {}),
  ctx: { type, create: true },
  body: [...(o.before ?? []), section(o.title, form()), ...(o.after ?? [])],
});
