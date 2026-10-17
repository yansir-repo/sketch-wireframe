/**
 * 环境的静态面：模板里每个变量是什么、一个 bind 路径指向哪里。体检（validate）和“哪些字段被展示了”（quality）
 * 走同一棵树、问同一个问题，所以树的遍历和路径的解析只在这里。引擎在运行时对同一套路径求值（web/nodes.ts），语法由这里定义。
 *
 *   路径 = 段.段.段        段 = 名字 | {另一条路径}（字段名本身来自数据：p.{f.field}）
 *   第一段是变量名就从那个变量开始，否则从“当前记录”（最近的那个 record 变量，或页面记录）开始。
 *   @title = 一条记录的显示名。
 */
import { factFields } from "./facts.ts";
import type { Each, Field, Node, Sketch, Source } from "./schema.ts";

export type Var =
  | { readonly kind: "record"; readonly type: string }
  /** fields 来源的一项：label / value / field。names = 这个变量可能取到的字段名（对比表里 p.{f.field} 要用）。 */
  | {
      readonly kind: "entry";
      readonly type: string | undefined;
      readonly names: ReadonlyArray<string>;
    }
  | { readonly kind: "photo" }
  | { readonly kind: "row"; readonly columns: ReadonlyArray<string> };

export type Scope = {
  readonly vars: ReadonlyMap<string, Var>;
  /** 当前记录的变量名（没有 = 页面上没有记录）。 */
  readonly it: string | undefined;
};

/** 页面的环境：有记录的页面（详情页）里，`page` 和 `it` 都是那条记录。 */
export const pageScope = (recordType: string | undefined): Scope =>
  recordType
    ? { vars: new Map([["page", { kind: "record", type: recordType }]]), it: "page" }
    : { vars: new Map(), it: undefined };

// ---- 路径 ----

export type Seg = { readonly lit: string } | { readonly dyn: string };

export const parsePath = (path: string): Seg[] => {
  const out: Seg[] = [];
  let cur = "";
  let i = 0;
  const push = () => {
    if (cur !== "") out.push({ lit: cur });
    cur = "";
  };
  while (i < path.length) {
    const c = path[i]!;
    if (c === "{") {
      push();
      const end = path.indexOf("}", i);
      if (end < 0) {
        cur += path.slice(i);
        break;
      }
      out.push({ dyn: path.slice(i + 1, end) });
      i = end + 1;
      if (path[i] === ".") i++;
      continue;
    }
    if (c === ".") push();
    else cur += c;
    i++;
  }
  push();
  return out;
};

/** 一个 bind 路径静态地指向什么。 */
export type Target =
  | { readonly kind: "field"; readonly type: string; readonly field: string; readonly fd: Field }
  /** 字段名来自数据：可能是 fields 里任何一个。 */
  | { readonly kind: "fields"; readonly type: string; readonly names: ReadonlyArray<string> }
  | {
      readonly kind: "entry-value";
      readonly type: string | undefined;
      readonly names: ReadonlyArray<string>;
    }
  | { readonly kind: "scalar" }
  | { readonly kind: "title"; readonly type: string }
  | { readonly kind: "photo" };

export const resolveStatic = (
  s: Sketch,
  scope: Scope,
  path: string,
):
  | { readonly ok: true; readonly target: Target }
  | { readonly ok: false; readonly error: string } => {
  const segs = parsePath(path);
  if (segs.length === 0) return { ok: false, error: "空的绑定路径" };
  let rest = segs;
  let v: Var | undefined;
  const first = segs[0]!;
  if ("lit" in first && scope.vars.has(first.lit)) {
    v = scope.vars.get(first.lit);
    rest = segs.slice(1);
  } else if (scope.it) v = scope.vars.get(scope.it);
  if (!v) return { ok: false, error: `“${path}”：这里没有当前记录，路径要以变量名开头` };

  if (rest.length === 0) {
    if (v.kind === "photo") return { ok: true, target: { kind: "photo" } };
    if (v.kind === "record") return { ok: true, target: { kind: "title", type: v.type } };
    return {
      ok: false,
      error: `“${path}”：${v.kind === "entry" ? "fields 的一项要取 .label / .value / .field" : "要指明取哪一列"}`,
    };
  }
  const seg = rest[0]!;
  if (rest.length > 1) return { ok: false, error: `“${path}”：路径太长（最多 变量.字段）` };
  if (v.kind === "photo") return { ok: false, error: `“${path}”：图片没有字段` };
  if (v.kind === "row") {
    if ("dyn" in seg || !v.columns.includes(seg.lit))
      return {
        ok: false,
        error: `“${path}”：列表行里没有列 ${"lit" in seg ? seg.lit : "{…}"}（有：${v.columns.join("、")}）`,
      };
    return { ok: true, target: { kind: "scalar" } };
  }
  if (v.kind === "entry") {
    if ("dyn" in seg || !["label", "value", "field"].includes(seg.lit))
      return { ok: false, error: `“${path}”：fields 的一项只有 label / value / field` };
    return {
      ok: true,
      target:
        seg.lit === "value"
          ? { kind: "entry-value", type: v.type, names: v.names }
          : { kind: "scalar" },
    };
  }
  // record
  const def = s.model[v.type];
  if (!def) return { ok: false, error: `类型 ${v.type} 不存在` };
  if ("dyn" in seg) {
    // {f.field}：字段名来自 fields 的一项——它可能是 names 里任何一个，每一个都得是这个类型的字段
    const inner = parsePath(seg.dyn);
    const head = inner[0];
    const last = inner[1];
    const ev = head && "lit" in head ? scope.vars.get(head.lit) : undefined;
    if (
      ev?.kind !== "entry" ||
      inner.length !== 2 ||
      !last ||
      !("lit" in last) ||
      last.lit !== "field"
    )
      return { ok: false, error: `“${path}”：{} 里要写 fields 一项的 .field，如 {f.field}` };
    const bad = ev.names.filter((n) => !def.fields[n]);
    if (bad.length)
      return { ok: false, error: `“${path}”：${bad.join("、")} 不是类型 ${v.type} 的字段` };
    return { ok: true, target: { kind: "fields", type: v.type, names: ev.names } };
  }
  if (seg.lit === "@title") return { ok: true, target: { kind: "title", type: v.type } };
  const fd = def.fields[seg.lit];
  if (!fd) return { ok: false, error: `“${path}”：字段 ${seg.lit} 不在类型 ${v.type} 里` };
  return { ok: true, target: { kind: "field", type: v.type, field: seg.lit, fd } };
};

// ---- 来源：each 给模板绑定的变量 ----

export const bindSource = (
  s: Sketch,
  scope: Scope,
  source: Source,
): { readonly ok: true; readonly var: Var } | { readonly ok: false; readonly error: string } => {
  if ("records" in source) {
    return s.model[source.records]
      ? { ok: true, var: { kind: "record", type: source.records } }
      : { ok: false, error: `records 的类型 ${source.records} 不存在` };
  }
  if ("fields" in source) {
    const f = source.fields;
    let type = f.type;
    if (f.of !== undefined) {
      const v = scope.vars.get(f.of);
      if (!v || v.kind !== "record")
        return { ok: false, error: `fields.of 的 ${f.of} 不是一个记录变量` };
      type = v.type;
    } else if (type === undefined) {
      const v = scope.it ? scope.vars.get(scope.it) : undefined;
      if (!v || v.kind !== "record")
        return {
          ok: false,
          error: "fields 要放在有记录的地方（详情页、或某个 each 里），或者用 type 指明类型",
        };
      type = v.type;
    }
    if (!s.model[type]) return { ok: false, error: `fields 的类型 ${type} 不存在` };
    return { ok: true, var: { kind: "entry", type, names: factFields(s, type, f) } };
  }
  const r = resolveStatic(s, scope, source.items);
  if (!r.ok) return r;
  if (r.target.kind !== "field")
    return { ok: false, error: `items 要指向一个多值字段：“${source.items}”` };
  const fd = r.target.fd;
  if (fd.kind === "term" || fd.kind === "ref")
    return fd.to && s.model[fd.to]
      ? { ok: true, var: { kind: "record", type: fd.to } }
      : { ok: false, error: `items 的字段 ${r.target.field} 指向的类型不存在` };
  if (fd.kind === "media") return { ok: true, var: { kind: "photo" } };
  if (fd.kind === "list")
    return { ok: true, var: { kind: "row", columns: Object.keys(fd.columns ?? {}) } };
  return {
    ok: false,
    error: `items 只能展开 term/ref/media/list 字段，${r.target.field} 是 ${fd.kind}`,
  };
};

export const withVar = (scope: Scope, name: string, v: Var): Scope => {
  const vars = new Map(scope.vars);
  vars.set(name, v);
  return { vars, it: v.kind === "record" ? name : scope.it };
};

// ---- 遍历 ----

export type Visit = (n: Node, scope: Scope, at: string) => void;
export type Failure = (at: string, message: string) => void;

/** 沿树走，每个节点带着它那一处的环境；each 的模板在“多绑了一个变量”的环境里走。 */
export const walkTree = (
  s: Sketch,
  n: Node,
  scope: Scope,
  at: string,
  visit: Visit,
  fail: Failure = () => undefined,
): void => {
  visit(n, scope, at);
  if ("group" in n) {
    n.group.forEach((c, i) => walkTree(s, c, scope, `${at}.group[${i}]`, visit, fail));
    return;
  }
  if ("each" in n) {
    const b = bindSource(s, scope, n.each);
    if (!b.ok) {
      fail(at, b.error);
      return;
    }
    if (n.item)
      walkTree(s, n.item, withVar(scope, (n as Each).as ?? "it", b.var), `${at}.item`, visit, fail);
  }
};
