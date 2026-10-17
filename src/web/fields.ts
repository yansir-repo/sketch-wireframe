/**
 * 表单：字段的 kind 决定渲染成哪个 wired-element——跟 zeroY 的 fields/kind 是同一套词汇，
 * 字段定义和控件选择分开，不是每个表单手写一遍“这个用下拉那个用勾选框”。
 * renderField 和 readField 认同一套 data-field/data-value 钩子，互为反函数。
 * 只在“客户/运营真的要填”的地方用（询盘表单、模型视图的新增/编辑），别处占位框就是占位框。
 */
import type { Db } from "./db.ts";
import { esc, asOption, titleField } from "./fmt.ts";
import type { Field, Row, Sketch } from "../shared/schema.ts";
import { scalar } from "../shared/scalar.ts";
import { strings, ZH, type Strings } from "./strings.ts";

export const MAX_PHOTOS = 6;
const KEY_RE = /^[A-Za-z0-9._-]+$/;
const rid = () => "r" + Math.random().toString(36).slice(2, 8);

type Photo = { dataUrl: string; caption?: string };

export const listRowHtml = (
  columns: Record<string, string>,
  row: Row = {},
  L: Strings = ZH,
): string => `
  <div class="lrow" data-row-id="${esc(row.row_id ?? rid())}">
    ${Object.entries(columns)
      .map(
        ([c, label]) =>
          `<wired-input data-col="${esc(c)}" placeholder="${esc(label)}" value="${esc(row[c] ?? "")}"></wired-input>`,
      )
      .join("")}
    <a href="#" data-act="del-row">${esc(L.delete)}</a>
  </div>`;

export const photoHtml = (p: Photo, L: Strings = ZH): string => `
  <div class="pv" data-photo data-src="${esc(p.dataUrl)}" data-caption="${esc(p.caption ?? "")}">
    <img src="${esc(p.dataUrl)}" alt=""><a href="#" data-act="photo-del">${esc(L.remove)}</a>
  </div>`;

/** 上传的图片先在浏览器里压成 JPEG（长边 ≤800px），否则一张手机原图就能把 localStorage 的配额吃光；透明 PNG 先垫白底。 */
export const shrinkImage = (file: File, max = 800): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable image"));
    };
    img.src = url;
  });

const control = (
  s: Sketch,
  db: Db,
  name: string,
  fd: Field,
  value: unknown,
  disabled: boolean,
  L: Strings,
): string => {
  const dis = disabled ? " disabled" : "";
  switch (fd.kind) {
    case "text":
      return fd.multiline
        ? `<wired-textarea rows="3" placeholder="${esc(fd.label)}"${dis}>${esc(value ?? "")}</wired-textarea>`
        : `<wired-input placeholder="${esc(fd.label)}" value="${esc(value ?? "")}"${dis}></wired-input>`;
    case "number":
      return `<wired-input type="number" placeholder="${esc(fd.label)}" value="${esc(value ?? "")}"${dis}></wired-input>`;
    case "bool":
      return `<wired-checkbox ${value ? "checked" : ""}${dis}>${esc(fd.label)}</wired-checkbox>`;
    case "choice": {
      const opts = (fd.options ?? []).map(asOption);
      return fd.radio
        ? `<wired-radio-group selected="${esc(value ?? opts[0]?.value ?? "")}">${opts.map((o) => `<wired-radio name="${esc(o.value)}">${esc(o.label)}</wired-radio>`).join("")}</wired-radio-group>`
        : `<wired-combo selected="${esc(value ?? "")}">${opts.map((o) => `<wired-item value="${esc(o.value)}">${esc(o.label)}</wired-item>`).join("")}</wired-combo>`;
    }
    case "term":
    case "ref": {
      const target = s.model[fd.to!]!;
      const opts = db.all(fd.to!).map((r) => ({
        value: String(r[target.key]),
        label: String(r[titleField(s, fd.to!)] ?? r[target.key]),
      }));
      if (fd.multiple) {
        const on = new Set((Array.isArray(value) ? value : []).map(String));
        return `<div class="checks">${opts.map((o) => `<wired-checkbox data-value="${esc(o.value)}" ${on.has(o.value) ? "checked" : ""}>${esc(o.label)}</wired-checkbox>`).join("")}</div>`;
      }
      return `<wired-combo selected="${esc(value ?? "")}"><wired-item value="">${esc(L.unselected)}</wired-item>${opts.map((o) => `<wired-item value="${esc(o.value)}">${esc(o.label)}</wired-item>`).join("")}</wired-combo>`;
    }
    case "media": {
      const photos = (Array.isArray(value) ? value : []) as Photo[];
      return `<div data-media>
        <div class="pvs">${photos.map((p) => photoHtml(p, L)).join("")}</div>
        <button type="button" class="btn small" data-rough="btn" data-seed="12" data-act="pick-photos">${esc(L.uploadImages)}</button>
        <input type="file" accept="image/*" multiple hidden data-photo-input>
        <span class="hint">${esc(L.maxPhotosHint(MAX_PHOTOS))}</span>
      </div>`;
    }
    case "list": {
      const rows = (Array.isArray(value) ? value : []) as Row[];
      return `<div data-list data-columns="${esc(JSON.stringify(fd.columns))}">
        ${rows.map((r) => listRowHtml(fd.columns!, r, L)).join("")}
        <a href="#" class="pill" data-rough="pill" data-seed="13" data-act="add-row">${esc(L.addRow)}</a>
      </div>`;
    }
  }
};

export const renderField = (
  s: Sketch,
  db: Db,
  name: string,
  fd: Field,
  value: unknown,
  disabled = false,
  L: Strings = strings(s.locale),
  note = "",
): string =>
  `<div class="field" data-field="${esc(name)}" data-kind="${fd.kind}"><div class="fl">${esc(fd.label)}${note ? ` <span class="hint">${esc(note)}</span>` : ""}</div><div class="fc">${control(s, db, name, fd, value, disabled, L)}</div></div>`;

export const readField = (container: Element | Document, name: string, fd: Field): unknown => {
  const wrap = container.querySelector(`[data-field="${name}"]`);
  if (!wrap) return undefined;
  switch (fd.kind) {
    case "text":
      return (
        (wrap.querySelector("wired-textarea, wired-input") as { value?: string } | null)?.value ??
        ""
      ).trim();
    case "number": {
      const v = (
        (wrap.querySelector("wired-input") as { value?: string } | null)?.value ?? ""
      ).trim();
      return v === "" ? "" : Number(v);
    }
    case "bool":
      return !!(wrap.querySelector("wired-checkbox") as { checked?: boolean } | null)?.checked;
    case "choice":
      return fd.radio
        ? ((wrap.querySelector("wired-radio-group") as { selected?: string }).selected ?? "")
        : ((wrap.querySelector("wired-combo") as { selected?: string }).selected ?? "");
    case "term":
    case "ref":
      return fd.multiple
        ? [...wrap.querySelectorAll<HTMLElement & { checked?: boolean }>("wired-checkbox")]
            .filter((c) => c.checked)
            .map((c) => c.dataset.value!)
        : ((wrap.querySelector("wired-combo") as { selected?: string }).selected ?? "");
    case "media":
      return [...wrap.querySelectorAll<HTMLElement>("[data-photo]")].map((el) => ({
        dataUrl: el.dataset.src!,
        caption: el.dataset.caption || undefined,
      }));
    case "list":
      return [...wrap.querySelectorAll<HTMLElement>(".lrow")]
        .map((r) => ({
          row_id: r.dataset.rowId!,
          ...Object.fromEntries(
            [...r.querySelectorAll<HTMLElement & { value?: string }>("wired-input")].map((i) => [
              i.dataset.col!,
              (i.value ?? "").trim(),
            ]),
          ),
        }))
        .filter((r) => Object.entries(r).some(([k, v]) => k !== "row_id" && v !== ""));
  }
};

/** 主键 "id" 且是自动生成的（访客不该填编号）：新建时不显示，编辑时只读显示。 */
const autoKey = (s: Sketch, type: string) => s.model[type]!.key === "id";

/** ?query 里的一个值 → 字段的初始值（多选字段是数组，其余取第一个）。 */
const initialValue = (fd: Field, v: ReadonlyArray<string> | undefined): unknown => {
  if (!v || v.length === 0) return undefined;
  return fd.multiple ? [...v] : v[0];
};

export const renderForm = (
  s: Sketch,
  db: Db,
  type: string,
  row: Row | null,
  mode: "public" | "model",
  /** 地址里带来的初始值（?字段=值）：别处的链接用 action 的 with 把环境带过来，新增表单拿它当初始值。 */
  initial: Readonly<Record<string, ReadonlyArray<string>>> = {},
): string => {
  const def = s.model[type]!;
  const editing = row !== null;
  // 后台界面永远是中文；公开表单跟着草图的 locale
  const L = mode === "model" ? ZH : strings(s.locale);
  const fields = Object.entries(def.fields)
    .filter(([name]) => !(name === def.key && autoKey(s, type) && !editing))
    // 只给后台的字段：访客的公开表单里没有它
    .filter(([, fd]) => mode === "model" || fd.internal !== true)
    .map(([name, fd]) =>
      renderField(
        s,
        db,
        name,
        fd,
        row ? row[name] : initialValue(fd, initial[name]),
        name === def.key && editing,
        L,
        fd.internal ? "（仅后台）" : "",
      ),
    )
    .join("");
  const key = row ? String(row[def.key]) : "";
  return `<div class="form" data-form data-type="${esc(type)}" data-editing="${esc(key)}" data-mode="${mode}" data-lang="${mode === "model" ? "zh" : (s.locale ?? "zh")}">
    ${fields}
    <div class="actions">
      <button type="button" class="btn" data-rough="btn" data-seed="9" data-act="submit">${mode === "public" ? esc(L.submit) : editing ? "保存修改" : "新增保存"}</button>
      ${mode === "model" ? `<a class="btn ghost" data-rough="btn" data-seed="10" href="#/_model/${esc(type)}">取消</a>` : ""}
    </div>
  </div>`;
};

export type SubmitResult =
  | { ok: true; row: Row; created: boolean }
  | { ok: false; message: string };

export const collectRow = (
  s: Sketch,
  db: Db,
  type: string,
  form: Element | Document,
  editingKey: string,
  L: Strings = strings(s.locale),
): SubmitResult => {
  const def = s.model[type]!;
  const existing = editingKey ? db.find(type, editingKey) : undefined;
  const row: Row = { ...existing };
  for (const [name, fd] of Object.entries(def.fields)) {
    if (name === def.key) continue;
    const v = readField(form, name, fd);
    if (v !== undefined) row[name] = v;
  }
  if (editingKey) row[def.key] = editingKey;
  else if (autoKey(s, type)) row[def.key] = db.nextId(type);
  else {
    const k = scalar(readField(form, def.key, def.fields[def.key]!));
    if (!k) return { ok: false, message: L.required(def.fields[def.key]!.label) };
    if (!KEY_RE.test(k))
      return {
        ok: false,
        message: L.keyChars(def.fields[def.key]!.label),
      };
    if (db.find(type, k)) return { ok: false, message: L.exists(k) };
    row[def.key] = k;
  }
  return { ok: true, row, created: !editingKey };
};
