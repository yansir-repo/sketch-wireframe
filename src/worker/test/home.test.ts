import { describe, expect, it } from "vitest";
import llms from "../../../docs/llms.txt?raw";
import { fillTemplate, renderHtml, renderPage } from "../home.ts";

describe("home page = docs/llms.txt, rendered", () => {
  it("fills the origin everywhere and the example line when there is an example", () => {
    const text = fillTemplate(
      llms,
      "https://x.test",
      "https://x.test/s/ex-catalog.0123456789abcdef",
    );
    expect(text).not.toContain("{{");
    expect(text).toContain("POST https://x.test/mcp");
    expect(text).toContain("https://x.test/s/ex-catalog.0123456789abcdef");
  });

  it("drops the whole example line when there is none (no dangling placeholder, nothing leaked)", () => {
    const text = fillTemplate(llms, "https://x.test", null);
    expect(text).not.toContain("{{");
    expect(text).not.toContain("Live example");
  });

  it("never lists or counts sketches: the only sketch path that can appear is the example's", () => {
    const text = fillTemplate(llms, "https://x.test", null);
    expect(text).not.toMatch(/\/s\/[a-z0-9-]+\.[0-9a-f]{16}/);
  });

  it("escapes HTML in what it renders", () => {
    const html = renderHtml('# <script>alert(1)</script>\n- a "quoted" & <b>bold</b> `<i>`');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<code>&lt;i&gt;</code>");
  });

  it("turns bare urls into links without swallowing trailing punctuation", () => {
    expect(renderHtml("- see https://x.test/a.")).toContain(
      '<a href="https://x.test/a">https://x.test/a</a>.',
    );
  });

  it("renders a page with a framed section per ## heading, and no scripts", () => {
    const page = renderPage(
      fillTemplate(llms, "https://x.test", "https://x.test/s/ex-catalog.0123456789abcdef"),
    );
    expect(page.match(/<section>/g)?.length).toBe(3);
    expect(page).toContain("<h1>sketch-wireframe</h1>");
    expect(page).not.toContain("<script");
    expect(page).toContain("noindex");
  });
});
