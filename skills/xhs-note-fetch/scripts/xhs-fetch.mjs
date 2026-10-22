#!/usr/bin/env node
// Compatibility shim. Fetching a note through the running Obsidian plugin now lives in
// import-content.mjs (`--print --via obsidian`); this keeps the old command and its JSON shape:
//   node xhs-fetch.mjs "<share url>" [--vault <name>] [--timeout <seconds>]
// Writing a note file is done with import-content.mjs --output-dir.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const fail = (message) => {
	console.error(`xhs-fetch: ${message}`);
	process.exit(1);
};

if (args.length === 0 || args.includes("--help")) {
	console.log('Usage: node xhs-fetch.mjs "<xiaohongshu share url>" [--vault <name>] [--timeout <seconds>]');
	process.exit(args.length === 0 ? 1 : 0);
}
if (args.includes("--out")) {
	fail("--out was removed; use import-content.mjs --output-dir <dir> --url <url> to save a note");
}

const opt = (name) => {
	const index = args.indexOf(name);
	return index >= 0 && index + 1 < args.length ? args[index + 1] : "";
};
const url = args.find((arg) => /xiaohongshu\.com|xhslink\.com/i.test(arg));
if (!url) {
	fail("no xiaohongshu.com / xhslink.com URL in arguments");
}

const forwarded = ["--print", "--via", "obsidian", "--url", url];
for (const name of ["--vault", "--timeout"]) {
	if (opt(name)) {
		forwarded.push(name, opt(name));
	}
}

const script = fileURLToPath(new URL("./import-content.mjs", import.meta.url));
const run = spawnSync("node", [script, ...forwarded], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let result;
try {
	result = JSON.parse(run.stdout).results[0];
} catch {
	fail((run.stderr || run.stdout || "no output from import-content.mjs").trim().split("\n")[0]);
}
if (result.status !== "success") {
	fail(result.error);
}

const { status, platform, route, url: _input, fallbackReason, ...payload } = result;
console.log(JSON.stringify(payload, null, 2));
