# Reading_book REQ-000 Implementation Plan

**目标**：从门禁模板初始化一个可构建、可测试的离线阅读器骨架。

**架构**：静态浏览器应用，使用 JavaScript 模块和 TypeScript 静态检查。以本地 UTF-8 TXT 预览验证应用入口。架构、存储边界和日常门禁命令记录在 `docs/architecture/overview.md`。

**验收与实施**

- [ ] AC-1：写入 TXT 导入测试，验证 UTF-8 文本正常读取、其他格式被拒绝、空文件有错误提示。先运行 `npm test` 确认功能缺失，再添加 `src/reader.js`。
- [ ] AC-2：通过 `src/index.html`、`src/main.js` 和 `src/styles.css` 读取本地文件。用 `npm run build` 生成 `dist/`，用 `npm run test:smoke` 检查发布目录中的页面和读取模块。
- [ ] AC-3：完善架构及 `AGENTS.md`，为 npm 安装、ESLint、TypeScript 和 Node 测试接入 CI。`REQ-000` 可变更 `AGENTS.md`、`harness.config.json`、`.github/workflows/ci.yml`、`.gitignore`、`README.md`、`docs/architecture/**`、本实施文档、两项不适用的模板技能、`package*.json`、`eslint.config.js`、`tsconfig.json`、`src/**`、`tests/**`、`tools/build.mjs`。
- [ ] AC-4：保留原有门禁脚本，针对本次经授权的初始化运行一次 `gate-mvp`，并确认对初始化后的基准直接运行严格门禁也通过。随后由人工独立评审并决定是否合并。
