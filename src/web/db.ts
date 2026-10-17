/**
 * 活数据：种子 + 访客/运营真的做过的增删改。没有后端——这是公开、无登录的草图 Worker，不该有谁都能写的接口；
 * 状态只活在当前浏览器（localStorage），换设备或“重置为初始数据”就没了，这是设计如此。
 *
 * 存储键里带模型+种子的哈希：改了种子/字段重新发布后，客户浏览器里旧的活数据会自动作废，
 * 而不是和新种子混在一起（旧数据的字段形状对不上新模型，渲染会莫名其妙缺东西）。
 */
import type { Row, Sketch } from "../shared/schema.ts";
import { scalar } from "../shared/scalar.ts";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const fnv = (str: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

export type Db = ReturnType<typeof createDb>;

/** 持久化的窄口：浏览器传 localStorage，测试传内存实现，不传 = 不持久。引擎的状态逻辑因此不依赖 DOM。 */
export type Store = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const createDb = (s: Sketch, store?: Store) => {
  const seeds: Record<string, Row[]> = Object.fromEntries(
    Object.entries(s.model).map(([t, d]) => [t, [...d.seed]]),
  );
  const shape = Object.fromEntries(Object.entries(s.model).map(([t, d]) => [t, d.fields]));
  const storageKey = `sketch:${s.code}:${fnv(JSON.stringify({ shape, seeds }))}`;

  const load = (): Record<string, Row[]> | null => {
    try {
      const raw = store?.getItem(storageKey) ?? null;
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  let rows: Record<string, Row[]> = load() ?? clone(seeds);
  const persist = () => {
    try {
      store?.setItem(storageKey, JSON.stringify(rows));
      return true;
    } catch {
      return false; // 配额满（上传的图片是 data URL，吃空间）：调用方要回滚并告诉用户，不能假装存上了
    }
  };
  const keyField = (t: string) => s.model[t]!.key;

  const api = {
    storageKey,
    all: (t: string): Row[] => rows[t] ?? [],
    find: (t: string, key: string): Row | undefined =>
      (rows[t] ?? []).find((r) => String(r[keyField(t)]) === key),
    /** 对客户可见的记录：命中 unlisted 的（草稿）不算。 */
    visible: (t: string, r: Row) =>
      !Object.entries(s.model[t]!.unlisted ?? {}).some(([f, v]) => r[f] === v),
    list: (t: string): Row[] => (rows[t] ?? []).filter((r) => api.visible(t, r)),
    nextId: (t: string) =>
      `${t.slice(0, 1).toUpperCase()}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    /** 新增或覆盖；存不下就还原并返回 false。 */
    put(t: string, row: Row): boolean {
      const before = rows;
      const list = rows[t] ?? [];
      const k = String(row[keyField(t)]);
      const i = list.findIndex((r) => String(r[keyField(t)]) === k);
      rows = { ...rows, [t]: i < 0 ? [...list, row] : list.map((r, j) => (j === i ? row : r)) };
      if (persist()) return true;
      rows = before;
      return false;
    },
    remove(t: string, key: string): void {
      rows = { ...rows, [t]: (rows[t] ?? []).filter((r) => String(r[keyField(t)]) !== key) };
      persist();
    },
    reset(): void {
      rows = clone(seeds);
      try {
        store?.removeItem(storageKey);
      } catch {
        /* 没有 localStorage 也照常工作，只是不持久 */
      }
    },
  };
  return api;
};

/** where：值是 ":参数"（路由参数）、"$字段"（当前记录的字段）或字面量；数组字段按“包含”匹配。 */
export const query = (
  db: Db,
  type: string,
  where: Record<string, string> | undefined,
  scope: { params: Record<string, string>; record?: Row },
  keyOf: (t: string) => string,
  notSelf = false,
): Row[] => {
  let list = db.list(type);
  for (const [field, v] of Object.entries(where ?? {})) {
    const want = v.startsWith(":")
      ? (scope.params[v.slice(1)] ?? "")
      : v.startsWith("$")
        ? scalar(scope.record?.[v.slice(1)])
        : v;
    list = list.filter((r) =>
      Array.isArray(r[field])
        ? (r[field] as unknown[]).map(String).includes(want)
        : scalar(r[field]) === want,
    );
  }
  if (notSelf && scope.record) {
    const k = keyOf(type);
    list = list.filter((r) => r[k] !== scope.record![k]);
  }
  return list;
};
