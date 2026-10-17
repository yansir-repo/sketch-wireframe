# 给 agent 用：怎么直接操作这个工具

人不用网页（没有网页），agent 用 **MCP** 或 **命令行**。两者调的是同一套函数（`src/worker/mcp.ts` 的 `TOOLS` 是唯一来源，`scripts/do.ts` 只是它的壳），所以不会有第二套规则。

## 1. MCP

- 地址：`POST https://sketch-wireframe.yansir.workers.dev/mcp`（本地 `http://localhost:5173/mcp`）
- 传输：MCP Streamable HTTP，**无状态、JSON 响应**（没有会话，没有 SSE；`GET` 返回 405）
- **两个端点**：`/mcp` 公开，只有不碰存储的工具；`/admin/mcp` 在 Cloudflare Access 后面（应用「草图预览 · 运营」），客户端工具和 `[admin]` 工具都有
- 机器用 Access 服务令牌：请求头 `CF-Access-Client-Id` / `CF-Access-Client-Secret`（身份记成 `service:<client id>`）

```sh
claude mcp add --transport http sketch https://sketch-wireframe.yansir.workers.dev/mcp
claude mcp add --transport http sketch-admin https://sketch-wireframe.yansir.workers.dev/admin/mcp \
  --header "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" --header "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"
```

### 工具

| 工具 | 作用 |
|---|---|
| `describe_format` | 草图格式：语法（槽、组、模型、页面）、规则、红线 + JSON Schema。**先读它** |
| `get_example` | 一份完整有效的范例（Sketch JSON + 它的 TS 配置源码） |
| `check_sketch {sketch}` | 不发布，体检：结构（Schema）、语义（引用/路由/seed）、公开预览红线（价格/密码/令牌）。返回 `ok`、`errors`、`warnings` |
| `publish_sketch {sketch}` 🔒 | 体检通过才发布，返回 `url`（`/s/<code>.<key>`）。同一编号永远同一个地址；内容没变不加版本 |
| `list_sketches` 🔒 | 所有已发布草图：地址、版本、谁最后改的 |
| `get_sketch {code}` 🔒 | 元数据 + 当前对外的 JSON |
| `sketch_versions {code}` 🔒 | 版本历史 |
| `rollback_sketch {code, version}` 🔒 | 回到某个旧版本（地址不变） |
| `remove_sketch {code}` 🔒 | 下线：地址立刻失效，历史保留；再发布同一编号会复活原地址 |
| `rotate_key {code}` 🔒 | 换 key：旧链接立刻失效（链接泄露时用） |

### 典型流程

1. `describe_format` → `get_example`
2. 写草图（直接写 JSON，或写 TS 配置再用命令行 `build` 求值）
3. `check_sketch` 直到 `ok`
4. 🔒 `publish_sketch` → 把 `url` 发给客户；改了再发布一次，地址不变

## 2. 命令行

```sh
node scripts/do.ts tools                              # 工具和输入
node scripts/do.ts describe_format
node scripts/do.ts get_example
node scripts/do.ts build my.config.ts [--out f.json]  # TS 配置 → Sketch JSON（本地）
node scripts/do.ts check my.config.ts                 # 同一份体检（本地，不联网）
node scripts/do.ts publish my.config.ts               # 体检 → publish_sketch
node scripts/do.ts ship my.config.ts [--flow f.mjs]   # 体检 → 发布 → 在真 Chrome 里把线上地址点一遍
node scripts/do.ts audit                              # 用本地代码重新体检线上每一份草图（部署前自动跑）
node scripts/do.ts list_sketches | get_sketch '{"code":"EX-CATALOG"}' | remove_sketch … | rotate_key … | rollback_sketch …
```

- 配置里写 `import { … } from "sketch-wireframe"`，不管配置放在哪个仓库、工具仓库在哪个目录：命令行把这个名字解析到本仓库的 `src/shared/dsl.ts`。
- 输出：工具结果的 JSON 在 stdout；退出码 0 成功、1 失败（工具报错 / 体检不过 / 验证不过）、2 用法错误。
- 地址：`--url` 或 `$SKETCH_URL`，默认线上；本机调试用 `--url http://localhost:5173`。
- 凭证：`$CF_ACCESS_CLIENT_ID` / `$CF_ACCESS_CLIENT_SECRET`，其次**当前目录**的 `.dev.vars`（在客户项目仓库里跑时用那个仓库的凭证），再其次本仓库的 `.dev.vars`。对本机 localhost 不需要。

## 3. 验证

`node scripts/verify.ts <草图地址> [--flow 流程脚本]`：真 Chrome（`CHROME_PATH` 可指定）里把整站点一遍——每个路由能渲染、无坏链、手绘层画出来、板块都有标签、
**线条档零文案**、客户页没有工具条/后台入口、数据结构图画出了箭头、控制台零报错；再跑项目自己的流程（增删改、上传、筛选、分页、提交）。范例流程：`examples/catalog.verify.mjs`。
