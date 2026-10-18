/**
 * 给 agent 的接口：无状态 MCP（Streamable HTTP，JSON 响应）。工具清单 `TOOLS` 是唯一来源——
 * `scripts/do.ts` 只是它的命令行壳，docs/agent-api.md 与 docs/llms.txt 照它写。
 *
 * 两个端点：`/mcp` 公开，只有不碰存储的工具（读格式、看范例、体检）；`/admin/mcp` 要 Bearer 运营令牌，
 * 多出带 [admin] 的发布/下线/换 key 等。协议子集：initialize、notifications/initialized、ping、tools/list、tools/call。
 */
import { Effect } from "effect";
import example from "../../examples/catalog.config.ts";
import exampleSource from "../../examples/catalog.config.ts?raw";
import formatGuide from "../../docs/format.md?raw";
import { checkSketch } from "../shared/check.ts";
import { sketchJsonSchema } from "../shared/parse.ts";
import { Browser } from "./browser.ts";
import { TOOLS } from "../shared/tools.ts";
import { listForOperator } from "./feedback.ts";
import { get, list, promote, publish, remove, rotateKey, versions } from "./sketches.ts";

export const MCP_PROTOCOL = "2025-06-18";

/** A tool failing in a way the calling agent can read: one line. */
const bad = (message: string) => Effect.fail({ _tag: "ToolError" as const, message });

const field = (args: Record<string, unknown>, name: string) => {
  const v = args[name];
  return typeof v === "string" && v.trim() !== ""
    ? Effect.succeed(v.trim())
    : bad(`missing ${name}`);
};

const optInt = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) ? v : undefined;

const withUrl = <T extends { path: string }>(origin: string, m: T) => ({
  ...m,
  url: `${origin}${m.path}`,
});

const callTool = (name: string, args: Record<string, unknown>, origin: string, admin: boolean) =>
  Effect.gen(function* () {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return yield* bad(`unknown tool ${name}`);
    if (tool.admin && !admin) return yield* bad(`${name} needs the admin endpoint`);
    switch (name) {
      case "describe_format":
        return formatGuide;
      case "get_schema":
        return sketchJsonSchema();
      case "get_example":
        return args["format"] === "json"
          ? (JSON.parse(JSON.stringify(example)) as unknown)
          : exampleSource;
      case "check_sketch": {
        const r = checkSketch(args["sketch"]);
        return { ok: r.ok, errors: r.errors, warnings: r.warnings };
      }
      case "publish_sketch": {
        const p = yield* publish(args["sketch"], { live: args["live"] !== false });
        return { ...withUrl(origin, p), previewUrl: `${origin}${p.path}?v=${p.staged}` };
      }
      case "verify_sketch": {
        const g = yield* get(yield* field(args, "code"), optInt(args["version"]));
        const base = `${origin}${g.path}?v=${g.shown}`;
        const results = yield* (yield* Browser).verify(base);
        const failed = results.filter((r) => !r.ok && r.level === "error");
        return {
          ok: failed.length === 0,
          version: g.shown,
          checked: results.length,
          passed: results.filter((r) => r.ok).map((r) => r.name),
          failed,
          warnings: results.filter((r) => !r.ok && r.level === "warn"),
        };
      }
      case "list_sketches":
        return (yield* list).map((m) => withUrl(origin, m));
      case "get_sketch": {
        const g = yield* get(yield* field(args, "code"), optInt(args["version"]));
        return withUrl(origin, g);
      }
      case "list_feedback":
        return yield* listForOperator(yield* field(args, "code"), optInt(args["after"]));
      case "sketch_versions":
        return yield* versions(yield* field(args, "code"));
      case "promote_sketch": {
        const version = optInt(args["version"]);
        if (version === undefined) return yield* bad("version must be an integer");
        return withUrl(origin, yield* promote(yield* field(args, "code"), version));
      }
      case "remove_sketch":
        return yield* remove(yield* field(args, "code"));
      case "rotate_key":
        return withUrl(origin, yield* rotateKey(yield* field(args, "code")));
    }
    return yield* bad(`unknown tool ${name}`);
  });

/** Every failure a tool can have, as one line (or a few) for the calling agent. */
const errorText = (e: { readonly _tag: string }): string => {
  const x = e as { readonly _tag: string; readonly message?: unknown; readonly what?: unknown };
  return typeof x.message === "string" && x.message !== ""
    ? x.message
    : typeof x.what === "string"
      ? `not found: ${x.what}`
      : x._tag;
};

// ── JSON-RPC ─────────────────────────────────────────────────────────────────────────────────────

type RpcMessage = {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
};

const result = (id: unknown, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** One JSON-RPC message → its response (null for a notification). `admin` is false on the open endpoint. */
export const handleMcp = (message: RpcMessage, origin: string, admin: boolean) =>
  Effect.gen(function* () {
    const id = message.id ?? null;
    const method = typeof message.method === "string" ? message.method : "";
    const params = (
      typeof message.params === "object" && message.params !== null ? message.params : {}
    ) as Record<string, unknown>;
    if (message.id === undefined) return null;
    switch (method) {
      case "initialize":
        return result(id, {
          protocolVersion:
            typeof params["protocolVersion"] === "string"
              ? params["protocolVersion"]
              : MCP_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "sketch-wireframe", version: "0.1.0" },
          instructions:
            "sketch-wireframe: express a client website's structure as a hand-drawn sketch and publish it as a capability URL. Flow: describe_format → get_example → check_sketch (until ok) → publish_sketch (admin endpoint) → send the returned url to the client → list_feedback to read what the client wrote, page by page → publish the next version.",
        });
      case "ping":
        return result(id, {});
      case "tools/list":
        return result(id, {
          tools: TOOLS.filter((t) => admin || !t.admin).map(
            ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
          ),
        });
      case "tools/call": {
        const name = typeof params["name"] === "string" ? params["name"] : "";
        const args = (
          typeof params["arguments"] === "object" && params["arguments"] !== null
            ? params["arguments"]
            : {}
        ) as Record<string, unknown>;
        return yield* callTool(name, args, origin, admin).pipe(
          Effect.map((value) =>
            result(id, {
              // 字符串结果（指南、范例源码）原样给，不再套一层 JSON 转义
              content: [
                {
                  type: "text",
                  text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
                },
              ],
              structuredContent: { result: value },
            }),
          ),
          Effect.catch((e) =>
            Effect.succeed(
              result(id, {
                isError: true,
                content: [{ type: "text", text: errorText(e as { _tag: string }) }],
              }),
            ),
          ),
        );
      }
      default:
        return rpcError(id, -32601, `method not found: ${method}`);
    }
  });
