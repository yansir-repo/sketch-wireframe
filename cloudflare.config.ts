import { bindings, defineConfig } from "cf/config";

/**
 * The Worker's single runtime fact source. `cf dev` simulates D1 locally under `.cloudflare/state`.
 * The D1 id and the Access audience are filled in when the remote resources exist (docs/deploy.md).
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
      notFoundHandling: "single-page-application",
      // A sketch's page and data are gated by the key in the path, so the Worker answers them before assets.
      runWorkerFirst: ["/s/*", "/mcp", "/admin/mcp"],
    },
    env: {
      DB: bindings.d1({ name: "sketch-wireframe", id: "99c00e0d-5883-4406-8d9f-38538dad0e65" }),
      // The engine bundle as a binding: the Worker serves its shell after a sketch's key checks out.
      ASSETS: bindings.assets(),
      // Browser Rendering for verify_sketch. Remote-only; locally `scripts/verify.ts` drives a local Chrome instead.
      ...(ctx.mode === "development" ? {} : { BROWSER: bindings.browser() }),
      // Cloudflare Access application gating /admin/*. The Worker verifies the forwarded JWT again (src/worker/access.ts).
      ACCESS_TEAM_DOMAIN: bindings.text("nosunthx.cloudflareaccess.com"),
      ACCESS_AUD: bindings.text("d3027610c14287786ad5bb36242a327b9ab567a93ef1b438da9b7cf4bc760b8d"),
      // `cf dev` only: who is "signed in" on localhost (there is no Access there); set it in .dev.vars.
      DEV_USER_EMAIL: bindings.secret(),
      PUBLIC_URL: bindings.text(
        ctx.mode === "development"
          ? "http://localhost:5173"
          : "https://sketch-wireframe.yansir.workers.dev",
      ),
    },
  },
}));
