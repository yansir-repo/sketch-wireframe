/**
 * 配置校验：把“引用对不上”这类错误挡在发布之前，而且给出能直接定位的路径。
 * 纯函数；Node（check.ts）和浏览器（引擎启动时）共用。error 会拦发布，warning 只提示。
 */
import { matchRoute, pagesOf } from "./derive.ts";
import { FIELD_KINDS, SLOT_KINDS, type Field, type Node, type Sketch } from "./schema.ts";
import { scalar } from "./scalar.ts";

export type Report = { errors: string[]; warnings: string[] };

const KEY_RE = /^[A-Za-z0-9._-]+$/;
const KINDS: ReadonlyArray<string> = FIELD_KINDS;
const SLOTS: ReadonlyArray<string> = SLOT_KINDS;
const MAX_GROUP_DEPTH = 4;

type Scope = { recordType?: string; listType?: string; params: string[]; create?: boolean };

export const validate = (s: Sketch): Report => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (at: string, m: string) => errors.push(`${at}：${m}`);
  const warn = (at: string, m: string) => warnings.push(`${at}：${m}`);

  if (!s.code || !/^[A-Za-z0-9-]+$/.test(s.code))
    err("code", `项目编号只能用字母、数字、横线：${JSON.stringify(s.code)}`);
  if (!s.title) err("title", "缺少 title");
  if (!s.model || !Object.keys(s.model).length) err("model", "至少要有一个类型");

  const fieldOf = (type: string, name: string): Field | undefined => s.model[type]?.fields[name];

  // ---- 页面 ----
  const pages = pagesOf(s);
  const patterns = Object.keys(pages);
  if (!pages["/"]) err("pages", '缺少首页 "/"');

  const node = (n: Node, at: string, sc: Scope, depth: number): void => {
    if (n && n.w !== undefined && !(Number.isFinite(n.w) && n.w > 0))
      err(at, "span 的份数要是正数");
    if ("group" in n) {
      if (!n.group.length) err(at, "空的组");
      if (n.dir !== "col" && n.dir !== "row") err(at, `dir 只能是 col/row：${String(n.dir)}`);
      if (depth > MAX_GROUP_DEPTH)
        warn(
          at,
          `组嵌套超过 ${MAX_GROUP_DEPTH} 层：草图表达“放什么”，不是版式——嵌套越深越容易引出版式争论`,
        );
      n.group.forEach((c, i) => node(c, `${at}.group[${i}]`, sc, depth + 1));
      return;
    }
    if (!n || !SLOTS.includes(n.slot)) {
      err(at, `不认识的槽 ${JSON.stringify((n as { slot?: string }).slot)}`);
      return;
    }
    const needRecord = () => {
      if (!sc.recordType) err(at, `${n.slot} 需要在“绑定了一条记录”的页面或卡片里用`);
      return sc.recordType;
    };
    const checkFill = (fill: unknown) => {
      if (fill && typeof fill === "object" && "bind" in fill) {
        const rt = needRecord();
        const head = String((fill as { bind: string }).bind).split(".")[0]!;
        if (rt && !fieldOf(rt, head)) err(at, `绑定的字段 "${head}" 不在类型 ${rt} 里`);
      }
    };
    switch (n.slot) {
      case "text":
        if (![1, 2, 3].includes(n.size)) err(at, `text 的 size 只能是 1/2/3：${n.size}`);
        checkFill(n.fill);
        break;
      case "image":
        checkFill(n.fill);
        break;
      case "action":
        checkFill(n.fill);
        if (n.to !== undefined && !n.to.startsWith("/")) err(at, `to 要以 / 开头：${n.to}`);
        else if (n.to && !n.to.startsWith("/_model") && !matchRoute(patterns, n.to))
          err(at, `to 指向的路由 ${n.to} 没有对应页面`);
        break;
      case "nav":
        for (const p of n.paths) if (!pages[p]) err(at, `nav 里的路由 ${p} 不是已有页面的路由模式`);
        break;
      case "collection": {
        if (!s.model[n.type]) {
          err(at, `collection 的类型 ${n.type} 不存在`);
          break;
        }
        for (const [fld, v] of Object.entries(n.where ?? {})) {
          if (!fieldOf(n.type, fld)) err(at, `where 里的字段 ${fld} 不在类型 ${n.type} 里`);
          if (v.startsWith("$")) {
            const rt = needRecord();
            if (rt && !fieldOf(rt, v.slice(1)))
              err(at, `where 的 ${v} 指向的字段不在类型 ${rt} 里`);
          } else if (v.startsWith(":") && !sc.params.includes(v.slice(1)))
            err(at, `where 的 ${v} 不是本路由的参数`);
        }
        if (n.notSelf && sc.recordType !== n.type) err(at, "notSelf 只能在同类型的详情页里用");
        if (n.limit !== undefined && (!Number.isInteger(n.limit) || n.limit < 1))
          err(at, "limit 要是正整数");
        break;
      }
      case "facts": {
        const rt = needRecord();
        for (const k of n.skip ?? [])
          if (rt && !fieldOf(rt, k)) err(at, `skip 里的字段 ${k} 不在类型 ${rt} 里`);
        break;
      }
      case "filters": {
        const rt = sc.listType ?? sc.recordType;
        if (!rt) {
          err(at, "filters 要放在列表页（ctx.many）或详情页里，才知道在哪个类型上筛选");
          break;
        }
        if (!n.fields.length) err(at, "filters 至少要一个字段");
        for (const name of n.fields) {
          const fd = fieldOf(rt, name);
          if (!fd) err(at, `filters 的字段 ${name} 不在类型 ${rt} 里`);
          else if (!["term", "choice", "bool"].includes(fd.kind))
            err(at, `filters 只能筛 term/choice/bool 字段，${name} 是 ${fd.kind}`);
        }
        break;
      }
      case "badges":
      case "gallery": {
        const rt = needRecord();
        const want = n.slot === "gallery" ? "media" : "term";
        const fd = rt ? fieldOf(rt, n.field) : undefined;
        if (rt && !fd) err(at, `${n.slot} 的字段 ${n.field} 不在类型 ${rt} 里`);
        else if (fd && fd.kind !== want)
          err(at, `${n.slot} 需要 ${want} 字段，${n.field} 是 ${fd.kind}`);
        break;
      }
      case "form":
        if (!sc.recordType) err(at, "form 只能在“新增某类型”的页面里用");
        break;
    }
  };

  // ---- 模型（要在 node 定义之后跑：卡片模板里有节点）----
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
          if (fd.kind === "term" && fd.to && s.model[fd.to]) {
            const target = s.model[fd.to]!;
            const ids = new Set(target.seed.map((x) => String(x[target.key])));
            for (const id of Array.isArray(v) ? v : v === "" || v == null ? [] : [v])
              if (!ids.has(String(id)))
                err(rat, `${name} 引用了词表 ${fd.to} 里没有的条目 "${id}"`);
          }
        }
      });
      for (const k of Object.keys(def.unlisted ?? {}))
        if (!(k in def.fields)) err(at, `unlisted 里的字段 ${k} 没在 fields 里声明`);
      if (def.card) node(def.card, `${at}.card`, { recordType: t, params: [] }, 1);
    }
  };

  checkModel();

  for (const [pattern, page] of Object.entries(pages)) {
    const at = `pages["${pattern}"]`;
    if (!pattern.startsWith("/")) err(at, "路由要以 / 开头");
    const params = [...pattern.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!);
    const c = page.ctx ?? null;
    let sc: Scope = { params };
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
      if (c.many) sc = { params, listType: c.type };
      else if (c.create) sc = { params, recordType: c.type, create: true };
      else {
        if (!params.length) err(at, `详情页（ctx.type = ${c.type}）的路由要带 :id 参数`);
        sc = { params, recordType: c.type };
      }
    }
    if (!page.body?.length) err(at, "页面没有任何板块");
    page.body.forEach((n, i) => {
      if (!("group" in n) || !n.name)
        warn(`${at}.body[${i}]`, '页面顶层应该是带名字的板块：section("名字", …)');
      node(n, `${at}.body[${i}]`, sc, 1);
    });
  }
  if (s.header) node(s.header, "header", { params: [] }, 1);
  else err("header", "缺少 header");
  if (s.footer) node(s.footer, "footer", { params: [] }, 1);
  else err("footer", "缺少 footer");

  return { errors, warnings };
};
