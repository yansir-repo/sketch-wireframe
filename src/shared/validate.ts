/**
 * 配置校验：把“引用对不上”这类错误挡在发布之前，而且给出能直接定位的路径。
 * 纯函数；Node（check.ts）和浏览器（引擎启动时）共用。error 会拦发布，warning 只提示。
 * 节点树里每一处都带着它那里的环境（scope.ts）：模板里的变量是什么、bind 路径指向哪个字段，都在这里被检查。
 */
import { matchRoute, pagesOf } from "./derive.ts";
import { qualityWarnings } from "./quality.ts";
import {
  FIELD_KINDS,
  SLOT_KINDS,
  TONES,
  isLinkKind,
  type Field,
  type Fill,
  type Node,
  type Sketch,
  type Source,
} from "./schema.ts";
import { scalar } from "./scalar.ts";
import { bindSource, pageScope, resolveStatic, withVar, type Scope as Env } from "./scope.ts";

export type Report = { errors: string[]; warnings: string[] };

const KEY_RE = /^[A-Za-z0-9._-]+$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KINDS: ReadonlyArray<string> = FIELD_KINDS;
const SLOTS: ReadonlyArray<string> = SLOT_KINDS;
const MAX_GROUP_DEPTH = 5;

/** 页面本身的上下文：路由参数、列表页在列哪个类型、是不是新增表单页。 */
type PageCtx = { params: string[]; listType?: string; create?: string };

export const validate = (s: Sketch): Report => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (at: string, m: string): void => {
    errors.push(`${at}：${m}`);
  };
  const warn = (at: string, m: string): void => {
    warnings.push(`${at}：${m}`);
  };

  if (!s.code || !/^[A-Za-z0-9-]+$/.test(s.code))
    err("code", `项目编号只能用字母、数字、横线：${JSON.stringify(s.code)}`);
  if (!s.title) err("title", "缺少 title");
  if (!s.model || !Object.keys(s.model).length) err("model", "至少要有一个类型");

  const fieldOf = (type: string, name: string): Field | undefined => s.model[type]?.fields[name];

  // ---- 页面 ----
  const pages = pagesOf(s);
  const patterns = Object.keys(pages);
  if (!pages["/"]) err("pages", '缺少首页 "/"');

  /** 一个 bind 路径：能解析到字段，且不是 internal（只给后台的字段不能出现在客户页面上）。 */
  const checkBind = (path: string, env: Env, at: string) => {
    const r = resolveStatic(s, env, path);
    if (!r.ok) return err(at, r.error);
    if (r.target.kind === "field" && r.target.fd.internal)
      err(at, `字段 "${r.target.field}" 是 internal（只给后台），不能出现在客户页面上`);
  };

  const checkSource = (src: Source, env: Env, ctx: PageCtx, at: string) => {
    const b = bindSource(s, env, src);
    if (!b.ok) return err(at, b.error);
    if ("records" in src) {
      for (const [fld, v] of Object.entries(src.where ?? {})) {
        if (!fieldOf(src.records, fld)) err(at, `where 里的字段 ${fld} 不在类型 ${src.records} 里`);
        if (v.startsWith("$")) {
          const page = env.vars.get("page");
          if (!page || page.kind !== "record") err(at, `where 的 ${v}：这一页没有记录可以引用`);
          else if (!fieldOf(page.type, v.slice(1)))
            err(at, `where 的 ${v} 指向的字段不在类型 ${page.type} 里`);
        } else if (v.startsWith(":") && !ctx.params.includes(v.slice(1)))
          err(at, `where 的 ${v} 不是本路由的参数`);
      }
      const page = env.vars.get("page");
      if (src.notSelf && !(page?.kind === "record" && page.type === src.records))
        err(at, "notSelf 只能在同类型的详情页里用");
      if (src.limit !== undefined && (!Number.isInteger(src.limit) || src.limit < 1))
        err(at, "limit 要是正整数");
    }
    if ("fields" in src) {
      const f = src.fields;
      if (f.only && f.skip) err(at, "fields 的 only 和 skip 只能写一个");
      const type = b.var.kind === "entry" ? b.var.type : undefined;
      for (const k of f.skip ?? [])
        if (type && !fieldOf(type, k)) err(at, `skip 里的字段 ${k} 不在类型 ${type} 里`);
      for (const k of f.only ?? []) {
        const fd = type ? fieldOf(type, k) : undefined;
        if (type && !fd) err(at, `only 里的字段 ${k} 不在类型 ${type} 里`);
        else if (fd?.internal) err(at, `only 里的字段 ${k} 是 internal（只给后台），不能给客户看`);
        else if (fd?.kind === "media")
          err(at, `only 里的 ${k} 是图片字段：用 items 展开它（gallery）`);
      }
      if (b.var.kind === "entry" && b.var.names.length === 0)
        err(at, "fields 没有一个能显示的字段");
    }
    if ("items" in src) checkBind(src.items, env, at);
  };

  const checkFill = (fill: Fill, env: Env, ctx: PageCtx, at: string) => {
    if (fill === undefined || typeof fill === "string") return;
    if ("bind" in fill) checkBind(fill.bind, env, at);
    else {
      if ("fields" in fill.count) err(at, "count 只能数 records 或 items");
      else checkSource(fill.count, env, ctx, at);
    }
  };

  const check = (n: Node, env: Env, ctx: PageCtx, at: string, depth: number): void => {
    if (n.w !== undefined && !(Number.isFinite(n.w) && n.w > 0)) err(at, "span 的份数要是正数");

    if ("group" in n || "each" in n) {
      if (n.tone && !TONES.includes(n.tone)) err(at, `不认识的 tone ${String(n.tone)}`);
      if (depth > MAX_GROUP_DEPTH)
        warn(
          at,
          `嵌套超过 ${MAX_GROUP_DEPTH} 层：草图表达“放什么”，不是版式——嵌套越深越容易引出版式争论`,
        );
    }
    if ("group" in n) {
      if (!n.group.length) err(at, "空的组");
      n.group.forEach((c, i) => check(c, env, ctx, `${at}.group[${i}]`, depth + 1));
      return;
    }
    if ("each" in n) {
      checkSource(n.each, env, ctx, at);
      const b = bindSource(s, env, n.each);
      const as = n.as ?? "it";
      if (!NAME_RE.test(as)) return err(at, `变量名只能用字母数字下划线：${as}`);
      if (as === "page") return err(at, "page 是页面记录的名字，起另一个");
      if (env.vars.has(as))
        return err(at, `变量 ${as} 已被外层占用：嵌套的 each 要用 as 起不同的名字`);
      if (!n.item && !("records" in n.each))
        return err(at, "fields / items 的 each 必须写 item（怎么画每一项）");
      if (b.ok && n.item) check(n.item, withVar(env, as, b.var), ctx, `${at}.item`, depth + 1);
      return;
    }
    if (!SLOTS.includes(n.slot)) {
      err(at, `不认识的槽 ${JSON.stringify((n as { slot?: string }).slot)}`);
      return;
    }
    switch (n.slot) {
      case "text":
        if (![1, 2, 3].includes(n.size)) err(at, `text 的 size 只能是 1/2/3：${n.size}`);
        checkFill(n.fill, env, ctx, at);
        break;
      case "image":
        checkFill(n.fill, env, ctx, at);
        break;
      case "brand":
        checkFill(n.fill, env, ctx, at);
        if (n.to !== undefined && !n.to.startsWith("/")) err(at, `to 要以 / 开头：${n.to}`);
        break;
      case "action": {
        checkFill(n.fill, env, ctx, at);
        const to = n.to;
        if (to !== undefined && !to.startsWith("/")) err(at, `to 要以 / 开头：${to}`);
        else if (to && !to.startsWith("/_model") && !matchRoute(patterns, to))
          err(at, `to 指向的路由 ${to} 没有对应页面`);
        for (const [k, v] of Object.entries(n.with ?? {})) {
          const target = to ? matchRoute(patterns, to) : null;
          const c = target ? pages[target.pattern]?.ctx : null;
          if (!c || !c.create) err(at, `with 只能带给“新增表单页”：${to ?? "（没有 to）"} 不是`);
          else {
            const fd = fieldOf(c.type, k);
            if (!fd) err(at, `with 的键 ${k} 不是类型 ${c.type} 的字段`);
            else if (fd.internal) err(at, `with 的键 ${k} 是 internal，公开表单里没有它`);
          }
          if (typeof v !== "string") checkBind(v.bind, env, at);
        }
        break;
      }
      case "nav":
        for (const p of n.paths) if (!pages[p]) err(at, `nav 里的路由 ${p} 不是已有页面的路由模式`);
        break;
      case "filters": {
        const rt =
          ctx.listType ??
          (env.vars.get("page")?.kind === "record"
            ? (env.vars.get("page") as { type: string }).type
            : undefined);
        if (!rt) {
          err(at, "filters 要放在列表页（ctx.many）或详情页里，才知道在哪个类型上筛选");
          break;
        }
        if (!n.fields.length) err(at, "filters 至少要一个字段");
        for (const name of n.fields) {
          const fd = fieldOf(rt, name);
          if (!fd) err(at, `filters 的字段 ${name} 不在类型 ${rt} 里`);
          else if (!["term", "ref", "choice", "bool"].includes(fd.kind))
            err(at, `filters 只能筛 term/ref/choice/bool 字段，${name} 是 ${fd.kind}`);
          else if (fd.internal) err(at, `filters 里的字段 ${name} 是 internal，不能给客户用`);
        }
        break;
      }
      case "form":
        if (!ctx.create) err(at, "form 只能在“新增某类型”的页面里用");
        break;
    }
  };

  // ---- 模型（要在 check 定义之后跑：卡片模板里有节点）----
  const checkModel = () => {
    for (const [t, def] of Object.entries(s.model ?? {})) {
      const at = `model.${t}`;
      if (!KEY_RE.test(t)) err(at, "类型名会进路由，只能用字母、数字、点、下划线、横线");
      if (!def.label) err(at, "缺少 label");
      if (!(def.key in def.fields) && def.key !== "id")
        err(at, `主键字段 "${def.key}" 没在 fields 里声明`);
      if (def.title && !(def.title in def.fields))
        err(at, `title 字段 "${def.title}" 没在 fields 里声明`);
      for (const [name, fd] of Object.entries(def.fields)) {
        const fat = `${at}.fields.${name}`;
        if (!KINDS.includes(fd.kind)) err(fat, `不认识的字段类型 ${fd.kind}`);
        if (!fd.label) err(fat, "缺少 label");
        if (fd.kind === "term") {
          if (!fd.to || !s.model[fd.to]) err(fat, `term 引用的词表 "${fd.to}" 不存在`);
          else if (!s.model[fd.to]!.vocab) err(fat, `"${fd.to}" 不是词表（vocab）`);
        }
        if (fd.kind === "ref") {
          if (!fd.to || !s.model[fd.to]) err(fat, `ref 引用的类型 "${fd.to}" 不存在`);
          else if (s.model[fd.to]!.vocab)
            err(fat, `"${fd.to}" 是词表：引用词表用 term，ref 引用内容类型`);
        }
        if (fd.internal && name === def.key) err(fat, "主键不能是 internal");
        if (fd.kind === "choice" && !fd.options?.length) err(fat, "choice 需要 options");
        if (fd.kind === "list" && (!fd.columns || !Object.keys(fd.columns).length))
          err(fat, "list 需要 columns");
        if (fd.kv && Object.keys(fd.columns ?? {}).length < 2)
          err(fat, "kv 需要至少两列（名、值）");
      }
      const seen = new Set<string>();
      def.seed.forEach((r, i) => {
        const rat = `${at}.seed[${i}]`;
        const k = r[def.key];
        if (k === undefined || k === "") {
          if (def.key !== "id") err(rat, `缺少主键 ${def.key}`);
          return;
        }
        if (typeof k !== "string" || !KEY_RE.test(k))
          err(rat, `主键会进网址，只能用字母、数字、点、下划线、横线：${JSON.stringify(k)}`);
        if (seen.has(scalar(k))) err(rat, `主键重复：${scalar(k)}`);
        seen.add(scalar(k));
        for (const [name, v] of Object.entries(r)) {
          const fd = def.fields[name];
          if (!fd) {
            warn(rat, `字段 ${name} 没在 fields 里声明`);
            continue;
          }
          if (isLinkKind(fd.kind) && fd.to && s.model[fd.to]) {
            const target = s.model[fd.to]!;
            const ids = new Set(target.seed.map((x) => String(x[target.key])));
            for (const id of Array.isArray(v) ? v : v === "" || v == null ? [] : [v])
              if (!ids.has(String(id)))
                err(rat, `${name} 引用了 ${fd.to} 里没有的条目 "${scalar(id)}"`);
          }
        }
      });
      for (const k of Object.keys(def.unlisted ?? {}))
        if (!(k in def.fields)) err(at, `unlisted 里的字段 ${k} 没在 fields 里声明`);
      // 卡片模板：每一项叫 it，类型是这个类型
      if (def.card)
        check(
          def.card,
          withVar({ vars: new Map(), it: undefined }, "it", { kind: "record", type: t }),
          { params: [] },
          `${at}.card`,
          1,
        );
    }
  };

  checkModel();

  for (const [pattern, page] of Object.entries(pages)) {
    const at = `pages["${pattern}"]`;
    if (!pattern.startsWith("/")) err(at, "路由要以 / 开头");
    const params = [...pattern.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
    const c = page.ctx ?? null;
    let ctx: PageCtx = { params };
    let env = pageScope(undefined);
    if (c) {
      if (!s.model[c.type]) {
        err(`${at}.ctx`, `类型 ${c.type} 不存在`);
        continue;
      }
      for (const [fld, v] of Object.entries(c.where ?? {})) {
        if (!fieldOf(c.type, fld)) err(`${at}.ctx`, `where 的字段 ${fld} 不在类型 ${c.type} 里`);
        if (v.startsWith(":") && !params.includes(v.slice(1)))
          err(`${at}.ctx`, `where 的 ${v} 不是本路由的参数`);
      }
      if (c.many) ctx = { params, listType: c.type };
      else if (c.create) ctx = { params, create: c.type };
      else {
        if (!params.length) err(at, `详情页（ctx.type = ${c.type}）的路由要带 :id 参数`);
        env = pageScope(c.type);
      }
    }
    if (!page.body?.length) err(at, "页面没有任何板块");
    page.body.forEach((n, i) => {
      if (!("group" in n || "each" in n) || !n.name)
        warn(`${at}.body[${i}]`, '页面顶层应该是带名字的板块：section("名字", …)');
      check(n, env, ctx, `${at}.body[${i}]`, 1);
    });
  }
  if (s.header) check(s.header, pageScope(undefined), { params: [] }, "header", 1);
  else err("header", "缺少 header");
  if (s.footer) check(s.footer, pageScope(undefined), { params: [] }, "footer", 1);
  else err("footer", "缺少 footer");

  if (errors.length === 0) warnings.push(...qualityWarnings(s)); // 结构都不对时，“设计问题”没有意义
  return { errors, warnings };
};
