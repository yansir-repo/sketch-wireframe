/**
 * 线上验证：Cloudflare Browser Rendering 里开一个真浏览器，把草图点一遍——和本机 `scripts/verify.ts` 是同一份检查（core.ts），
 * 只是页面来自 BROWSER 绑定。Worker 里的 verify_sketch 工具经 Effect.tryPromise 调它。
 * 项目自己的流程脚本是本机文件，不能在这里跑；要跑它用本机 `scripts/verify.ts --flow`。
 */
import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import type { Page } from "puppeteer-core";
import { runChecks, type Result } from "./core.ts";

export const verifyRemote = async (binding: BrowserWorker, base: string): Promise<Result[]> => {
  const browser = await puppeteer.launch(binding);
  try {
    // @cloudflare/puppeteer 的 Page 与 puppeteer-core 的结构一致，类型声明各写一份；core 只用公共方法。
    const page = (await browser.newPage()) as unknown as Page;
    return await runChecks(page, { base });
  } finally {
    await browser.close();
  }
};
