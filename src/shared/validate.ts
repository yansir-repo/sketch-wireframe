/**
 * 配置校验：把“引用对不上”这类错误挡在发布之前，而且给出能直接定位的路径。
 * 纯函数；Node（check.ts）和浏览器（引擎启动时）共用。error 会拦发布，warning 只提示。
 * 节点树里每一处都带着它那里的环境（scope.ts）：模板里的变量是什么、bind 路径指向哪个字段，都在这里被检查。
 */
import { matchRoute, pagesOf } from "./derive.ts";
import { parseOrder, searchFields, sortable } from "./facts.ts";
import { parseNodes } from "./parse.ts";
import { qualityWarnings } from "./quality.ts";
import {
  FIELD_KINDS,
  SLOT_KINDS,
  TONES,
  isLinkKind,
  type Field,
  type Fill,
  type Node,
  type ParamDecl,
  type RecordsSource,
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
const FACET_KINDS = ["term", "ref", "choice", "bool"];
const PARAM_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

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

  /** 一个自由文本参数（搜索词、页码）：要在这个页面（或会话）里声明成 free。 */
  const freeParam = (param: string, env: Env, at: string, what: string) => {
    const d = env.state[param];
    if (!d) err(at, `${what} 的参数 ${param} 没有在这个页面的 state 里声明（要 free()）`);
    else if (!d.free) err(at, `${what} 的参数 ${param} 要声明成 free()（它的取值不是有限集合）`);
  };

  /** 排序依据：字段要存在、有大小可比；写成参数时，参数的每个取值都得是这样的字段。 */
  const checkOrder = (
    type: string,
    order: NonNullable<RecordsSource["order"]>,
    env: Env,
    at: string,
  ) => {
    const field = (o: string, where: string) => {
      const { field: f } = parseOrder(o);
      if (!fieldOf(type, f)) err(at, `${where}的字段 ${f} 不在类型 ${type} 里`);
      else if (!sortable(s, type, f))
        err(at, `${where}的字段 ${f} 不能排序（图片/列表/内容树没有大小）`);
    };
    if (typeof order === "string") return field(order, "order ");
    const d = env.state[order.param];
    if (!d) return err(at, `order 的参数 ${order.param} 没有在这个页面的 state 里声明`);
    if (d.free || d.multi)
      return err(at, `order 的参数 ${order.param} 要是有限取值的单选（每个取值是一种排序）`);
    for (const v of d.values) field(v, `order 参数 ${order.param} 的取值 ${v}：`);
  };

  const checkRecords = (src: RecordsSource, env: Env, at: string) => {
    if (src.order !== undefined) checkOrder(src.records, src.order, env, at);
    if (src.search) {
      freeParam(src.search.param, env, at, "search");
      if (searchFields(s, src.records).length === 0)
        err(at, `search：类型 ${src.records} 没有能搜的字段`);
    }
    if (src.page) {
      freeParam(src.page.param, env, at, "page");
      if (src.limit === undefined) err(at, "page 要和 limit 一起写（limit 就是每页几条）");
    }
  };

  const checkSource = (src: Source, env: Env, ctx: PageCtx, at: string) => {
    const b = bindSource(s, env, src);
    if (!b.ok) return err(at, b.error);
    if ("pages" in src) {
      if (!src.pages.page) err(at, "pages 要指向一个写了 page 的 records 来源");
      checkSource(src.pages, env, ctx, at);
    }
    if ("records" in src) {
      checkRecords(src, env, at);
      for (const [fld, v] of Object.entries(src.where ?? {})) {
        if (!fieldOf(src.records, fld)) err(at, `where 里的字段 ${fld} 不在类型 ${src.records} 里`);
        if (v.startsWith("$")) {
          const page = env.vars.get("page");
          if (!page || page.kind !== "record") err(at, `where 的 ${v}：这一页没有记录可以引用`);
          else if (!fieldOf(page.type, v.slice(1)))
            err(at, `where 的 ${v} 指向的字段不在类型 ${page.type} 里`);
        } else if (v.startsWith(":") && !ctx.params.includes(v.slice(1)))
          err(at, `where 的 ${v} 不是本路由的参数`);
        else if (v.startsWith("{") && v.endsWith("}")) {
          // {x.value}：条件的值来自环境里的一个变量（分组统计里“这一组的值”）
          const r = resolveStatic(s, env, v.slice(1, -1));
          if (!r.ok) err(at, `where 的 ${v}：${r.error}`);
        }
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
    if ("facets" in src) {
      const t = b.var.kind === "facet" ? b.var.type : undefined;
      if (!src.facets.length) err(at, "facets 至少要一个字段");
      for (const name of src.facets) {
        const fd = t ? fieldOf(t, name) : undefined;
        if (t && !fd) err(at, `facets 的字段 ${name} 不在类型 ${t} 里`);
        else if (fd && !FACET_KINDS.includes(fd.kind))
          err(at, `facets 只能筛 term/ref/choice/bool 字段，${name} 是 ${fd.kind}`);
        else if (fd?.internal) err(at, `facets 里的字段 ${name} 是 internal，不能给客户用`);
      }
    }
  };

  const checkFill = (fill: Fill, env: Env, ctx: PageCtx, at: string) => {
    if (fill === undefined || typeof fill === "string") return;
    if ("bind" in fill) checkBind(fill.bind, env, at);
    else {
      const { op, of, field } = fill.fold;
      if ("fields" in of || "facets" in of || "options" in of || "param" in of || "pages" in of)
        err(at, "fold 只能折叠 records / items / distinct");
      else checkSource(of, env, ctx, at);
      if (op === "count") {
        if (field !== undefined) err(at, "count 不需要 field");
      } else if (field === undefined) err(at, `${op} 需要 field（一个数字字段）`);
      else if ("distinct" in of) err(at, `${op} 不能对 distinct 折叠（它只有值和个数）`);
      else if ("records" in of) {
        const fd = fieldOf(of.records, field);
        if (!fd) err(at, `${op} 的字段 ${field} 不在类型 ${of.records} 里`);
        else if (fd.kind !== "number") err(at, `${op} 要对数字字段折叠，${field} 是 ${fd.kind}`);
        else if (fd.internal) err(at, `${op} 的字段 ${field} 是 internal`);
      }
    }
  };

  /** 一个状态参数在这里认不认识：页面声明过的，或者是这一页筛选的字段（筛选的参数就是字段名，不用声明）。 */
  const paramKnown = (name: string, env: Env): boolean => {
    if (env.state[name]) return true;
    const page = env.vars.get("page");
    const t = env.listType ?? (page?.kind === "record" ? page.type : undefined);
    const fd = t ? fieldOf(t, name) : undefined;
    return !!fd && FACET_KINDS.includes(fd.kind) && !fd.internal;
  };

  const checkWhen = (w: NonNullable<Node["when"]>, env: Env, at: string) => {
    const names = typeof w.param === "string" ? [w.param] : [...w.param];
    for (const p of names) {
      if (!paramKnown(p, env)) err(at, `when 的参数 ${p} 没有在这个页面的 state 里声明`);
      else if (
        w.is !== undefined &&
        env.state[p] &&
        !env.state[p]!.free &&
        !env.state[p]!.values.includes(w.is)
      )
        err(at, `when 的 ${p}=${w.is}：${p} 的取值只有 ${env.state[p]!.values.join("、")}`);
    }
  };

  /** 改状态参数：键是已知参数（可以是 {f.field} 这种来自数据的），值是它的取值之一（或空串 = 清掉）。 */
  const checkSet = (
    set: Readonly<Record<string, string | { bind: string }>>,
    env: Env,
    at: string,
  ) => {
    for (const [k, v] of Object.entries(set)) {
      const dynamic = k.startsWith("{") && k.endsWith("}");
      if (dynamic) {
        const r = resolveStatic(s, env, k.slice(1, -1));
        if (!r.ok) err(at, r.error);
      } else if (!paramKnown(k, env)) err(at, `set 的参数 ${k} 没有在这个页面的 state 里声明`);
      else if (
        typeof v === "string" &&
        v !== "" &&
        env.state[k] &&
        !env.state[k]!.free &&
        !env.state[k]!.values.includes(v)
      )
        err(at, `set 的 ${k}=${v}：${k} 的取值只有 ${env.state[k]!.values.join("、")}`);
      if (typeof v !== "string") checkBind(v.bind, env, at);
    }
  };

  const checkLink = (
    link: {
      to?: string;
      with?: Readonly<Record<string, string | { bind: string }>>;
      set?: Readonly<Record<string, string | { bind: string }>>;
    },
    env: Env,
    at: string,
  ) => {
    if (link.set && link.to) err(at, "link 的 set（改当前页状态）和 to（去别的页）只能写一个");
    if (link.set) checkSet(link.set, env, at);
    if (link.to !== undefined) checkTo(link.to, link.with, env, at);
    else if (link.with) err(at, "with 要和 to 一起写");
  };

  /** 去别的页：路由要存在；带的 with 只能带给“新增表单页”、写进它有的字段。 */
  const checkTo = (
    to: string,
    withArgs: Readonly<Record<string, string | { bind: string }>> | undefined,
    env: Env,
    at: string,
  ) => {
    if (!to.startsWith("/")) return err(at, `to 要以 / 开头：${to}`);
    if (!to.startsWith("/_model") && !matchRoute(patterns, to))
      return err(at, `to 指向的路由 ${to} 没有对应页面`);
    for (const [k, v] of Object.entries(withArgs ?? {})) {
      const target = matchRoute(patterns, to);
      const c = target ? pages[target.pattern]?.ctx : null;
      if (!c || !c.create) err(at, `with 只能带给“新增表单页”：${to} 不是`);
      else {
        const fd = fieldOf(c.type, k);
        if (!fd) err(at, `with 的键 ${k} 不是类型 ${c.type} 的字段`);
        else if (fd.internal) err(at, `with 的键 ${k} 是 internal，公开表单里没有它`);
      }
      if (typeof v !== "string") checkBind(v.bind, env, at);
    }
  };

  const check = (n: Node, env: Env, ctx: PageCtx, at: string, depth: number): void => {
    if (n.w !== undefined && !(Number.isFinite(n.w) && n.w > 0)) err(at, "span 的份数要是正数");
    if (n.when) checkWhen(n.when, env, at);
    if ("group" in n || "each" in n) if (n.link) checkLink(n.link, env, at);

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
      // 嵌套层数只数“纯排版”的组：有 tone / link / rule 的组、each 都带着意思（筛选面、字段表的一行……），不是版式
      const layout = !n.tone && !n.link && !n.rule && !n.seq;
      n.group.forEach((c, i) =>
        check(c, env, ctx, `${at}.group[${i}]`, layout ? depth + 1 : depth),
      );
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
      if (b.ok && n.item) check(n.item, withVar(env, as, b.var), ctx, `${at}.item`, depth);
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
      case "media":
        checkFill(n.fill, env, ctx, at);
        break;
      case "brand":
        checkFill(n.fill, env, ctx, at);
        if (n.to !== undefined && !n.to.startsWith("/")) err(at, `to 要以 / 开头：${n.to}`);
        break;
      case "action": {
        checkFill(n.fill, env, ctx, at);
        if (n.set) {
          if (n.to) err(at, "action 的 set（改当前页状态）和 to（去别的页）只能写一个");
          checkSet(n.set, env, at);
        }
        if (n.to !== undefined) checkTo(n.to, n.with, env, at);
        else if (n.with) err(at, "with 要和 to 一起写");
        break;
      }
      case "nav":
        for (const p of n.paths) if (!pages[p]) err(at, `nav 里的路由 ${p} 不是已有页面的路由模式`);
        break;
      case "form":
        if (!ctx.create) err(at, "form 只能在“新增某类型”的页面里用");
        break;
      case "search":
        freeParam(n.param, env, at, "search");
        checkFill(n.fill, env, ctx, at);
        break;
      case "embed": {
        if (!n.fill || typeof n.fill !== "object" || !("bind" in n.fill)) {
          err(at, 'embed 要绑一个 blocks 字段：embed(bind("body"))');
          break;
        }
        const r = resolveStatic(s, env, n.fill.bind);
        if (!r.ok) err(at, r.error);
        else if (r.target.kind !== "field" || r.target.fd.kind !== "blocks")
          err(at, `embed 要绑 blocks 字段，“${n.fill.bind}”不是`);
        else if (r.target.fd.internal)
          err(at, `字段 "${r.target.field}" 是 internal，不能出现在客户页面上`);
        break;
      }
    }
  };

  /** 一个 blocks 字段里存的树：合法的节点；只能是内容（不能再有 embed / form / nav / brand，保证一定终止）；绑定相对那条记录。 */
  const checkBlocks = (value: unknown, type: string, at: string) => {
    const parsed = parseNodes(value);
    if (!parsed.ok) return err(at, `blocks 的值不是合法的节点树：${parsed.error}`);
    const scope = withVar(pageScope(type), "it", { kind: "record", type });
    const shell = new Set(["embed", "form", "nav", "brand", "search"]);
    const walk = (n: Node, where: string) => {
      if ("group" in n) n.group.forEach((c, i) => walk(c, `${where}.group[${i}]`));
      else if ("each" in n) {
        if (n.item) walk(n.item, `${where}.item`);
      } else if (shell.has(n.slot)) err(where, `blocks 里不能放 ${n.slot}：它是页面的壳，不是内容`);
    };
    parsed.nodes.forEach((n, i) => {
      walk(n, `${at}[${i}]`);
      check(n, scope, { params: [] }, `${at}[${i}]`, 1);
    });
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
          if (
            fd.kind === "blocks" &&
            !(v === undefined || v === "" || (Array.isArray(v) && v.length === 0))
          )
            checkBlocks(v, t, `${rat}.${name}`);
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
          withVar(pageScope(undefined, { state: s.session }), "it", { kind: "record", type: t }),
          { params: [] },
          `${at}.card`,
          1,
        );
    }
  };

  checkModel();

  /** 一个参数的声明：有限取值的要有取值；free 的不能有取值和 multi（它什么字符串都行），可以有 default（页码从 1 起）。 */
  const checkDecl = (decl: ParamDecl, at: string) => {
    if (decl.free) {
      if (decl.values.length || decl.multi) err(at, "free 参数不写 values / multi");
      return;
    }
    if (!decl.values.length) err(at, "取值不能为空");
    if (decl.default !== undefined && !decl.values.includes(decl.default))
      err(at, `default ${decl.default} 不在 values 里`);
    if (decl.multi && decl.default !== undefined) err(at, "多选参数没有 default");
  };

  for (const [pname, decl] of Object.entries(s.session ?? {})) {
    if (!PARAM_RE.test(pname)) err("session", `参数名只能用字母数字下划线横线：${pname}`);
    checkDecl(decl, `session.${pname}`);
    for (const [route, page] of Object.entries(pages))
      if (page.state?.[pname]) err(`pages["${route}"].state.${pname}`, `和会话参数 ${pname} 重名`);
  }

  for (const [pattern, page] of Object.entries(pages)) {
    const at = `pages["${pattern}"]`;
    if (!pattern.startsWith("/")) err(at, "路由要以 / 开头");
    const params = [...pattern.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
    const c = page.ctx ?? null;
    let ctx: PageCtx = { params };
    let env = pageScope(undefined, { state: { ...s.session, ...page.state } });
    for (const [pname, decl] of Object.entries(page.state ?? {})) {
      if (!PARAM_RE.test(pname)) err(`${at}.state`, `参数名只能用字母数字下划线横线：${pname}`);
      checkDecl(decl, `${at}.state.${pname}`);
      const t = page.ctx?.type;
      if (t && s.model[t]?.fields[pname])
        err(
          `${at}.state.${pname}`,
          `参数名和类型 ${t} 的字段重名：筛选的参数就是字段名，换一个名字`,
        );
    }
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
      if (c.many) {
        ctx = { params, listType: c.type };
        env = pageScope(undefined, { listType: c.type, state: { ...s.session, ...page.state } });
      } else if (c.create) ctx = { params, create: c.type };
      else {
        if (!params.length) err(at, `详情页（ctx.type = ${c.type}）的路由要带 :id 参数`);
        env = pageScope(c.type, { state: { ...s.session, ...page.state } });
      }
    }
    if (!page.body?.length) err(at, "页面没有任何板块");
    page.body.forEach((n, i) => {
      if (!("group" in n || "each" in n) || !n.name)
        warn(`${at}.body[${i}]`, '页面顶层应该是带名字的板块：section("名字", …)');
      check(n, env, ctx, `${at}.body[${i}]`, 1);
    });
  }
  if (s.header)
    check(s.header, pageScope(undefined, { state: s.session }), { params: [] }, "header", 1);
  else err("header", "缺少 header");
  if (s.footer)
    check(s.footer, pageScope(undefined, { state: s.session }), { params: [] }, "footer", 1);
  else err("footer", "缺少 footer");

  if (errors.length === 0) warnings.push(...qualityWarnings(s)); // 结构都不对时，“设计问题”没有意义
  return { errors, warnings };
};
