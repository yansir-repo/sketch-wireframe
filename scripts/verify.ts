/**
 * 草图的端到端验证（本机）：真 Chrome 里把整个站点点一遍。检查本身在 src/verify/core.ts（线上的 verify_sketch 用同一份）。
 *
 *   node scripts/verify.ts https://sketch-wireframe.yansir.workers.dev/s/<code>.<key>             # 线上已发布的
 *   node scripts/verify.ts https://sketch-wireframe.yansir.workers.dev/s/<code>.<key>?v=3         # 一个还没上线的预览版本
 *   node scripts/verify.ts http://localhost:5173/s/<code>.<key> --flow my.verify.mjs               # 本机 vp dev
 *
 * --flow：项目自己的流程脚本，默认导出 async ({ page, go, sleep, check, load, base }) => {…}（增删改、上传、提交这类）。范例：examples/catalog.verify.mjs。
 * --json：只输出 JSON。Chrome 找不到就设 CHROME_PATH。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { runChecks, type Flow } from "../src/verify/core.ts";

const USAGE = `用法：node scripts/verify.ts <草图地址[?v=版本]> [--flow <路径>] [--json]`;

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(2);
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);
const findChrome = () =>
  CHROME_CANDIDATES.find((p) => existsSync(p)) ??
  fail("找不到 Chrome：装一个，或者用环境变量 CHROME_PATH 指到可执行文件");

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const i = argv.indexOf(flag);
  return i < 0 ? undefined : argv[i + 1];
};
const jsonOnly = argv.includes("--json");
const target = argv.find((x, i) => !x.startsWith("--") && argv[i - 1] !== "--flow") ?? fail(USAGE);
const flowPath = valueOf("--flow");
const flow = flowPath
  ? ((await import(pathToFileURL(path.resolve(flowPath)).href)).default as Flow)
  : undefined;

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
let results;
try {
  results = await runChecks(await browser.newPage(), {
    base: target,
    flow,
    flowName: flowPath ? path.basename(flowPath) : undefined,
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok && r.level === "error");
if (jsonOnly) console.log(JSON.stringify({ base: target, results }, null, 2));
else {
  for (const r of results)
    console.log(
      `${r.ok ? "✓" : r.level === "error" ? "✗" : "!"} ${r.name}${r.ok || !r.detail ? "" : `\n    ${r.detail}`}`,
    );
  console.log(
    `\n验证：${failed.length ? `${failed.length} 项失败` : "全部通过"}${results.some((r) => !r.ok && r.level === "warn") ? "（另有提示项）" : ""}`,
  );
}
process.exit(failed.length ? 1 : 0);
