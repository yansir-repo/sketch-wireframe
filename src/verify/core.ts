/**
 * 草图的端到端验证：真 Chrome 里把整个站点点一遍。agent 不用自己写 puppeteer 脚本，也不用记那些已知的坑。
 *
 *   node scripts/verify.ts https://sketch-wireframe.yansir.workers.dev/s/<code>.<key>      # 线上（发布后）
 *   node scripts/verify.ts http://localhost:5173/s/<code>.<key> --flow my.verify.mjs        # 本机 vp dev
 *
 * 通用检查（所有草图都跑；路由清单来自引擎自己报的 window.__sketch.sampleRoutes()，每个路由模式都有真实可访问的例子）：
 *   - 每个路由：能渲染、不是 404、没有“配置有错误”、手绘叠加层真的画出来了、每个板块都有名字标签、没有未注册的自定义元素、没有横向溢出
 *   - 站内链接：顺着页面里所有 <a href="#/…"> 再走一遍，指向 404 = 坏链
 *   - 保真度不变量：切到“线条”档，非模型视图的页面里不能有任何 [data-copy]——一个字都不许漏，只剩结构
 *   - 图片查看器能打开；控制台零报错、没有失败的请求
 *
 * 项目自己的业务流程（增删改、上传、提交询盘这类）：`--flow` 指向一个脚本，默认导出
 * `async ({ page, go, sleep, check, load, base }) => {…}`。范例：examples/catalog.verify.mjs。
 *
 * 已知的坑已经内置：每次加时间戳绕开缓存、同一个 hash 重复赋值不会触发 hashchange（先跳到别处再回来）、
 * 网络不稳时不等 networkidle（workers.dev/Google Fonts 偶发超时）而是等引擎就绪，并重试。
 */
import type { Page } from "puppeteer-core";

export type Result = { name: string; ok: boolean; level: "error" | "warn"; detail?: string };

export type FlowContext = {
  page: Page;
  go: (hash: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  check: (name: string, ok: boolean, detail?: string, level?: "error" | "warn") => void;
  base: string;
  load: (hash?: string, fidelity?: string) => Promise<void>;
};
export type Flow = (ctx: FlowContext) => Promise<void>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 在一个已经打开的浏览器页面上跑全部检查。页面从哪来不是这里的事：本机是 puppeteer-core + Chrome（scripts/verify.ts），
 * 线上是 Cloudflare Browser Rendering（src/verify/remote.ts，Worker 里的 verify_sketch 工具用它）。base 可以带 ?query（如预览版本 ?v=3）。
 */
export const runChecks = async (
  page: Page,
  o: { base: string; flow?: Flow; flowName?: string },
): Promise<Result[]> => {
  const base = o.base.replace(/[?#].*$/, "") + (new URL(o.base).search ?? "");
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: string, level: "error" | "warn" = "error") => {
    results.push({ name, ok, level, ...(detail ? { detail } : {}) });
  };
  const pageUrl = (fidelity: string) => {
    const u = new URL(o.base);
    u.hash = "";
    u.searchParams.set("t", String(Date.now()));
    u.searchParams.set("fidelity", fidelity);
    return u.toString();
  };
  try {
    await page.setViewport({ width: 1100, height: 900 });

    const problems: string[] = [];
    page.on("pageerror", (e: unknown) =>
      problems.push(`pageerror: ${e instanceof Error ? e.message : String(e)}`),
    );
    page.on("console", (m: { type(): string; text(): string }) => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
        problems.push(`console: ${m.text()}`);
    });
    page.on("response", (r: { status(): number; url(): string }) => {
      if (r.status() >= 400 && !r.url().endsWith("/favicon.ico"))
        problems.push(`${r.status()} ${r.url()}`);
    });
    page.on("requestfailed", (r: { url(): string; failure(): { errorText: string } | null }) => {
      // 字体来自 Google Fonts：国内网络偶发失败，不算草图的错（有回退字体）
      if (!r.url().endsWith("/favicon.ico") && !/fonts\.(googleapis|gstatic)\.com/.test(r.url()))
        problems.push(`请求失败 ${r.url()} ${r.failure()?.errorText ?? ""}`);
    });

    /** 整页加载一次：加时间戳绕缓存，等引擎就绪（不等 networkidle），网络不稳就重试。 */
    const load = async (hash = "#/", fidelity = "words") => {
      for (let attempt = 1; ; attempt++) {
        try {
          await page.goto(pageUrl(fidelity) + hash, {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
          await page.waitForFunction(
            () =>
              (window as unknown as { __sketch?: { ready?: boolean } }).__sketch?.ready !==
              undefined,
            { timeout: 45000 },
          );
          await page.evaluate(async () => {
            const tags = [
              ...new Set(
                [...document.querySelectorAll("*")]
                  .map((e) => e.localName)
                  .filter((n) => n.includes("-")),
              ),
            ];
            await Promise.race([
              Promise.all(tags.map((t) => customElements.whenDefined(t))),
              new Promise((r) => setTimeout(r, 15000)),
            ]);
          });
          await sleep(300);
          return;
        } catch (e) {
          if (attempt >= 4) throw e;
          await sleep(3000);
        }
      }
    };

    /** 站内跳转：目标就是当前 hash 时不会触发 hashchange，所以先跳去别处。 */
    const go = async (hash: string) => {
      const cur = await page.evaluate(() => location.hash);
      if (cur === hash) {
        await page.evaluate(() => (location.hash = "#/__verify__"));
        await sleep(120);
      }
      await page.evaluate((h: string) => (location.hash = h), hash);
      await sleep(380); // 路由渲染 + rAF 里的手绘叠加层
    };

    const inspect = () =>
      page.evaluate(() => {
        const app = document.getElementById("app")!;
        const hosts = [...document.querySelectorAll<HTMLElement>("[data-rough]")].filter(
          (el) => el.offsetWidth >= 4 && el.offsetHeight >= 4,
        );
        return {
          notFound: !!app.querySelector("[data-notfound]"),
          fatal: !!app.querySelector("[data-fatal]"),
          empty: app.children.length === 0,
          undrawn: hosts.filter((el) => !el.querySelector(":scope > svg.rough-overlay path"))
            .length,
          untagged: [...app.querySelectorAll("section[data-section]")].filter(
            (s) => !s.querySelector(":scope > .block-tag"),
          ).length,
          links: [...document.querySelectorAll('a[href^="#/"]')].map((a) =>
            a.getAttribute("href")!,
          ),
          copy: document.querySelectorAll("[data-copy]").length,
          squiggles: document.querySelectorAll(".sq").length,
          title: document.title,
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
          undefinedEls: [
            ...new Set(
              [...document.querySelectorAll("*")]
                .filter((e) => e.localName.includes("-") && !customElements.get(e.localName))
                .map((e) => e.localName),
            ),
          ],
          hasViewer: !!app.querySelector('[data-act="view"]'),
        };
      });

    await load();
    const boot = await page.evaluate(() => {
      const s = (
        window as unknown as { __sketch?: { ready: boolean; errors: string[]; code: string } }
      ).__sketch;
      return { ready: !!s?.ready, errors: s?.errors ?? [], code: s?.code ?? "" };
    });
    check(
      "引擎启动成功（配置没有错误）",
      boot.ready,
      boot.errors.join("  |  ") || "没有读到 window.__sketch",
    );
    if (!boot.ready) throw new Error("引擎没有启动，后面的检查没有意义");
    check(
      "客户页面上没有工具条/警示条/模型视图入口",
      await page.evaluate(
        () => !document.querySelector(".bar, .warn, .tools, a[href^='#/_model']"),
      ),
    );

    const routes: string[] = await page.evaluate(() =>
      (window as unknown as { __sketch: { sampleRoutes(): string[] } }).__sketch.sampleRoutes(),
    );
    check(`引擎给出 ${routes.length} 个路由样例`, routes.length > 1);

    const broken: string[] = [];
    const notDrawn: string[] = [];
    const untagged: string[] = [];
    const overflow: string[] = [];
    const untitled: string[] = [];
    const found = new Set<string>();
    let viewerTested = false;

    const visit = async (p: string, linkCheck: boolean) => {
      await go(`#${p}`);
      const info = await inspect();
      if (info.notFound || info.fatal || info.empty)
        broken.push(`${p}${info.fatal ? "（配置有错误）" : info.empty ? "（空）" : ""}`);
      if (info.undrawn) notDrawn.push(`${p}（${info.undrawn} 个）`);
      if (info.untagged) untagged.push(`${p}（${info.untagged} 个）`);
      if (info.overflowX) overflow.push(p);
      if (!info.title.includes(boot.code)) untitled.push(p);
      if (info.undefinedEls.length)
        check(`${p} 自定义元素都已注册`, false, info.undefinedEls.join(", "));
      if (linkCheck) for (const l of info.links) found.add(l.replace(/^#/, ""));
      if (info.hasViewer && !viewerTested) {
        viewerTested = true;
        await page.click('[data-act="view"]');
        await sleep(500);
        check(
          "图片查看器：点缩略图能打开",
          await page.evaluate(
            () => !!document.querySelector("#viewer-root dialog")?.hasAttribute("open"),
          ),
        );
        await page.evaluate(() =>
          (
            document.querySelector("#viewer-root [data-dialog-close]") as HTMLElement | null
          )?.click(),
        );
        await sleep(500);
      }
      return info;
    };

    for (const r of routes) await visit(r, true);
    check("每个路由都能渲染（没有 404 / 空白 / 配置错误）", broken.length === 0, broken.join("  "));
    check("手绘叠加层都画出来了", notDrawn.length === 0, notDrawn.join("  "));
    check("每个板块都有名字标签", untagged.length === 0, untagged.join("  "));
    check(`页面标题带项目编号 ${boot.code}`, untitled.length === 0, untitled.join("  "), "warn");

    // ---- 站内链接：顺着链接再走一遍，指向 404 = 坏链 ----
    const extra = [...found].filter((l) => !routes.includes(l)).slice(0, 40);
    const badLinks: string[] = [];
    for (const l of extra) {
      await go(`#${l}`);
      const i = await inspect();
      if (i.notFound || i.fatal) badLinks.push(l);
    }
    check(
      `站内链接没有指向 404（另走了 ${extra.length} 个链接）`,
      badLinks.length === 0,
      badLinks.join("  "),
    );
    check("桌面宽度下没有横向溢出", overflow.length === 0, overflow.join("  "), "warn");

    // ---- 数据结构图：每个类型一个框，选词字段连了箭头 ----
    await go("#/_model");
    const er = await page.evaluate(() => ({
      boxes: document.querySelectorAll(".erbox").length,
      arrows: document.querySelectorAll('.er[data-rough="links"] > svg.rough-overlay path').length,
      wanted: JSON.parse(document.querySelector(".er")?.getAttribute("data-links") ?? "[]").length,
    }));
    check(
      "数据结构图：类型都成了框，每条引用画了箭头",
      er.boxes > 0 && er.wanted > 0 && er.arrows >= er.wanted * 3,
      JSON.stringify(er),
    );

    // ---- 保真度不变量：线条档里不能有任何文案 ----
    await page.evaluate(() =>
      (window as unknown as { __sketch: { setFidelity(v: string): void } }).__sketch.setFidelity(
        "lines",
      ),
    );
    await sleep(300);
    const leaked: string[] = [];
    let noSquiggles = 0;
    for (const r of routes.filter((x) => !x.startsWith("/_model"))) {
      await go(`#${r}`);
      const i = await inspect();
      if (i.copy) leaked.push(`${r}（${i.copy} 处）`);
      if (!i.squiggles) noSquiggles++;
    }
    check("线条档：页面里没有任何文案（只剩结构）", leaked.length === 0, leaked.join("  "));
    check(
      "线条档：有文字的地方画成了波浪线",
      noSquiggles < routes.filter((x) => !x.startsWith("/_model")).length,
    );
    await page.evaluate(() =>
      (window as unknown as { __sketch: { setFidelity(v: string): void } }).__sketch.setFidelity(
        "words",
      ),
    );
    await sleep(300);

    // ---- 手机宽度：只看溢出，抽查几个路由 ----
    await page.setViewport({ width: 390, height: 800 });
    const mobileOverflow: string[] = [];
    for (const r of routes.filter((x) => !x.startsWith("/_model")).slice(0, 8)) {
      await go(`#${r}`);
      if ((await inspect()).overflowX) mobileOverflow.push(r);
    }
    check(
      "手机宽度（390px）下没有横向溢出（抽查前 8 个路由）",
      mobileOverflow.length === 0,
      mobileOverflow.join("  "),
      "warn",
    );

    // 窄屏导航：链接收起，菜单按钮点开能看到、再点一个链接就收回去
    await go("#/");
    const nav = await page.evaluate(() => {
      const n = document.querySelector("#header-body nav.nav");
      if (!n) return null;
      const vis = (e: Element | null) => !!e && (e as HTMLElement).offsetParent !== null;
      return {
        toggle: vis(n.querySelector(".nav-toggle")),
        links: vis(n.querySelector(".nav-links")),
      };
    });
    if (nav) {
      check("窄屏：导航收起，只剩菜单按钮", nav.toggle && !nav.links, JSON.stringify(nav));
      await page.click("#header-body .nav-toggle");
      await sleep(150);
      const open = await page.evaluate(() => {
        const l = document.querySelector("#header-body .nav-links");
        return !!l && (l as HTMLElement).offsetParent !== null;
      });
      check("窄屏：点菜单按钮展开导航", open);
      await page.click("#header-body .nav-links a");
      await sleep(300);
      const closed = await page.evaluate(() => !document.querySelector("#header-body nav.open"));
      check("窄屏：点了导航项之后菜单收回去", closed);
    }
    await page.setViewport({ width: 1100, height: 900 });

    // ---- 项目自己的流程 ----
    if (o.flow) {
      await load("#/");
      try {
        await o.flow({ page, go, sleep, check, base, load });
      } catch (e) {
        check(
          `项目流程 ${o.flowName ?? ""} 跑完`,
          false,
          String(e instanceof Error ? e.message : e),
        );
      }
    }

    const uniqueProblems = [...new Set(problems)];
    check(
      "控制台零报错、没有失败的请求",
      uniqueProblems.length === 0,
      uniqueProblems.slice(0, 6).join("  |  "),
    );
  } catch (e) {
    check("验证流程本身没有崩", false, String(e instanceof Error ? e.message : e));
  }
  return results;
};
