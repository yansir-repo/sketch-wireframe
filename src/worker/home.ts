/**
 * 首页和 /llms.txt 是同一份内容（docs/llms.txt）：机器拿 markdown 原文，浏览器拿它排好版的样子。
 * 一个事实一处——不另写一份 HTML。首页不列任何草图、不显示数量：key 是唯一的闸门，首页不能泄露“有没有”。
 * 唯一出现的草图是范例（虚构的），它的地址在渲染时从库里取，不写死在文件里。
 */

/** 填占位符：{{origin}}；{{example}} 所在的整行——没有可用的范例就整行去掉。 */
export const fillTemplate = (template: string, origin: string, exampleUrl: string | null): string =>
  template
    .split("\n")
    .flatMap((line) => {
      if (!line.includes("{{example}}")) return [line];
      return exampleUrl === null ? [] : [line.replace("{{example}}", exampleUrl)];
    })
    .join("\n")
    .replaceAll("{{origin}}", origin);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 行内：`代码`、**粗体**、裸网址。先整体转义，再在转义后的文本上套标记（用户内容来不了这里，但转义是默认动作）。 */
const inline = (raw: string): string =>
  esc(raw)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(https?:\/\/[^\s<)]+[^\s<).,;])/g, '<a href="$1">$1</a>');

/** 只认这份文件里用到的几种行：# / ## 标题、> 引言、- 列表、空行、其余是段落。 */
export const renderHtml = (markdown: string): string => {
  const out: string[] = [];
  let list = false;
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const line of markdown.split("\n")) {
    if (line.startsWith("- ")) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith("## ")) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith("> ")) out.push(`<p class="lead">${inline(line.slice(2))}</p>`);
    else if (line.trim() !== "") out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
};

const STYLE = `
body{margin:0;background:#f5efe3;background-image:radial-gradient(#d9cfba 1px,transparent 1px);background-size:22px 22px;color:#3a3630;font:17px/1.7 'ZCOOL KuaiLe','Caveat',cursive,sans-serif}
main{max-width:760px;margin:0 auto;padding:36px 20px 60px}
h1{font-size:44px;margin:.2em 0 .1em}
h2{font-size:24px;margin:1.6em 0 .5em;display:inline-block;border:1.5px solid #6b645a;border-radius:10px;padding:0 14px;background:#f5efe3}
.lead{color:#6b645a;margin:.2em 0}
section{position:relative;border:2px solid #3a3630;border-radius:4px 16px 3px 14px/14px 3px 16px 4px;background:#fffefb;padding:8px 22px 14px;margin:30px 0 0}
section h2{position:absolute;top:-17px;left:16px;margin:0}
ul{padding-left:1.2em}li{margin:.35em 0}
code{background:#efe6cf;border-radius:4px;padding:0 5px;font-size:.92em}
a{color:#3a3630;text-decoration:underline dotted}
`;

/** 整页：标题和引言在最上面，每个 ## 一个手绘风的框。 */
export const renderPage = (markdown: string): string => {
  const [head, ...rest] = markdown.split(/\n(?=## )/);
  const sections = rest.map((s) => `<section>${renderHtml(s)}</section>`).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>sketch-wireframe</title>
<link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Caveat:wght@500;700&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body><main>${renderHtml(head ?? "")}${sections}</main></body></html>`;
};
