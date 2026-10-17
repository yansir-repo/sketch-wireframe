// 范例草图的业务流程验证：后台增删改、参数行、图片上传、草稿对客户不可见、刷新持久化、访客提交、筛选、分页、搜索。
// `node scripts/verify.ts <url> --flow examples/catalog.verify.mjs`。通用检查（路由/手绘/保真度/控制台）verify.ts 已经跑了，这里不重复。
export default async function flow({ page, go, sleep, check, load }) {
  const CODE = "VERIFY-001";
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const count = (sel) => page.$$eval(sel, (r) => r.length);
  const hash = () => ev(() => location.hash);
  const rows = (type) => ev((t) => window.__sketch.db.all(t).length, type);

  // ---- 新增一个型号：参数行、校验、上传 ----
  await go("#/_model/product/new");
  const before = await rows("product");
  await page.click('[data-field="specs"] [data-act="add-row"]');
  await page.click('[data-field="specs"] [data-act="add-row"]');
  check("参数行：能加行", (await count('[data-field="specs"] .lrow')) === 2);
  await page.$eval(
    '[data-field="specs"] .lrow:first-of-type wired-input[data-col="key"]',
    (el) => (el.value = "尺寸"),
  );
  await page.$eval(
    '[data-field="specs"] .lrow:first-of-type wired-input[data-col="value"]',
    (el) => (el.value = "30cm"),
  );
  await page.click('[data-field="specs"] .lrow:last-of-type [data-act="del-row"]');
  check("参数行：能删行", (await count('[data-field="specs"] .lrow')) === 1);

  await page.$eval('[data-field="code"] wired-input', (el) => (el.value = 'bad"code<'));
  await page.click('[data-act="submit"]');
  await sleep(300);
  check("型号编码带引号/尖括号被拒", (await hash()).endsWith("/new"));

  await page.$eval('[data-field="code"] wired-input', (el, c) => (el.value = c), CODE);
  await page.$eval('[data-field="category"] wired-combo', (el) => (el.selected = "pens"));
  await page.$eval('[data-field="status"] wired-radio-group', (el) => (el.selected = "上架"));

  await ev(async () => {
    const c = document.createElement("canvas");
    c.width = 2000;
    c.height = 1500;
    const x = c.getContext("2d");
    x.fillStyle = "#c33";
    x.fillRect(0, 0, 2000, 1500);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "big.png", { type: "image/png" }));
    const input = document.querySelector("[data-photo-input]");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(900);
  const thumb = await page.$eval(".pv img", (i) => ({ w: i.naturalWidth, h: i.naturalHeight }));
  check(
    "上传：2000×1500 的图被压到长边 ≤800",
    thumb.w <= 800 && thumb.h <= 800,
    `${thumb.w}×${thumb.h}`,
  );

  await page.click('[data-act="submit"]');
  await sleep(600);
  check(
    "新增保存：回到列表，记录数 +1",
    (await hash()) === "#/_model/product" && (await rows("product")) === before + 1,
  );

  // ---- 客户页：用上了后台填的东西 ----
  await go(`#/product/${CODE}`);
  const facts = await page.$$eval(".grp.pair", (r) => r.map((e) => e.textContent.trim()));
  check(
    "详情页显示后台填的参数行",
    facts.some((s) => s.includes("尺寸") && s.includes("30cm")),
    facts.join(" | "),
  );
  check(
    "没填值的参数行存在（显示为波浪线，不是“待填写”）",
    facts.length >= 1 && !facts.some((s) => s.includes("待填写")),
  );
  check("图库显示真实上传的照片", (await count(".thumb .xbox.has-img")) === 1);
  await page.click('.thumb[data-act="view"]');
  await sleep(500);
  const viewer = await ev(() => ({
    open: document.querySelector("#viewer-root dialog").open,
    src: document.querySelector("#viewer-img").src.slice(0, 15),
  }));
  check(
    "点真实照片 → 放大查看",
    viewer.open && viewer.src.startsWith("data:image/jpeg"),
    JSON.stringify(viewer),
  );
  await ev(() => document.querySelector("#viewer-root [data-dialog-close]").click());
  await sleep(500);

  // ---- 生成器的三个用法：对比表、有序流程、带上下文的链接 ----
  await go("#/compare");
  const cmp = await ev(() => ({
    rows: document.querySelectorAll(".grp.ruled > .grp.row").length,
    cells: document.querySelectorAll(".grp.ruled > .grp.row:first-child .grp.row > *").length,
  }));
  check(
    "对比表：每个字段一行，每条记录一格",
    cmp.rows === 3 && cmp.cells === 3,
    JSON.stringify(cmp),
  );
  await go("#/");
  const flow = await ev(() => ({
    no: document.querySelectorAll(".stepno").length,
    sep: document.querySelectorAll(".stepsep").length,
  }));
  check("流程：序号和连接线由引擎画", flow.no === 4 && flow.sep === 3, JSON.stringify(flow));
  await go("#/product/P102");
  await page.click('a[href*="/inquiry?product="]');
  await sleep(500);
  const prefilled = await page.$eval('[data-field="product"] wired-combo', (el) => el.selected);
  check("带上下文的链接：报价表单里“意向型号”已选好", prefilled === "P102", String(prefilled));
  await go("#/category/pens");
  check("count：分类页显示本分类的型号数", await ev(() => document.body.textContent.includes("5")));

  // ---- 状态：标签页、手风琴——点标题改地址里的参数，内容跟着出现/消失；清掉参数回到默认 ----
  await go("#/product/P101");
  const onFirst = await ev(() => document.body.textContent.includes("尺寸"));
  check("标签页：默认显示第一个标签（技术参数）", onFirst);
  await page.click('a.btn[href*="tab=related"]');
  await sleep(300);
  check(
    "标签页：点另一个标签，地址里有 ?tab=related，内容换了",
    (await hash()).includes("tab=related") &&
      !(await ev(() => document.body.textContent.includes("尺寸"))),
  );
  await go("#/inquiry");
  const faqClosed = await count('a.btn[href*="faq="]');
  await page.click('a.btn[href*="faq=lead"]');
  await sleep(300);
  check("手风琴：点标题展开，地址里有 ?faq=lead", (await hash()).includes("faq=lead"));
  await page.click('a.btn[href$="faq=lead,pack"]');
  await sleep(300);
  check(
    "手风琴：多选——再展开另一条，两条都在地址里",
    (await hash()).includes("faq=lead,pack"),
    await hash(),
  );
  check("手风琴：有两个标题", faqClosed === 2);

  // ---- fold / distinct：计数、最小值、分组统计 ----
  await go("#/");
  const groups = await ev(
    () => document.querySelectorAll('[data-section="各分类型号数"] .grp.pair').length,
  );
  check("distinct：每个分类一行，带各自的型号数", groups === 4, String(groups));
  await go("#/category/pens");
  const stats = await ev(() => document.querySelector('[data-section="概览"]')?.textContent ?? "");
  check("fold：本分类的型号数和最低起订量算出来了", /\d/.test(stats) && /100/.test(stats), stats);

  // ---- embed：文章正文是一棵存在数据里的树，详情页把它渲染出来 ----
  await go("#/article/a1");
  const body = await ev(() => ({
    embed: document.querySelectorAll(".embed").length,
    kids: document.querySelectorAll(".embed > *").length,
  }));
  check("embed：正文这棵树被渲染出来", body.embed === 1 && body.kids >= 3, JSON.stringify(body));
  await go("#/_model/article/a1/edit");
  const nodes0 = await count(".tree-root li.tree-node");
  check("后台：内容树字段是可编辑的大纲（每个节点一行）", nodes0 >= 3, String(nodes0));
  // 加一个文字节点到根，写上字，上移到最前，保存，文章页就有它
  await page.select(".tree-root > .tree-addrow [data-tree-kind]", "text");
  await page.click('.tree-root > .tree-addrow [data-act="tree-add"]');
  await ev(() => {
    const inputs = [
      ...document.querySelectorAll('.tree-root > li.tree-node input[data-tree-set="fill"]'),
    ];
    const el = inputs.at(-1);
    el.value = "NEWTEXT-FROM-EDITOR";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(200);
  check("后台：加了一个节点", (await count(".tree-root > li.tree-node")) === nodes0 + 1);
  for (let i = 0; i < nodes0; i++)
    await ev(
      (k) =>
        [...document.querySelectorAll(".tree-root > li.tree-node")][k]
          ?.querySelector(':scope > .tree-ctl a[data-act="tree-up"]')
          ?.click(),
      nodes0 - i,
    );
  await sleep(200);
  check(
    "后台：上移到了最前面",
    await ev(
      () =>
        document.querySelector('.tree-root > li.tree-node input[data-tree-set="fill"]')?.value ===
        "NEWTEXT-FROM-EDITOR",
    ),
  );
  const treeBefore = await ev(() => document.querySelector(".tree").dataset.tree);
  await ev(() => {
    const raw = document.querySelector("[data-tree-raw]");
    raw.value = "not json";
    raw.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(700);
  check(
    "后台：JSON 里写错了会提示，树不变",
    (await count("[data-toast]")) > 0 &&
      (await ev(() => document.querySelector(".tree").dataset.tree)) === treeBefore,
  );
  await page.click('[data-act="submit"]');
  await sleep(600);
  await go("#/article/a1");
  check(
    "编辑后的内容树渲染在文章页上",
    await ev(() => document.querySelector(".embed")?.textContent.includes("NEWTEXT-FROM-EDITOR")),
  );
  await go("#/_model/article/a1/edit");
  await page.click('.tree-root > li.tree-node:first-of-type .tree-ctl a[data-act="tree-del"]');
  await sleep(200);
  check("后台：删掉一个节点", (await count(".tree-root > li.tree-node")) === nodes0);

  // ---- 会话参数（谁在看）：切换后换页不丢；页眉随之变化；地址里写了以地址为准 ----
  await load("#/");
  check(
    "会话：默认是访客，页眉有“会员登录”",
    await ev(() => document.querySelector("#header-body").textContent.includes("会员登录")),
  );
  await go("#/product/P101");
  check("会话：访客看不到“会员资料”", (await count('[data-section="会员资料"]')) === 0);
  await page.click('#header-body a.btn[href*="viewer=member"]');
  await sleep(400);
  check(
    "会话：点“会员登录”，地址里有 ?viewer=member，页眉变成“退出登录”",
    (await hash()).includes("viewer=member") &&
      (await ev(() => document.querySelector("#header-body").textContent.includes("退出登录"))),
  );
  check("会话：会员看得到“会员资料”", (await count('[data-section="会员资料"]')) === 1);
  await page.click('#header-body nav a[href="#/product"]');
  await sleep(400);
  check(
    "会话：换页（地址里没有参数）后仍是会员",
    await ev(() => document.querySelector("#header-body").textContent.includes("退出登录")),
  );
  await load("#/product/P101");
  check("会话：刷新后仍是会员（存在浏览器里）", (await count('[data-section="会员资料"]')) === 1);
  await go("#/product/P101?viewer=visitor");
  check("会话：地址里写了就以地址为准", (await count('[data-section="会员资料"]')) === 0);
  await ev(() => localStorage.removeItem("sketch:EX-CATALOG:session"));

  // ---- 客户页筛选：并集/交集、地址即状态、清除 ----
  await go("#/product");
  const expected = (m, c) =>
    ev(
      ({ m, c }) =>
        window.__sketch.db
          .list("product")
          .filter(
            (p) =>
              (!m.length || m.some((x) => p.materials.includes(x))) &&
              (!c.length || c.some((x) => p.certs.includes(x))),
          ).length,
      { m, c },
    );
  const total = await count(".grid .card");
  check(
    "全部型号页：侧栏筛选和产品并排",
    await ev(() => {
      const a = document.querySelector(".facets")?.getBoundingClientRect(),
        b = document.querySelector(".grid")?.getBoundingClientRect();
      return !!a && !!b && a.right <= b.left + 2 && a.width < b.width;
    }),
  );
  await page.click('.facet a.opt[href*="materials=metal"]');
  await sleep(300);
  const metal = await count(".grid .card");
  check(
    "筛选：选一个材质，只剩含它的型号",
    metal > 0 && metal < total && metal === (await expected(["metal"], [])),
    `${total} → ${metal}`,
  );
  check("筛选状态写进地址", (await hash()).includes("materials=metal"));
  await page.click('.facet a.opt[href*="metal,paper"]');
  await sleep(300);
  const union = await count(".grid .card");
  check(
    "同一字段多选取并集",
    union > metal && union === (await expected(["metal", "paper"], [])),
    `${metal} → ${union}`,
  );
  await page.click('.facet a.opt[href*="certs=reach"]');
  await sleep(300);
  const both = await count(".grid .card");
  check(
    "不同字段取交集",
    both < union && both === (await expected(["metal", "paper"], ["reach"])),
    `${union} → ${both}`,
  );
  await page.click("a.clear");
  await sleep(300);
  check("清除筛选：回到全部", (await count(".grid .card")) === total);
  await go("#/category/pens?materials=bamboo");
  check(
    "直接打开带筛选的链接：状态来自地址",
    (await count(".grid .card")) ===
      (await ev(
        () =>
          window.__sketch.db
            .list("product")
            .filter((p) => p.category === "pens" && p.materials.includes("bamboo")).length,
      )),
  );

  // ---- 后台表格：分页、搜索、筛选 ----
  await go("#/_model/product");
  check(
    "表格分页：每页 10 行",
    (await count(".grid-table.sk tr")) === 11,
    `${await count(".grid-table.sk tr")} 行`,
  );
  await go("#/_model/product?q=P10");
  check("表格搜索：按关键字收窄", (await count(".grid-table.sk tr")) === 3);
  await go("#/_model/product?category=pens");
  check(
    "表格筛选：按分类",
    (await count(".grid-table.sk tr")) ===
      1 +
        (await ev(
          () => window.__sketch.db.all("product").filter((p) => p.category === "pens").length,
        )),
  );

  // ---- 编辑回填；改成草稿后客户看不到 ----
  await go(`#/_model/product/${CODE}/edit`);
  check(
    "编辑：参数行和照片都回填",
    (await count('[data-field="specs"] .lrow')) === 1 && (await count(".pv")) === 1,
  );
  await page.$eval('[data-field="status"] wired-radio-group', (el) => (el.selected = "草稿"));
  await page.click('[data-act="submit"]');
  await sleep(600);
  await go(`#/product/${CODE}`);
  check("改成草稿后，客户页当不存在", (await count("[data-notfound]")) === 1);
  await go(`#/_model/product?q=${CODE}`);
  check(
    "草稿在后台仍可管理，并标出“客户看不到”",
    await ev(
      (c) =>
        document.body.textContent.includes(c) && document.body.textContent.includes("客户看不到"),
      CODE,
    ),
  );

  // ---- 删除走手绘确认框 ----
  const n = await rows("product");
  await page.click(`[data-act="del"][data-key="${CODE}"]`);
  await sleep(400);
  await page.click('[data-act="confirm-yes"]');
  await sleep(600);
  check("删除：确认框点“确定”后真的删了", (await rows("product")) === n - 1);

  // ---- 刷新后持久化；重置 ----
  await go("#/_model/product?q=P101");
  await page.click('[data-act="del"][data-key="P101"]');
  await sleep(400);
  await page.click('[data-act="confirm-yes"]');
  await sleep(600);
  await load("#/_model/product");
  check(
    "刷新页面后删除仍然生效（localStorage）",
    await ev(() => !window.__sketch.db.all("product").some((p) => p.code === "P101")),
  );
  await go("#/_model");
  await page.click('[data-act="reset"]');
  await sleep(400);
  await page.click('[data-act="confirm-yes"]');
  await sleep(600);
  check("重置为初始数据", (await rows("product")) === before);

  // ---- 访客提交：公开的“新增”表单，记录出现在后台里 ----
  await go("#/inquiry");
  await page.$eval(
    '[data-field="contact"] wired-input',
    (el) => (el.value = "verify@example.test"),
  );
  await page.click('[data-act="submit"]');
  await sleep(500);
  check("提交：出现提示", (await count("[data-toast]")) > 0);
  check("提交：记录出现在后台里", (await rows("inquiry")) === 1);
  await go("#/_model/inquiry");
  check(
    "询盘列表里能看到刚提交的",
    await ev(() => document.body.textContent.includes("verify@example.test")),
  );

  await ev(() => window.__sketch.db.reset());
}
