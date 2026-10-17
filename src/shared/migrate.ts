/**
 * 格式 3 → 4：count 填充是 fold 的特例（{fold:{op:"count", of}}）。
 * 格式 2 → 3：filters 槽没有了——它是“改状态参数的链接 + 条件出现”的特例（dsl.ts 的 filters 就是那几行）。
 * 格式 1 → 2：collection / facts / badges / gallery 这四个槽没有了，它们本来就是 each 的特例（dsl.ts 里是几行简写）。
 * 旧版本的草图存在库里，原样不动；读出来（和发布时）统一升级成当前格式，引擎只认当前格式。
 * 这个函数同时是个证明：旧语言里能表达的，新语言一个不少——测试拿旧范例逐个对。
 * 移除条件：库里再没有 v:1 的版本（`do.ts audit` 会数）。
 */
import { FORMAT_VERSION } from "./schema.ts";
import { badges, collection, facts, filters, gallery } from "./dsl.ts";

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

/** 对每个节点（递归进组）做一次改写；改写函数只管叶子。 */
const mapNodes = (n: unknown, leaf: (n: Json) => unknown): unknown => {
  if (!isObj(n)) return n;
  if (Array.isArray(n["group"]))
    return { ...n, group: (n["group"] as unknown[]).map((c) => mapNodes(c, leaf)) };
  if (isObj(n["each"])) return n["item"] ? { ...n, item: mapNodes(n["item"], leaf) } : n;
  return leaf(n);
};

const toV2Leaf = (n: Json): unknown => {
  const w = typeof n["w"] === "number" ? { w: n["w"] } : {};
  switch (n["slot"]) {
    case "collection":
      return {
        ...collection(n["type"] as string, {
          ...(isObj(n["where"]) ? { where: n["where"] as Record<string, string> } : {}),
          ...(typeof n["limit"] === "number" ? { limit: n["limit"] } : {}),
          ...(n["notSelf"] === true ? { notSelf: true } : {}),
        }),
        ...w,
      };
    case "facts":
      return {
        ...facts({
          ...(Array.isArray(n["skip"]) ? { skip: n["skip"] as string[] } : {}),
          ...(Array.isArray(n["only"]) ? { only: n["only"] as string[] } : {}),
        }),
        ...w,
      };
    case "badges":
      return { ...badges(n["field"] as string), ...w };
    case "gallery":
      return { ...gallery(n["field"] as string), ...w };
    default:
      return n;
  }
};

const toV3Leaf = (n: Json): unknown =>
  n["slot"] === "filters"
    ? {
        ...filters(...((n["fields"] as string[] | undefined) ?? [])),
        ...(typeof n["w"] === "number" ? { w: n["w"] } : {}),
      }
    : n;

/** 3 → 4：count 填充成了 fold 的一个特例。 */
const toV4Leaf = (n: Json): unknown => {
  const fill = n["fill"];
  return isObj(fill) && "count" in fill
    ? { ...n, fill: { fold: { op: "count", of: fill["count"] } } }
    : n;
};

/** 把整份草图里的每个节点（页面、页眉页脚、卡片模板）过一遍。 */
const mapSketch = (input: Json, leaf: (n: Json) => unknown, version: number): unknown => {
  const model = isObj(input["model"])
    ? Object.fromEntries(
        Object.entries(input["model"]).map(([t, def]) => [
          t,
          isObj(def) && def["card"] ? { ...def, card: mapNodes(def["card"], leaf) } : def,
        ]),
      )
    : input["model"];
  const pages = isObj(input["pages"])
    ? Object.fromEntries(
        Object.entries(input["pages"]).map(([r, p]) => [
          r,
          isObj(p) && Array.isArray(p["body"])
            ? { ...p, body: (p["body"] as unknown[]).map((b) => mapNodes(b, leaf)) }
            : p,
        ]),
      )
    : input["pages"];
  return {
    ...input,
    v: version,
    model,
    pages,
    header: mapNodes(input["header"], leaf),
    footer: mapNodes(input["footer"], leaf),
  };
};

/** 旧格式一步步升到当前（v:1 → 2 → 3 → 4）；已经是当前或更新的原样返回。 */
export const migrateSketch = (input: unknown): unknown => {
  let cur = input;
  if (isObj(cur) && cur["v"] === 1) cur = mapSketch(cur, toV2Leaf, 2);
  if (isObj(cur) && cur["v"] === 2) cur = mapSketch(cur, toV3Leaf, 3);
  if (isObj(cur) && cur["v"] === 3) cur = mapSketch(cur, toV4Leaf, 4);
  return cur;
};

/** 库里存的一份 JSON 文本 → 当前格式的 JSON 文本（已经是当前格式的原样返回）。 */
export const upgradeStored = (json: string): string => {
  const parsed: unknown = JSON.parse(json);
  return isObj(parsed) && typeof parsed["v"] === "number" && parsed["v"] < FORMAT_VERSION
    ? JSON.stringify(migrateSketch(parsed))
    : json;
};
