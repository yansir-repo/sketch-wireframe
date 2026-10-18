# 部署

线上地址：**https://sketch-wireframe.yansir.workers.dev**（workers.dev 子域；以后换自定义域名时改 `cloudflare.config.ts` 的 `PUBLIC_URL`）。

## 资源（2026-10-16 创建）

| 资源 | 名字 / id |
|---|---|
| Worker | `sketch-wireframe`（账户 `d1da6c26f60e13fb006a3d4b5dae3f09`） |
| D1 | `sketch-wireframe` · `99c00e0d-5883-4406-8d9f-38538dad0e65`（表：`sketches`、`sketch_versions`、`feedback`，见 `migrations/`） |

没有 KV / R2 / Durable Object：草图就是 D1 里的 JSON。

## 密钥

`ADMIN_TOKEN`：运营令牌，`Authorization: Bearer` 打开 `/admin/mcp`。放在 `data/prod-secrets.json`（gitignored，权限 600），部署时随 `--secrets-file` 上传；本机脚本（`do.ts`）从 `.dev.vars` 读同一个值。没有别的密钥。

## 运营入口：共享令牌

`/admin/mcp` 只认 `Authorization: Bearer <ADMIN_TOKEN>`，路由前校验一次（`src/worker/operator.ts`），handler 里没有“是谁”的概念。`/s/*`（客户打开草图、写意见）和 `/mcp`（公开、只有不碰存储的工具）不需要凭证。没有网页版运营界面：运营就是 agent，用 `scripts/do.ts` 或 MCP。

- 失败模型：令牌泄露 = 运营接口被滥用；没有“谁做了什么”的审计（所以库里不再记操作者）。
- 取消条件：运营不止一两个人、或要审计时，换成 Cloudflare Access（Worker 里再验一次它转发的 JWT）。
- 换令牌：改 `data/prod-secrets.json` 与 `.dev.vars` 的 `ADMIN_TOKEN`，重新部署；旧令牌立刻失效。

## 发布

`vp run deploy` = `ci`（类型 + lint + 测试 + effect 扫描 + build）→ `audit`（用本地代码重新体检线上每一份草图）→ `cf:ready` → 远程迁移 → `cf:ready` → `cf deploy`。

**`cf:ready`（`scripts/cf-ready.mjs`）**：`cf` 的 OAuth 令牌每小时过期，过期后的**第一个** `cf` 调用会被拒绝（`[7403] The given account is not valid or is not authorized to access this service`），同一个调用顺带完成刷新，之后全部正常——所以以前看起来像是 `cf d1 migrations apply` 随机 403（2026-10-17 在两次令牌到期点实测：到期后第一个调用失败、刷新、下一个成功；用 `cf auth whoami` 先吃掉这一次，随后的 d1 调用就不再失败）。条件：只有登录真的没了才会失败（`cf auth login`）。**`cf` 学会先刷新再用的时候删掉它。**
本地：`vp run db:migrate && vp dev`（`.dev.vars` 里放 `ADMIN_TOKEN`）；`node scripts/do.ts publish … --url http://localhost:5173`。
回滚某份草图：`promote_sketch {code, version}`（上线一个暂存的版本，或退回旧版本）；回滚整个引擎：`cf` 里回退到上一个 Worker 版本（先看 `audit` 能不能过）。
