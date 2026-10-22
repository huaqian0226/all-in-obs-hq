---
name: xhs-note-fetch
description: Fetch or import a Xiaohongshu (小红书) note or a WeChat (微信公众号) article from its link — title, text, tags, images, video link — and save it as a Markdown note in a chosen folder; for Xiaohongshu it can also capture all comments with replies into a research evidence bundle. Use when a task needs the content, or the comment section, of a xiaohongshu.com, xhslink.com or mp.weixin.qq.com link, alone or for research-studio.
---

# XHS note fetch / content import

Handles WeChat articles and Xiaohongshu notes. `SKILL_DIR` below is the directory that holds this
file; run commands as `node "$SKILL_DIR/scripts/…"`.

| Need | Command | Precondition |
|---|---|---|
| Save one or many links as notes in a folder | `import-content.mjs --output-dir <dir> --url <url>…` | WeChat: none. Xiaohongshu: any open Obsidian vault with the importer plugin loaded |
| Only read the content, write nothing | `import-content.mjs --print --url <url>` | same as above |
| Xiaohongshu body + all comments | `xhs-bundle.sh <url> <new bundle dir>` | user approved logged-in browser reads this session (ego-browser) |

## Notes and images: `import-content.mjs`

```bash
node "$SKILL_DIR/scripts/import-content.mjs" --output-dir "/abs/folder" --url "<link>" [--url "<link2>"]
node "$SKILL_DIR/scripts/import-content.mjs" --output-dir "/abs/folder" --input-file links.txt
node "$SKILL_DIR/scripts/import-content.mjs" --print --url "<link>"
```

Platforms are detected from the link; a pasted share message works too (`--text "<message>"`, or
a file with one message per line). The output folder is where the notes go; if it lies inside an
Obsidian vault the notes appear there.

**Two fetch routes, one renderer.** `standalone` is plain Node `fetch` (no dependencies, Obsidian
not needed). `obsidian` goes through the running Obsidian app and its
`multi-source-content-importer` plugin via the `obsidian` CLI. Both return the same extracted
data, so the written note is identical. In the default `--via auto` mode:

- **WeChat:** `standalone` first, then `obsidian` if it fails (verification page, empty body).
- **Xiaohongshu:** `obsidian` only. Xiaohongshu answers plain HTTP clients (Node, curl, Firecrawl)
  with a redirect to its login page, so plain Node cannot read a note; Obsidian's browser network
  stack can.

The result's `route` says which one fetched, and `fallbackReason` why the first one failed. The
`obsidian` route needs Obsidian running with the plugin loaded in an open vault. The script
finds such a vault itself: it tries the vaults `obsidian vaults` lists and uses the first one
that is open with the plugin loaded (`--vault <name>` or `OBSIDIAN_VAULT` to force one; closed
vaults are skipped, not opened). It only reads through Obsidian, never writing into the vault. If
no vault qualifies and a Xiaohongshu note is needed, ask the user to open one, or use the browser
route below (`content.md` in the bundle has the body).

**Output format** follows the author's fork of the plugin (same as the plugin's own import):

- Note: `<output-dir>/<title>.md`; images: `<output-dir>/images/<md5>_MD5.<ext>` (the
  obsidian-local-images-plus naming, identical images collapse to one file). A failed download
  keeps the remote URL in the note and counts under `imagesFailed`. `--no-download-media` keeps
  remote URLs for everything.
- No `cover` field. Frontmatter, Xiaohongshu: `platform, title, source, category, imported_at,
  type`. WeChat adds `account, wechat_id, alias, author, published_at, published_ts, description`.
  `category` is the output folder's name unless `--category` is given.
- Xiaohongshu body: the images as `![404](…)![400](…)…` right under the title (alt text is the
  Obsidian display width), then the text, then the tags on the last line. Video notes embed a
  `<video>` tag instead of the gallery, the video file is saved under `images/` too, and the
  note's images are not downloaded because the note does not show them.
- WeChat body: Markdown converted from the article HTML. The converter in the script is a
  dependency-free one (headings, bold/italic, links, images, lists, quotes, code, tables); it is
  not identical to the plugin's turndown output on unusual markup.

The result is JSON on stdout: `successCount`, `failedCount`, and per link `status`, `route`
(`standalone` or `obsidian`), `filePath`, `imagesDownloaded`, `imagesFailed`, or `error`. Report
the created paths, failed links with reasons, and `invalidLines` (input lines with no supported
link). Exit code 1 if any link failed. Save notes only where the user asked; do not write into a
vault folder the user did not name.

`--print` writes nothing and returns the extracted data (Xiaohongshu:
`{title, content, tags, images, videoUrl, isVideo, source, resolvedUrl}`; WeChat adds
`account, author, publishedAt, description, contentMarkdown`). `xhs-fetch.mjs "<url>"` remains as
a shim for the old Obsidian-only body fetch.

## Xiaohongshu comments: evidence bundle

Anonymous clients are redirected to the login page, so comments need the browser route. This is
read-only and separate from note import (comments are not written into notes).

```bash
"$SKILL_DIR/scripts/xhs-bundle.sh" "<note url>" <new bundle dir> [max_roots=200] [max_replies_per_root=50]
```

Opens the note in the user's logged-in ego-browser session, scrolls the comment list, clicks
"展开" reply buttons, and records the page's own comment API responses (root pages and reply
pages) into `raw/`. It writes `manifest.json`, `content.md` and `comments.jsonl` in the format of
research-studio's `references/evidence-bundle.md`, then closes its browser task. A reply's
`parent_id` is its `target_comment` when the platform gives one, else its root.

Then check it: `python3 "$SKILL_DIR/../research-studio/scripts/check_bundle.py" <bundle> --digest` (research-studio installed next to this skill; in the author's library that is `~/.skills-manager/skills/research-studio`).

Stop reasons: `exhausted` (root cursor ended and no reply buttons left), `budget`, `stalled`
(no new responses while `has_more` was true), `blocked` (login wall or note unavailable). The
displayed "共 N 条评论" count includes replies and may include deleted or folded comments; the
gap list says where captured < declared. The output directory must not exist yet.

Observed 2026-10-21/22: a 27-comment note captured 27/27 (16 roots, 11 replies). If a run fails,
read `raw/ego-stderr.log` and rerun into a new directory (an earlier intermittent failure was the
15 s page-load timeout, now tolerated). Never store cookies; never like, comment, follow or message.

## Notes

- Observed 2026-10-22 (two spaced rounds, same links through both routes): WeChat standalone 4/4,
  the Obsidian route 3/4 (one empty reply, now retried in the script); Xiaohongshu plain Node 0/8
  (always the login page) against Obsidian 8/8 on live links, which is why Xiaohongshu uses
  Obsidian only. A video note (22.7 MB mp4) imported through Obsidian. Short links and tokens from
  older smoke cases were already dead on both routes, so a failure on both is a dead link.
- Xiaohongshu share links carry an `xsec_token` that expires, and short links (`xhslink.com`)
  expire too. If both routes fail with "不可访问" / empty note, ask the owner for a fresh share link.
- WeChat sometimes serves a verification page ("环境异常/去验证") depending on the network; retry
  later or from another network.
- Image and video URLs for notes imported with `--no-download-media` point at the platform CDN and
  expire; keep downloads on when local copies matter. Send a video to `video-understanding` as a
  local file.
- Paid fallback for Xiaohongshu when no browser is available: EveryInfra's Xiaohongshu API ($5.56
  per 1,000 requests, 15 roots or 10 replies per call, observed 2026-10-21). Use it only after the
  user agrees to the cost.
- The output rules mirror the plugin repo (`all-in-obs-hq`, `main.ts` and `src/platforms/*`); if
  the plugin's note format changes, update `import-content.mjs` to match.
