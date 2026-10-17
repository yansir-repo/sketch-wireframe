# 部署

线上地址：**https://sketch-wireframe.yansir.workers.dev**（workers.dev 子域；以后换自定义域名时改 `cloudflare.config.ts` 的 `PUBLIC_URL`）。

## 资源（2026-10-16 创建）

| 资源 | 名字 / id |
|---|---|
| Worker | `sketch-wireframe`（账户 `d1da6c26f60e13fb006a3d4b5dae3f09`） |
| D1 | `sketch-wireframe` · `99c00e0d-5883-4406-8d9f-38538dad0e65`（表：`sketches`、`sketch_versions`，见 `migrations/`） |
| Access 应用 | 「草图预览 · 运营」· id `20052c88-49c8-48fe-8ac6-6b0d5d35e913` · 只盖 `sketch-wireframe.yansir.workers.dev/admin` 和 `/admin/*` |

没有 KV / R2 / Durable Object：草图就是 D1 里的 JSON。

## 密钥

`DEV_USER_EMAIL`：线上固定为 `none`（声明的 secret 必须存在；只在 localhost 生效）。放在 `data/prod-secrets.json`（gitignored，权限 600），部署时随 `--secrets-file` 上传。没有别的密钥。

## 运营入口：Cloudflare Access

`/s/*`（客户打开草图）和 `/mcp`（公开、只有不碰存储的工具）**不在 Access 里**，否则客户打不开。`/admin/mcp` 在里面：

| 策略 | 谁 |
|---|---|
| 运营（allow） | 与 37-design-order 的「运营」相同的两个邮箱，邮箱验证码，会话 30 天 |
| agent（服务 token，non_identity） | 服务令牌（Client ID/Secret 在本机 `.dev.vars` 的 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`，到期 2027-10-08；令牌本身由账号管理员在 Zero Trust 里签发） |

Worker 里**再验一次** JWT（`src/worker/access.ts`）：绕过边缘到达 Worker 的请求读不到运营接口。机器身份记成 `service:<client id>`。
加管理员：在 Zero Trust 里给该应用的「运营」策略加邮箱。吊销机器入口：改掉那条策略或删服务令牌。
`ACCESS_AUD` 是应用的 audience tag，写在 `cloudflare.config.ts`。

## 发布

`vp run deploy` = `ci`（类型 + lint + 测试 + effect 扫描 + build）→ `audit`（用本地代码重新体检线上每一份草图）→ 远程迁移 → `cf deploy`。
本地：`vp run db:migrate && vp dev`（`.dev.vars` 里 `DEV_USER_EMAIL` 当 localhost 上的“登录者”）；`node scripts/do.ts publish … --url http://localhost:5173`。
回滚某份草图：`promote_sketch {code, version}`（上线一个暂存的版本，或退回旧版本）；回滚整个引擎：`cf` 里回退到上一个 Worker 版本（先看 `audit` 能不能过）。
