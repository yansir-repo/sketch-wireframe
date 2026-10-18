// Bindings and secrets the Worker reads (cloudflare.config.ts; `.dev.vars` locally, `cf workers secrets` in production).
declare namespace Cloudflare {
  interface Env {
    /** Published sketches and their versions (migrations/). */
    DB: D1Database;
    /** The SPA shell (the engine bundle), served after a sketch's key checks out. */
    ASSETS: Fetcher;
    /** Browser Rendering (deployed only): verify_sketch opens a real browser here. */
    BROWSER?: import("@cloudflare/puppeteer").BrowserWorker;
    /** The operator token: `Authorization: Bearer <ADMIN_TOKEN>` opens /admin/mcp. */
    ADMIN_TOKEN: string;
    /** This app's public origin: links handed to agents are built from it. */
    PUBLIC_URL: string;
  }
}
