/**
 * The tool from a terminal — for people and agents without MCP. Every server-side command is one MCP tool call,
 * so the CLI cannot drift from what MCP clients see; `build` / `check` / `verify` run locally on the same code.
 *
 *   node scripts/do.ts tools                              # tools and their inputs
 *   node scripts/do.ts describe_format                    # the grammar (read this first)
 *   node scripts/do.ts get_example                        # a complete valid sketch
 *   node scripts/do.ts build my.config.ts [--out f.json]  # evaluate a TS config → Sketch JSON
 *   node scripts/do.ts check my.config.ts                 # same check the server runs (local, no network)
 *   node scripts/do.ts publish my.config.ts               # check → publish_sketch (admin): goes live at once
 *   node scripts/do.ts ship my.config.ts [--flow f.mjs]   # check → stage (not live) → verify the preview → promote; a failed verify leaves the live version untouched
 *   node scripts/do.ts audit                              # re-check every published sketch against THIS checkout's schema/validate (deploy runs it)
 *   node scripts/do.ts list_sketches | get_sketch '{"code":"EX-CATALOG"}' | remove_sketch … | rotate_key … | promote_sketch …
 *
 * A config may `import { … } from "sketch-wireframe"` wherever it lives; this process resolves that name to src/shared/dsl.ts.
 * Output: JSON on stdout; exit 0 ok, 1 failed (tool error, check not ok, verify failed), 2 usage.
 * Base URL: `--url` or $SKETCH_URL, else the deployed one. Admin tools go to `/admin/mcp` behind Cloudflare Access
 * (credential from CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET; see access-client.ts); open tools go to `/mcp`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkSketch } from "../src/shared/check.ts";
import { accessHeaders } from "./access-client.ts";

const DEPLOYED = "https://sketch-wireframe.yansir.workers.dev";

const usage = (why: string): never => {
  console.error(
    `${why}\nusage: node scripts/do.ts <tools|build|check|publish|ship|audit|<tool>> [file|'<json args>'] [--url U] [--out F] [--flow F]`,
  );
  process.exit(2);
};

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? usage(`--${name} needs a value`) : v;
};
const base = (flag("url") ?? process.env["SKETCH_URL"] ?? DEPLOYED).replace(/\/$/, "");
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !a.startsWith("{") && !argv[i - 1]?.startsWith("--"),
);
const [command, file] = positional;
const jsonArg = argv.find((a) => a.startsWith("{"));
if (!command) usage("missing command");

/** TS/JS config → Sketch JSON; a .json file is read as is. */
const load = async (f: string | undefined): Promise<unknown> => {
  if (!f) return usage("missing file");
  const abs = path.resolve(f);
  if (abs.endsWith(".json")) return JSON.parse(readFileSync(abs, "utf8"));
  await import(new URL("./dsl-loader.mjs", import.meta.url).href);
  const mod = (await import(pathToFileURL(abs).href)) as { default?: unknown };
  if (!mod.default) return usage(`${f} has no default export (export default defineSketch({...}))`);
  return JSON.parse(JSON.stringify(mod.default));
};

type RpcReply = {
  readonly result?: {
    readonly tools?: ReadonlyArray<{ name: string; description: string; inputSchema: unknown }>;
    readonly isError?: boolean;
    readonly content?: ReadonlyArray<{ type: string; text?: string }>;
    readonly structuredContent?: { readonly result: unknown };
  };
  readonly error?: { readonly message: string };
};

const call = (
  endpoint: "/mcp" | "/admin/mcp",
  method: string,
  params: unknown,
): Promise<RpcReply> =>
  fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(endpoint === "/admin/mcp" ? accessHeaders(base) : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json() as Promise<RpcReply>);

const OPEN = new Set(["describe_format", "get_schema", "get_example", "check_sketch"]);

/** One tool call that reports failure instead of exiting (ship needs to decide what a failure means). */
const attempt = async (
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> => {
  const reply = await call(OPEN.has(name) ? "/mcp" : "/admin/mcp", "tools/call", {
    name,
    arguments: args,
  });
  if (reply.error) return { ok: false, message: reply.error.message };
  if (reply.result?.isError)
    return { ok: false, message: reply.result.content?.[0]?.text ?? "tool failed" };
  return { ok: true, value: reply.result?.structuredContent?.result ?? null };
};

/** One tool call; exits 1 with the tool's message on failure. */
const tool = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const r = await attempt(name, args);
  if (!r.ok) {
    console.error(r.message);
    process.exit(1);
  }
  return r.value;
};

/** 字符串结果（指南、范例源码）原样打印，其余是 JSON。 */
const print = (v: unknown) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));

const printReport = (r: ReturnType<typeof checkSketch>) => {
  for (const e of r.errors) console.error(`✗ ${e}`);
  for (const w of r.warnings) console.error(`! ${w}`);
  console.error(r.ok ? `ok（${r.warnings.length} 条提示）` : `不能发布：${r.errors.length} 个错误`);
};

/** 本机 Chrome 验证（可带项目流程脚本）。url 可以是预览地址（?v=）。 */
const verify = (url: string): number =>
  spawnSync(
    "node",
    [
      new URL("./verify.ts", import.meta.url).pathname,
      url,
      ...(flag("flow") ? ["--flow", flag("flow")!] : []),
    ],
    { stdio: "inherit" },
  ).status ?? 1;

switch (command) {
  case "tools": {
    const reply = await call("/admin/mcp", "tools/list", {});
    print(reply.result?.tools ?? []);
    break;
  }
  case "build": {
    const sketch = await load(file);
    const out = flag("out");
    if (out) writeFileSync(out, JSON.stringify(sketch, null, 2));
    else print(sketch);
    break;
  }
  case "check": {
    const report = checkSketch(await load(file));
    printReport(report);
    print({ ok: report.ok, errors: report.errors, warnings: report.warnings });
    process.exit(report.ok ? 0 : 1);
    break;
  }
  case "publish": {
    const sketch = await load(file);
    const report = checkSketch(sketch);
    printReport(report);
    if (!report.ok) process.exit(1);
    print(await tool("publish_sketch", { sketch }));
    break;
  }
  case "ship": {
    // 验证通过才上线：先暂存（正在对外的版本不动），在预览地址上验证，通过了再 promote。验证不过 = 对外的版本一点没变。
    const sketch = await load(file);
    const report = checkSketch(sketch);
    printReport(report);
    if (!report.ok) process.exit(1);
    const staged = (await tool("publish_sketch", { sketch, live: false })) as {
      code: string;
      staged: number;
      version: number;
      previewUrl: string;
      url: string;
    };
    console.error(
      `暂存为 v${staged.staged}（对外的仍是 ${staged.version ? `v${staged.version}` : "（还没有）"}）：${staged.previewUrl}`,
    );

    // 线上浏览器（Browser Rendering）先点一遍；本机 vp dev 没有这个绑定，就用本机 Chrome。
    const remote = await attempt("verify_sketch", { code: staged.code, version: staged.staged });
    let localNeeded = !!flag("flow");
    if (remote.ok) {
      const v = remote.value as {
        ok: boolean;
        failed: Array<{ name: string; detail?: string }>;
        checked: number;
      };
      console.error(
        `线上浏览器验证：${v.ok ? `${v.checked} 项全部通过` : `${v.failed.length} 项失败`}`,
      );
      for (const f of v.failed) console.error(`✗ ${f.name}${f.detail ? `\n    ${f.detail}` : ""}`);
      if (!v.ok) {
        console.error(`没有上线。修好之后重新 ship；要放弃这一版不用做任何事（它只是暂存）。`);
        process.exit(1);
      }
    } else if (/not available here/.test(remote.message)) {
      console.error(`线上浏览器不可用（${base}），改用本机 Chrome`);
      localNeeded = true;
    } else {
      console.error(remote.message);
      process.exit(1);
    }
    if (localNeeded && verify(staged.previewUrl) !== 0) {
      console.error("本机验证没通过，没有上线。");
      process.exit(1);
    }
    const live = (await tool("promote_sketch", { code: staged.code, version: staged.staged })) as {
      url: string;
      version: number;
    };
    console.error(
      `已上线 v${live.version}（之前对外的是 ${staged.version ? `v${staged.version}` : "没有"}）`,
    );
    print({ url: live.url, version: live.version });
    break;
  }
  case "audit": {
    // 兼容门禁：单 Worker 意味着所有已发布的草图共用同一份引擎和校验。改了 schema/validate/引擎之前，
    // 先用“本地这份代码”把线上每一份草图重新体检一遍——会被拒的就是改坏了的。
    const all = (await tool("list_sketches", {})) as Array<{ code: string }>;
    let broken = 0;
    for (const m of all) {
      const g = (await tool("get_sketch", { code: m.code })) as { sketch: unknown };
      const r = checkSketch(g.sketch);
      console.error(`${r.ok ? "✓" : "✗"} ${m.code}${r.ok ? "" : `\n  ${r.errors.join("\n  ")}`}`);
      if (!r.ok) broken++;
    }
    print({ checked: all.length, broken });
    process.exit(broken ? 1 : 0);
    break;
  }
  default: {
    const args: Record<string, unknown> = jsonArg
      ? (JSON.parse(jsonArg) as Record<string, unknown>)
      : {};
    if (command === "check_sketch" && file) args["sketch"] = await load(file);
    print(await tool(command, args));
  }
}
