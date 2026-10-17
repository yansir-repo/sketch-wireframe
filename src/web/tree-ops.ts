/**
 * 一棵内容树（blocks 字段的值）的编辑操作：纯函数，不碰 DOM。树用节点语法写成数据（和页面同一套），
 * 路径 = 一串下标：[] 是根（一串节点），[2, 0] 是根的第 2 个节点（必须是组）的第 0 个孩子。
 * 编辑器能结构化编辑的是内容常用的几种：文字、图片、媒体占位、按钮、组（含流程）；其余节点（each 等）原样保留，可以移动、删除，内容用 JSON 编辑。
 */
export type TNode = Record<string, unknown>;
export type Tree = TNode[];
export type Path = number[];

export const KINDS = ["text", "image", "media", "action", "col", "row", "grid", "steps"] as const;
export type Kind = (typeof KINDS)[number];

export const fresh = (kind: Kind): TNode => {
  switch (kind) {
    case "text":
      return { slot: "text", size: 3 };
    case "image":
      return { slot: "image" };
    case "media":
      return { slot: "media", kind: "video" };
    case "action":
      return { slot: "action" };
    case "steps":
      return { group: [], dir: "row", seq: true };
    default:
      return { group: [], dir: kind };
  }
};

export const isGroup = (n: TNode): n is TNode & { group: Tree } => Array.isArray(n["group"]);

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** 路径指向的那一串兄弟（父的孩子数组）和下标。 */
const locate = (tree: Tree, path: Path): { siblings: Tree; index: number } | null => {
  if (path.length === 0) return null;
  let siblings = tree;
  for (const i of path.slice(0, -1)) {
    const n = siblings[i];
    if (!n || !isGroup(n)) return null;
    siblings = n.group;
  }
  const index = path[path.length - 1]!;
  return index >= 0 && index < siblings.length ? { siblings, index } : null;
};

/** 往 path 指向的组（[] = 根）末尾加一个新节点。 */
export const add = (tree: Tree, path: Path, kind: Kind): Tree => {
  const next = clone(tree);
  let into = next;
  for (const i of path) {
    const n = into[i];
    if (!n || !isGroup(n)) return tree;
    into = n.group;
  }
  into.push(fresh(kind));
  return next;
};

export const remove = (tree: Tree, path: Path): Tree => {
  const next = clone(tree);
  const at = locate(next, path);
  if (!at) return tree;
  at.siblings.splice(at.index, 1);
  return next;
};

/** 在兄弟里上移（-1）/ 下移（+1）。 */
export const move = (tree: Tree, path: Path, delta: -1 | 1): Tree => {
  const next = clone(tree);
  const at = locate(next, path);
  if (!at) return tree;
  const j = at.index + delta;
  if (j < 0 || j >= at.siblings.length) return tree;
  [at.siblings[at.index], at.siblings[j]] = [at.siblings[j]!, at.siblings[at.index]!];
  return next;
};

/** 改一个节点的一个属性；值是空串/undefined = 去掉这个属性（没填 = 波浪线）。size 转成数字，seq 是布尔。 */
export const update = (
  tree: Tree,
  path: Path,
  key: string,
  value: string | boolean | undefined,
): Tree => {
  const next = clone(tree);
  const at = locate(next, path);
  if (!at) return tree;
  const n = at.siblings[at.index]!;
  if (value === undefined || value === "" || value === false) delete n[key];
  else n[key] = key === "size" ? Number(value) : value;
  return next;
};

/** 是不是一串长得像节点的东西（保存前的粗检；严格的校验在发布时，用同一份 Schema）。 */
export const looksLikeTree = (x: unknown): x is Tree =>
  Array.isArray(x) &&
  x.every(
    (n) =>
      typeof n === "object" &&
      n !== null &&
      !Array.isArray(n) &&
      (typeof (n as TNode)["slot"] === "string" ||
        Array.isArray((n as TNode)["group"]) ||
        typeof (n as TNode)["each"] === "object"),
  );
