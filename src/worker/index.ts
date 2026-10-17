/**
 * The Worker. One deployment serves every sketch: the engine bundle is a static asset, a sketch is a row in D1.
 *
 *   GET  /s/<code>.<key>              the engine's page (only when code + key match)
 *   GET  /s/<code>.<key>/sketch.json  the sketch the engine renders
 *   POST /mcp                         open: describe_format, get_example, check_sketch
 *   POST /admin/mcp                   behind Cloudflare Access: publish, list, remove, …
 *
 * There is no public write endpoint: what visitors "save" in a sketch lives in their own browser.
 */
import { env } from "cloudflare:workers";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { AccessVerifierLive } from "./access.ts";
import { BrowserLive } from "./browser.ts";
import { DbLive, type D1Like } from "./db.ts";
import { handleMcp } from "./mcp.ts";
import { parseSketchPath, serve } from "./sketches.ts";
import { LocalUserLive, actorLabel, currentActor } from "./user.ts";

const Verifier = AccessVerifierLive({
  teamDomain: env.ACCESS_TEAM_DOMAIN,
  audience: env.ACCESS_AUD,
});

const ServicesLive = (db: D1Like) =>
  Layer.mergeAll(DbLive(db), Verifier, LocalUserLive(env.DEV_USER_EMAIL), BrowserLive(env.BROWSER));

const NOT_FOUND = () =>
  HttpServerResponse.text("没有这个草图", { status: 404, headers: { "x-robots-tag": "noindex" } });
// no-cache: a sketch can be promoted or rolled back at any moment; the payload is small, so always revalidate.
const PRIVATE = { "cache-control": "private, no-cache", "x-robots-tag": "noindex" } as const;

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
      const v = Number(url.searchParams.get("v"));
      const version = Number.isInteger(v) && v > 0 ? v : undefined;
      const json = yield* serve(parts.slug, parts.key, version).pipe(
        Effect.provide(ServicesLive(db)),
      );
      if (json === null) return NOT_FOUND();
      if (parts.json)
        return HttpServerResponse.text(json, { contentType: "application/json", headers: PRIVATE });
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

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const MAX_BODY = 2_000_000;

const mcpRoute = (db: D1Like, path: "/mcp" | "/admin/mcp") =>
  HttpRouter.add(
    "POST",
    path,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const origin = env.PUBLIC_URL.replace(/\/$/, "");
      const actor =
        path === "/mcp"
          ? null
          : yield* currentActor(request.headers).pipe(Effect.provide(ServicesLive(db)));
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
      const answers = yield* Effect.forEach(messages, (m) =>
        handleMcp(m, origin, actor ? actorLabel(actor) : null),
      ).pipe(Effect.provide(ServicesLive(db)));
      const replies = answers.filter((a) => a !== null);
      if (replies.length === 0) return HttpServerResponse.empty({ status: 202 });
      return HttpServerResponse.jsonUnsafe(Array.isArray(body) ? replies : replies[0], {
        headers: { "mcp-protocol-version": "2025-06-18" },
      });
    }),
  );

/** One web handler per request: a Workers isolate serves requests concurrently, and I/O created for one request cannot be awaited by another. */
const buildHandler = (db: D1Like) =>
  HttpRouter.toWebHandler(Layer.mergeAll(sketchRoute(db), mcpRoute(db, "/mcp")), {
    disableLogger: true,
  });

/** The operator's surface in its own handler, so the identity check covers exactly it. Access gates the path at the edge; this refuses a request that got here some other way. */
const buildAdminHandler = (db: D1Like) =>
  HttpRouter.toWebHandler(mcpRoute(db, "/admin/mcp"), {
    disableLogger: true,
    middleware: (app) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const actor = yield* currentActor(request.headers);
        if (!actor)
          return HttpServerResponse.text("需要通过 Cloudflare Access 登录", { status: 401 });
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
    if (pathname.startsWith("/s/") && request.method === "GET")
      return respond(buildHandler(env.DB))(request);
    return Promise.resolve(new Response("Not found", { status: 404 }));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
