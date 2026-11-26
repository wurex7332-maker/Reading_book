# Project Agent Rules (AGENTS.md)

本仓库遵循「确定性门禁约束非确定性 Agent」的研发规范。所有编码、测试、文档与评审 Agent 在修改或审查代码前必须遵守本文件。

## 1. 通用工作流铁律（全项目适用，禁止削弱）
1. **先读后写**：动手前必须先阅读 `docs/architecture/overview.md` 及本次任务涉及的 `.agents/skills/*/SKILL.md`。
2. **严格遵守白名单**：仅修改需求单允许的路径及对应测试文件；禁止顺手重构无关模块、禁止升级未指定的依赖版本。
3. **禁止篡改门禁基座**：除非需求单明确授权，严禁修改 `harness.config.json`、`scripts/gate.mjs`、`scripts/check-gate-integrity.mjs`、`scripts/check-harness-health.mjs`、`.github/workflows/ci.yml` 或调低测试覆盖率阈值。
4. **禁止绕过门禁**：严禁通过删除/跳过已有测试（`.skip` / `.only`）、添加 `@ts-ignore` / `@ts-nocheck` / `eslint-disable` / 覆盖率忽略注释来让门禁变绿。
5. **禁止自编自审**：实现者不得评审自己的变更；提交前必须确保 `node scripts/gate.mjs gate-mvp`（或完整需求 `node scripts/gate.mjs gate-all`）退出码为 0。
6. **证据驱动交付**：所有自动化报告必须输出至 `artifacts/` 目录（已被 `.gitignore` 忽略），PR 描述必须附带逐条 AC 与证据文件的映射表。

## 2. 通用安全与合规红线
1. **零硬编码凭据**：禁止在源码、测试或配置文件中写入真实密钥、Token、密码或生产内网地址；配置项统一通过环境变量读取，并同步更新 `.env.example`。
2. **日志脱敏**：禁止打印密码、JWT、手机号、身份证号、银行卡号等敏感明文。
3. **外部调用必带保护**：调用第三方 API、模型服务或外部基础设施时，必须设置显式超时与失败降级/错误处理逻辑。
4. **许可证红线**：禁止引入 `AGPL` 或 `GPL-3.0` 等强传染性开源依赖（除非架构评审书面批准并隔离运行）。
5. **数据变更向后兼容**：数据库或持久化结构变更必须提供向后兼容的 Migration 脚本，禁止单次发布直接删除或重命名线上正在使用的列。

## 3. 项目专属架构红线（新项目初始化时按场景填写）
> 以下条目由团队在基于模板创建具体项目时补充，并与 `docs/architecture/overview.md` 保持一致：
- **技术栈与目录边界**：（示例：前后端物理隔离，共享类型统一沉淀在 `packages/shared`）
- **核心分层约束**：（示例：Controller 仅做路由与入参校验，业务逻辑归属 Service，数据访问归属 Repository）
- **UI 与交互规范**：（示例：前端统一使用 Element Plus，弹窗与消息提示收口至 `src/utils/feedback.ts`，禁止无作用域覆盖 `.el-*` 全局样式）
- **默认加载技能**：见 `.agents/skills/` 目录
