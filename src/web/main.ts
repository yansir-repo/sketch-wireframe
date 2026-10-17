/**
 * 页面入口：地址是 /s/<code>.<key>，草图数据在它下面的 sketch.json。服务端已经验过 key，
 * 这里只负责取回来交给引擎；引擎启动时还会再跑一遍语义校验（纯函数，同一份 validate）。
 */
import { mount } from "./mount.ts";
import type { Sketch } from "../shared/schema.ts";

const here = location.pathname.replace(/\/+$/, "");
const app = document.querySelector<HTMLElement>("#app")!;

if (!/^\/s\/[a-z0-9-]+\.[0-9a-f]{16}$/.test(here)) {
  app.textContent = "sketch-wireframe — 这里没有草图。给 agent 的说明见 /llms.txt";
} else {
  fetch(
    `${here}/sketch.json${location.search.match(/[?&](v=\d+)/)?.[1] ? `?${location.search.match(/[?&](v=\d+)/)![1]}` : ""}`,
  )
    .then((r) =>
      r.ok ? (r.json() as Promise<Sketch>) : Promise.reject(new Error(`sketch.json ${r.status}`)),
    )
    .then((sketch) => mount(sketch))
    .catch((e: unknown) => {
      app.textContent = `草图加载失败：${e instanceof Error ? e.message : String(e)}`;
    });
}
