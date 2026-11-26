# Reading_book REQ-000 Implementation Plan

**目标**：从门禁模板初始化一个可构建、可测试的离线阅读器骨架。

**架构**：静态浏览器应用，使用 JavaScript 模块和 TypeScript 静态检查。以本地 UTF-8 TXT 预览验证应用入口。架构、存储边界和日常门禁命令记录在 `docs/architecture/overview.md`。

**验收与实施**

- [x] AC-1：验证 UTF-8 文本正常读取、其他格式被拒绝、空文件和编码错误有提示。
- [x] AC-2：通过 `src/index.html`、`src/main.js` 和 `src/styles.css` 读取本地文件。`npm run test:smoke` 检查发布目录中的页面和读取模块。
- [x] AC-3：完善架构及 `AGENTS.md`，为 npm 安装、ESLint、TypeScript 和 Node 测试接入 CI。`REQ-000` 的修改范围为 `AGENTS.md`、`harness.config.json`、`.github/workflows/ci.yml`、`README.md`、`docs/architecture/**`、`docs/loopforge/README.md`、本实施文档、两项不适用的模板技能、`package*.json`、`eslint.config.js`、`tsconfig.json`、`src/**`、`tests/**`、`tools/build.mjs`。
- [x] AC-4（本地）：保留原有门禁脚本。初始化本地验证使用模板约定的一次性授权，并在模拟合并后的基准上通过严格门禁。
- [ ] AC-4（合并）：由维护者确认变更及证据，合并至 `main`，核验 GitHub CI 和 LoopForge 实际工作区。
