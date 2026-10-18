/**
 * 发布闸门里“引擎能渲染、但这份草图作为客户要看的东西不靠谱”的那一类。
 * 它们都在回答同一个问题：字段有没有真的被展示、关系是不是真的建成了关系、数据和文案能不能给客户看、
 * 导航是不是太长、站是不是英文却没设 locale。
 *
 * 判定只依赖数据的一律是 error（拦发布）；本质主观的（阈值、启发）是 warning。
 * 它们不进 validate()：validate 只回答“引擎渲染得了吗”，线上存量草图在浏览器里按它渲染，
 * 新规则不能让已上线的草图白屏。一份草图能不能发布仍然只有 checkSketch 一个判断。
 */
import { pagesOf } from "./derive.ts";
import { factFields } from "./facts.ts";
import type { Field, Node, Option, Sketch, TypeDef } from "./schema.ts";
import { pageScope, resolveStatic, scopeOfPage, walkTree, withVar, type Scope } from "./scope.ts";
import { matchesWhere } from "./where.ts";

const MAX_NAV = 7;
const MAX_FIELDS = 25;
const MIN_RECORDS = 4;
const MAX_SECTIONS = 9;
/** 看着像后台流程的字段名：出现在客户页上多半是漏标了 internal。 */
const BACK_OFFICE = /(verif|reviewer|reviewed|claim_status|approv|internal|workflow|last_checked)/i;

const textsOf = (s: Sketch): string[] => {
  const out: string[] = [];
  const grab = (n: Node) => {
    if (!("group" in n) && !("each" in n) && "fill" in n && typeof n.fill === "string")
      out.push(n.fill);
  };
  for (const p of Object.values(pagesOf(s))) {
    if (p.name) out.push(p.name);
    for (const b of p.body) walkTree(s, b, scopeOfPage(p, s.session), "", grab);
  }
  walkTree(s, s.header, pageScope(undefined, { state: s.session }), "", grab);
  walkTree(s, s.footer, pageScope(undefined, { state: s.session }), "", grab);
  return out;
};

const singular = (w: string): string =>
  w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.replace(/s$/, "");
const slugify = (w: string): string => singular(w.toLowerCase().replace(/_/g, "-"));
/** 一个词指向哪个类型：整词相等，或是类型名最后一段（"cases" → "sourcing-cases"）。 */
const typeNamed = (s: Sketch, word: string): string | undefined => {
  const w = slugify(word);
  if (!w) return undefined;
  return Object.keys(s.model).find((t) => {
    const n = slugify(t);
    return n === w || n.endsWith(`-${w}`);
  });
};
/** 关系的名字：related_cases / source_product / alternative_products / product_slug 去掉前后缀剩下的词。 */
const RELATION_PREFIX = /^(related|recommended|alternative|companion|source)_/;
/** 编号后缀只认 slug / id：code 多半是这个类型自己的编号（style_code），不是指向别处。 */
const RELATION_SUFFIX = /_(slug|id)$/;
const relationStem = (name: string): string =>
  name.replace(RELATION_PREFIX, "").replace(RELATION_SUFFIX, "");
const optionValue = (o: Option): string => (typeof o === "string" ? o : o.value);

/**
 * 关联类型：两个以上的 ref，其余字段只是关系的属性（文字、选项、数字、日期……，没有图片、列表、内容树、词表）——
 * 一行就是一条关系事实。记录数不够不算问题：没有依据的关系不造（造了就是编数据）。
 */
const ATTRIBUTE_KINDS: ReadonlyArray<string> = ["text", "choice", "number", "bool", "date"];
const isAssociation = (def: TypeDef): boolean => {
  const others = Object.entries(def.fields).filter(([n]) => n !== def.key);
  return (
    others.filter(([, f]) => f.kind === "ref").length >= 2 &&
    others.every(([, f]) => f.kind === "ref" || ATTRIBUTE_KINDS.includes(f.kind))
  );
};

export type Quality = { errors: string[]; warnings: string[] };

export const quality = (s: Sketch): Quality => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const warn = (at: string, m: string) => warnings.push(`${at}：${m}`);
  const err = (at: string, m: string) => errors.push(`${at}：${m}`);
  const pages = pagesOf(s);

  // ---- 字段：哪些从来没出现在任何客户页面上 ----
  const shown = new Map<string, Set<string>>();
  const mark = (type: string | undefined, field: string) => {
    if (!type) return;
    if (!shown.has(type)) shown.set(type, new Set());
    shown.get(type)!.add(field);
  };
  const markBind = (path: string, scope: Scope) => {
    const r = resolveStatic(s, scope, path);
    if (!r.ok) return;
    const t = r.target;
    if (t.kind === "field") mark(t.type, t.field);
    else if (t.kind === "fields") t.names.forEach((n) => mark(t.type, n));
    else if (t.kind === "entry-value") t.names.forEach((n) => mark(t.type, n));
    else if (t.kind === "title") {
      const def = s.model[t.type];
      if (def) mark(t.type, def.title ?? def.key);
    }
  };
  const visitShown = (n: Node, scope: Scope): void => {
    if ("group" in n) return;
    if ("each" in n) {
      const src = n.each;
      if ("fields" in src) {
        const v = scope.vars.get(src.fields.of ?? scope.it ?? "");
        const type = src.fields.type ?? (v?.kind === "record" ? v.type : undefined);
        for (const name of type ? (resolveNames(type, src) ?? []) : []) mark(type, name);
      }
      if ("items" in src) markBind(src.items, scope);
      if ("distinct" in src) mark(src.distinct.type, src.distinct.field);
      if ("facets" in src) {
        const page = scope.vars.get("page");
        const type = scope.listType ?? (page?.kind === "record" ? page.type : undefined);
        for (const f of src.facets) mark(type, f);
      }
      return;
    }
    const fillBind = (f: unknown) => {
      if (f && typeof f === "object" && "bind" in f) markBind((f as { bind: string }).bind, scope);
      // fold 折叠出来的数字也是“展示了”这个字段
      if (f && typeof f === "object" && "fold" in f) {
        const { of, field } = (f as { fold: { of: { records?: string }; field?: string } }).fold;
        if (of.records && field) mark(of.records, field);
      }
    };
    if (
      n.slot === "text" ||
      n.slot === "image" ||
      n.slot === "media" ||
      n.slot === "action" ||
      n.slot === "brand" ||
      n.slot === "embed"
    )
      fillBind(n.fill);
    if (n.slot === "action") for (const v of Object.values(n.with ?? {})) fillBind(v);
  };
  const resolveNames = (
    type: string,
    src: { fields: { only?: ReadonlyArray<string>; skip?: ReadonlyArray<string> } },
  ) => factFields(s, type, src.fields);

  for (const [pattern, page] of Object.entries(pages)) {
    page.body.forEach((b, i) =>
      walkTree(s, b, scopeOfPage(page, s.session), `pages["${pattern}"].body[${i}]`, visitShown),
    );
  }
  for (const [t, def] of Object.entries(s.model)) {
    if (def.card)
      walkTree(
        s,
        def.card,
        withVar(pageScope(undefined, { state: s.session }), "it", { kind: "record", type: t }),
        `model.${t}.card`,
        visitShown,
      );
    // 列表里的集合卡片（没写 card 时是 图 + 显示名）也算展示了显示名；主键在地址里
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
    err(
      "model",
      `这些字段在任何客户页面上都没出现过（要么加进页面，要么是只给后台的，标 internal: true；没人看的字段不用建）——${never.join("；")}`,
    );

  // ---- 后台味的字段名出现在了客户页上 ----
  for (const [t, def] of Object.entries(s.model)) {
    if (def.vocab || def.public) continue;
    for (const [n, fd] of Object.entries(def.fields))
      if (fd.internal !== true && BACK_OFFICE.test(n) && shown.get(t)?.has(n))
        err(
          `model.${t}.fields.${n}`,
          "名字像后台流程字段（审核/核实状态之类），却会出现在客户页面上——只给后台的标 internal: true",
        );
  }

  // ---- 模型数据的一致性：判定只依赖数据 ----
  for (const [t, def] of Object.entries(s.model)) {
    const known = (fd: Field): ReadonlyArray<string> | undefined =>
      fd.kind === "choice" ? (fd.options ?? []).map(optionValue) : undefined;
    // 草稿过滤：命中的是“字段值 === 这个字符串”，所以字段得是能取到这个字符串的类型，值得在取值范围里
    for (const [f, v] of Object.entries(def.unlisted ?? {})) {
      const fd = def.fields[f];
      if (!fd) continue;
      const at = `model.${t}.unlisted.${f}`;
      const opts = known(fd);
      if (opts) {
        if (!opts.includes(v))
          err(at, `草稿值 "${v}" 不在 ${f} 的选项里（${opts.join(" / ")}）：这个过滤永远不会生效`);
      } else if (fd.kind !== "text")
        err(at, `unlisted 只能比较 choice / text 字段的字符串值，${f} 是 ${fd.kind}`);
    }
    def.seed.forEach((r, i) => {
      const rat = `model.${t}.seed[${i}]`;
      for (const [name, v] of Object.entries(r)) {
        const fd = def.fields[name];
        if (!fd) {
          err(rat, `字段 ${name} 没在 fields 里声明`);
          continue;
        }
        const opts = known(fd);
        if (!opts) continue;
        for (const x of Array.isArray(v) ? v : v === "" || v == null ? [] : [v])
          if (!opts.includes(String(x)))
            err(rat, `${name} 的值 "${String(x)}" 不在选项里（${opts.join(" / ")}）`);
      }
    });
    // 关系必须是关系：用 text / list 存对方的编号，where 查不到、也点不过去
    if (def.vocab) continue;
    for (const [n, fd] of Object.entries(def.fields)) {
      const at = `model.${t}.fields.${n}`;
      if (fd.kind === "text" || fd.kind === "list") {
        const target = typeNamed(s, relationStem(n));
        // 没有 related_ 这类前缀、只有编号后缀、又指向自己所在的类型：那是自己的编号（product_id），不是关系
        const ownId = target === t && !RELATION_PREFIX.test(n);
        if ((RELATION_PREFIX.test(n) || RELATION_SUFFIX.test(n)) && target && !ownId)
          err(
            at,
            `像是指向 ${target} 的关系，却是 ${fd.kind}：关系用 f.ref("${target}")（where 才查得到、页面才点得过去）；关系上要带属性（角色、数量……）就建一个关联类型，两个 ref 加属性字段`,
          );
      }
      if (fd.kind === "list")
        for (const col of Object.keys(fd.columns ?? {})) {
          const target = RELATION_SUFFIX.test(col) ? typeNamed(s, relationStem(col)) : undefined;
          if (target && target !== t)
            err(
              `${at}.columns.${col}`,
              `列像是指向 ${target} 的关系：list 的列只是文字，where 和链接都用不上——用关联类型（两个 ref 加属性字段）`,
            );
        }
    }
  }

  // ---- 模型体量 ----
  for (const [t, def] of Object.entries(s.model)) {
    const n = Object.keys(def.fields).length;
    if (!def.vocab && n > MAX_FIELDS)
      warn(
        `model.${t}`,
        `${n} 个字段（>${MAX_FIELDS}）：很多多半是一段一段的文字——那是页面板块里的内容，不是数据结构；结构草图只建“要筛选、要列表、要关联”的字段`,
      );
    if (!def.vocab && !def.public && !isAssociation(def) && def.seed.length < MIN_RECORDS)
      warn(
        `model.${t}.seed`,
        `只有 ${def.seed.length} 条记录（<${MIN_RECORDS}）：列表、筛选、“相关”这类板块演示不出来——补同形的记录，没有依据的字段留空（波浪线），不要写“示意/Demo”之类的说明`,
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
    const seen = new Map<string, string>();
    page.body.forEach((b, i) =>
      walkTree(s, b, scopeOfPage(page, s.session), `${at}.body[${i}]`, (n, scope, where) => {
        if ("group" in n || !("each" in n)) return;
        const src = n.each;
        // 同一页里两个 fields 显示完全一样的字段 = 重复板块
        if ("fields" in src) {
          const v = scope.vars.get(src.fields.of ?? scope.it ?? "");
          const t = src.fields.type ?? (v?.kind === "record" ? v.type : undefined);
          const key = `${t}:${(t ? (resolveNames(t, src) ?? []) : []).join("|")}`;
          if (key.endsWith(":")) return;
          const prev = seen.get(key);
          if (prev) err(where, `和 ${prev} 显示完全相同的字段：用 only 把字段分给不同的板块`);
          else seen.set(key, where);
        }
        if ("records" in src) {
          if (!src.where)
            err(
              where,
              `详情页里的 ${src.records} 集合没有 where：显示的是所有记录，不是“相关的”——用 where 指向关系字段（ref / term）`,
            );
          else if (Object.values(src.where).some((v) => v.startsWith("$"))) {
            // 关系查询在每一条种子记录上都查不到东西 = 这个板块在演示里永远是空的
            const own = s.model[type]!;
            const target = s.model[src.records];
            const visible = (r: Record<string, unknown>) =>
              !Object.entries(target?.unlisted ?? {}).some(([f, v]) => r[f] === v);
            if (target && own.seed.length > 0) {
              const hits = own.seed.map(
                (rec) =>
                  target.seed.filter(
                    (r) =>
                      visible(r) &&
                      matchesWhere(r, src.where, { params: {}, record: rec }) &&
                      !(src.notSelf && src.records === type && r[own.key] === rec[own.key]),
                  ).length,
              );
              if (hits.every((h) => h === 0))
                err(
                  where,
                  `${src.records} 集合的 where 在每一条 ${type} 种子记录上都查不到记录：这个板块演示时永远是空的——种子里要让相关的记录真的互相关联（每个分组至少两条）`,
                );
            }
          }
        }
      }),
    );
  }

  // ---- 页眉 ----
  walkTree(
    s,
    s.header,
    pageScope(undefined, { state: s.session }),
    "header",
    (n, _scope, where) => {
      if (!("group" in n) && !("each" in n) && n.slot === "nav" && n.paths.length > MAX_NAV)
        warn(
          where,
          `导航有 ${n.paths.length} 项（>${MAX_NAV}）：引擎会把它收进菜单，但这说明信息架构该合并或分组了`,
        );
    },
  );
  const firstLeaf = (n: Node): Node => ("group" in n && n.group[0] ? firstLeaf(n.group[0]) : n);
  const lead = firstLeaf(s.header);
  if (!("group" in lead) && !("each" in lead) && lead.slot === "action" && lead.to === "/")
    warn(
      "header",
      '页眉第一个东西是回首页的 action：它会渲染成一个按钮。logo/字标用 brand()（或 image("LOGO")）',
    );

  // ---- 图片占位上写着“视频/地图……”：那是 media，不是图片 ----
  const mediaWord = /(video|视频|\bmap\b|地图|chart|图表|\bicon\b|图标|download|下载)/i;
  const hint = (n: Node, _scope: Scope, where: string) => {
    if (!("group" in n) && !("each" in n) && n.slot === "image" && typeof n.fill === "string") {
      if (mediaWord.test(n.fill))
        warn(
          where,
          `image("${n.fill}") 看着是视频/地图/图表/图标/文件：用 media("video" | "map" | "chart" | "icon" | "file")`,
        );
    }
  };
  for (const [pattern, page] of Object.entries(pages))
    page.body.forEach((b, i) =>
      walkTree(s, b, scopeOfPage(page, s.session), `pages["${pattern}"].body[${i}]`, hint),
    );
  walkTree(s, s.header, pageScope(undefined, { state: s.session }), "header", hint);
  walkTree(s, s.footer, pageScope(undefined, { state: s.session }), "footer", hint);

  // ---- 详情页链到表单页：当前记录得带过去 ----
  // 表单页有一个指回这个类型的 ref 字段，链接的 with 却一个也没给它：访客得重填“我问的是哪个”
  for (const [pattern, page] of Object.entries(pages)) {
    const c = page.ctx;
    const type = c && !c.many && !c.create ? c.type : undefined;
    if (!type) continue;
    page.body.forEach((b, i) =>
      walkTree(
        s,
        b,
        scopeOfPage(page, s.session),
        `pages["${pattern}"].body[${i}]`,
        (n, _sc, where) => {
          if ("group" in n || "each" in n || n.slot !== "action" || !n.to) return;
          const target = pages[n.to];
          const tc = target?.ctx;
          if (!tc || !tc.create) return;
          const asks = Object.entries(s.model[tc.type]?.fields ?? {}).filter(
            ([, fd]) => fd.kind === "ref" && fd.to === type,
          );
          if (asks.length && !asks.some(([name]) => name in (n.with ?? {})))
            warn(
              where,
              `去 ${n.to} 的按钮没带上当前记录：${tc.type} 有 ref 字段（${asks.map(([name]) => name).join("、")}）指向 ${type}——用 with: { ${asks[0]![0]}: bind("${s.model[type]!.key}") } 带过去`,
            );
        },
      ),
    );
  }

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
  return { errors, warnings };
};
