/**
 * 引擎自带、客户会看到的文案：一个地方、两种语言。草图的 `locale`（默认 zh）决定用哪套。
 * 后台（#/_model）是运营的界面，永远是中文——它不走这里。
 * en 的类型是 typeof zh：加一个键两边都得有，漏了编译器会说。
 */
import type { Sketch } from "./schema.ts";

const zh = {
  home: "首页",
  notFound: "页面不存在",
  backHome: "返回首页",
  empty: (label: string) => `（还没有${label}）`,
  emptyFiltered: (label: string) => `（没有符合条件的${label}）`,
  more: (n: number) => `… 共 ${n} 个`,
  clearFilters: "清除筛选",
  menu: "菜单",
  yes: "是",
  no: "否",
  photos: (n: number) => `${n} 张`,
  rows: (n: number) => `${n} 行`,
  blocks: (n: number) => `${n} 块内容`,
  badBlocks: "内容树不是合法的 JSON 节点数组",
  remove: "移除",
  delete: "删除",
  unselected: "（未选）",
  uploadImages: "上传图片",
  maxPhotosHint: (n: number) => `最多 ${n} 张，浏览器里压成小图，只存在这台设备`,
  addRow: "+ 加一行",
  submit: "提交",
  demoSubmitted: "这是草图演示：已记录在这台设备上，不会真的发给任何人——正式表单在网站开发阶段接上",
  storageFull: "浏览器存储空间满了，没保存：少传几张图再试",
  maxPhotos: (n: number) => `最多 ${n} 张`,
  photoUnreadable: (name: string) => `${name} 读不出来，换一张图片`,
  required: (label: string) => `${label}不能为空`,
  keyChars: (label: string) => `${label}会进网址，只能用字母、数字、点、下划线、横线`,
  exists: (key: string) => `${key} 已存在，换一个，或者去编辑它`,
};

export type Strings = typeof zh;

const en: Strings = {
  home: "Home",
  notFound: "Page not found",
  backHome: "Back to home",
  empty: (label) => `(No ${label} yet)`,
  emptyFiltered: (label) => `(No ${label} match these filters)`,
  more: (n) => `… ${n} in total`,
  clearFilters: "Clear filters",
  menu: "Menu",
  yes: "Yes",
  no: "No",
  photos: (n) => `${n} photo${n === 1 ? "" : "s"}`,
  rows: (n) => `${n} row${n === 1 ? "" : "s"}`,
  blocks: (n) => `${n} block${n === 1 ? "" : "s"}`,
  badBlocks: "The content tree is not a valid JSON array of nodes",
  remove: "Remove",
  delete: "Delete",
  unselected: "(none)",
  uploadImages: "Upload images",
  maxPhotosHint: (n) => `Up to ${n}; shrunk in your browser and kept only on this device`,
  addRow: "+ Add a row",
  submit: "Submit",
  demoSubmitted:
    "This is a sketch demo: saved on this device only, nothing is sent — the real form is wired up during the build",
  storageFull: "Browser storage is full and nothing was saved: try fewer images",
  maxPhotos: (n) => `Up to ${n} photos`,
  photoUnreadable: (name) => `${name} could not be read; try another image`,
  required: (label) => `${label} is required`,
  keyChars: (label) =>
    `${label} goes into the address: letters, digits, dot, underscore and dash only`,
  exists: (key) => `${key} already exists`,
};

export const ZH: Strings = zh;

/** 模板里 `ui.xxx` 能取到的键：纯字符串的那些（带参数的函数不是值）。 */
export const UI_KEYS: ReadonlyArray<string> = Object.entries(zh)
  .filter(([, v]) => typeof v === "string")
  .map(([k]) => k);
export const strings = (locale: Sketch["locale"]): Strings => (locale === "en" ? en : zh);

/**
 * 意见框（`web/feedback.ts`）的文案。它是引擎壳子的一部分，不是草图内容，所以不在 `Strings` 里——
 * 否则会被当成草图作者能用的 `ui.xxx`。
 */
const fbZh = {
  open: "给这页提意见",
  close: "关闭",
  title: (path: string) => `对这一页（${path}）的意见`,
  placeholder: "这一页哪里不对、缺什么、想怎么改……",
  send: "发送",
  sent: "已发送",
  none: "这一页还没有意见",
  total: (n: number) => `共 ${n} 条意见（所有页面）`,
  done: "我提完了",
  doneOk: "已提交，谢谢。之后再写的意见会算作新的一轮",
  failed: "没发出去，稍后再试",
};
export type FeedbackStrings = typeof fbZh;
const fbEn: FeedbackStrings = {
  open: "Comment on this page",
  close: "Close",
  title: (path) => `Comments on this page (${path})`,
  placeholder: "What is wrong, missing, or should change on this page…",
  send: "Send",
  sent: "Sent",
  none: "No comments on this page yet",
  total: (n) => `${n} comment${n === 1 ? "" : "s"} in total (all pages)`,
  done: "I'm done",
  doneOk: "Submitted, thank you. Anything you write later counts as a new round",
  failed: "Could not send, try again later",
};
export const feedbackStrings = (locale: Sketch["locale"]): FeedbackStrings =>
  locale === "en" ? fbEn : fbZh;
