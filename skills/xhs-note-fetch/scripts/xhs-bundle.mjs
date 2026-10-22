// Body + comments of one Xiaohongshu note through the user's logged-in ego-browser session.
// Run through xhs-bundle.sh, which prepends `const ARGS = {url, out, maxRoots, maxReplies}`.
// Read-only: scrolls the comment list and clicks "展开" reply buttons; never likes, posts or follows.
const fs = await import("node:fs/promises");
const path = await import("node:path");
const { url, out, maxRoots, maxReplies } = ARGS;
const API = /edith\.xiaohongshu\.com\/api\/sns\/web\/v2\/comment\/(page|sub\/page)/;

const task = await taskSpace(`xhs-bundle ${Date.now()}`);
const page = task.page("p1");
// Heavy pages often miss the 15 s "load" event after navigation commits; carry on from there.
const go = (pg, u) => pg.goto(u).catch((e) => { if (!/timed out/i.test(e.message)) throw e; });
await page.cdp("Network.enable", {});
await page.events();
await go(page, url);
await page.waitForTimeout(4000);

const state = await page.evaluate(() => {
  const map = window.__INITIAL_STATE__?.note?.noteDetailMap || {};
  const key = Object.keys(map).find((k) => map[k]?.note?.noteId);
  const n = key ? map[key].note : null;
  return {
    finalUrl: location.href,
    loginWall: !!document.querySelector(".login-container") || /\/login/.test(location.pathname),
    note: n && {
      id: n.noteId, title: n.title, desc: n.desc, type: n.type, time: n.time,
      author: n.user?.nickname, authorId: n.user?.userId,
      tags: (n.tagList || []).map((t) => t.name),
      images: (n.imageList || []).map((i) => i.urlDefault || i.url).filter(Boolean),
      video: n.video?.media?.stream ? Object.values(n.video.media.stream).flat()[0]?.masterUrl || null : null,
      counts: n.interactInfo,
    },
    declaredText: document.querySelector(".comments-container .total")?.innerText || null,
  };
});

const comments = new Map();
const rawFiles = [];
let rootHasMore = true;
let rootCursorSeen = false;
let fetchErrors = 0;
const authorId = state.note?.authorId;

const add = (c, rootId) => {
  if (comments.has(c.id)) return;
  comments.set(c.id, {
    id: c.id,
    parent_id: rootId ? (c.target_comment?.id && c.target_comment.id !== c.id ? c.target_comment.id : rootId) : null,
    root_id: rootId || c.id,
    author: c.user_info?.nickname ?? null,
    text: c.content ?? "",
    likes: c.like_count != null ? Number(c.like_count) : null,
    created_at: c.create_time ? new Date(Number(c.create_time)).toISOString() : null,
    is_op: authorId ? c.user_info?.user_id === authorId : null,
    is_pinned: (c.show_tags || []).includes("is_top") || null,
    reply_count: c.sub_comment_count != null ? Number(c.sub_comment_count) : null,
    ip_location: c.ip_location ?? null,
  });
};

const drain = async () => {
  let got = 0;
  for (const e of await page.events()) {
    if (e.method !== "Network.responseReceived" || !API.test(e.params?.response?.url || "")) continue;
    if (e.params.response.status !== 200) continue;
    try {
      const { body } = await page.cdp("Network.getResponseBody", { requestId: e.params.requestId });
      const d = JSON.parse(body);
      const isSub = /sub\/page/.test(e.params.response.url);
      const file = `raw/${String(rawFiles.length + 1).padStart(3, "0")}-${isSub ? "sub" : "root"}.json`;
      await fs.writeFile(path.join(out, file), body);
      rawFiles.push(file);
      for (const c of d?.data?.comments || []) {
        if (isSub) add(c, new URL(e.params.response.url).searchParams.get("root_comment_id"));
        else {
          add(c, null);
          for (const s of c.sub_comments || []) add(s, c.id);
        }
      }
      if (!isSub) { rootHasMore = !!d?.data?.has_more; rootCursorSeen = true; }
      got++;
    } catch { fetchErrors++; }
  }
  return got;
};

let idle = 0;
let stop = "exhausted";
if (state.loginWall || !state.note) stop = "blocked";
while (stop !== "blocked") {
  await page.evaluate(() => {
    const s = document.querySelector(".note-scroller") || document.scrollingElement;
    s.scrollTop = s.scrollHeight;
  });
  await page.waitForTimeout(1500);
  const clicked = await page.evaluate((limit) => {
    let n = 0;
    for (const b of document.querySelectorAll(".show-more")) {
      if (n >= limit) break;
      if (/展开|更多/.test(b.innerText)) { b.click(); n++; }
    }
    return n;
  }, 5);
  await page.waitForTimeout(clicked ? 1500 : 500);
  const got = await drain();
  const roots = [...comments.values()].filter((c) => !c.parent_id).length;
  if (roots >= maxRoots) { stop = "budget"; break; }
  if (!rootHasMore && clicked === 0 && got === 0) { stop = "exhausted"; break; }
  idle = got === 0 ? idle + 1 : 0;
  if (idle >= 4) { stop = rootHasMore ? "stalled" : "exhausted"; break; }
}

// Cap replies per root after collection so the budget is visible rather than silent.
const rows = [...comments.values()];
const perRoot = {};
const kept = rows.filter((c) => {
  if (!c.parent_id) return true;
  perRoot[c.root_id] = (perRoot[c.root_id] || 0) + 1;
  return perRoot[c.root_id] <= maxReplies;
});
const roots = kept.filter((c) => !c.parent_id);
const declared = state.declaredText ? Number((state.declaredText.match(/\d+/) || [])[0]) : null;
const gaps = [];
if (stop === "blocked") gaps.push("login wall or note unavailable; nothing captured");
if (stop === "stalled") gaps.push("root pages stopped loading while has_more was true");
if (!rootCursorSeen && stop !== "blocked") gaps.push("no root comment API response observed");
for (const r of roots) {
  const have = kept.filter((c) => c.root_id === r.id && c.parent_id).length;
  if (r.reply_count != null && have < r.reply_count) gaps.push(`root ${r.id}: ${have}/${r.reply_count} replies`);
}
if (declared != null && kept.length < declared) gaps.push(`captured ${kept.length} of ${declared} declared (declared count includes deleted/folded)`);
if (fetchErrors) gaps.push(`${fetchErrors} intercepted responses had no readable body`);

const n = state.note || {};
await fs.writeFile(path.join(out, "content.md"), [
  `# ${n.title || "(untitled)"}`, "",
  `- URL: ${url}`, `- Author: ${n.author ?? "unknown"}`,
  `- Published: ${n.time ? new Date(n.time).toISOString() : "unknown"}`,
  `- Tags: ${(n.tags || []).join(", ")}`,
  `- Counts: ${JSON.stringify(n.counts || {})}`,
  n.video ? `- Video: ${n.video}` : "", "",
  n.desc || "", "",
  ...(n.images || []).map((u, i) => `![image ${i + 1}](${u})`),
].join("\n"));
await fs.writeFile(path.join(out, "comments.jsonl"), kept.map((c) => JSON.stringify(c)).join("\n") + (kept.length ? "\n" : ""));
await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify({
  schema: "research-evidence-bundle/1", platform: "xiaohongshu", url, source_id: n.id ?? null,
  title: n.title ?? null, author: n.author ?? null,
  published_at: n.time ? new Date(n.time).toISOString() : null,
  fetched_at: new Date().toISOString(), route: "ego-browser:logged-in", login_used: true,
  sort: "platform default", budget: { max_roots: maxRoots, max_replies_per_root: maxReplies },
  declared_comment_count: declared,
  captured: { roots: roots.length, replies: kept.length - roots.length, total: kept.length },
  stop_reason: stop, gaps, cost: { usd: 0, note: "browser session" },
  files: { content: "content.md", comments: "comments.jsonl", transcript: null, media: null },
  raw_files: rawFiles,
}, null, 2));
await task.finish({ keep: [] });
console.log(JSON.stringify({ out, stop, declared, captured: kept.length, roots: roots.length, gaps: gaps.length }));
