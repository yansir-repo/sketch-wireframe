/**
 * 给 agent 的接口：无状态 MCP（Streamable HTTP，JSON 响应）。工具清单 `TOOLS` 是唯一来源——
 * `scripts/do.ts` 只是它的命令行壳，docs/agent-api.md 与 public/llms.txt 照它写。
 *
 * 两个端点：`/mcp` 公开，只有不碰存储的工具（读格式、看范例、体检）；`/admin/mcp` 在 Cloudflare Access 后面，
 * 多出带 [admin] 的发布/下线/换 key 等。协议子集：initialize、notifications/initialized、ping、tools/list、tools/call。
 */
import { Effect } from "effect";
import example from "../../examples/catalog.config.ts";
import exampleSource from "../../examples/catalog.config.ts?raw";
import formatGuide from "../../docs/format.md?raw";
import { checkSketch } from "../shared/check.ts";
import { sketchJsonSchema } from "../shared/schema.ts";
import { get, list, publish, remove, rollback, rotateKey, versions } from "./sketches.ts";

export const MCP_PROTOCOL = "2025-06-18";

type JsonSchema = Readonly<Record<string, unknown>>;
type ToolDef = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly admin?: boolean;
};

const str = (description: string): JsonSchema => ({ type: "string", description });
const obj = (
  properties: Record<string, JsonSchema>,
  required: ReadonlyArray<string> = [],
): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const sketchArg: JsonSchema = {
  type: "object",
  description:
    "A Sketch as JSON (see describe_format for the grammar and the JSON Schema; get_example for a complete one).",
};
const code = obj({ code: str("project code, e.g. EX-CATALOG (case-insensitive)") }, ["code"]);

export const TOOLS: ReadonlyArray<ToolDef> = [
  {
    name: "describe_format",
    description:
      "How to express a website's structure as a hand-drawn sketch: the grammar (slots, groups, model, pages), rules, red lines, and the JSON Schema. Read this first.",
    inputSchema: obj({}),
  },
  {
    name: "get_example",
    description:
      "A complete, valid example: the Sketch JSON and the TypeScript config it was built from. The standard answer for shape and style.",
    inputSchema: obj({}),
  },
  {
    name: "check_sketch",
    description:
      "Validate a Sketch without publishing: structure (schema), semantics (references, routes, seeds) and public-preview red lines (prices, passwords, tokens). Returns ok, errors, warnings. Free and side-effect free.",
    inputSchema: obj({ sketch: sketchArg }, ["sketch"]),
  },
  {
    name: "publish_sketch",
    description:
      "[admin] Check, then publish a Sketch. The URL (/s/<code>.<key>) is public to anyone holding the key. The same code keeps the same URL on every re-publish; unchanged content adds no version.",
    inputSchema: obj({ sketch: sketchArg }, ["sketch"]),
    admin: true,
  },
  {
    name: "list_sketches",
    description: "[admin] Every published sketch with its URL, version and who last changed it.",
    inputSchema: obj({}),
    admin: true,
  },
  {
    name: "get_sketch",
    description: "[admin] A published sketch's metadata and the JSON currently served.",
    inputSchema: code,
    admin: true,
  },
  {
    name: "sketch_versions",
    description: "[admin] A sketch's version history, newest first.",
    inputSchema: code,
    admin: true,
  },
  {
    name: "rollback_sketch",
    description: "[admin] Serve an earlier version again (the URL does not change).",
    inputSchema: obj(
      {
        code: str("project code"),
        version: { type: "integer", description: "a version from sketch_versions" },
      },
      ["code", "version"],
    ),
    admin: true,
  },
  {
    name: "remove_sketch",
    description:
      "[admin] Take a sketch offline: its URL stops working at once, history is kept. Publishing the same code again revives the same URL.",
    inputSchema: code,
    admin: true,
  },
  {
    name: "rotate_key",
    description:
      "[admin] Replace a sketch's secret key: the old URL stops working at once (use when a link leaked).",
    inputSchema: code,
    admin: true,
  },
];

/** A tool failing in a way the calling agent can read: one line. */
const bad = (message: string) => Effect.fail({ _tag: "ToolError" as const, message });

const field = (args: Record<string, unknown>, name: string) => {
  const v = args[name];
  return typeof v === "string" && v.trim() !== ""
    ? Effect.succeed(v.trim())
    : bad(`missing ${name}`);
};

const withUrl = <T extends { path: string }>(origin: string, m: T) => ({
  ...m,
  url: `${origin}${m.path}`,
});

const callTool = (
  name: string,
  args: Record<string, unknown>,
  origin: string,
  actor: string | null,
) =>
  Effect.gen(function* () {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return yield* bad(`unknown tool ${name}`);
    if (tool.admin && actor === null) return yield* bad(`${name} needs the admin endpoint`);
    switch (name) {
      case "describe_format":
        return { guide: formatGuide, jsonSchema: sketchJsonSchema() };
      case "get_example":
        return { sketch: JSON.parse(JSON.stringify(example)) as unknown, source: exampleSource };
      case "check_sketch": {
        const r = checkSketch(args["sketch"]);
        return { ok: r.ok, errors: r.errors, warnings: r.warnings };
      }
      case "publish_sketch":
        return withUrl(origin, yield* publish(args["sketch"], actor!));
      case "list_sketches":
        return (yield* list).map((m) => withUrl(origin, m));
      case "get_sketch": {
        const g = yield* get(yield* field(args, "code"));
        return withUrl(origin, g);
      }
      case "sketch_versions":
        return yield* versions(yield* field(args, "code"));
      case "rollback_sketch": {
        const version = args["version"];
        if (typeof version !== "number" || !Number.isInteger(version))
          return yield* bad("version must be an integer");
        return withUrl(origin, yield* rollback(yield* field(args, "code"), version, actor!));
      }
      case "remove_sketch":
        return yield* remove(yield* field(args, "code"), actor!);
      case "rotate_key":
        return withUrl(origin, yield* rotateKey(yield* field(args, "code"), actor!));
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

/** One JSON-RPC message → its response (null for a notification). `actor` is null on the open endpoint. */
export const handleMcp = (message: RpcMessage, origin: string, actor: string | null) =>
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
            "sketch-wireframe: express a client website's structure as a hand-drawn sketch and publish it as a capability URL. Flow: describe_format → get_example → check_sketch (until ok) → publish_sketch (admin endpoint) → send the returned url to the client.",
        });
      case "ping":
        return result(id, {});
      case "tools/list":
        return result(id, {
          tools: TOOLS.filter((t) => actor !== null || !t.admin).map(
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
        return yield* callTool(name, args, origin, actor).pipe(
          Effect.map((value) =>
            result(id, {
              content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
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
