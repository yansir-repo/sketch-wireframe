/**
 * 意见框：客户在每一页上写意见，写完按“我提完了”收成一轮。它是引擎外面的一层壳（不在 #app 里，不属于草图内容）：
 * 状态只在服务端（`/s/<code>.<key>/feedback.json`），这里不存任何东西；意见记在客户当时看的那一版上。
 * 后台（`#/_…`）是运营的界面，不显示它。
 */
import { MAX_NOTE_CHARS, pathOf } from "../shared/feedback.ts";
import type { FeedbackStrings } from "../shared/strings.ts";

type Note = { id: number; version: number; path: string; text: string; at: number };

export const mountFeedback = (o: { base: string; version: number; L: FeedbackStrings }): void => {
  const { base, version, L } = o;
  const root = document.createElement("div");
  root.className = "fb";
  root.innerHTML = `
    <button type="button" class="cbtn fb-fab" data-fb="open"></button>
    <section class="fb-panel" hidden>
      <header><b class="fb-title"></b><button type="button" class="cbtn" data-fb="close"></button></header>
      <ul class="fb-list"></ul>
      <textarea class="fb-text" rows="3" maxlength="${MAX_NOTE_CHARS}"></textarea>
      <div class="fb-row"><span class="fb-status" role="status"></span><button type="button" class="cbtn on" data-fb="send"></button></div>
      <footer><span class="fb-total"></span><button type="button" class="cbtn" data-fb="done"></button></footer>
    </section>`;
  document.body.append(root);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const panel = $<HTMLElement>(".fb-panel");
  const status = (msg: string) => ($(".fb-status").textContent = msg);
  let notes: Note[] = [];

  const here = () => pathOf(location.hash);
  const render = () => {
    root.hidden = here().startsWith("/_");
    $(".fb-fab").textContent = L.open;
    $<HTMLButtonElement>('[data-fb="close"]').textContent = L.close;
    $<HTMLButtonElement>('[data-fb="send"]').textContent = L.send;
    $<HTMLButtonElement>('[data-fb="done"]').textContent = L.done;
    $<HTMLTextAreaElement>(".fb-text").placeholder = L.placeholder;
    $(".fb-title").textContent = L.title(here());
    const mine = notes.filter((n) => n.path === here());
    const list = $(".fb-list");
    list.replaceChildren(
      ...(mine.length
        ? mine.map((n) => Object.assign(document.createElement("li"), { textContent: n.text }))
        : [
            Object.assign(document.createElement("li"), {
              textContent: L.none,
              className: "fb-none",
            }),
          ]),
    );
    $(".fb-total").textContent = L.total(notes.length);
  };

  const load = () =>
    fetch(`${base}/feedback.json?v=${version}`)
      .then((r) =>
        r.ok ? (r.json() as Promise<Note[]>) : Promise.reject(new Error(String(r.status))),
      )
      .then((rows) => {
        notes = rows;
        render();
      })
      .catch(() => status(L.failed));

  const post = (path: string, body: Record<string, unknown>) =>
    fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, ...body }),
    }).then(async (r) => {
      if (r.ok) return;
      const e = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? L.failed);
    });

  root.addEventListener("click", (ev) => {
    const act = (ev.target as HTMLElement).closest<HTMLElement>("[data-fb]")?.dataset["fb"];
    if (act === "open") {
      panel.hidden = false;
      status("");
      void load();
    } else if (act === "close") panel.hidden = true;
    else if (act === "send") {
      const ta = $<HTMLTextAreaElement>(".fb-text");
      const text = ta.value.trim();
      if (text === "") return;
      post("feedback", { path: here(), text })
        .then(() => {
          ta.value = "";
          status(L.sent);
          return load();
        })
        .catch((e: unknown) => status(e instanceof Error ? e.message : L.failed));
    } else if (act === "done")
      post("feedback/done", {})
        .then(() => status(L.doneOk))
        .catch((e: unknown) => status(e instanceof Error ? e.message : L.failed));
  });
  window.addEventListener("hashchange", render);
  render();
  void load();
};
