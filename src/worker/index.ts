/**
 * The Worker. One deployment serves every sketch: the engine bundle is a static asset, a sketch is a row in D1.
 *
 *   GET  /s/<code>.<key>                  the engine's page (only when code + key match)
 *   GET  /s/<code>.<key>/sketch.json      the sketch the engine renders (x-sketch-version: which version)
 *   GET  /s/<code>.<key>/feedback.json    what the client has written so far
 *   POST /s/<code>.<key>/feedback         the client's note on one page   ┐ the only public writes:
 *   POST /s/<code>.<key>/feedback/done    the client closes a round       ┘ append-only, never touch the sketch
 *   POST /mcp                             open: describe_format, get_example, check_sketch
 *   POST /admin/mcp                       Bearer ADMIN_TOKEN: publish, list, remove, feedback, …
 */
import { env } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { BrowserLive } from "./browser.ts";
import { DbLive, type D1Like } from "./db.ts";
import { TOOLS } from "../shared/tools.ts";
import { handleMcp } from "./mcp.ts";
import llms from "../../docs/llms.txt?raw";
import { fillTemplate, renderPage } from "./home.ts";
import { type FeedbackRejected, addNote, closeRound, listForClient } from "./feedback.ts";
import { exampleUrl, parseSketchPath, serve } from "./sketches.ts";
import { OperatorGate, OperatorGateLive } from "./operator.ts";

const ServicesLive = (db: D1Like) =>
  Layer.mergeAll(DbLive(db), OperatorGateLive(env.ADMIN_TOKEN), BrowserLive(env.BROWSER));

const NOT_FOUND = () =>
  HttpServerResponse.text("没有这个草图", { status: 404, headers: { "x-robots-tag": "noindex" } });
// no-cache: a sketch can be promoted or rolled back at any moment; the payload is small, so always revalidate.
const PRIVATE = { "cache-control": "private, no-cache", "x-robots-tag": "noindex" } as const;

const versionParam = (url: URL): number | undefined => {
  const v = Number(url.searchParams.get("v"));
  return Number.isInteger(v) && v > 0 ? v : undefined;
};

/** The gate is the key in the path; right and wrong answers look the same from outside. */
const sketchRoute = (db: D1Like) =>
  HttpRouter.add(
    "GET",
    "/s/*",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, "http://x");
      const parts = parseSketchPath(url.pathname);
      if (!parts) return NOT_FOUND();
      // ?v=<n> previews a specific (possibly not yet live) version; the key is still the gate.
      const version = versionParam(url);
      if (parts.resource === "feedback.json") {
        if (version === undefined) return NOT_FOUND();
        const notes = yield* listForClient(parts.slug, parts.key, version).pipe(
          Effect.provide(ServicesLive(db)),
          Effect.catchTag("FeedbackNotFound", () => Effect.succeed(null)),
        );
        return notes === null
          ? NOT_FOUND()
          : HttpServerResponse.jsonUnsafe(notes, { headers: PRIVATE });
      }
      if (parts.resource === "feedback" || parts.resource === "feedback/done") return NOT_FOUND();
      const served = yield* serve(parts.slug, parts.key, version).pipe(
        Effect.provide(ServicesLive(db)),
      );
      if (served === null) return NOT_FOUND();
      if (parts.resource === "sketch.json")
        return HttpServerResponse.text(served.json, {
          contentType: "application/json",
          headers: { ...PRIVATE, "x-sketch-version": String(served.version) },
        });
      // The engine's page: the SPA shell from the static assets (the path is not an asset, so ask for "/").
      const shell = yield* Effect.promise(() =>
        env.ASSETS.fetch(new Request(`http://${request.headers["host"] ?? "localhost"}/`)),
      );
      const html = yield* Effect.promise(() => shell.text());
      return HttpServerResponse.text(html, {
        contentType: "text/html; charset=utf-8",
        headers: PRIVATE,
      });
    }),
  );

const FeedbackBody = Schema.Struct({
  version: Schema.Number,
  path: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
});
const decodeFeedback = Schema.decodeUnknownEffect(Schema.fromJsonString(FeedbackBody));
const MAX_FEEDBACK_BODY = 8_000;

/** The client's only write: a note on a page, or "I'm done" for the round. Same key gate as reading. */
const feedbackRoute = (db: D1Like) =>
  HttpRouter.add(
    "POST",
    "/s/*",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const parts = parseSketchPath(new URL(request.url, "http://x").pathname);
      if (!parts || (parts.resource !== "feedback" && parts.resource !== "feedback/done"))
        return NOT_FOUND();
      const text = yield* request.text;
      if (text.length > MAX_FEEDBACK_BODY)
        return HttpServerResponse.jsonUnsafe({ error: "太长了" }, { status: 413 });
      const body = yield* decodeFeedback(text).pipe(Effect.orElseSucceed(() => null));
      if (body === null)
        return HttpServerResponse.jsonUnsafe({ error: "请求格式不对" }, { status: 400 });
      const write =
        parts.resource === "feedback"
          ? addNote(parts.slug, parts.key, {
              version: body.version,
              path: body.path ?? "",
              text: body.text ?? "",
            })
          : closeRound(parts.slug, parts.key, body.version);
      return yield* write.pipe(
        Effect.provide(ServicesLive(db)),
        Effect.map((ok) => HttpServerResponse.jsonUnsafe(ok, { headers: PRIVATE })),
        Effect.catchTags({
          FeedbackNotFound: () => Effect.succeed(NOT_FOUND()),
          FeedbackRejected: (e: FeedbackRejected) =>
            Effect.succeed(HttpServerResponse.jsonUnsafe({ error: e.message }, { status: 400 })),
        }),
      );
    }),
  );

/** 首页与 /llms.txt：同一份内容。浏览器（Accept 里有 text/html）拿排好版的页面，其余（agent、curl）拿 markdown 原文。 */
const homeRoute = (db: D1Like, path: "/" | "/llms.txt") =>
  HttpRouter.add(
    "GET",
    path,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const origin = env.PUBLIC_URL.replace(/\/$/, "");
      const example = yield* exampleUrl(origin).pipe(Effect.provide(ServicesLive(db)));
      const text = fillTemplate(llms, origin, example, {
        open: TOOLS.filter((t) => !t.admin),
        admin: TOOLS.filter((t) => t.admin),
      });
      const wantsHtml = path === "/" && (request.headers["accept"] ?? "").includes("text/html");
      return wantsHtml
        ? HttpServerResponse.text(renderPage(text), {
            contentType: "text/html; charset=utf-8",
            headers: { "x-robots-tag": "noindex" },
          })
        : HttpServerResponse.text(text, {
            contentType: "text/markdown; charset=utf-8",
            headers: { "x-robots-tag": "noindex" },
          });
    }),
  );

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const MAX_BODY = 2_000_000;

const mcpRoute = (db: D1Like, path: "/mcp" | "/admin/mcp") =>
  HttpRouter.add(
    "POST",
    path,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const origin = env.PUBLIC_URL.replace(/\/$/, "");
      const admin = path === "/admin/mcp";
      const text = yield* request.text;
      if (text.length > MAX_BODY) return HttpServerResponse.text("body too large", { status: 413 });
      const body = yield* decodeJson(text).pipe(Effect.orElseSucceed(() => null));
      if (body === null)
        return HttpServerResponse.jsonUnsafe(
          { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
          { status: 400 },
        );
      const messages = (Array.isArray(body) ? body : [body]) as ReadonlyArray<
        Record<string, unknown>
      >;
      const answers = yield* Effect.forEach(messages, (m) => handleMcp(m, origin, admin)).pipe(
        Effect.provide(ServicesLive(db)),
      );
      const replies = answers.filter((a) => a !== null);
      if (replies.length === 0) return HttpServerResponse.empty({ status: 202 });
      return HttpServerResponse.jsonUnsafe(Array.isArray(body) ? replies : replies[0], {
        headers: { "mcp-protocol-version": "2025-06-18" },
      });
    }),
  );

/** One web handler per request: a Workers isolate serves requests concurrently, and I/O created for one request cannot be awaited by another. */
const buildHandler = (db: D1Like) =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      sketchRoute(db),
      feedbackRoute(db),
      homeRoute(db, "/"),
      homeRoute(db, "/llms.txt"),
      mcpRoute(db, "/mcp"),
    ),
    {
      disableLogger: true,
    },
  );

/** The operator's surface in its own handler, so the token check covers exactly it; it runs once, before any route. */
const buildAdminHandler = (db: D1Like) =>
  HttpRouter.toWebHandler(mcpRoute(db, "/admin/mcp"), {
    disableLogger: true,
    middleware: (app) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const gate = yield* OperatorGate;
        if (!(yield* gate.allows(request.headers["authorization"])))
          return HttpServerResponse.text("需要运营令牌（Authorization: Bearer）", { status: 401 });
        return yield* app;
      }).pipe(Effect.provide(ServicesLive(db))),
  });

const respond =
  (web: { handler: (r: Request) => Promise<Response>; dispose: () => Promise<void> }) =>
  (request: Request): Promise<Response> =>
    // Read the body out before disposing: the response streams from the runtime being disposed.
    web.handler(request).then((response) =>
      response.arrayBuffer().then((body) => {
        void web.dispose();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }),
    );

export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/admin/mcp")
      return request.method === "POST"
        ? respond(buildAdminHandler(env.DB))(request)
        : Promise.resolve(
            new Response("POST JSON-RPC here", { status: 405, headers: { allow: "POST" } }),
          );
    if (pathname === "/mcp")
      return request.method === "POST"
        ? respond(buildHandler(env.DB))(request)
        : Promise.resolve(
            new Response("POST JSON-RPC here (MCP Streamable HTTP, JSON responses)", {
              status: 405,
              headers: { allow: "POST" },
            }),
          );
    if (
      ((pathname.startsWith("/s/") || pathname === "/" || pathname === "/llms.txt") &&
        request.method === "GET") ||
      (pathname.startsWith("/s/") && request.method === "POST")
    )
      return respond(buildHandler(env.DB))(request);
    return Promise.resolve(new Response("Not found", { status: 404 }));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
