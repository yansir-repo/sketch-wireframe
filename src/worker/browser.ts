/**
 * Cloudflare Browser Rendering 作为一个服务：在线上用真浏览器把某个草图地址点一遍（检查本身是 src/verify/core.ts，
 * 和本机 scripts/verify.ts 同一份）。本机 `vp dev` 没有这个绑定：返回一个说得清的失败，调用方（ship）改用本机 Chrome。
 */
import type { BrowserWorker } from "@cloudflare/puppeteer";
import { Context, Data, Effect, Layer } from "effect";
import type { Result } from "../verify/core.ts";
import { verifyRemote } from "../verify/remote.ts";

export class BrowserUnavailable extends Data.TaggedError("BrowserUnavailable")<{
  readonly message: string;
}> {}

export class Browser extends Context.Service<
  Browser,
  { readonly verify: (base: string) => Effect.Effect<ReadonlyArray<Result>, BrowserUnavailable> }
>()("sketch-wireframe/Browser") {}

export const BrowserLive = (binding: BrowserWorker | undefined): Layer.Layer<Browser> =>
  Layer.succeed(Browser, {
    verify: (base) =>
      binding === undefined
        ? Effect.fail(
            new BrowserUnavailable({
              message:
                "browser rendering is not available here (local dev): run scripts/verify.ts with a local Chrome instead",
            }),
          )
        : Effect.tryPromise({
            try: () => verifyRemote(binding, base),
            catch: (e) =>
              new BrowserUnavailable({
                message: `browser rendering failed: ${e instanceof Error ? e.message : String(e)}`,
              }),
          }).pipe(Effect.withSpan("browser.verify")),
  });
