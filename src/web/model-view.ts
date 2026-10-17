/**
 * 模型视图：由模型推出来的增删改，不需要任何表达——每个类型一张表、一个新增/编辑表单。
 * 它展示的是“数据模型 + 行为”，不是页面结构，所以客户看不到入口：只有知道地址（#/_model）的人能进，给 agent 和设计师看结构、试增删改。
 * 真·CRUD：增删改立即生效、状态落 localStorage（见 db.ts）。
 */
import { isLinkKind } from "../shared/schema.ts";
import { ZH } from "../shared/strings.ts";
import type { Db } from "./db.ts";
import { renderForm } from "./fields.ts";
import { applySel, facetHtml, facetsOf, parseQuery, toQuery, type Sel } from "./facets.ts";
import { display, esc, isEmpty } from "./fmt.ts";
import type { Sketch } from "../shared/schema.ts";

const sec = (name: string, inner: string) =>
  `<section class="grp col sec" data-section="${esc(name)}"><span class="block-tag">${esc(name)}</span>${inner}</section>`;

const typeTabs = (s: Sketch, current?: string) =>
  `<div class="pills tabs">${Object.entries(s.model)
    .map(
      ([t, d]) =>
        `<a class="tab${t === current ? " on" : ""}" href="#/_model/${esc(t)}">${esc(d.label)}</a>`,
    )
    .join("")}<a class="tab" href="#/_model">结构图</a></div>`;

const KIND: Record<string, string> = {
  text: "文字",
  number: "数字",
  bool: "是/否",
  choice: "选一个",
  term: "选词",
  media: "图片",
  list: "参数表",
  blocks: "内容树",
};

/** 数据结构图：每个类型一个框、字段逐行；选词字段连一条箭头到词表。由模型直接画出，不需要任何表达。 */
const erDiagram = (s: Sketch, db: Db): string => {
  const links: Array<[string, string]> = [];
  const box = (t: string) => {
    const d = s.model[t]!;
    const rows = Object.entries(d.fields)
      .map(([n, f]) => {
        if (isLinkKind(f.kind) && f.to && s.model[f.to] && f.to !== t)
          links.push([`er-${t}`, `er-${f.to}`]);
        const how = isLinkKind(f.kind)
          ? `${f.multiple ? "多选" : "单选"}${f.kind === "ref" ? "引用" : ""}→${s.model[f.to!]?.label ?? f.to}`
          : (KIND[f.kind] ?? f.kind);
        return `<div class="erf"><span>${esc(f.label)}${n === d.key ? " ★" : ""}${f.internal ? ' <i class="hint">仅后台</i>' : ""}</span><span class="hint">${esc(how)}</span></div>`;
      })
      .join("");
    const tag = d.vocab ? "词表" : d.public ? "访客可提交" : "内容";
    return `<a class="erbox" id="er-${esc(t)}" href="#/_model/${esc(t)}" data-rough="frame" data-seed="${t.length + 3}"><div class="erh"><b>${esc(d.label)}</b><span class="hint">${tag} · ${db.all(t).length} 条</span></div>${d.vocab ? "" : rows}</a>`;
  };
  const types = Object.keys(s.model);
  const left = types
    .filter((t) => !s.model[t]!.vocab)
    .map(box)
    .join("");
  const right = types
    .filter((t) => s.model[t]!.vocab)
    .map(box)
    .join("");
  const uniq = [...new Map(links.map((l) => [l.join(">"), l])).values()];
  return `<div class="er" data-rough="links" data-seed="5" data-links='${esc(JSON.stringify(uniq))}'><div class="ercol">${left}</div><div class="ercol">${right}</div></div>
    <div class="foot"><span class="hint">点任一框进入这张表，增删改都能试</span> · <a href="#" data-act="reset">重置为初始数据</a></div>`;
};

export type ModelView = { html: string; title: string; notFound?: boolean };

export const renderModelView = (s: Sketch, db: Db, parts: string[], qs = ""): ModelView => {
  const [type, a, b] = parts;
  const crumb = `<div class="crumb"><a href="#/">首页</a> / <a href="#/_model">数据结构</a>${type ? ` / ${esc(s.model[type]?.label ?? type)}` : ""}</div>`;

  if (!type) return { title: "数据结构", html: crumb + sec("数据结构", erDiagram(s, db)) };

  const def = s.model[type];
  if (!def) return { title: "404", html: "", notFound: true };

  if (a === "new" || b === "edit") {
    const key = b === "edit" ? decodeURIComponent(a!) : "";
    const row = key ? db.find(type, key) : null;
    if (key && !row) return { title: "404", html: "", notFound: true };
    return {
      title: key ? `编辑 ${key}` : `新增${def.label}`,
      html:
        crumb +
        typeTabs(s, type) +
        sec(
          key ? `编辑 · ${key}` : `新增 · ${def.label}`,
          renderForm(s, db, type, row ?? null, "model"),
        ),
    };
  }

  // ---- 列表：搜索 + 筛选 + 分页，筛选和客户页共用 facets.ts ----
  const PER = 10;
  const flagged = Object.entries(def.fields)
    .filter(([, fd]) => fd.table)
    .map(([n]) => n);
  const cols = flagged.length
    ? flagged
    : Object.keys(def.fields)
        .filter(
          (n) => n !== def.key && def.fields[n]!.kind !== "media" && def.fields[n]!.kind !== "list",
        )
        .slice(0, 3);
  const facetFields = cols.filter(
    (c) => ["term", "ref", "choice", "bool"].includes(def.fields[c]!.kind) && c !== def.key,
  );
  const qp = new URLSearchParams(qs);
  const q = (qp.get("q") ?? "").trim();
  const sel = parseQuery(qs);
  const base = `#/_model/${type}`;
  const hrefOf = (next: Sel, page = 1) => {
    const parts = [
      q ? `q=${encodeURIComponent(q)}` : "",
      toQuery(next, facetFields),
      page > 1 ? `p=${page}` : "",
    ].filter(Boolean);
    return base + (parts.length ? "?" + parts.join("&") : "");
  };
  const all = db.all(type);
  const media = Object.entries(def.fields).find(([, fd]) => fd.kind === "media")?.[0];
  const text = (r: Record<string, unknown>) =>
    [def.key, ...cols]
      .map((c) => display(s, db, type, r, c, ZH))
      .join(" ")
      .toLowerCase();
  const hits = applySel(all, sel, facetFields).filter(
    (r) => !q || text(r).includes(q.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(hits.length / PER));
  const page = Math.min(pages, Math.max(1, Number(qp.get("p")) || 1));
  let n = 0;
  const facets = facetsOf(s, db, type, facetFields, all, sel, ZH);
  const bar = facetHtml(facets, sel, {
    variant: "bar",
    words: true,
    clear: ZH.clearFilters,
    seed: () => ++n + 500,
    href: (next) => hrefOf(next),
  });
  const cell = (r: Record<string, unknown>, c: string) => {
    const fd = def.fields[c]!;
    if (isEmpty(r[c])) return '<span class="dash">—</span>';
    const v = esc(display(s, db, type, r, c, ZH));
    return fd.kind === "term" || fd.kind === "ref" || fd.kind === "choice"
      ? `<span class="tag">${v}</span>`
      : v;
  };
  const head = `<tr>${media ? "<th></th>" : ""}<th>${esc(def.fields[def.key]?.label ?? def.key)}</th>${cols.map((c) => `<th>${esc(def.fields[c]!.label)}</th>`).join("")}<th></th></tr>`;
  const body = hits
    .slice((page - 1) * PER, page * PER)
    .map((r) => {
      const k = String(r[def.key]);
      const kk = encodeURIComponent(k);
      const photos =
        media && Array.isArray(r[media]) ? (r[media] as Array<{ dataUrl: string }>) : [];
      const thumb = media
        ? `<td class="thumbc">${photos.length ? `<img class="thumb-img" src="${esc(photos[0]!.dataUrl)}" alt="">` : `<span class="thumb-x" data-rough="x" data-seed="${++n + 900}"></span>`}</td>`
        : "";
      const open =
        !def.vocab && !def.public ? `<a href="#/${esc(type)}/${kk}">${esc(k)}</a>` : esc(k);
      return `<tr>${thumb}<td>${open}${db.visible(type, r) ? "" : ' <span class="hint">（客户看不到）</span>'}</td>${cols.map((c) => `<td>${cell(r, c)}</td>`).join("")}<td class="ops"><a class="cbtn sm" href="#/_model/${esc(type)}/${kk}/edit">编辑</a> <a class="cbtn sm" href="#" data-act="del" data-type="${esc(type)}" data-key="${esc(k)}">删除</a></td></tr>`;
    })
    .join("");
  const pager = `<div class="pager"><span class="hint">共 ${hits.length} 条${hits.length !== all.length ? `（全部 ${all.length}）` : ""} · 第 ${page} / ${pages} 页</span>${page > 1 ? `<a class="cbtn sm" href="${esc(hrefOf(sel, page - 1))}">上一页</a>` : ""}${page < pages ? `<a class="cbtn sm" href="${esc(hrefOf(sel, page + 1))}">下一页</a>` : ""}</div>`;
  return {
    title: def.label,
    html:
      crumb +
      typeTabs(s, type) +
      sec(
        `${def.label} · 共 ${all.length} 条`,
        `
      <div class="tbar"><a class="cbtn" href="#/_model/${esc(type)}/new">+ 新增</a><input class="sk-input" data-search data-base="${base}" data-keep="${esc(toQuery(sel, facetFields))}" value="${esc(q)}" placeholder="搜索，回车确认"></div>
      ${bar}
      ${hits.length ? `<table class="grid-table sk">${head}${body}</table>` : '<div class="empty">（没有符合的记录）</div>'}
      ${pager}`,
      ),
  };
};
