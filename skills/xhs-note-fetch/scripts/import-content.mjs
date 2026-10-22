#!/usr/bin/env node
// Import WeChat (公众号) articles and Xiaohongshu (小红书) notes as Markdown notes.
//
// Fetch routes feed one renderer:
//   standalone - plain Node fetch (no dependencies, Obsidian not needed); WeChat only
//   obsidian   - the running Obsidian app's multi-source-content-importer plugin, reached
//                through the `obsidian` CLI; the only route for Xiaohongshu
// In auto mode WeChat tries standalone then obsidian; Xiaohongshu uses obsidian. Either way this
// script downloads the images and writes the note, so the output is identical.
//
// The WeChat extraction and the rendering mirror the plugin sources (src/platforms/wechat/*,
// main.ts importWechatArticle / importXiaohongshuNote) of the all-in-obs-hq fork. Keep them
// aligned with the plugin.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const PLUGIN_ID = "multi-source-content-importer";
const MEDIA_SUBFOLDER = "images";
const COVER_IMAGE_ALT = "404";
const GALLERY_IMAGE_ALT = "400";
const XHS_LOGIN_WALL_TITLE = "小红书 - 你的生活兴趣社区";
const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HTTP_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------- CLI

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}
	if (!options.print && !options.outputDir) {
		throw new Error("Missing required argument: --output-dir (or use --print to only fetch)");
	}

	const rawInputs = await collectRawInputs(options);
	const batch = extractBatchImportTargets(rawInputs);
	if (batch.targets.length === 0) {
		throw new Error("No valid links found. Supported platforms: WeChat / Xiaohongshu.");
	}

	const outputDir = options.outputDir ? path.resolve(options.outputDir) : "";
	const category = options.category || (outputDir ? path.basename(outputDir) : "") || "其他";
	const results = [];

	for (const target of batch.targets) {
		try {
			const fetched = await fetchTarget(target, options);
			if (options.print) {
				results.push({ status: "success", platform: target.platform, url: target.url, route: fetched.route, ...printable(target.platform, fetched) });
				continue;
			}
			const written = await writeNote(target.platform, fetched, { outputDir, category, downloadMedia: options.downloadMedia });
			results.push({
				status: "success",
				platform: target.platform,
				url: target.url,
				route: fetched.route,
				...(fetched.fallbackReason ? { fallbackReason: fetched.fallbackReason } : {}),
				filePath: written.filePath,
				imagesDownloaded: written.imagesDownloaded,
				imagesFailed: written.imagesFailed,
			});
		} catch (error) {
			results.push({
				status: "failed",
				platform: target.platform,
				url: target.url,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const summary = {
		...(options.print ? { print: true } : { outputDir, category, downloadMedia: options.downloadMedia }),
		successCount: results.filter((item) => item.status === "success").length,
		failedCount: results.filter((item) => item.status === "failed").length,
		invalidLines: batch.invalidLines,
		results,
	};
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	if (summary.failedCount > 0) {
		process.exitCode = 1;
	}
}

function parseArgs(args) {
	const options = {
		urls: [],
		inputFile: "",
		text: "",
		outputDir: "",
		category: "",
		downloadMedia: true,
		via: "auto",
		vault: process.env.OBSIDIAN_VAULT || "",
		timeout: 90,
		print: false,
		help: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--url":
				options.urls.push(readValue(args, ++index, "--url"));
				break;
			case "--input-file":
				options.inputFile = readValue(args, ++index, "--input-file");
				break;
			case "--text":
				options.text = readValue(args, ++index, "--text");
				break;
			case "--output-dir":
				options.outputDir = readValue(args, ++index, "--output-dir");
				break;
			case "--category":
				options.category = readValue(args, ++index, "--category");
				break;
			case "--download-media":
				options.downloadMedia = true; // default; kept for older callers
				break;
			case "--no-download-media":
				options.downloadMedia = false;
				break;
			case "--via": {
				const value = readValue(args, ++index, "--via");
				if (!["auto", "standalone", "obsidian"].includes(value)) {
					throw new Error("--via must be one of: auto, standalone, obsidian");
				}
				options.via = value;
				break;
			}
			case "--vault":
				options.vault = readValue(args, ++index, "--vault");
				break;
			case "--timeout":
				options.timeout = Number(readValue(args, ++index, "--timeout")) || 90;
				break;
			case "--print":
				options.print = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function readValue(args, index, flag) {
	const value = args[index];
	if (!value || value.startsWith("--")) {
		throw new Error(`Missing value for ${flag}`);
	}
	return value;
}

function printHelp() {
	const text = `
Usage:
  node scripts/import-content.mjs --output-dir <dir> [--category <name>] --url <url>...
  node scripts/import-content.mjs --output-dir <dir> --input-file <file>
  node scripts/import-content.mjs --print --url <url>          fetch only, write nothing

Options:
  --output-dir <dir>      folder that receives the notes; images go to <dir>/images/
  --category <name>       frontmatter category (default: the output folder's name)
  --no-download-media     keep remote image URLs instead of saving them under images/
  --via auto|standalone|obsidian
                          auto (default): WeChat = plain Node fetch, then the running Obsidian plugin;
                          Xiaohongshu = the running Obsidian plugin only (plain HTTP clients are
                          redirected to its login page)
  --vault <name>          Obsidian vault for the fallback (default: first open vault with the plugin
                          loaded; or env OBSIDIAN_VAULT)
  --print                 print extracted data as JSON; no files are written
  --text <string>         free text containing links (e.g. a pasted share message)
  --timeout <seconds>     wait limit for the Obsidian fallback (default 90)

Examples:
  node scripts/import-content.mjs --output-dir ./inbox --url "https://mp.weixin.qq.com/s/xxxx"
  node scripts/import-content.mjs --output-dir ./inbox --input-file ./links.txt
  node scripts/import-content.mjs --print --url "http://xhslink.com/o/xxxx"
`;
	process.stdout.write(text.trimStart());
}

async function collectRawInputs(options) {
	const parts = [...options.urls];
	if (options.text) {
		parts.push(options.text);
	}
	if (options.inputFile) {
		parts.push(await fs.readFile(path.resolve(options.inputFile), "utf8"));
	}
	return parts.join("\n");
}

// ---------------------------------------------------------------- target extraction

function extractBatchImportTargets(text) {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const targets = [];
	const invalidLines = [];
	const seen = new Set();

	for (const line of lines) {
		const target = extractImportTarget(line);
		if (!target) {
			invalidLines.push(line);
			continue;
		}
		const key = `${target.platform}:${target.url}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		targets.push(target);
	}

	return { targets, invalidLines };
}

function extractImportTarget(input) {
	const wechatUrl = extractWechatUrl(input);
	if (wechatUrl) {
		return { platform: "wechat", url: wechatUrl };
	}
	const xhsUrl = extractXiaohongshuUrl(input);
	if (xhsUrl) {
		return { platform: "xiaohongshu", url: xhsUrl };
	}
	return null;
}

function extractWechatUrl(input) {
	const normalizedInput = input.replace(/&amp;/g, "&");
	const patterns = [
		/(https?:\/\/mp\.weixin\.qq\.com\/s\/[a-zA-Z0-9_-]+(?:\?[^\s，,]*)?)/,
		/(https?:\/\/mp\.weixin\.qq\.com\/s\?[^\s，,]+)/,
	];
	for (const pattern of patterns) {
		const match = normalizedInput.match(pattern);
		if (match?.[1]) {
			return normalizeArticleUrl(match[1]);
		}
	}
	return null;
}

function extractXiaohongshuUrl(input) {
	const normalizedInput = input.replace(/&amp;/g, "&");
	const patterns = [
		/(https?:\/\/xhslink\.com\/a?o?\/[^\s，,]+)/i,
		/(https?:\/\/www\.xiaohongshu\.com\/(?:discovery\/item|explore)\/[a-zA-Z0-9]+(?:\?[^\s，,]*)?)/i,
	];
	for (const pattern of patterns) {
		const match = normalizedInput.match(pattern);
		if (match?.[1]) {
			return match[1].replace("/explore/", "/discovery/item/");
		}
	}
	return null;
}

function normalizeArticleUrl(url) {
	let normalized = url.trim().replace(/&amp;/g, "&");
	normalized = normalized.replace(/[。！!）)\]】>,，,]+$/, "");
	normalized = normalized.replace(/#wechat_redirect$/, "");
	return normalized;
}

// ---------------------------------------------------------------- route selection

// Returns { route, fallbackReason?, data } where data is the platform's extracted record.
// WeChat pages load fine over plain Node, so WeChat tries standalone first and the Obsidian
// plugin second. Xiaohongshu redirects plain HTTP clients to its login page, so it only goes
// through the Obsidian plugin (a real browser network stack).
async function fetchTarget(target, options) {
	const routes = { obsidian: () => fetchViaObsidian(target, options) };
	if (target.platform === "wechat") {
		routes.standalone = () => fetchWechatStandalone(target.url);
	}

	const autoOrder = target.platform === "wechat" ? ["standalone", "obsidian"] : ["obsidian"];
	const order = options.via === "auto" ? autoOrder : [options.via];
	if (!routes[order[0]]) {
		throw new Error("Xiaohongshu can only be read through the Obsidian plugin (use --via obsidian or auto)");
	}

	const failures = [];
	for (const route of order) {
		try {
			const data = await routes[route]();
			return { route, ...(failures.length ? { fallbackReason: failures.join(" | ") } : {}), data };
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			failures.push(`${route}: ${reason}`);
			if (route !== order[order.length - 1]) {
				process.stderr.write(`[${route} failed] ${target.platform} ${target.url}: ${reason}\n[fallback] trying ${order[order.indexOf(route) + 1]}...\n`);
			}
		}
	}
	throw new Error(failures.join(" | "));
}

function printable(platform, fetched) {
	const data = fetched.data;
	if (platform === "xiaohongshu") {
		return {
			title: data.title,
			content: data.content,
			tags: data.tags,
			images: data.images,
			videoUrl: data.videoUrl || null,
			isVideo: Boolean(data.isVideo),
			source: data.source,
			resolvedUrl: data.resolvedUrl,
			...(fetched.fallbackReason ? { fallbackReason: fetched.fallbackReason } : {}),
		};
	}
	const images = extractImageUrlsFromContent(data.contentHtml);
	return {
		title: data.title,
		account: data.account,
		author: data.author,
		publishedAt: data.publishedAt,
		description: data.description,
		contentMarkdown: htmlToMarkdown(data.contentHtml, (raw) => normalizeMediaUrl(raw)),
		images,
		source: data.source,
		...(fetched.fallbackReason ? { fallbackReason: fetched.fallbackReason } : {}),
	};
}

// ---------------------------------------------------------------- HTTP

async function http(url, { method = "GET", headers = {}, redirect = "manual" } = {}) {
	const response = await fetch(url, {
		method,
		headers,
		redirect,
		signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
	});
	const text = method === "HEAD" ? "" : await response.text();
	return { status: response.status, headers: response.headers, text, url: response.url || url };
}

function xhsHeaders() {
	return {
		"User-Agent": UA,
		"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
		Referer: "https://www.xiaohongshu.com/",
	};
}

function wechatHeaders(articleUrl) {
	return {
		"User-Agent": UA,
		Referer: "https://mp.weixin.qq.com/",
		"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
		"Cache-Control": "no-cache",
		"Sec-Fetch-Site": "none",
		"Sec-Fetch-Mode": "navigate",
		"Sec-Fetch-Dest": "document",
		"X-Requested-With": "XMLHttpRequest",
		"X-Source-URL": articleUrl,
	};
}

// ---------------------------------------------------------------- Xiaohongshu check

// Xiaohongshu is read only through the Obsidian plugin (plain HTTP clients are redirected to its
// login page), so the plugin's extraction result is all this script needs to validate.
// A login page or an empty shell is a failure, not a note.
function assertRealXhsNote(note) {
	if (note.title === XHS_LOGIN_WALL_TITLE) {
		throw new Error("小红书返回了登录页（需要登录或 xsec_token 已过期）");
	}
	if (!note.content.trim() && note.images.length === 0 && !note.videoUrl) {
		throw new Error("小红书页面没有笔记数据（登录墙、空壳页或 xsec_token 已过期）");
	}
}

// ---------------------------------------------------------------- WeChat: standalone route

async function fetchWechatStandalone(inputUrl) {
	const url = normalizeArticleUrl(inputUrl);
	const response = await http(url, { headers: wechatHeaders(url), redirect: "follow" });
	if (response.status >= 400) {
		throw new Error(`请求失败（HTTP ${response.status}）`);
	}
	if (isWechatVerificationPage(response.text)) {
		throw new Error("微信返回了验证页面（环境异常/去验证），请稍后重试或更换网络环境。");
	}
	const article = extractWechatArticle(url, response.text);
	assertRealWechatArticle(article);
	return article;
}

function assertRealWechatArticle(article) {
	if (!article.contentHtml.trim()) {
		throw new Error("未提取到正文内容");
	}
}

function isWechatVerificationPage(html) {
	return /环境异常|去验证|secitptpage\/template\/verify|TCaptcha|wappoc_appmsgcaptcha/i.test(html);
}

// ---------------------------------------------------------------- WeChat: extraction

function extractWechatArticle(sourceUrl, html) {
	const cgiSegment = extractCgiDataSegment(html);

	const title =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, "title")),
			decodeJsEscapedString(extractVarSingleQuoted(html, "msg_title", "\\.html\\(false\\)")),
			extractMetaContent(html, "property", "og:title"),
			extractTitleTag(html),
		]) || "Untitled WeChat Article";

	const description =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, "desc")),
			decodeJsEscapedString(extractVarHtmlDecodeDoubleQuoted(html, "msg_desc")),
			extractMetaContent(html, "name", "description"),
		]) || "";

	const account =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, "nick_name")),
			decodeJsEscapedString(extractVarHtmlDecodeDoubleQuoted(html, "nickname")),
		]) || "";

	const wechatId =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, "user_name")),
			decodeJsEscapedString(extractVarDoubleQuoted(html, "user_name")),
		]) || "";

	const alias =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, "alias")),
			decodeJsEscapedString(extractWindowDoubleQuoted(html, "alias")),
		]) || "";

	const author =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, "author")),
			decodeJsEscapedString(extractVarDoubleQuoted(html, "author")),
		]) || "";

	const publishedAtRaw =
		pickFirst([
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, "create_time")),
			decodeJsDecodeValue(extractJsDecodeProp(cgiSegment, "ori_create_time")),
		]) || "";

	const publishedTs = pickNumber([
		extractNumericProp(cgiSegment, "ori_create_time"),
		extractNumericVar(html, "ct"),
		extractNumericVar(html, "create_time"),
	]);
	const publishedAt = publishedAtRaw || (publishedTs > 0 ? formatUnixTime(publishedTs) : "");

	const type =
		pickFirst([extractNumericType(cgiSegment), decodeJsEscapedString(extractVarDoubleQuoted(html, "appmsg_type"))]) || "article";

	// Same precedence as the plugin: the rendered #js_content first, then content_noencode.
	let contentHtml = extractJsContentHtml(html);
	if (!contentHtml) {
		contentHtml = decodeJsDecodeValue(extractContentNoEncode(cgiSegment));
	}
	contentHtml = cleanContentHtml(contentHtml);

	return {
		title: cleanText(title),
		description: cleanText(description),
		source: sourceUrl,
		account: cleanText(account),
		wechatId: cleanText(wechatId),
		alias: cleanText(alias),
		author: cleanText(author),
		publishedAt: cleanText(publishedAt),
		publishedTs,
		type: cleanText(type),
		contentHtml,
	};
}

function extractCgiDataSegment(html) {
	const startIndex = html.indexOf("window.cgiDataNew");
	return startIndex < 0 ? html : html.slice(startIndex, startIndex + 650000);
}

function extractJsDecodeProp(text, prop) {
	const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`${escaped}\\s*:\\s*JsDecode\\('([\\s\\S]*?)'\\)`).exec(text)?.[1] ?? "";
}

function extractVarDoubleQuoted(text, variableName) {
	const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`var\\s+${escaped}\\s*=\\s*"([\\s\\S]*?)"`).exec(text)?.[1] ?? "";
}

function extractWindowDoubleQuoted(text, variableName) {
	const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`window\\.${escaped}\\s*=\\s*"([\\s\\S]*?)"`).exec(text)?.[1] ?? "";
}

function extractVarSingleQuoted(text, variableName, suffixPattern = "") {
	const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`var\\s+${escaped}\\s*=\\s*'([\\s\\S]*?)'${suffixPattern}`).exec(text)?.[1] ?? "";
}

function extractVarHtmlDecodeDoubleQuoted(text, variableName) {
	const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`var\\s+${escaped}\\s*=\\s*htmlDecode\\("([\\s\\S]*?)"\\)`).exec(text)?.[1] ?? "";
}

function extractNumericVar(text, variableName) {
	const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return toNumber(new RegExp(`var\\s+${escaped}\\s*=\\s*"?(\\d{8,13})"?`).exec(text)?.[1] ?? "");
}

function extractNumericProp(text, propName) {
	const escaped = propName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return toNumber(new RegExp(`${escaped}\\s*:\\s*'?(\\d{8,13})'?\\s*\\*?\\s*1?`).exec(text)?.[1] ?? "");
}

function extractNumericType(text) {
	return /type\s*:\s*'?(\d+)'?\s*\*\s*1/.exec(text)?.[1] ?? "";
}

function extractMetaContent(html, attrName, attrValue) {
	const escaped = attrValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return decodeHtmlEntities(new RegExp(`<meta\\s+${attrName}=["']${escaped}["']\\s+content=["']([^"']*)["']`, "i").exec(html)?.[1] ?? "");
}

function extractTitleTag(html) {
	const value = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
	return decodeHtmlEntities(value).replace(/\s*-\s*微信公众平台\s*$/, "").trim();
}

function extractContentNoEncode(segment) {
	return segment.match(/content_noencode\s*:\s*JsDecode\('([\s\S]*?)'\),\s*create_time\s*:/)?.[1] ?? "";
}

// innerHTML of <div id="js_content"> by balanced <div> counting (no DOM in Node).
function extractJsContentHtml(html) {
	const startMatch = /<div[^>]+id=["']js_content["'][^>]*>/i.exec(html);
	if (!startMatch || startMatch.index === undefined) {
		return "";
	}
	const contentStart = startMatch.index + startMatch[0].length;
	let index = contentStart;
	let depth = 1;
	const tagPattern = /<\/?div\b[^>]*>/gi;
	tagPattern.lastIndex = contentStart;
	for (let tag = tagPattern.exec(html); tag; tag = tagPattern.exec(html)) {
		depth += /^<div\b/i.test(tag[0]) ? 1 : -1;
		if (depth === 0) {
			return html.slice(contentStart, tag.index);
		}
		index = tag.index + tag[0].length;
	}
	return index > contentStart ? html.slice(contentStart) : "";
}

function cleanContentHtml(contentHtml) {
	return (contentHtml || "")
		.replace(/<(script|style|noscript|iframe)\b[\s\S]*?<\/\1>/gi, "")
		.replace(/<mp-style-type\b[^>]*>[\s\S]*?<\/mp-style-type>/gi, "");
}

// Images that appear in the article body. The cover is not included: the note has no
// `cover` field, so downloading it would leave an orphan file in images/.
function extractImageUrlsFromContent(contentHtml) {
	const urls = new Set();
	for (const match of (contentHtml || "").matchAll(/<img\b[^>]*>/gi)) {
		const raw = extractAttribute(match[0], "data-src") || extractAttribute(match[0], "src");
		const normalized = normalizeMediaUrl(raw);
		if (normalized) {
			urls.add(normalized);
		}
	}
	return Array.from(urls);
}

function extractAttribute(tag, name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(?<![\\w-])${escaped}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] ?? "";
}

// ---------------------------------------------------------------- Obsidian fallback route

function obsidianCli(vault, code, timeoutMs) {
	try {
		const raw = execFileSync("obsidian", [`vault=${vault}`, "eval", `code=${code}`], {
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
			timeout: timeoutMs,
		});
		return raw.replace(/^=>\s?/, "").trim();
	} catch (error) {
		const detail = String(error.message || error).split("\n")[0];
		throw new Error(`obsidian CLI failed (is Obsidian running with vault "${vault}" open?): ${detail}`);
	}
}

function pluginLoadedProbe() {
	return `JSON.stringify({x:typeof app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.xhsNoteService?.fetchHtml,w:typeof app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.wechatArticleService?.fetchHtml})`;
}

function findObsidianVault(options) {
	const probeTimeout = 15000;
	const isLoaded = (vault) => {
		try {
			const info = JSON.parse(obsidianCli(vault, pluginLoadedProbe(), probeTimeout));
			return info.x === "function" && info.w === "function";
		} catch {
			return false;
		}
	};

	if (options.vault) {
		if (!isLoaded(options.vault)) {
			throw new Error(`plugin ${PLUGIN_ID} is not loaded in vault "${options.vault}" (or the vault is not open)`);
		}
		return options.vault;
	}

	let names = [];
	try {
		names = execFileSync("obsidian", ["vaults"], { encoding: "utf8", timeout: probeTimeout })
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		throw new Error("obsidian CLI is not available or Obsidian is not running");
	}
	for (const name of names) {
		if (isLoaded(name)) {
			return name;
		}
	}
	throw new Error(`no open Obsidian vault has the ${PLUGIN_ID} plugin loaded`);
}

async function fetchViaObsidian(target, options) {
	const vault = findObsidianVault(options);
	const timeoutMs = options.timeout * 1000;
	const key = `__xhsNoteFetch_${Date.now()}`;
	const plugin = `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]`;
	const urlLiteral = JSON.stringify(target.url);

	const job =
		target.platform === "wechat"
			? `const p=${plugin};const u=${urlLiteral};const h=await p.wechatArticleService.fetchHtml(u);const d=p.wechatArticleService.extractArticle(u,h);window[${JSON.stringify(key)}]=JSON.stringify({ok:true,...d});`
			: `const p=${plugin};const u=await p.xhsResolver.resolve(${urlLiteral});const h=await p.xhsNoteService.fetchHtml(u);const d=p.xhsNoteService.extractNoteData(u,h);window[${JSON.stringify(key)}]=JSON.stringify({ok:true,resolvedUrl:u,...d});`;

	obsidianCli(
		vault,
		`window[${JSON.stringify(key)}]="pending";(async()=>{try{${job}}catch(e){window[${JSON.stringify(key)}]=JSON.stringify({ok:false,error:String((e&&e.message)||e)});}})();"started"`,
		timeoutMs
	);

	const started = Date.now();
	let result = "pending";
	// An empty reply is treated like "not ready yet": it was seen once in a few dozen polls.
	while ((result === "pending" || result === "") && Date.now() - started < timeoutMs) {
		await new Promise((resolve) => setTimeout(resolve, 1500));
		result = obsidianCli(vault, `window[${JSON.stringify(key)}]`, timeoutMs);
	}
	obsidianCli(vault, `delete window[${JSON.stringify(key)}];"cleared"`, timeoutMs);

	if (result === "pending" || result === "") {
		throw new Error(`Obsidian did not answer within ${options.timeout}s`);
	}
	let data;
	try {
		data = JSON.parse(result);
	} catch {
		throw new Error(`unexpected reply from Obsidian: ${result.slice(0, 200)}`);
	}
	if (!data.ok) {
		throw new Error(data.error || "Obsidian plugin reported a failure");
	}

	if (target.platform === "wechat") {
		const article = {
			title: cleanText(data.title || ""),
			description: cleanText(data.description || ""),
			source: target.url,
			account: data.account || "",
			wechatId: data.wechatId || "",
			alias: data.alias || "",
			author: data.author || "",
			publishedAt: data.publishedAt || "",
			publishedTs: data.publishedTs || 0,
			type: data.type || "article",
			contentHtml: data.contentHtml || "",
		};
		assertRealWechatArticle(article);
		return article;
	}

	const note = {
		title: data.title,
		source: target.url,
		content: data.content || "",
		images: data.images || [],
		videoUrl: data.videoUrl || null,
		isVideo: Boolean(data.isVideo),
		tags: data.tags || [],
		cover: data.cover || "",
		resolvedUrl: data.resolvedUrl,
	};
	assertRealXhsNote(note);
	return note;
}

// ---------------------------------------------------------------- note writing

async function writeNote(platform, fetched, { outputDir, category, downloadMedia }) {
	await fs.mkdir(outputDir, { recursive: true });
	const mediaFolder = path.join(outputDir, MEDIA_SUBFOLDER);
	const stats = { imagesDownloaded: 0, imagesFailed: 0 };
	const data = fetched.data;

	if (platform === "wechat") {
		const headers = wechatHeaders(data.source);
		const imageMap = await buildImageMap(extractImageUrlsFromContent(data.contentHtml), { downloadMedia, mediaFolder, headers, stats });
		const contentMarkdown = htmlToMarkdown(data.contentHtml, (raw) => {
			const normalized = normalizeMediaUrl(raw);
			return normalized ? imageMap.get(normalized) ?? normalized : "";
		});
		const markdown = `${buildWechatFrontmatter(data, category)}\n# ${data.title}\n\n${contentMarkdown}\n`;
		const filePath = await getUniqueNotePath(outputDir, sanitizeFileName(data.title, "Untitled WeChat Article"));
		await fs.writeFile(filePath, markdown, "utf8");
		return { filePath, ...stats };
	}

	const headers = xhsHeaders();
	// A video note renders the video instead of the image gallery, so its images are not downloaded.
	const rendersVideo = data.isVideo && Boolean(data.videoUrl);
	const imageMap = rendersVideo ? new Map() : await buildImageMap(data.images, { downloadMedia, mediaFolder, headers, stats });
	const finalImages = data.images.map((img) => {
		const normalized = normalizeMediaUrl(img);
		return imageMap.get(normalized) ?? imageMap.get(img) ?? normalized ?? img;
	});

	let videoMarkdown = "";
	if (data.isVideo && data.videoUrl) {
		let finalVideoUrl = data.videoUrl;
		if (downloadMedia) {
			const safeMediaTitle = sanitizeMediaBaseName(data.title, "Untitled-XHS-Note");
			const videoFilename = await downloadMediaFile(data.videoUrl, mediaFolder, `${safeMediaTitle}-video`, ".mp4", headers);
			if (!videoFilename.startsWith("http")) {
				finalVideoUrl = `${MEDIA_SUBFOLDER}/${videoFilename}`;
			}
		}
		videoMarkdown = `<video controls src="${finalVideoUrl}" width="100%"></video>\n\n`;
	}

	let body = "";
	if (videoMarkdown) {
		body += videoMarkdown;
	} else if (finalImages.length > 0) {
		const gallery = finalImages
			.map((img, index) => `![${index === 0 ? COVER_IMAGE_ALT : GALLERY_IMAGE_ALT}](${toMarkdownDestination(img)})`)
			.join("");
		body += `${gallery}\n\n`;
	}
	const cleanContent = data.content.trim();
	if (cleanContent) {
		body += `${cleanContent}\n\n`;
	}
	if (data.tags.length > 0) {
		body += `${data.tags.map((tag) => `#${tag}`).join(" ")}\n\n`;
	}

	const markdown = `${buildXhsFrontmatter(data, category)}\n# ${data.title}\n\n${normalizeMarkdownSpacing(body)}\n`;
	const filePath = await getUniqueNotePath(outputDir, sanitizeFileName(data.title, "Untitled Xiaohongshu Note"));
	await fs.writeFile(filePath, markdown, "utf8");
	return { filePath, ...stats };
}

function buildWechatFrontmatter(article, category) {
	return [
		"---",
		`platform: ${toYamlString("wechat")}`,
		`title: ${toYamlString(article.title)}`,
		`source: ${toYamlString(article.source)}`,
		`account: ${toYamlString(article.account)}`,
		`wechat_id: ${toYamlString(article.wechatId)}`,
		`alias: ${toYamlString(article.alias)}`,
		`author: ${toYamlString(article.author)}`,
		`published_at: ${toYamlString(article.publishedAt)}`,
		`published_ts: ${article.publishedTs > 0 ? String(article.publishedTs) : "0"}`,
		`imported_at: ${toYamlString(formatDateTime(new Date()))}`,
		`category: ${toYamlString(category)}`,
		`description: ${toYamlString(article.description)}`,
		`type: ${toYamlString(article.type)}`,
		"---",
	].join("\n");
}

function buildXhsFrontmatter(note, category) {
	return [
		"---",
		`platform: ${toYamlString("xiaohongshu")}`,
		`title: ${toYamlString(note.title)}`,
		`source: ${toYamlString(note.source)}`,
		`category: ${toYamlString(category)}`,
		`imported_at: ${toYamlString(formatDateTime(new Date()))}`,
		`type: ${toYamlString(note.isVideo ? "video" : "note")}`,
		"---",
	].join("\n");
}

// ---------------------------------------------------------------- media

async function buildImageMap(imageUrls, { downloadMedia, mediaFolder, headers, stats }) {
	const map = new Map();
	for (const rawUrl of imageUrls) {
		const normalized = normalizeMediaUrl(rawUrl);
		if (!normalized || map.has(normalized)) {
			continue;
		}
		if (!downloadMedia) {
			map.set(normalized, normalized);
			continue;
		}
		const downloaded = await downloadImageByContentHash(normalized, mediaFolder, guessImageExtension(normalized), headers);
		if (downloaded.startsWith("http")) {
			stats.imagesFailed += 1;
			map.set(normalized, downloaded);
		} else {
			stats.imagesDownloaded += 1;
			map.set(normalized, `${MEDIA_SUBFOLDER}/${downloaded}`);
		}
	}
	return map;
}

async function fetchBinary(url, headers) {
	const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

// "<md5>_MD5.<ext>" naming shared with obsidian-local-images-plus: MD5 over three UTF-8
// decoded 15000-byte samples (head, middle, tail) of the binary, joined with ",".
function mediaMd5Signature(buffer) {
	const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	const decoder = new TextDecoder("utf-8");
	const middle = Math.round(data.byteLength / 2);
	const sampledText = [data.slice(0, 15000), data.slice(middle, middle + 15000), data.slice(-15000)]
		.map((part) => decoder.decode(part))
		.join();
	return createHash("md5").update(sampledText, "utf8").digest("hex");
}

async function downloadImageByContentHash(url, folderPath, extension, headers) {
	try {
		const data = await fetchBinary(url, headers);
		await fs.mkdir(folderPath, { recursive: true });
		const filename = `${mediaMd5Signature(data)}_MD5${extension}`;
		const filePath = path.join(folderPath, filename);
		if (!(await exists(filePath))) {
			await fs.writeFile(filePath, data);
		}
		return filename;
	} catch (error) {
		process.stderr.write(`[image] download failed, keeping remote URL: ${url} (${error.message})\n`);
		return url;
	}
}

async function downloadMediaFile(url, folderPath, baseName, extension, headers) {
	try {
		const data = await fetchBinary(url, headers);
		await fs.mkdir(folderPath, { recursive: true });
		let index = 0;
		for (;;) {
			const filename = `${baseName}${index === 0 ? "" : `-${index}`}${extension}`;
			if (!(await exists(path.join(folderPath, filename)))) {
				await fs.writeFile(path.join(folderPath, filename), data);
				return filename;
			}
			index += 1;
		}
	} catch (error) {
		process.stderr.write(`[media] download failed, keeping remote URL: ${url} (${error.message})\n`);
		return url;
	}
}

function guessImageExtension(url) {
	const wxFmt = url.match(/[?&]wx_fmt=([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase();
	if (wxFmt === "jpeg" || wxFmt === "jpg") {
		return ".jpg";
	}
	if (wxFmt === "png" || wxFmt === "gif" || wxFmt === "webp") {
		return `.${wxFmt}`;
	}
	try {
		const ext = new URL(url).pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
		if (ext && ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) {
			return ext === "jpeg" ? ".jpg" : `.${ext}`;
		}
	} catch {
		// Fall through to the default extension.
	}
	return ".jpg";
}

function normalizeMediaUrl(url) {
	if (!url) {
		return "";
	}
	let normalized = decodeHtmlEntities(decodeJsEscapedString(url.trim()));
	normalized = normalized.replace(/\\x26amp;/gi, "&").replace(/&amp;/gi, "&").replace(/&/gi, "&");
	normalized = normalized.replace(/^\/\//, "https://");
	if (/^http:\/\//i.test(normalized)) {
		normalized = normalized.replace(/^http:\/\//i, "https://");
	}
	return /^https?:\/\//i.test(normalized) ? normalized.trim() : "";
}

// ---------------------------------------------------------------- HTML -> Markdown (no dependencies)
// A compact converter for WeChat article bodies. The plugin uses turndown; this covers the same
// elements (headings, emphasis, links, images, lists, quotes, code, tables) with simpler escaping.

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "figure", "figcaption", "table"]);
const REMOVE_TAGS = /<(script|style|noscript|iframe|svg|mp-style-type)\b[\s\S]*?<\/\1>/gi;

function htmlToMarkdown(html, resolveImage) {
	const source = (html || "").replace(REMOVE_TAGS, "").replace(/<!--[\s\S]*?-->/g, "");
	const out = [];
	const lists = [];
	const wraps = [];
	let preDepth = 0;

	const push = (value) => {
		if (value) {
			out.push(value);
		}
	};
	const lastChar = () => (out.length ? out[out.length - 1].slice(-1) : "\n");
	const openWrap = (kind) => wraps.push({ kind, start: out.length });
	const closeWrap = (kind) => {
		for (let index = wraps.length - 1; index >= 0; index -= 1) {
			if (wraps[index].kind === kind) {
				const wrap = wraps.splice(index)[0];
				return out.splice(wrap.start).join("");
			}
		}
		return null;
	};
	const emphasize = (inner, mark) => {
		const core = inner.trim();
		if (!core || core.includes("\n")) {
			return inner;
		}
		const lead = inner.match(/^\s*/)[0];
		const trail = inner.match(/\s*$/)[0];
		return `${lead}${mark}${core}${mark}${trail}`;
	};

	for (const match of source.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>|[^<]+|</g)) {
		const token = match[0];
		if (!match[2]) {
			let text = decodeHtmlEntities(token).replace(/​/g, "").replace(/ /g, " ");
			if (!preDepth) {
				text = text.replace(/[ \t\r\n]+/g, " ");
				if (/[\s]/.test(lastChar())) {
					text = text.replace(/^ +/, "");
				}
			}
			push(text);
			continue;
		}

		const closing = match[1] === "/";
		const name = match[2].toLowerCase();

		if (/^h[1-6]$/.test(name)) {
			if (closing) {
				push("\n\n");
			} else {
				push(`\n\n${"#".repeat(Number(name[1]))} `);
			}
		} else if (BLOCK_TAGS.has(name)) {
			if (preDepth) {
				push("\n");
			} else if (lists.length) {
				push(closing ? " " : "");
			} else {
				push("\n\n");
			}
		} else if (name === "tr") {
			push(closing ? "\n" : "");
		} else if (name === "td" || name === "th") {
			if (closing) {
				push(" | ");
			}
		} else if (name === "br") {
			push("\n");
		} else if (name === "hr") {
			push("\n\n---\n\n");
		} else if (name === "ul" || name === "ol") {
			if (closing) {
				lists.pop();
				push(lists.length ? "" : "\n\n");
			} else {
				push(lists.length ? "" : "\n\n");
				lists.push({ ordered: name === "ol", count: 0 });
			}
		} else if (name === "li") {
			if (!closing) {
				const list = lists[lists.length - 1];
				if (list) {
					list.count += 1;
				}
				push(`\n${"  ".repeat(Math.max(lists.length - 1, 0))}${list?.ordered ? `${list.count}. ` : "- "}`);
			}
		} else if (name === "strong" || name === "b") {
			if (closing) {
				const inner = closeWrap("strong");
				push(inner === null ? "" : emphasize(inner, "**"));
			} else {
				openWrap("strong");
			}
		} else if (name === "em" || name === "i") {
			if (closing) {
				const inner = closeWrap("em");
				push(inner === null ? "" : emphasize(inner, "_"));
			} else {
				openWrap("em");
			}
		} else if (name === "code" && !preDepth) {
			if (closing) {
				const inner = closeWrap("code");
				push(inner === null ? "" : emphasize(inner, "`"));
			} else {
				openWrap("code");
			}
		} else if (name === "pre") {
			if (closing) {
				preDepth = Math.max(preDepth - 1, 0);
				const inner = closeWrap("pre");
				push(inner === null ? "" : `\n\n\`\`\`\n${inner.replace(/^\n+|\n+$/g, "")}\n\`\`\`\n\n`);
			} else {
				preDepth += 1;
				openWrap("pre");
			}
		} else if (name === "blockquote") {
			if (closing) {
				const inner = closeWrap("quote");
				if (inner !== null) {
					const quoted = normalizeMarkdownSpacing(inner)
						.split("\n")
						.map((line) => (line ? `> ${line}` : ">"))
						.join("\n");
					push(`\n\n${quoted}\n\n`);
				}
			} else {
				openWrap("quote");
			}
		} else if (name === "a") {
			if (closing) {
				const wrap = wraps.findLast((item) => item.kind === "link");
				const inner = closeWrap("link");
				if (inner !== null) {
					const text = inner.trim();
					push(wrap?.href && text && !text.includes("\n") ? `[${text}](${toMarkdownDestination(wrap.href)})` : inner);
				}
			} else {
				openWrap("link");
				const href = decodeHtmlEntities(extractAttribute(token, "href"));
				wraps[wraps.length - 1].href = /^https?:\/\//i.test(href) ? href : "";
			}
		} else if (name === "img" && !closing) {
			const finalUrl = resolveImage(extractAttribute(token, "data-src") || extractAttribute(token, "src"));
			if (finalUrl) {
				const alt = cleanText(decodeHtmlEntities(extractAttribute(token, "alt"))) || "Image";
				push(`![${alt}](${toMarkdownDestination(finalUrl)})`);
			}
		}
	}

	return normalizeMarkdownSpacing(out.join("").replace(/\*\*\s*\*\*/g, "").replace(/ \| *\n/g, "\n"));
}

// ---------------------------------------------------------------- text helpers

function sanitizePathSegment(value, fallback) {
	const sanitized = (value || "").replace(/[\\/:*?"<>|]/g, "-").trim();
	return sanitized || fallback;
}

function sanitizeFileName(value, fallback) {
	return sanitizePathSegment(value, fallback).replace(/\s+/g, " ").substring(0, 120) || fallback;
}

function sanitizeMediaBaseName(value, fallback) {
	const sanitized = (value || "")
		.replace(/[^a-zA-Z0-9一-龥\s-_]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.substring(0, 96);
	return sanitized || fallback;
}

function normalizeMarkdownSpacing(markdown) {
	const normalized = (markdown || "").replace(/\r\n/g, "\n").replace(/ /g, " ").replace(/​/g, "");
	const output = [];
	let previousWasBlank = false;

	for (const rawLine of normalized.split("\n")) {
		const cleanedLine = rawLine.replace(/[ \t　]+$/g, "");
		if (cleanedLine.replace(/[ \t　]/g, "") === "") {
			if (!previousWasBlank) {
				output.push("");
			}
			previousWasBlank = true;
			continue;
		}
		output.push(cleanedLine);
		previousWasBlank = false;
	}

	return output.join("\n").replace(/^\n+|\n+$/g, "");
}

function toYamlString(value) {
	return `"${(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function toMarkdownDestination(value) {
	if (!value) {
		return value;
	}
	return /[\s()<>]/.test(value) ? `<${value}>` : value;
}

function formatDateTime(date) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatUnixTime(unixSeconds) {
	return Number.isFinite(unixSeconds) && unixSeconds > 0 ? formatDateTime(new Date(unixSeconds * 1000)) : "";
}

function decodeJsDecodeValue(value) {
	if (!value) {
		return "";
	}
	return decodeHtmlEntities(
		value
			.replace(/\\x([0-9A-Fa-f]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
			.replace(/\\u([0-9A-Fa-f]{4})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
			.replace(/\\r/g, "\r")
			.replace(/\\n/g, "\n")
			.replace(/\\t/g, "\t")
			.replace(/\\'/g, "'")
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, "\\")
	);
}

function decodeJsEscapedString(value) {
	if (!value) {
		return "";
	}
	return decodeHtmlEntities(
		value
			.replace(/\\'/g, "'")
			.replace(/\\"/g, '"')
			.replace(/\\n/g, "\n")
			.replace(/\\r/g, "\r")
			.replace(/\\t/g, "\t")
			.replace(/\\\\/g, "\\")
	);
}

function decodeHtmlEntities(value) {
	if (!value) {
		return "";
	}
	const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
	return value.replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (all, token) => {
		if (token.startsWith("#x") || token.startsWith("#X")) {
			const codePoint = parseInt(token.slice(2), 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : all;
		}
		if (token.startsWith("#")) {
			const codePoint = parseInt(token.slice(1), 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : all;
		}
		return named[token] ?? all;
	});
}

function cleanText(value) {
	return (value || "").replace(/\s+/g, " ").trim();
}

function pickFirst(values) {
	for (const item of values) {
		if (item && item.trim()) {
			return item.trim();
		}
	}
	return "";
}

function pickNumber(values) {
	for (const value of values) {
		if (Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return 0;
}

function toNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

async function exists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function getUniqueNotePath(folderPath, baseName) {
	for (let index = 0; ; index += 1) {
		const filePath = path.join(folderPath, `${baseName}${index === 0 ? "" : `-${index}`}.md`);
		if (!(await exists(filePath))) {
			return filePath;
		}
	}
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
