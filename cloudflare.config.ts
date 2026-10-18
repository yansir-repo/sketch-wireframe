import { bindings, defineConfig } from "cf/config";

/**
 * The Worker's single runtime fact source. `cf dev` simulates D1 locally under `.cloudflare/state`.
 * The D1 id is filled in when the remote resource exists (docs/deploy.md).
 */
export default defineConfig((ctx) => ({
  accountId: "d1da6c26f60e13fb006a3d4b5dae3f09",
  worker: {
    name: "sketch-wireframe",
    compatibilityDate: "2026-09-08",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/worker/index.ts",
    observability: { enabled: true },
    workersDev: true,
    previewUrls: false,
    assets: {
      // Unknown paths are 404s: the engine's page is only ever served by the Worker, under /s/<code>.<key>.
      notFoundHandling: "none",
      // A sketch's page and data are gated by the key in the path, so the Worker answers them before assets.
      runWorkerFirst: ["/", "/llms.txt", "/s/*", "/mcp", "/admin/mcp"],
    },
    env: {
      DB: bindings.d1({ name: "sketch-wireframe", id: "99c00e0d-5883-4406-8d9f-38538dad0e65" }),
      // The engine bundle as a binding: the Worker serves its shell after a sketch's key checks out.
      ASSETS: bindings.assets(),
      // Browser Rendering for verify_sketch. Remote-only; locally `scripts/verify.ts` drives a local Chrome instead.
      ...(ctx.mode === "development" ? {} : { BROWSER: bindings.browser() }),
      // The operator surface (/admin/mcp) takes `Authorization: Bearer <ADMIN_TOKEN>` (src/worker/operator.ts).
      // Locally it comes from .dev.vars.
      ADMIN_TOKEN: bindings.secret(),
      PUBLIC_URL: bindings.text(
        ctx.mode === "development"
          ? "http://localhost:5173"
          : "https://sketch-wireframe.yansir.workers.dev",
      ),
    },
  },
}));
