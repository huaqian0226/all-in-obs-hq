# Multi-Source Content Importer

English | [简体中文](README.zh-CN.md)

Import WeChat Official Account articles and Xiaohongshu notes as structured Markdown, collected into your Obsidian knowledge base.

This repository serves two kinds of usage:

- Human users: use it manually in Obsidian as a community plugin
- Agent users: call the import capability directly as a skill (`xhs-note-fetch`)

## Table of Contents

- [Features](#features)
- [Usage Guide](#usage-guide)
- [Development and Release](#development-and-release)
- [Changelog](#changelog)
- [Acknowledgements](#acknowledgements)

## Features

### Core Capabilities

- Automatic source detection: WeChat Official Accounts / Xiaohongshu
- Single and batch import
- Automatic body extraction and conversion to Markdown
- Image download to local files, automatically falling back to remote links on failure
- Automatic frontmatter metadata
- Category folders and custom folders

### Supported Link Formats

WeChat Official Accounts:

- `https://mp.weixin.qq.com/s/...`
- `https://mp.weixin.qq.com/s?...`

Xiaohongshu:

- `https://www.xiaohongshu.com/explore/...`
- `https://www.xiaohongshu.com/discovery/item/...`
- `https://xhslink.com/...`

### Output Structure

The default `defaultFolder` is `External Files`.

In plugin mode, the default output is:

- Note: `<defaultFolder>/<category>/<title>.md`
- Media: `<defaultFolder>/<category>/images/<md5>_MD5.<ext>`

If you choose "Custom folder" (自定义文件夹):

- Note: `<customFolder>/<title>.md`
- Media: `<customFolder>/images/<md5>_MD5.<ext>`

Media files are always saved in the `images/` subfolder next to the note, named after the content's MD5 signature
(exactly the same `<md5>_MD5` naming algorithm as
[obsidian-local-images-plus](https://github.com/Sergei-Korneev/obsidian-local-images-plus)),
and identical images are deduplicated automatically.

### Settings

- `defaultFolder`: root folder for imports
- `categories`: list of categories, maintained in the settings page; on import, existing first-level subfolders under `defaultFolder` are discovered automatically and shown in the settings page as well (auto-discovered folders are read-only)
- `lastCategory`: remembers the most recent selection
- `downloadMedia`: whether to download media by default
- `debugEnabled`: whether to write the unified multi-platform debug log (enabled by default)

### Frontmatter Fields

WeChat Official Account articles get these fields:

- `platform`
- `title`
- `source`
- `account`
- `wechat_id`
- `alias`
- `author`
- `published_at`
- `published_ts`
- `imported_at`
- `category`
- `description`
- `type`

Xiaohongshu notes get these basic fields:

- `platform`
- `title`
- `source`
- `category`
- `imported_at`
- `type`

### Current Limitations

- Only publicly accessible content is supported
- Login, CAPTCHAs, and permission walls are not handled
- WeChat risk-control pages abort the import with a notice
- Changes to a platform's page structure may break parsing

## Usage Guide

### Human Users: Use as an Obsidian Plugin

#### Installation

Put the build output into the current vault's plugin folder. The folder name must exactly match the `id` in [`manifest.json`](manifest.json):

`<your vault>/.obsidian/plugins/multi-source-content-importer/`

The folder must contain at least these 3 files:

- `main.js`
- `manifest.json`
- `styles.css`

The simplest way is to download these 3 files of the current version from [GitHub Releases](https://github.com/huaqian0226/all-in-obs-hq/releases) and place them in the folder above.

To install locally from source, run:

```bash
npm install
npm run build
mkdir -p "<your vault>/.obsidian/plugins/multi-source-content-importer"
cp main.js manifest.json styles.css "<your vault>/.obsidian/plugins/multi-source-content-importer/"
```

For local development and debugging, a symlink is recommended:

```bash
npm install
npm run build
ln -s "$(pwd)" "<your vault>/.obsidian/plugins/multi-source-content-importer"
```

#### Enable in Obsidian

1. Open the current vault
2. Go to `Settings -> Community plugins`
3. If community plugins are not turned on yet, turn them on first
4. Enable `Multi-Source Content Importer` in the installed plugins list

#### Verify the Installation

If any one of the following is true, the plugin has usually loaded correctly:

- A book icon appears in the left Ribbon
- `导入文章（微信 / 小红书）` (Import article (WeChat / Xiaohongshu)) can be found in the command palette
- You can see the plugin in `Settings -> Community plugins` and open its settings page

#### Start Importing

1. Click the left Ribbon icon, or open the command palette and run `导入文章（微信 / 小红书）`
2. Paste one or more links or share texts
3. Choose a category
4. Check "下载图片到本地" (Download images locally) if needed
5. Click import

#### Troubleshooting and Smoke Tests

- Run `运行多平台实网 smoke 测试` (run the multi-platform live-network smoke test) from the command palette
- The plugin settings page can run the smoke test, open the report, and open the debug log (unified across platforms) with one click
- The plugin settings page lets you customize WeChat/Xiaohongshu smoke cases, one per line
- Report output: `.obsidian/plugins/multi-source-content-importer/smoke-report.json`
- Debug log: `.obsidian/plugins/multi-source-content-importer/debug.log`
- `debugEnabled` can be turned off in the settings page

#### Common Installation Problems

If the plugin is installed but does not show up, check in this order:

1. Is the plugin folder named `multi-source-content-importer`?
2. Are `main.js`, `manifest.json`, and `styles.css` placed directly in the root of the plugin folder?
3. Did you put them under the `.obsidian/plugins/` folder of the vault that is currently open?
4. For a source install, did you run `npm install` and `npm run build` first?
5. After copying or symlinking, did you reload Obsidian or re-enable the plugin?

You can self-check directly like this:

```bash
ls "<your vault>/.obsidian/plugins/multi-source-content-importer"
```

You should see at least:

- `main.js`
- `manifest.json`
- `styles.css`

Incorrect example:

```text
<your vault>/.obsidian/plugins/multi-source-content-importer/
  wx-article/
    main.js
    manifest.json
    styles.css
```

Correct example:

```text
<your vault>/.obsidian/plugins/multi-source-content-importer/
  main.js
  manifest.json
  styles.css
```

### Agent Users: Use as a Skill

#### When to Use

If you are not clicking through the Obsidian plugin UI by hand, but want an agent to import WeChat Official Account articles or Xiaohongshu notes directly, use the skill folder:

- [skills/xhs-note-fetch/SKILL.md](skills/xhs-note-fetch/SKILL.md) (keeps the `xhs-note-fetch` name, and supports both WeChat Official Accounts and Xiaohongshu)

#### How It Works

[scripts/import-content.mjs](skills/xhs-note-fetch/scripts/import-content.mjs) in the skill is a standalone mirror of this plugin's fetching and output logic:

- Fetching: WeChat Official Accounts are fetched by default with Node's native `fetch` (no dependencies, no need to open Obsidian), and only if that fails does it call the running plugin through the `obsidian` command line. Xiaohongshu redirects non-browser requests to its login page, so it is fetched only through this plugin: the script automatically finds an open vault that has loaded the plugin, and the vault name can be given with `--vault`. Both routes produce the same output.
- Parsing: Xiaohongshu short-link resolution and extraction of body, tags, and images reuse the plugin directly; WeChat Official Account metadata and body extraction mirror `src/platforms/wechat/*`.
- Output: consistent with this fork's plugin output — notes are written to the given folder, images are saved under `images/` next to the note and named by content MD5 (`<md5>_MD5.<ext>`, identical images are deduplicated), frontmatter has no `cover`, Xiaohongshu notes use the `![404](...)![400](...)` image layout with tags on the last line; video notes embed `<video>` (the video file is also saved under `images/`), and images that the note does not display are not downloaded.
- Fetch only, no write: add `--print` to return only the extracted result as JSON, without writing any files.
- Options: `--via auto|standalone|obsidian` picks the fetch route (default `auto`), `--vault` or the `OBSIDIAN_VAULT` environment variable forces a vault, `--category` overrides the `category` field (default: the output folder's name), `--no-download-media` keeps remote URLs, and `--text` / `--input-file` accept pasted share messages. See `SKILL.md` for details.
- Comments: Xiaohongshu comments and replies are captured through `scripts/xhs-bundle.sh` in the skill (ego-browser, which needs a logged-in browser); this is not part of plugin import and the comments are not written into notes.

This skill is maintained in the author's central skills library, and `skills/xhs-note-fetch/` in this repository is a mirror of it; when the plugin's output format changes, the script must be kept in sync, see the "Skills Alignment Rule" in [AGENTS.md](AGENTS.md).

#### Install Location

Recommended install locations:

- `~/.codex/skills/xhs-note-fetch/`
- `~/.claude/skills/xhs-note-fetch/`

You must copy the whole folder, not just `SKILL.md`, because the scripts live in it too:

- `SKILL.md`
- `scripts/` (`import-content.mjs`, `xhs-fetch.mjs`, `xhs-bundle.mjs`, `xhs-bundle.sh`)

Example:

```bash
mkdir -p ~/.codex/skills ~/.claude/skills
cp -R skills/xhs-note-fetch ~/.codex/skills/
cp -R skills/xhs-note-fetch ~/.claude/skills/
```

#### Post-Install Self-Check

```bash
node ~/.codex/skills/xhs-note-fetch/scripts/import-content.mjs --help
node ~/.claude/skills/xhs-note-fetch/scripts/import-content.mjs --help
```

## Development and Release

### Local Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Hot development:

```bash
npm run dev
```

`npm run dev` watches [`main.ts`](main.ts) and regenerates `main.js` automatically after changes.

If you are debugging inside Obsidian, the recommended way to refresh is:

- Keep `npm run dev` running
- Disable and re-enable the plugin in Obsidian
- Or run `Reload app without saving`

### Local Checks

During development, run at least these 3 checks:

```bash
npm run lint
npm run build
npx tsc --noEmit
```

They are used for:

- `npm run lint`: check common code issues and TypeScript / ESLint rules
- `npm run build`: confirm the plugin bundles correctly and produces `main.js`
- `npx tsc --noEmit`: confirm the type check passes, without emitting extra files

If you only want a quick self-check before committing, run them in the order above.

### Publishing to the Community Store

The recommended order is:

1. Update the version in `package.json`, and sync `manifest.json` and `versions.json`
2. Run `npm run lint`
3. Run `npm run build`
4. Run `npx tsc --noEmit`
5. Create a Git tag or GitHub Release matching the version number, e.g. `0.1.6`
6. Upload `main.js`, `manifest.json`, and `styles.css` to the Release

## Changelog

### Unreleased (fork customizations)

- WeChat Official Account import no longer downloads the cover image: notes no longer write `cover`, and downloading the cover would only leave an unreferenced file in `images/`
- Xiaohongshu video notes no longer download images that the note does not display (a video note renders the video, not the image layout)

### 0.1.10-hq.1 (fork customizations)

This fork (the `my-features` branch) customizes the note output format on top of upstream 0.1.10:

- Images are now stored in the `images/` subfolder next to the note, named by content MD5 signature (`<md5>_MD5.<ext>`,
  the same algorithm as obsidian-local-images-plus), and identical images are deduplicated automatically
- The `cover` field is removed from frontmatter (both WeChat and Xiaohongshu)
- Xiaohongshu note layout changed: the cover `![404](...)` and the remaining images `![400](...)` are laid out consecutively right after the title,
  followed by the body, and the last line is the tags (the alt text is the Obsidian display width)
- Xiaohongshu tags and the `[话题]` ("topic") suffix in the body are cleaned up, producing plain tags (e.g. `#AI工具`)
- The agent skill has moved to `skills/xhs-note-fetch/`, and its import script's output format stays consistent with this customization (see "Agent Users: Use as a Skill" above)

### 0.1.10

- Fixed an issue where, with "Download images locally" on, some `sns-webpic-*.xhscdn.com/...!nd_dft...` images in long Xiaohongshu image-text notes still kept remote links
- Unified the local media mapping logic for body images and cover images, to avoid missed replacements caused by different `http/https` URL forms
- Added "每天学点经济学｜第149期：除权除息" as a Xiaohongshu smoke regression case, and updated the agent skill's handling of the same flow accordingly

### 0.1.9

- Adjusted the plugin description wording and removed the `Obsidian` keyword to satisfy community store validation rules
- Kept the `eslint + build + tsc` local checks all passing

### 0.1.8

- Integrated `eslint-plugin-obsidianmd` (legacy `.eslintrc`) for local pre-checks
- Fixed a batch of must-fix items from ObsidianReviewBot: removed `any`, removed unnecessary assertions, avoided inline-style patterns, dynamic `configDir` paths, `console` normalization
- Adjusted some UI wording and settings naming to reduce sentence-case / heading rule false positives

### 0.1.7

- Fixed the inconsistency between the "Category management" section in the settings page and the category source in the import dialog
- The settings page now shows "custom categories + auto-discovered folders" together, where auto-discovered folders are read-only
- Kept the existing editing boundary: rename, reorder, and delete only affect manually configured categories

### 0.1.6

- Refactored into a "plugin shell + platform services" structure, split `main.ts` and modularized the WeChat/Xiaohongshu logic into `src/platforms/*`
- Unified the settings page into a "Multi-platform debugging" section, with one-click smoke runs, report viewing, and unified debug log viewing
- Smoke cases can be customized per platform in the settings page (one per line) and run through the real plugin entry point
- Debug log and report share a unified path:
- Log: `.obsidian/plugins/multi-source-content-importer/debug.log`
- Report: `.obsidian/plugins/multi-source-content-importer/smoke-report.json`
- Absorbed the `fix/custom-folder` capability: import categories automatically merge the first-level folders under `defaultFolder`, and the custom folder input is linked with the suggestion picker
- Kept network requests compliant: continued to use `requestUrl`, no fallback to Node built-in networking modules

### 0.1.5

- Fixed unstable resolution of Xiaohongshu `xhslink` short links, preferring to keep the share parameters after the redirect to avoid losing `xsec_token`
- Strengthened the Xiaohongshu short-link resolution fallback by adding a Node `http/https` request path, reducing failures caused by network differences in the Obsidian runtime
- On the "小红书 - 你访问的页面不见了" ("Xiaohongshu - the page you visited is gone") page, the import now errors out and stops instead of generating a blank note
- Fixed an issue where some video notes could not have their body, cover, and video link extracted because the share parameters were trimmed
- Synced the Xiaohongshu short-link and unavailable-page handling in the agent skill script

### 0.1.4

- Added the `obsidian-content-importer` skill for direct agent use
- Improved the documentation for local installation, symlink debugging, and hot updates

## Acknowledgements

- Thanks to the open-source project `xiaohongshu-importer` for its implementation ideas and interaction design reference.
