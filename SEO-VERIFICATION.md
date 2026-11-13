# ClearLight Tools — SEO 改造核对汇总表

- **主域名**：`https://clearlighttools.com` ・ **品牌**：`ClearLight Tools`（标题中逐字保留）
- **规模**：13 语言 × 78 工具 ・ 1198 个 HTML 页面 ・ 1183 条 sitemap URL
- **校验方式**：本地浏览器实测（`http://localhost:5173`，读取渲染后 DOM + 抓取原始 HTML）＋ 构建产物门禁（`dist/`）
- **字符计数**：码点（code points，`[...str].trim().length`），与谷歌 SERP 截断口径一致
- **日期**：2026-11-13 ・ 全链 `npm run check` EXIT=0

---

## 1. 英文基准版（默认 en）

| 页面路由 | `<title>` | Title 字符 | Desc 字符 | `<h1>` | 校验 |
|---|---|---:|---:|---|:--:|
| `/en/`（首页） | Free Online Tools & Daily Web Utilities - ClearLight Tools | 58 | 163 | Free Online Tools & Fast Browser Utilities | ✓ |
| `/en/pdf/merge-pdf/`（工具） | Free Online Merge PDF - join files - ClearLight Tools | 53 | 146 | Free Online Merge PDF | ✓ |
| `/en/pdf/`（分类） | PDF tools - ClearLight Tools | 28 | 83 | PDF tools | ✓ |
| `/en/all/`（全部） | All tools - ClearLight Tools | 28 | 95 | All tools | ✓ |
| `/en/privacy/`（合规） | Privacy policy - ClearLight Tools | 33 | 94 | Privacy policy | ✓ |

**首页 description（业主指定，逐字）**：`Access clean, fast, and free online tools for everyday life, office work, and content creation. 100% browser-based utilities on ClearLight Tools—no login required.`（163）

**工具 description 公式示例**（merge-pdf，146）：`Merge several PDF files into one document with our free online Merge PDF. 100% browser-based, fast, and private—no login or file uploads required.`

> 长度窗口：EN 工具 Title 50–60（≤60 硬性，<50 为长名精简的软提示）・EN 工具 Desc 135–158。首页 Title/Desc 为业主逐字指定，Desc 不受工具窗口约束（≤200  sanity cap）。

---

## 2. 首页 ・ 13 语言翻译预览

| 语言 | 路由 | 首页 `<title>` 预览 | Title 字符 | Desc 字符 | 校验 |
|---|---|---|---:|---:|:--:|
| en | `/en/` | Free Online Tools & Daily Web Utilities - ClearLight Tools | 58 | 163 | ✓ |
| zh | `/zh/` | 免费在线日常实用工具｜ClearLight Tools | 27 | 66 | ✓ |
| es | `/es/` | Herramientas gratis y utilidades diarias - ClearLight Tools | 59 | 156 | ✓ |
| fr | `/fr/` | Outils gratuits et utilitaires quotidiens - ClearLight Tools | 60 | 160 | ✓ |
| de | `/de/` | Kostenlose Online-Tools & tägliche Helfer - ClearLight Tools | 60 | 138 | ✓ |
| pt | `/pt/` | Ferramentas grátis e utilidades diárias - ClearLight Tools | 58 | 149 | ✓ |
| ja | `/ja/` | 無料オンラインツール｜ClearLight Tools | 27 | 76 | ✓ |
| ko | `/ko/` | 무료 온라인 도구｜ClearLight Tools | 26 | 82 | ✓ |
| ru | `/ru/` | Бесплатные онлайн-инструменты и утилиты - ClearLight Tools | 58 | 133 | ✓ |
| vi | `/vi/` | Công cụ online miễn phí & tiện ích web - ClearLight Tools | 57 | 153 | ✓ |
| ms | `/ms/` | Alat online percuma & utiliti web harian - ClearLight Tools | 59 | 160 | ✓ |
| id | `/id/` | Alat online gratis & utilitas web harian - ClearLight Tools | 59 | 154 | ✓ |
| hi | `/hi/` | मुफ़्त ऑनलाइन टूल व वेब उपयोगिता - ClearLight Tools | 51 | 123 | ✓ |

> CJK 首页 Title 26–27（业主 25–30 防截断）・拉丁/西里尔/天城文 Title 51–60（≤60）。每语言首页 `<h1>` 与 Desc 均为本语言地道翻译，品牌逐字保留。

---

## 3. 工具页示例（compress-pdf）・ 13 语言翻译预览

| 语言 | 工具 `<title>` 预览 | Title 字符 | Desc 字符 | 校验 |
|---|---|---:|---:|:--:|
| en | Free Online Compress PDF - shrink size - ClearLight Tools | 57 | 144 | ✓ |
| zh | 免费PDF 压缩｜ClearLight Tools | 25 | 80 | ✓ |
| es | Gratis Comprimir PDF - ClearLight Tools | 39 | 148 | ✓ |
| fr | Gratuit Compresser PDF - ClearLight Tools | 41 | 148 | ✓ |
| de | Kostenlos PDF komprimieren - ClearLight Tools | 45 | 148 | ✓ |
| pt | Grátis Compactar PDF - ClearLight Tools | 39 | 146 | ✓ |
| ja | 無料PDF 圧縮｜ClearLight Tools | 25 | 81 | ✓ |
| ko | 무료PDF 압축｜ClearLight Tools | 25 | 79 | ✓ |
| ru | Бесплатно Сжать PDF - ClearLight Tools | 38 | 148 | ✓ |
| vi | Miễn Phí Online Nén PDF - giảm dung lượng - ClearLight Tools | 60 | 157 | ✓ |
| ms | Percuma Online Mampat PDF - kecilkan saiz - ClearLight Tools | 60 | 143 | ✓ |
| id | Gratis Kompres PDF - ClearLight Tools | 37 | 150 | ✓ |
| hi | मुफ़्त PDF को संपीड़ित करें - ClearLight Tools | 46 | 152 | ✓ |

> CJK 工具 Title 25（≤30）・Desc 79–81（70–85）。拉丁/西里尔/天城文 Title 37–60（≤60，超 60 自动精简修饰词）・Desc 143–157（≤160）。动词开头、卖点（免费/纯浏览器/免登录/不上传）按各语言搜索习惯地道改写。

---

## 4. 技术 SEO 标签契约（全站实测）

| 项目 | 契约 | 实测 | 校验 |
|---|---|---|:--:|
| `<meta name="keywords">` | 全站删除 | 0 / 1198 页携带 | ✓ |
| Canonical | 每页自指、业主主域 | 1198/1198 指向 `https://clearlighttools.com/<自身路由>` | ✓ |
| hreflang | 13 语言 + x-default | 每页 14 条 alternate（共 16772）；x-default→英文路由 | ✓ |
| zh hreflang 代码 | `zh-Hans` | 每页 HTML head 内为 zh-Hans（sitemap 仅 loc+lastmod，不带 hreflang） | ✓ |
| robots（工具/分类/首页） | index,follow | `index,follow,max-image-preview:large` | ✓ |
| robots（404/联系） | noindex | 长度窗口豁免，品牌/精确式/无keywords 仍校验 | ✓ |
| sitemap 结构 | 单一根 `sitemap.xml` | 构建后扫描 `dist/` 生成 1 个 `sitemap.xml`，1183 URL（13×91）；无 index、无分语言文件 | ✓ |
| sitemap 字段 | 仅 `loc` + `lastmod` | 每 URL `<loc>`（业主域+HTTPS+尾斜杠，与 canonical 逐字一致）+ `<lastmod>`=构建日；无 priority/changefreq/hreflang | ✓ |
| sitemap 排除 | 根跳板/404/资源/博客 | 0 条根 `/`、0 条 `404.html`、0 条 `_assets`、0 条博客；旧 `sitemap-index.xml`+13 分语言文件已删除 | ✓ |
| robots.txt | Allow 全站 + 禁 404 + 指向单一地图 | `User-agent: *` / `Allow: /` / `Disallow: /404.html` + `/*/404.html` / `Sitemap: https://clearlighttools.com/sitemap.xml` | ✓ |

---

## 5. 门禁结果（重建后）

| 门禁 | 结果 | 测量量 |
|---|:--:|---|
| `check:tkd` | ✓ 0 | 1197 页：Title/Desc/H1 本语言、无 keywords、按脚本分段长度 |
| `check:toolseo` | ✓ 0 | 13 语言工具 SEO 种子契约 |
| `check:seotags` | ✓ 0 | 1198 页 canonical/hreflang/robots ・ 1183 sitemap URL |
| `check:serp` | ✓ 0 | 1014 工具 Desc 按脚本窗口 |
| `npm run check`（全链） | ✓ EXIT=0 | 含 936 次分语言挂载、1523 串/语言渲染审计 |

**软提示（非错误）**：9 个英文长名工具（change-speed、remove-duplicate-lines、base64-encode-decode、zero-width-watermark、json-to-svg、encrypt-decrypt、percentage-calculator、random-number-generator、rmb-uppercase）Title 43–47，触发 <50 长名精简软提示，符合业主“超 60 精简”规则。

**刻意保留的旧品牌字面量**（非残留）：`scripts/check-seo-tags.mjs` 的反证夹具（故意用旧域/旧品牌证明门禁会报错）；`smoke.mjs`/`check-dom-helpers.mjs` 的 `*.local` JSDOM 测试基址；`package-lock.json` 生成名。构建产物 `dist/` 已 0 处旧品牌。
