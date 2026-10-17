/**
 * 格式 1 → 2：collection / facts / badges / gallery 这四个槽没有了，它们本来就是 each 的特例（dsl.ts 里是几行简写）。
 * 旧版本的草图存在库里，原样不动；读出来（和发布时）统一升级成 2，引擎只认 2。
 * 这个函数同时是个证明：旧语言里能表达的，新语言一个不少——测试拿旧范例逐个对。
 * 移除条件：库里再没有 v:1 的版本（`do.ts audit` 会数）。
 */
import { badges, collection, facts, gallery } from "./dsl.ts";

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

const migrateNode = (n: unknown): unknown => {
  if (!isObj(n)) return n;
  if (Array.isArray(n["group"])) return { ...n, group: (n["group"] as unknown[]).map(migrateNode) };
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

export const migrateSketch = (input: unknown): unknown => {
  if (!isObj(input) || input["v"] !== 1) return input;
  const model = isObj(input["model"])
    ? Object.fromEntries(
        Object.entries(input["model"]).map(([t, def]) => [
          t,
          isObj(def) && def["card"] ? { ...def, card: migrateNode(def["card"]) } : def,
        ]),
      )
    : input["model"];
  const pages = isObj(input["pages"])
    ? Object.fromEntries(
        Object.entries(input["pages"]).map(([r, p]) => [
          r,
          isObj(p) && Array.isArray(p["body"])
            ? { ...p, body: (p["body"] as unknown[]).map(migrateNode) }
            : p,
        ]),
      )
    : input["pages"];
  return {
    ...input,
    v: 2,
    model,
    pages,
    header: migrateNode(input["header"]),
    footer: migrateNode(input["footer"]),
  };
};

/** 库里存的一份 JSON 文本 → 当前格式的 JSON 文本（已经是当前格式的原样返回）。 */
export const upgradeStored = (json: string): string => {
  const parsed: unknown = JSON.parse(json);
  return isObj(parsed) && parsed["v"] === 1 ? JSON.stringify(migrateSketch(parsed)) : json;
};
