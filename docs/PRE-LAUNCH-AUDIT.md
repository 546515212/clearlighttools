# ClearLight Tools — 上线前代码与配置体检报告

- 正式域名：`https://clearlighttools.com`
- 体检日期：2026-11-13
- 构建产物：`dist/`，共 **1198** 个 HTML 页面（78 工具 × 13 语言 + 分类/全站/法律/首页/根跳转）
- 本地验证服务器：`http://localhost:5173`（`node dev-server.mjs`）
- 全量门禁：`npm run check` 全绿（跑到最后一道 `check:residual` 输出 `ok`，证明此前所有门禁通过）

## 结论速览

| # | 体检项 | 结论 | 是否改动 |
|---|--------|------|----------|
| 1 | 构建与静态路由（硬编码地址/资源路径/尾斜杠） | 通过 | 配置注释 hygiene |
| 2 | 工具页 Schema.org `WebApplication` | 通过 | 无需改动（原本已完整） |
| 3 | OG + Twitter 卡片 + favicon/og 图 | 已修复 | 生成图标 + 补全标签 |
| 4 | 内容丰度（intro/3 步/FAQ，150–300 词） | 已修复 | 新增本地化概述/提示段落 |
| 5 | 控制台报错 + GA4 挂载 | 通过 | 无需改动（验证） |
| 6 | 法律页全语言可达 + 全站 Footer | 已修复 | 根跳转页补 Footer |

---

## 体检 1：构建与静态路由

**检查方法**：对 `dist/` 全量 grep 残留测试地址与旧品牌；浏览器实测深 3 段路由资源加载；核对 sitemap/internal href 尾斜杠、canonical/hreflang/x-default。

**结果（通过）**：
- 残留地址：`127.0.0.1` 0 处；`toolhive/ToolHive` 旧品牌 0 处。`localhost` 仅 14 处，全部是 Web Crypto 的合法提示文案（“Web Crypto hashes need an https or localhost page” 及其 13 语言翻译），属浏览器安全上下文说明，**非**残留测试链接。
- 资源路径：CSS/JS/图标/字典/worker/wasm 全部走绝对路径 `/_assets/…`。浏览器实测 `/en/pdf/images-to-pdf/`（深 3 段）：8 个资源请求，**0 失败**，工具正常挂载。
- 外部依赖：`site.css` 无任何 `http(s)://`、`@import`、Google Fonts —— 系统字体，完全本地。页面 head 的外部链接只有生产域 canonical/hreflang（SEO 文章栏目/博客已移除）。
- 尾斜杠：单一 `sitemap.xml` `<loc>` 1183 条 0 条缺尾斜杠（与 canonical 逐字一致）；内部 `href` 45 条 0 条缺尾斜杠。
- canonical/hreflang：每页 14 条 alternate（13 语言 + x-default），全部 `https://clearlighttools.com`，`zh` 用 `zh-Hans`，x-default → `/en/`。
- 根路由：`dist/index.html` 加载 `router.js`，`location.replace('/en/')`（`defaultLocale`，无回退陷阱）；服务器侧 `_redirects` 301 / `vercel.json` 308 同步。

**改动**：`config/site.json` 的 `routing.comment` 改为说明“国家映射表仅作保留参考；根路径恒开 /en/；语言只经手动菜单切换；平台国家头仅用于 GDPR 同意横幅，不参与选语言/跳转”。（仅注释，行为不变）

## 体检 2：Schema.org `WebApplication`

**检查方法**：解析工具页 JSON-LD，逐字段核验。

**结果（通过，原本已完整）**：每个工具页 4 个 JSON-LD 块 —— `BreadcrumbList`、`WebApplication`、`HowTo`、`FAQPage`。`WebApplication` 含 `name`、`url`、`applicationCategory`（按分类映射）、`operatingSystem:"Any"`、`offers:{"@type":"Offer","price":"0","priceCurrency":"USD"}`、`description`、`inLanguage`、`featureList`、`browserRequirements`。审计：缺失字段 `[]`，`operatingSystem=Any`，`offersOk=true`。**无需改动。**

## 体检 3：OG + Twitter 卡片 + favicon/og 图

**检查方法**：核对 head 标签完整性；确认图标二进制真实存在且随构建落地 `dist/_assets/`。

**结果（已修复）**：
- 新增永久生成器 `scripts/gen-icons.mjs`（零依赖，zlib 手工编码 PNG/ICO），产出并落地：`og.png`（1200×630）、`apple-touch-icon.png`（180×180）、`favicon.ico`（16/32/48）、`favicon.svg`、`favicon-16.png`、`favicon-32.png`。`og.png` 已视觉确认渲染正确。
- `src/templates.mjs` head 补全：`twitter:card/title/description/image`、`og:image:width=1200`/`height=630`，以及 4 条图标 link（svg/32/ico/apple）。`og:title/description/url/type/image` 原本齐全。
- 根跳转页 head 同步图标 link；删除旧的 `FAVICON` data-URI 常量。
- 已验证 `dist/_assets/` 含全部 6 个图标，深路由页 head 含全部 Twitter/OG/图标标签。

## 体检 4：内容丰度（防 AdSense 薄内容）

**检查方法**：从 `dist/en/<cat>/<id>/index.html` 提取**渲染后**正文（lede + #how-to + #faq + #overview），去标签计词，逐工具核对 150–300 词。

**结果（已修复）**：
- 新增本地化 `tool.overview.{pdf,image,audio,video,text,calc}` 与 `tool.tip.{…}`（各约 30 词）× 13 语言；工具页新增 `#overview` 段落（aboutTitle + 工具 desc + 分类概述 + privacyLine + 分类提示）。
- 修正过时的 `home.faq4A`：由“按地区自动切换语言”改为“默认英文，仅经头部菜单手动切换”，与已落地的根路由策略一致。
- 计词结果：**78 个工具全部 173–294 词，中位数 207，0 个落在 150–300 之外**。每页含 intro（lede）+ 3 步以上 How-to + FAQ + About/overview，13 语言 0 英文残留。

## 体检 5：控制台报错 + GA4 挂载

**检查方法**：浏览器实测代表工具的正常加载与空输入提交；核对 GA4/AdSense 挂载守卫；全量 `smoke --clicks` 门禁。

**结果（通过）**：
- 浏览器实测 3 个代表工具：`/en/pdf/images-to-pdf/`（深路由）、`/en/text/json-formatter/`、`/en/calc/percentage-calculator/` —— 加载与空输入提交均 **0 console error/warn**。PDF 工具空点 “Create PDF” 优雅降级、不抛错、保持挂载；text/calc 为实时计算工具，错误钩子捕获为空。
- 全量门禁 `smoke --clicks` + `smoke-all`：**936 次工具挂载**（78 工具 × 12 语言），点击每个按钮（含空输入提交），无未捕获异常、无语言级崩溃。
- GA4：`analytics.gtagId=""` → `async` gtag 守卫不输出任何脚本（挂载点已预留、非阻塞）；浏览器确认 `gtagPresent=false`。填入 ID 后以 `async` 加载，不阻塞渲染。
- AdSense：`ads.enabled=false`（ENABLE_ADS 默认关）→ 全站不输出任何广告 DOM（无占位框），不加载 `adsbygoogle` 脚本（非阻塞）。

## 体检 6：法律页全语言可达 + 全站 Footer

**检查方法**：遍历 13 语言 × 5 法律页 + 各页型代表（首页/工具/分类/全站）+ 根跳转页，核对存在性与 Footer 五链接。

**结果（已修复）**：
- **117 个页面**核查：缺失页 `none`，Footer 缺口 `none`（最小页 6987 字节，非空守卫通过）。
- 法律页 `about/privacy/terms/dmca/contact` × 13 语言 = 65 页全部存在，每页 Footer 含全部 5 个法律链接（locale  scoped）。
- 修复：根跳转页 `dist/index.html` 原本缺 Footer，已补 `/en/privacy|terms|about|contact` 链接。
- 联系页邮箱 `546515212@qq.com` 可点击（此前任务已落地）。

---

## 本次体检改动文件清单

- `scripts/gen-icons.mjs`（新增，永久图标生成器）
- `src/assets/og.png`、`apple-touch-icon.png`、`favicon.ico`、`favicon.svg`、`favicon-16.png`、`favicon-32.png`（新增二进制）
- `src/templates.mjs`（Twitter/OG 标签、图标 link、根页 Footer、`#overview` 段落、删除 FAVICON data-URI）
- `src/locales/{en,zh,es,fr,de,pt,ja,ko,ru,vi,ms,id,hi}.json`（`tool.overview`、`tool.tip`、`home.faq4A`）
- `config/site.json`（`routing.comment` 注释）

临时体检脚手架（`_audit.mjs`、`_add-overview.mjs`、`_legal-sweep.mjs`）已删除；永久生成器 `gen-icons.mjs` 保留。

## 上线前仍需业主手动填入（非代码缺陷，已预留非阻塞挂载点）

- `config/site.json` → `analytics.gtagId`：填 GA4 衡量 ID 即启用（async，非阻塞）。
- `config/site.json` → `ads.enabled` 改为 `true` 并填 `ads.clientId` 与 `ads.slotIds`：AdSense 审核通过后一键开启，全站工具/首页/分类页至多 2 个广告位（操作区上方 header + 结果下方 inContent），法律页 1 个，并自动生成 `ads.txt`。关闭态或未配置时不输出任何广告 DOM（无占位框、无弹窗）。