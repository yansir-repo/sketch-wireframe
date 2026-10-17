/**
 * 写草图配置时用的全部词汇（`import … from "sketch-wireframe"` 解析到这里）：
 *  - builders.ts：语言本身的构建函数（叶子、排列、each 和它的简写）——和 schema.ts 一一对应；
 *  - patterns.ts：常见网站结构的命名组合（hero、列表页、表单页……）——只是 builders 的组合，展开后就是普通的节点树，不进 schema。
 */
export * from "./builders.ts";
export * from "./patterns.ts";
