/**
 * 内容树的编辑器：把一棵树画成可编辑的大纲（每个节点一行，组缩进显示孩子），操作都是 tree-ops.ts 里的纯函数。
 * 事件接线在 mount.ts（data-act="tree-add|tree-del|tree-up|tree-down"、change 的 data-tree-set / data-tree-raw）。
 * 编辑器里的内容是数据（写在种子里的示意内容），所以这里的文字是运营的界面，永远是中文。
 */
import { esc } from "./fmt.ts";
import { KINDS, isGroup, type Kind, type Path, type TNode, type Tree } from "./tree-ops.ts";

const LABEL: Record<Kind, string> = {
  text: "文字",
  image: "图片",
  media: "媒体（视频/地图/图表/图标/文件）",
  action: "按钮",
  col: "纵向组",
  row: "横向组",
  grid: "网格组",
  steps: "流程（有顺序的组）",
};

const attr = (path: Path) => `data-path="${path.join(".")}"`;

const input = (path: Path, key: string, value: unknown, placeholder: string, width = 150) =>
  `<input class="sk-input tiny" ${attr(path)} data-tree-set="${key}" value="${esc(typeof value === "string" ? value : "")}" placeholder="${esc(placeholder)}" style="width:${width}px">`;

const select = (path: Path, key: string, value: unknown, options: Array<[string, string]>) =>
  `<select class="sk-input tiny" ${attr(path)} data-tree-set="${key}">${options
    .map(
      ([v, l]) =>
        `<option value="${esc(v)}"${String(value) === v ? " selected" : ""}>${esc(l)}</option>`,
    )
    .join("")}</select>`;

const addBar = (path: Path) =>
  `<span class="tree-add"><select class="sk-input tiny" data-tree-kind ${attr(path)}>${KINDS.map((k) => `<option value="${k}">${LABEL[k]}</option>`).join("")}</select> <a href="#" class="cbtn sm" data-act="tree-add" ${attr(path)}>+ 加在这里</a></span>`;

const controls = (path: Path) =>
  `<span class="tree-ctl"><a href="#" data-act="tree-up" ${attr(path)} title="上移">▲</a><a href="#" data-act="tree-down" ${attr(path)} title="下移">▼</a><a href="#" data-act="tree-del" ${attr(path)} title="删除">✕</a></span>`;

const row = (path: Path, n: TNode): string => {
  if (isGroup(n)) {
    const isSteps = n["seq"] === true;
    const head = `<span class="tree-kind">${isSteps ? "流程" : "组"}</span> ${select(
      path,
      "dir",
      n["dir"],
      [
        ["col", "纵向"],
        ["row", "横向"],
        ["grid", "网格"],
      ],
    )} ${input(path, "name", n["name"], "板块名（可不填）", 110)} <label class="tree-seq"><input type="checkbox" ${attr(path)} data-tree-set="seq" ${isSteps ? "checked" : ""}> 有顺序</label>`;
    const kids = n.group.map((c, i) => row([...path, i], c)).join("");
    return `<li class="tree-node">${head}${controls(path)}<ul>${kids}<li class="tree-addrow">${addBar(path)}</li></ul></li>`;
  }
  switch (n["slot"]) {
    case "text":
      return `<li class="tree-node"><span class="tree-kind">文字</span> ${select(
        path,
        "size",
        n["size"],
        [
          ["1", "标题"],
          ["2", "副标题"],
          ["3", "正文"],
        ],
      )} ${input(path, "fill", n["fill"], "写了就显示，不写 = 波浪线", 240)}${controls(path)}</li>`;
    case "image":
      return `<li class="tree-node"><span class="tree-kind">图片</span> ${input(path, "fill", n["fill"], "图注（可不填）", 200)}${controls(path)}</li>`;
    case "media":
      return `<li class="tree-node"><span class="tree-kind">媒体</span> ${select(
        path,
        "kind",
        n["kind"],
        [
          ["video", "视频"],
          ["map", "地图"],
          ["chart", "图表"],
          ["icon", "图标"],
          ["file", "文件"],
        ],
      )} ${input(path, "fill", n["fill"], "说明（可不填）", 200)}${controls(path)}</li>`;
    case "action":
      return `<li class="tree-node"><span class="tree-kind">按钮</span> ${input(path, "fill", n["fill"], "按钮文字", 140)} → ${input(path, "to", n["to"], "去哪个路由，如 /inquiry", 170)}${controls(path)}</li>`;
    default:
      return `<li class="tree-node"><span class="tree-kind">其他</span> <span class="hint">${esc(typeof n["slot"] === "string" ? n["slot"] : typeof n["each"] === "object" ? "each" : "节点")}：用下面的 JSON 改它</span>${controls(path)}</li>`;
  }
};

/** 编辑器整体：大纲 + 可折叠的 JSON（任何节点都能在 JSON 里改）。data-tree 是唯一的真相，保存时从它读。 */
export const treeEditorHtml = (
  tree: Tree,
): string => `<div class="tree" data-tree="${esc(JSON.stringify(tree))}">
  <div class="tree-body">${treeBody(tree)}</div>
  <details class="tree-raw"><summary>JSON（改完点别处生效）</summary><textarea class="sk-input" rows="8" data-tree-raw>${esc(JSON.stringify(tree, null, 1))}</textarea></details>
</div>`;

export const treeBody = (tree: Tree): string =>
  `<ul class="tree-root">${tree.map((n, i) => row([i], n)).join("")}<li class="tree-addrow">${addBar([])}</li></ul>`;
