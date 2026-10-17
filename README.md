# sketch-wireframe

给客户出「规划结构」那一步的**手绘风结构草图**：不是设计稿，而是一个真能点、真能增删改的小网站，只表达“页面放什么、数据长什么样”，字体配色间距都不可表达，客户无处可纠结。

- **agent-first**：没有网页界面。agent 用 MCP（`/mcp`、`/admin/mcp`）或命令行（`scripts/do.ts`），说明书是 `docs/format.md`（语法）和 `docs/agent-api.md`（操作）。
- **单 Worker**：引擎部署一次，草图是 D1 里的 JSON。发布 = 校验后写一行；同一个编号再发布，**地址不变**。
- **一个生成式**：`Node = Slot | Group`，`fill = ∅ | "文案" | bind`；页面是数据模型的影子；筛选、后台、数据结构图都由模型推出来。没填的一律是粗波浪线。

```sh
node scripts/do.ts describe_format        # 语法
node scripts/do.ts get_example            # 标准答案
node scripts/do.ts check my.config.ts     # 体检
node scripts/do.ts ship my.config.ts      # 体检 → 发布 → 真 Chrome 里点一遍
```

线上：`https://sketch-wireframe.yansir.workers.dev`。改代码前读 `AGENTS.md`。技术栈：Effect + Effect Schema、D1、Vite（vite-plus）+ `cf`、roughjs + wired-elements，浏览器引擎不用框架。
