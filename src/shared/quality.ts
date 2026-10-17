/**
 * 体检里“不算错、但多半是设计问题”的那一类：不拦发布，会出现在 warnings 里。
 * 它们都是在回答同一个问题——这份草图作为“客户要看的东西”靠不靠谱：
 * 字段有没有真的被展示、导航是不是太长、板块是不是重复、数据够不够演示、站是不是英文却没设 locale。
 * 引擎怎么渲染是引擎的事；这里只读 Sketch，纯函数。
 */
import { pagesOf } from "./derive.ts";
import { factFields } from "./facts.ts";
import type { Node, Sketch } from "./schema.ts";
import { matchesWhere } from "./where.ts";

const MAX_NAV = 7;
const MAX_FIELDS = 25;
const MIN_RECORDS = 4;
const MAX_SECTIONS = 9;
/** 看着像后台流程的字段名：出现在客户页上多半是漏标了 internal。 */
const BACK_OFFICE = /(verif|reviewer|reviewed|claim_status|approv|internal|workflow|last_checked)/i;

type Walk = (n: Node, ctxType: string | undefined, at: string) => void;

const walkNodes = (n: Node, ctxType: string | undefined, at: string, visit: Walk): void => {
  visit(n, ctxType, at);
  if ("group" in n) n.group.forEach((c, i) => walkNodes(c, ctxType, `${at}.group[${i}]`, visit));
};

const textsOf = (s: Sketch): string[] => {
  const out: string[] = [];
  const grab = (n: Node) => {
    if (!("group" in n) && "fill" in n && typeof n.fill === "string") out.push(n.fill);
  };
  const pages = pagesOf(s);
  for (const p of Object.values(pages)) {
    if (p.name) out.push(p.name);
    for (const b of p.body) walkNodes(b, undefined, "", grab);
  }
  walkNodes(s.header, undefined, "", grab);
  walkNodes(s.footer, undefined, "", grab);
  return out;
};

export const qualityWarnings = (s: Sketch): string[] => {
  const warnings: string[] = [];
  const warn = (at: string, m: string) => warnings.push(`${at}：${m}`);
  const pages = pagesOf(s);

  // ---- 字段：哪些从来没出现在任何客户页面上 ----
  const shown = new Map<string, Set<string>>();
  const mark = (type: string | undefined, field: string) => {
    if (!type) return;
    if (!shown.has(type)) shown.set(type, new Set());
    shown.get(type)!.add(field.split(".")[0]!);
  };
  const visitShown: Walk = (n, type) => {
    if ("group" in n) return;
    if (
      (n.slot === "text" || n.slot === "image" || n.slot === "action" || n.slot === "brand") &&
      n.fill &&
      typeof n.fill === "object"
    )
      mark(type, n.fill.bind);
    if (n.slot === "badges" || n.slot === "gallery") mark(type, n.field);
    if (n.slot === "filters") for (const f of n.fields) mark(type, f);
    if (n.slot === "facts" && type) for (const f of factFields(s, type, n)) mark(type, f);
  };
  for (const [pattern, page] of Object.entries(pages)) {
    const c = page.ctx;
    const type = c && !c.many && !c.create ? c.type : undefined;
    page.body.forEach((b, i) => walkNodes(b, type, `pages["${pattern}"].body[${i}]`, visitShown));
  }
  for (const [t, def] of Object.entries(s.model)) {
    if (def.card) walkNodes(def.card, t, `model.${t}.card`, visitShown);
    // 列表里的集合卡片（没写 card 时是 图 + 显示名）也算展示了显示名
    mark(t, def.title ?? def.key);
    mark(t, def.key);
  }

  const never: string[] = [];
  for (const [t, def] of Object.entries(s.model)) {
    if (def.vocab || def.public) continue;
    const hidden = Object.entries(def.fields)
      .filter(([n, fd]) => fd.internal !== true && !shown.get(t)?.has(n))
      .map(([n]) => n);
    if (hidden.length)
      never.push(
        `${t}：${hidden.slice(0, 8).join("、")}${hidden.length > 8 ? ` 等 ${hidden.length} 个` : ""}`,
      );
  }
  if (never.length)
    warn(
      "model",
      `这些字段在任何客户页面上都没出现过（要么加进页面，要么是只给后台的，标 internal: true；没人看的字段不用建）——${never.join("；")}`,
    );

  // ---- 后台味的字段名出现在了客户页上 ----
  for (const [t, def] of Object.entries(s.model)) {
    if (def.vocab || def.public) continue;
    for (const [n, fd] of Object.entries(def.fields))
      if (fd.internal !== true && BACK_OFFICE.test(n) && shown.get(t)?.has(n))
        warn(
          `model.${t}.fields.${n}`,
          "名字像后台流程字段（审核/核实状态之类），却会出现在客户页面上——只给后台的标 internal: true",
        );
  }

  // ---- 模型体量 ----
  for (const [t, def] of Object.entries(s.model)) {
    const n = Object.keys(def.fields).length;
    if (!def.vocab && n > MAX_FIELDS)
      warn(
        `model.${t}`,
        `${n} 个字段（>${MAX_FIELDS}）：很多多半是一段一段的文字——那是页面板块里的内容，不是数据结构；结构草图只建“要筛选、要列表、要关联”的字段`,
      );
    if (!def.vocab && !def.public && def.seed.length < MIN_RECORDS)
      warn(
        `model.${t}.seed`,
        `只有 ${def.seed.length} 条记录（<${MIN_RECORDS}）：列表、筛选、“相关”这类板块演示不出来`,
      );
  }

  // ---- 页面 ----
  for (const [pattern, page] of Object.entries(pages)) {
    const at = `pages["${pattern}"]`;
    if (page.body.length > MAX_SECTIONS)
      warn(
        at,
        `${page.body.length} 个顶层板块（>${MAX_SECTIONS}）：一页塞这么多，多半有重复或可以并到别的页面`,
      );
    const c = page.ctx;
    const type = c && !c.many && !c.create ? c.type : undefined;
    if (!type) continue;
    // 同一页里两个 facts 显示完全一样的字段 = 重复板块
    const seen = new Map<string, string>();
    page.body.forEach((b, i) =>
      walkNodes(b, type, `${at}.body[${i}]`, (n, _t, where) => {
        if ("group" in n || n.slot !== "facts") return;
        const key = factFields(s, type, n).join("|");
        if (!key) return;
        const prev = seen.get(key);
        if (prev)
          warn(where, `和 ${prev} 的 facts 显示完全相同的字段：用 only 把字段分给不同的板块`);
        else seen.set(key, where);
      }),
    );
    // 详情页里没有 where 的集合：显示的是“所有”，不是“相关的”
    page.body.forEach((b, i) =>
      walkNodes(b, type, `${at}.body[${i}]`, (n, _t, where) => {
        if ("group" in n || n.slot !== "collection") return;
        if (n.where && Object.values(n.where).some((v) => v.startsWith("$"))) {
          // 关系查询在每一条种子记录上都查不到东西 = 这个板块在演示里永远是空的：种子要让相关的记录真的互相关联
          const own = s.model[type]!;
          const target = s.model[n.type];
          const visible = (r: Record<string, unknown>) =>
            !Object.entries(target?.unlisted ?? {}).some(([f, v]) => r[f] === v);
          if (target && own.seed.length > 0) {
            const hits = own.seed.map(
              (rec) =>
                target.seed.filter(
                  (r) =>
                    visible(r) &&
                    matchesWhere(r, n.where, { params: {}, record: rec }) &&
                    !(n.notSelf && n.type === type && r[own.key] === rec[own.key]),
                ).length,
            );
            if (hits.every((h) => h === 0))
              warn(
                where,
                `${n.type} 集合的 where 在每一条 ${type} 种子记录上都查不到记录：这个板块演示时永远是空的——种子里要让相关的记录真的互相关联（每个分组至少两条）`,
              );
          }
        }
        if (!n.where)
          warn(
            where,
            `详情页里的 ${n.type} 集合没有 where：显示的是所有记录，不是“相关的”——用 where 指向关系字段（ref / term）`,
          );
      }),
    );
  }

  // ---- 页眉 ----
  walkNodes(s.header, undefined, "header", (n, _t, where) => {
    if (!("group" in n) && n.slot === "nav" && n.paths.length > MAX_NAV)
      warn(
        where,
        `导航有 ${n.paths.length} 项（>${MAX_NAV}）：引擎会把它收进菜单，但这说明信息架构该合并或分组了`,
      );
  });
  const firstLeaf = (n: Node): Node => ("group" in n && n.group[0] ? firstLeaf(n.group[0]) : n);
  const lead = firstLeaf(s.header);
  if (!("group" in lead) && lead.slot === "action" && lead.to === "/")
    warn(
      "header",
      '页眉第一个东西是回首页的 action：它会渲染成一个按钮。logo/字标用 brand()（或 image("LOGO")）',
    );

  // ---- 语言 ----
  if (s.locale === undefined) {
    const letters = textsOf(s).join("");
    const cjk = (letters.match(/[一-鿿]/g) ?? []).length;
    const latin = (letters.match(/[A-Za-z]/g) ?? []).length;
    if (latin >= 60 && cjk * 10 < latin)
      warn(
        "locale",
        '文案基本是英文，但没设 locale: "en"：面包屑、空状态、菜单这些引擎自带的文案会是中文',
      );
  }
  return warnings;
};
