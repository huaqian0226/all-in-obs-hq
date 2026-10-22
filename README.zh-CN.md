# Multi-Source Content Importer

[English](README.md) | 简体中文

将微信公众号和小红书内容导入为结构化 Markdown，统一沉淀到 Obsidian 知识库。

这个仓库主要服务两类使用方式：

- 人类用户：在 Obsidian 里作为社区插件手动使用
- Agent 用户：作为 skill（`xhs-note-fetch`）直接调用导入能力

## 目录

- [功能概览](#功能概览)
- [使用指南](#使用指南)
- [开发与发布](#开发与发布)
- [Changelog](#changelog)
- [Acknowledgements](#acknowledgements)

## 功能概览

### 核心能力

- 支持来源自动识别：微信公众号 / 小红书
- 支持单条导入与批量导入
- 自动抽取正文并转换为 Markdown
- 支持图片本地化下载，失败时自动回退远程链接
- 自动写入 frontmatter 元数据
- 支持分类目录与自定义文件夹

### 支持链接格式

微信公众号：

- `https://mp.weixin.qq.com/s/...`
- `https://mp.weixin.qq.com/s?...`

小红书：

- `https://www.xiaohongshu.com/explore/...`
- `https://www.xiaohongshu.com/discovery/item/...`
- `https://xhslink.com/...`

### 输出结构

默认 `defaultFolder` 为 `External Files`。

插件模式下，默认输出为：

- 笔记：`<defaultFolder>/<category>/<title>.md`
- 媒体：`<defaultFolder>/<category>/images/<md5>_MD5.<ext>`

如果选择“自定义文件夹”：

- 笔记：`<customFolder>/<title>.md`
- 媒体：`<customFolder>/images/<md5>_MD5.<ext>`

媒体文件统一保存在笔记所在文件夹的 `images/` 子目录中，文件名为内容 MD5 签名
（与 [obsidian-local-images-plus](https://github.com/Sergei-Korneev/obsidian-local-images-plus)
的 `<md5>_MD5` 命名算法完全一致），相同图片自动去重。

### 设置项说明

- `defaultFolder`：导入根目录
- `categories`：分类列表，可在设置页维护；导入时会自动识别 `defaultFolder` 下已有的一级子目录，并在设置页同步展示（自动目录为只读）
- `lastCategory`：记忆最近一次选择
- `downloadMedia`：默认是否下载媒体
- `debugEnabled`：是否写入多平台统一调试日志（默认开启）

### Frontmatter 字段

微信公众号文章会写入这些字段：

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

小红书笔记会写入这些基础字段：

- `platform`
- `title`
- `source`
- `category`
- `imported_at`
- `type`

### 当前限制

- 仅支持公开可访问内容
- 不处理登录、验证码、权限墙
- 微信风控页会终止导入并提示
- 平台页面结构变化可能影响解析逻辑

## 使用指南

### 人类用户：作为 Obsidian 插件使用

#### 安装方式

把构建产物放到当前 Vault 的插件目录里，目录名必须与 [`manifest.json`](manifest.json) 里的 `id` 完全一致：

`<你的Vault>/.obsidian/plugins/multi-source-content-importer/`

目录内至少包含这 3 个文件：

- `main.js`
- `manifest.json`
- `styles.css`

最简单的安装方式是直接从 [GitHub Releases](https://github.com/hztBUAA/all-in-obs/releases) 下载当前版本的这 3 个文件，然后放到上面的目录里。

如果你是从源码本地安装，可以执行：

```bash
npm install
npm run build
mkdir -p "<你的Vault>/.obsidian/plugins/multi-source-content-importer"
cp main.js manifest.json styles.css "<你的Vault>/.obsidian/plugins/multi-source-content-importer/"
```

如果你是开发时本地联调，推荐软链：

```bash
npm install
npm run build
ln -s "$(pwd)" "<你的Vault>/.obsidian/plugins/multi-source-content-importer"
```

#### 在 Obsidian 中启用

1. 打开当前 Vault
2. 进入 `Settings -> Community plugins`
3. 如果社区插件总开关未开启，先开启
4. 在已安装插件列表里启用 `Multi-Source Content Importer`

#### 如何确认安装成功

满足下面任意一项，通常就说明插件已经正常加载：

- 左侧 Ribbon 出现书本图标
- 命令面板中能搜到 `导入文章（微信 / 小红书）`
- `Settings -> Community plugins` 里能看到并打开该插件设置页

#### 如何开始导入

1. 点击左侧 Ribbon 图标，或打开命令面板执行 `导入文章（微信 / 小红书）`
2. 粘贴一个或多个链接或分享文本
3. 选择分类
4. 按需勾选“下载图片到本地”
5. 点击导入

#### 排障与 Smoke

- 命令面板可执行 `运行多平台实网 Smoke 测试`
- 插件设置页支持一键运行 Smoke、打开报告、打开调试日志（统一多平台）
- 插件设置页支持按行自定义微信/小红书 Smoke 用例
- 报告输出：`.obsidian/plugins/multi-source-content-importer/smoke-report.json`
- 调试日志：`.obsidian/plugins/multi-source-content-importer/debug.log`
- 设置页可关闭 `debugEnabled`

#### 常见安装问题

如果装了但不显示，建议按顺序检查：

1. 插件目录名是否为 `multi-source-content-importer`
2. `main.js`、`manifest.json`、`styles.css` 是否直接放在插件目录根部
3. 是否放到了当前打开的 Vault 的 `.obsidian/plugins/` 目录
4. 如果是源码安装，是否先执行过 `npm install` 和 `npm run build`
5. 复制或软链完成后，是否重新加载过 Obsidian 或重新启用过插件

可以直接这样自检：

```bash
ls "<你的Vault>/.obsidian/plugins/multi-source-content-importer"
```

至少应该看到：

- `main.js`
- `manifest.json`
- `styles.css`

错误示例：

```text
<你的Vault>/.obsidian/plugins/multi-source-content-importer/
  wx-article/
    main.js
    manifest.json
    styles.css
```

正确示例：

```text
<你的Vault>/.obsidian/plugins/multi-source-content-importer/
  main.js
  manifest.json
  styles.css
```

### Agent 用户：作为 Skill 使用

#### 适用场景

如果你不是手动点 Obsidian 插件 UI，而是希望让 agent 直接导入微信公众号文章或小红书笔记，请使用 skill 目录：

- [skills/xhs-note-fetch/SKILL.md](skills/xhs-note-fetch/SKILL.md)（沿用 `xhs-note-fetch` 这个名字，同时支持微信公众号与小红书）

#### 对应的逻辑

skill 里的 [scripts/import-content.mjs](skills/xhs-note-fetch/scripts/import-content.mjs) 是本插件抓取与输出逻辑的独立镜像：

- 抓取：微信公众号默认先用 Node 原生 `fetch` 独立抓取（没有任何依赖、不需要打开 Obsidian），失败再通过 `obsidian` 命令行调用正在运行的本插件；小红书会把非浏览器请求重定向到登录页，所以只通过本插件抓取：脚本自动找一个已打开且加载了本插件的 Vault，Vault 名可用 `--vault` 指定。两条路线的输出相同。
- 解析：小红书的短链解析与正文、标签、图片提取直接复用插件；微信公众号的元数据与正文提取镜像 `src/platforms/wechat/*`。
- 输出：与本 fork 的插件输出一致——笔记写入指定目录，图片保存在笔记所在目录的 `images/` 下并以内容 MD5 命名（`<md5>_MD5.<ext>`，相同图片自动去重），frontmatter 不含 `cover`，小红书笔记使用 `![404](...)![400](...)` 的图片排版，标签放在最后一行；视频笔记嵌入 `<video>`（视频文件同样保存在 `images/`），不下载笔记里不展示的图片。
- 只取不写：加 `--print` 只返回提取结果的 JSON，不写任何文件。
- 评论：小红书评论与回复通过 skill 里的 `scripts/xhs-bundle.sh`（ego-browser，需要已登录的浏览器）抓取，不属于插件导入，也不会写进笔记。

这份 skill 在作者的中央技能库中维护，本仓库的 `skills/xhs-note-fetch/` 是它的镜像；插件的输出格式变化时需同步脚本，规则见 [AGENTS.md](AGENTS.md) 的 “Skills Alignment Rule”。

#### 安装位置

推荐安装到：

- `~/.codex/skills/xhs-note-fetch/`
- `~/.claude/skills/xhs-note-fetch/`

安装时必须复制整个目录，而不是只复制 `SKILL.md`，因为脚本也在里面：

- `SKILL.md`
- `scripts/`（`import-content.mjs`、`xhs-fetch.mjs`、`xhs-bundle.mjs`、`xhs-bundle.sh`）

示例：

```bash
mkdir -p ~/.codex/skills ~/.claude/skills
cp -R skills/xhs-note-fetch ~/.codex/skills/
cp -R skills/xhs-note-fetch ~/.claude/skills/
```

#### 安装后自检

```bash
node ~/.codex/skills/xhs-note-fetch/scripts/import-content.mjs --help
node ~/.claude/skills/xhs-note-fetch/scripts/import-content.mjs --help
```

## 开发与发布

### 本地开发

安装依赖：

```bash
npm install
```

构建：

```bash
npm run build
```

热开发：

```bash
npm run dev
```

`npm run dev` 会监听 [`main.ts`](main.ts)，变更后自动重新生成 `main.js`。

如果你在 Obsidian 中联调，推荐这样刷新：

- 保持 `npm run dev` 运行
- 在 Obsidian 中关闭再启用该插件
- 或执行 `Reload app without saving`

### 本地检查

开发时推荐至少跑这 3 个检查：

```bash
npm run lint
npm run build
npx tsc --noEmit
```

它们分别用于：

- `npm run lint`：检查常见代码问题和 TypeScript / ESLint 规则
- `npm run build`：确认插件可以正常打包生成 `main.js`
- `npx tsc --noEmit`：确认类型检查通过，但不额外输出文件

如果只想在提交前做一次快速自检，建议按上面这个顺序执行。

### 发布到社区商店

推荐按下面顺序执行：

1. 更新 `package.json` 版本，并同步 `manifest.json` 与 `versions.json`
2. 执行 `npm run lint`
3. 执行 `npm run build`
4. 执行 `npx tsc --noEmit`
5. 创建与版本号一致的 Git tag 或 GitHub Release，例如 `0.1.6`
6. 在 Release 上传 `main.js`、`manifest.json`、`styles.css`

## Changelog

### 未发布（fork 定制）

- 微信公众号导入不再下载封面图：笔记已不写 `cover`，下载封面只会在 `images/` 留下无人引用的文件
- 小红书视频笔记不再下载笔记里不展示的图片（视频笔记渲染的是视频，不是图片排版）

### 0.1.10-hq.1（fork 定制）

本 fork（`my-features` 分支）在上游 0.1.10 基础上定制笔记输出格式：

- 图片改存到笔记所在文件夹的 `images/` 子目录，按内容 MD5 签名命名（`<md5>_MD5.<ext>`，
  与 obsidian-local-images-plus 算法一致），相同图片自动去重
- frontmatter 移除 `cover` 字段（微信与小红书均生效）
- 小红书笔记版式调整：封面 `![404](...)` 与其余图片 `![400](...)` 连续排列、紧跟标题，
  之后是正文，最后一行是标签（alt 文本即 Obsidian 显示宽度）
- 清理小红书标签及正文中的 `[话题]` 后缀，输出纯净标签（如 `#AI工具`）
- agent skill 已迁移为 `skills/xhs-note-fetch/`，其导入脚本的输出格式与本定制保持一致（见上文“Agent 用户：作为 Skill 使用”）

### 0.1.10

- 修复小红书长图文笔记在开启“下载图片到本地”时，部分 `sns-webpic-*.xhscdn.com/...!nd_dft...` 图片仍保留远程链接的问题
- 统一正文图片与封面图的本地媒体映射逻辑，避免因 `http/https` URL 形式不同而漏替换
- 补充“每天学点经济学｜第149期：除权除息”为小红书 smoke 回归用例，并同步修正 agent skill 的同链路处理

### 0.1.9

- 调整插件描述文案，移除 `Obsidian` 关键词以满足社区上架校验规则
- 继续保持 `eslint + build + tsc` 本地检查全通过

### 0.1.8

- 接入 `eslint-plugin-obsidianmd`（Legacy `.eslintrc`）用于本地预检
- 修复一批 ObsidianReviewBot 必改项：移除 `any`、去除不必要断言、避免内联样式写法、`configDir` 动态路径、`console` 规范化
- 调整部分 UI 文案与设置项写法，减少 sentence-case / heading 规则误报

### 0.1.7

- 修复设置页“分类管理”与导入弹窗分类来源不一致的问题
- 设置页现在同步展示“自定义分类 + 自动发现目录”，其中自动目录为只读项
- 保持原有可编辑边界：重命名、排序、删除仅作用于手动配置分类

### 0.1.6

- 重构为“插件壳 + 平台服务”结构，拆分 `main.ts` 并将微信/小红书逻辑模块化到 `src/platforms/*`
- 设置页统一为“多平台调试”章节，支持一键运行 smoke、查看报告、查看统一调试日志
- smoke 用例支持在设置页按平台自定义（每行一条），并通过真实插件入口执行
- 调试日志与报告统一路径：
- 日志：`.obsidian/plugins/multi-source-content-importer/debug.log`
- 报告：`.obsidian/plugins/multi-source-content-importer/smoke-report.json`
- 吸收 `fix/custom-folder` 能力：导入分类自动合并 `defaultFolder` 下一级目录，自定义文件夹输入与建议选择联动
- 保持网络请求合规：继续使用 `requestUrl`，不回退 Node 内置网络模块

### 0.1.5

- 修复小红书 `xhslink` 短链解析不稳定的问题，优先保留跳转后的分享参数，避免丢失 `xsec_token`
- 增强小红书短链解析 fallback，补充 Node `http/https` 请求链路，降低 Obsidian 运行时网络差异带来的失败率
- 遇到“小红书 - 你访问的页面不见了”时直接报错并停止导入，不再生成空白笔记
- 修复部分视频笔记因分享参数被裁剪而无法提取正文、封面和视频链接的问题
- 同步更新 agent skill 脚本的小红书短链与失效页处理逻辑

### 0.1.4

- 新增给 agent 直接调用的 `obsidian-content-importer` skill
- 完善本地安装、软链联调与热更新说明

## Acknowledgements

- 感谢开源项目 `xiaohongshu-importer` 提供的实现思路与交互设计参考。
