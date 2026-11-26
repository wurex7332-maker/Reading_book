# Reading_book 架构总览

## 1. 业务定位与核心场景

Reading_book 是个人文档阅读器。首期目标是从设备导入书籍、阅读文本、添加书签并恢复阅读进度。`REQ-000` 建立可构建的浏览器骨架，先交付单本 UTF-8 TXT 预览。书架、书签和进度持久化由后续需求实现。首期范围为单设备、单浏览器，云同步、账户、PDF 和 EPUB 由独立需求确定。

## 2. 技术栈与目录

- 前端使用浏览器原生 HTML、CSS 和 JavaScript ES 模块，使用 JSDoc 加 TypeScript 严格检查类型。应用没有运行时 npm 依赖。
- 文件通过浏览器的 `File` API 读取。后续用 IndexedDB 存书籍、书签与进度。
- `src/index.html`、`src/styles.css` 和 `src/main.js` 提供阅读页面，`src/reader.js` 负责文件校验和解码。`tests/` 存放单测与构建冒烟测试。`tools/build.mjs` 生成可由静态服务器发布的 `dist/`。

## 3. 接口契约和约束

- `readTextBook(file)` 成功时返回 `{ title, text }`，遇到不支持的格式、编码、空白或过大的文件时抛出可显示的错误。
- 应用只读取用户主动选择的文件，导入上限为 5 MB，文件内容保留在浏览器。阅读页使用 `textContent` 渲染输入。
- 后续存储按浏览器来源隔离，数据库结构变更通过 IndexedDB 版本升级保留已有数据。

## 4. 门禁命令

| 检查 | 命令 | 输出 |
| --- | --- | --- |
| 依赖安装 | `npm ci` | 按锁文件安装开发依赖 |
| lint | `npm run lint` | ESLint 检查 |
| typecheck | `npm run typecheck` | TypeScript 严格检查 |
| testUnit | `npm run test:gate` | `artifacts/unit.tap` |
| testE2e | `npm run test:smoke` | 构建产物冒烟测试和 `artifacts/smoke.tap` |
| build | `npm run build` | `dist/` |

`licenseCheck` 暂留空，应用无运行时依赖。`docsVerify` 是可选项，暂留空。
