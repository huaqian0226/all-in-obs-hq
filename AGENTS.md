# AGENTS Workflow

This repository uses a reproducible fix loop for Xiaohongshu and WeChat import issues.

## Standard Debug Loop

1. Reproduce with real plugin entry:
- In Obsidian command palette, run `运行多平台实网 Smoke 测试`.
- Or run from plugin settings page using one-click smoke buttons.
- This calls the same service path used by normal import flow (`main.ts -> XhsResolver/XhsNoteService`).

2. Inspect artifacts:
- Debug log: `.obsidian/plugins/multi-source-content-importer/debug.log`
- Smoke report: `.obsidian/plugins/multi-source-content-importer/smoke-report.json`

3. Locate failure stage from logs:
- `resolve-get-response` / `resolve-head-response`: shortlink redirect behavior.
- `resolve-html-extracted`: HTML fallback extraction behavior.
- `import-error`: final user-facing failure reason.

4. Implement minimal fix:
- Prefer fixing `src/platforms/xhs/*` service modules.
- Keep plugin shell orchestration in `main.ts`.

5. Regression run:
- Re-run smoke command.
- Ensure no case regresses compared with baseline.

## Baseline XHS Smoke Cases

- `http://xhslink.com/o/AOCPqBZcRZ8`
- `http://xhslink.com/o/9mieTWxY9ce`
- `http://xhslink.com/o/vwCTLUg3W5`
- `http://xhslink.com/o/9WJrnkkjpx5`
- `http://xhslink.com/o/8glUzkSMrIo`

## WeChat Smoke Cases

- Maintained in `src/platforms/wechat/smoke-cases.ts`.
- Default list can be empty because WeChat may intermittently return verification pages by network.
- Users can override both platform smoke cases from plugin settings (one case per line).

## Architecture Boundaries

- `main.ts`
- Plugin shell: commands, settings, orchestration.

- `src/plugin`
- `import-modal.ts`: import input UI.
- `settings-tab.ts`: plugin settings UI.
- `folder-suggest.ts`: folder path suggestions.
- `types.ts`: plugin-level settings/input contracts.
- `platform-smoke.ts`: unified real-network smoke runner for wechat/xiaohongshu.

- `src/platforms/xhs`
- `resolver.ts`: shortlink resolution (GET Location -> HEAD Location -> HTML extraction -> token rebuild).
- `note-service.ts`: note HTML fetch, unavailable-page detection, structured extraction.
- `smoke-cases.ts`: shared real-world smoke case set.

- `src/platforms/wechat`
- `article-service.ts`: fetch, parse, markdown conversion, and frontmatter for WeChat.
- `headers.ts`: platform-specific HTTP headers and verification page detection.

- `src/shared`
- Shared constants and cross-platform helper values.

## Skills Alignment Rule

`skills/xhs-note-fetch/` is a mirror of the skill that the maintainer keeps in their central skill library; the library copy is the one to edit, and this directory is re-synced from it.
Its `scripts/import-content.mjs` mirrors the plugin's WeChat extraction and its note output format (`images/<md5>_MD5.<ext>`, no `cover`, XHS gallery layout, video notes). Xiaohongshu is read only through the plugin itself, so it needs no separate mirror.
When plugin WeChat extraction or output behavior changes, update the skill script in the library and re-sync this copy in the same PR, and update `skills/xhs-note-fetch/SKILL.md` if the documented behavior changes.

## Pre-Release Checklist

1. `npm run build` passes.
2. Run Obsidian command `运行多平台实网 Smoke 测试`.
3. Confirm `smoke-report.json` success/failure count is acceptable and no known fixed case regresses.
4. Spot-check at least one direct long link and one xhs shortlink import in UI.
5. Keep `debugEnabled` default `true`; only disable for privacy-sensitive users.
