/**
 * 手绘：rough.js 在元素内部叠一层歪线 SVG，波浪线表示“此处有文字”。
 * 所有画出来的东西都是 [data-rough] 宿主 + 一个 svg.rough-overlay 子节点，验证器就按这个约定查有没有画出来。
 *
 * 踩过的坑（见 SKILL.md）：宿主要 position:relative; z-index:0（见 style.css），否则 z-index:-1 的叠加层会钻到祖先背景后面，
 * 看起来像“填充没画出来”；大尺寸元素别用 rough（抖动幅度跟像素尺寸绝对值相关）——所以板块外框用 CSS 边框，不在这里画。
 * 用固定 seed：窗口缩放重画时线条形状不变，不会每次都抖一下。
 */
import rough from "roughjs";

const INK = "#3a3630";
const PENCIL = "#6b645a";
const RED = "#b8332a";
const NS = "http://www.w3.org/2000/svg";

const mulberry = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** 一条手写感的波浪线：轻微上下起伏 + 随机抖动，种子固定。 */
export const scribblePath = (w: number, y: number, seed: number, amp = 2.4, step = 9): string => {
  const rnd = mulberry(seed);
  let d = `M0 ${y.toFixed(1)}`;
  for (let x = step; x < w + step; x += step) {
    const xe = Math.min(x, w);
    const ctrl = y + (rnd() - 0.5) * amp * 3 + Math.sin(x / step) * amp * 0.6;
    const end = y + (rnd() - 0.5) * amp;
    d += ` Q${(xe - step / 2).toFixed(1)} ${ctrl.toFixed(1)} ${xe.toFixed(1)} ${end.toFixed(1)}`;
    if (xe >= w) break;
  }
  return d;
};

const overlay = (el: HTMLElement, w: number, h: number): SVGSVGElement => {
  let svg = el.querySelector<SVGSVGElement>(":scope > svg.rough-overlay");
  if (!svg) {
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "rough-overlay");
    el.insertBefore(svg, el.firstChild);
  } else svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  return svg;
};

const seedOf = (el: HTMLElement) => Number(el.dataset.seed) || 7;

export const draw = (el: HTMLElement): void => {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (w < 4 || h < 4) return;
  const svg = overlay(el, w, h);
  const rc = rough.svg(svg);
  const seed = seedOf(el);
  const kind = el.dataset.rough;
  const base = { seed, roughness: 1.4, bowing: 0.9, fill: "transparent" };
  switch (kind) {
    case "x":
      svg.appendChild(
        rc.rectangle(3, 3, w - 6, h - 6, { ...base, stroke: PENCIL, strokeWidth: 1.8 }),
      );
      svg.appendChild(
        rc.line(4, 4, w - 4, h - 4, { ...base, stroke: PENCIL, strokeWidth: 1, roughness: 1.1 }),
      );
      svg.appendChild(
        rc.line(w - 4, 4, 4, h - 4, {
          ...base,
          stroke: PENCIL,
          strokeWidth: 1,
          roughness: 1.1,
          seed: seed + 1,
        }),
      );
      break;
    case "frame":
      svg.appendChild(
        rc.rectangle(3, 3, w - 6, h - 6, { ...base, stroke: PENCIL, strokeWidth: 1.8 }),
      );
      break;
    case "btn":
      svg.appendChild(
        rc.rectangle(3, 3, w - 6, h - 6, {
          ...base,
          roughness: 1.7,
          bowing: 1.3,
          stroke: el.classList.contains("ghost") ? PENCIL : INK,
          strokeWidth: el.classList.contains("ghost") ? 1.6 : 2.2,
        }),
      );
      break;
    case "circle":
      svg.appendChild(
        rc.circle(w / 2, h / 2, Math.min(w, h) - 6, {
          ...base,
          roughness: 1.9,
          stroke: INK,
          strokeWidth: 1.8,
        }),
      );
      break;
    case "pill":
      svg.appendChild(
        rc.rectangle(2, 2, w - 4, h - 4, {
          ...base,
          roughness: 1.2,
          bowing: 1,
          stroke: PENCIL,
          strokeWidth: 1.4,
        }),
      );
      break;
    case "warn":
      svg.appendChild(
        rc.rectangle(3, 3, w - 6, h - 6, {
          ...base,
          roughness: 1.8,
          bowing: 1.5,
          stroke: RED,
          strokeWidth: 2.4,
        }),
      );
      break;
    case "links": {
      // 结构图连线：data-links = [[fromId, toId]]；从框边到框边画手绘箭头
      const host = el.getBoundingClientRect();
      const edge = (r: DOMRect, tx: number, ty: number): [number, number] => {
        const cx = r.left + r.width / 2,
          cy = r.top + r.height / 2,
          dx = tx - cx,
          dy = ty - cy;
        const k = Math.min(
          dx ? r.width / 2 / Math.abs(dx) : Infinity,
          dy ? r.height / 2 / Math.abs(dy) : Infinity,
        );
        return [cx + dx * k - host.left, cy + dy * k - host.top];
      };
      (JSON.parse(el.dataset.links ?? "[]") as Array<[string, string]>).forEach(([a, b], i) => {
        const ea = document.getElementById(a),
          eb = document.getElementById(b);
        if (!ea || !eb) return;
        const ra = ea.getBoundingClientRect(),
          rb = eb.getBoundingClientRect();
        const [x1, y1] = edge(ra, rb.left + rb.width / 2, rb.top + rb.height / 2);
        const [x2, y2] = edge(rb, ra.left + ra.width / 2, ra.top + ra.height / 2);
        const o = {
          ...base,
          roughness: 1.2,
          bowing: 1.2,
          stroke: INK,
          strokeWidth: 1.8,
          seed: seed + i,
        };
        svg.appendChild(rc.line(x1, y1, x2, y2, o));
        const ang = Math.atan2(y2 - y1, x2 - x1);
        for (const d of [0.45, -0.45])
          svg.appendChild(
            rc.line(x2, y2, x2 - 14 * Math.cos(ang + d), y2 - 14 * Math.sin(ang + d), {
              ...o,
              roughness: 0.8,
              seed: seed + i + 9,
            }),
          );
      });
      break;
    }
    case "sq": {
      const pcts = (el.dataset.lines ?? "100").split(",").map(Number);
      const t = Number(el.dataset.t) || 3;
      pcts.forEach((pct, i) => {
        const y = (h * (i + 0.5)) / pcts.length;
        const p = document.createElementNS(NS, "path");
        p.setAttribute(
          "d",
          scribblePath((w * pct) / 100, y, seed * 31 + i * 7, Math.max(1.4, t * 0.55)),
        );
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", PENCIL);
        p.setAttribute("stroke-width", String(t));
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("stroke-linejoin", "round");
        p.setAttribute("opacity", "0.85");
        svg.appendChild(p);
      });
      break;
    }
  }
};

export const drawAll = (root: Element | Document = document): void => {
  root.querySelectorAll<HTMLElement>("[data-rough]").forEach(draw);
};

/** 图片查看器里占位用的大叉框（SVG data URL；dialog 对图片协议没有限制）。 */
export const crossedBoxSrc = (w = 800, h = 600): string => {
  const gen = rough.generator();
  const o = {
    stroke: PENCIL,
    strokeWidth: 3,
    roughness: 1.4,
    bowing: 0.9,
    seed: 11,
    fill: "transparent",
  };
  const parts = [
    gen.rectangle(6, 6, w - 12, h - 12, o),
    gen.line(8, 8, w - 8, h - 8, { ...o, strokeWidth: 1.6 }),
    gen.line(w - 8, 8, 8, h - 8, { ...o, strokeWidth: 1.6, seed: 12 }),
  ]
    .flatMap((d) => gen.toPaths(d))
    .map(
      (p) => `<path d="${p.d}" fill="none" stroke="${p.stroke}" stroke-width="${p.strokeWidth}"/>`,
    )
    .join("");
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="${NS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fffefb"/>${parts}</svg>`,
    )
  );
};

/** 表格行与行之间的手绘铅笔线（CSS 背景用：几十行的表格每格都画 rough 会很慢）。 */
export const rowLineSrc = (): string =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="${NS}" width="400" height="6" viewBox="0 0 400 6" preserveAspectRatio="none"><path d="${scribblePath(400, 3, 41, 1, 14)}" fill="none" stroke="${PENCIL}" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linecap="round"/></svg>`,
  );
