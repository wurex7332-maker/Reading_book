# Team AI-Native Harness & Skills Template

团队通用的 **AI 原生研发约束基座**（适配 LoopForge + DeepSeek Harness `dsh` / 异构 Reviewer）。本仓库**不含任何业务代码骨架**，门禁脚本采用**零第三方依赖的 Node.js（`.mjs`）**编写，原生支持 **Windows（PowerShell/CMD）、macOS、Linux 与 Docker 沙箱**。

## 核心理念

**「确定性门禁约束非确定性 Agent」**——通过不可篡改的硬性门禁，防止自主编码 Agent 出现代码幻觉、跳过测试或偷工减料。任何代码变更必须通过自动化门禁校验 + 异构模型独立评审才能合并。

## 包含资产

| 文件 / 目录 | 职责 |
| --- | --- |
| `AGENTS.md` | 全局工作流铁律 + 项目专属架构红线占位区 |
| `harness.config.json` | 项目命令适配器（新项目建骨架时填写） |
| `scripts/gate.mjs` | 跨平台统一门禁入口（供本地、LoopForge Script 节点与 CI 调用） |
| `scripts/check-harness-health.mjs` | 校验基座完整性、Skill 命名与 `dsh` 8,192 字符截断安全线 |
| `scripts/check-gate-integrity.mjs` | 防篡改 + 防绕过门禁（拦截 `@ts-ignore`、`eslint-disable`、`.skip` 等） |
| `scripts/check-review.mjs` | 独立评审裁决校验（解析 `artifacts/review.md` 中的 `VERDICT: PASS / BLOCK`） |
| `.agents/skills/` | 通用安全/测试技能 + 常用技术栈技能（可按项目裁剪或新增） |
| `.github/` | 需求单模板、AC 证据对照 PR 模板、自适应 CI 门禁 |
| `docs/loopforge/` | LoopForge 角色系统 Prompt（Planner / Developer / Reviewer）与标准 SOP 编排指南 |
| `docs/architecture/overview.md` | 项目架构说明模板 |
| `.gitattributes` | 统一使用 `LF` 换行符 |

---

## 环境准备（全平台统一）

仅需安装 3 个基础工具：**Git**、**Node.js ≥ 20**、**Gitleaks**（无需 `make`、WSL 2 或 `npm install`）。

### Windows（原生 PowerShell）
```powershell
winget install -e --id Git.Git
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Gitleaks.Gitleaks
```
安装完成后重开 PowerShell，验证工具链：
```powershell
git --version
node -v
gitleaks version
```

### macOS
```bash
brew install git node gitleaks
```

### Linux (Ubuntu / Debian)
```bash
sudo apt update && sudo apt install -y git curl
# Node.js >= 20 按需通过 nvm 或 NodeSource 安装
curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz -o /tmp/gitleaks.tar.gz
sudo tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks
```

---

## 基于本模板启动新项目（`REQ-000`）

从模板到可正式开发的项目，需要完成以下 5 步。整个过程称为 `REQ-000`（零号需求），完成后项目即可接入 LoopForge 进行正式的 AI 驱动开发。

### 第 1 步：从模板创建仓库并验证基座

1. 在 GitHub 点击 **`Use this template`** 创建新项目仓库，然后克隆到本地。
2. 运行基座健康检查，确认模板文件完整：
   ```bash
   node scripts/gate.mjs gate-harness
   ```
   > 首次运行因基座文件与 `origin/main` 存在差异，需加环境变量：
   > `ALLOW_HARNESS_EDIT=1 node scripts/gate.mjs gate-harness`

### 第 2 步：定义项目架构与边界

编辑 **`docs/architecture/overview.md`**，用一页纸填完以下 4 节内容：

| 区块 | 需要填写的内容 | 示例 |
| --- | --- | --- |
| 1. 业务定位 | 项目名称、目标用户、MVP 包含/排除范围 | 项目名：TaskFlow；包含：任务 CRUD、看板视图；排除：移动端 |
| 2. 技术栈与目录 | 后端/前端/数据库框架、目录职责划分 | 后端 NestJS、前端 Vue 3 + Element Plus、PostgreSQL |
| 3. 接口契约 | 统一响应格式、鉴权方式、性能基线 | `{ code, data, message }` 格式、JWT 鉴权、P95 < 200ms |
| 4. 门禁适配 | 对应 `harness.config.json` 中各命令的实际值 | `lint: "pnpm -r lint"` |

同时编辑 **`AGENTS.md`** 第 3 节「项目专属架构红线」，填入本项目的分层约束、UI 规范等。例如：
```markdown
- **技术栈与目录边界**：前后端物理隔离，共享类型统一沉淀在 `packages/shared`
- **核心分层约束**：Controller 仅做路由与入参校验，业务逻辑归属 Service，数据访问归属 Repository
- **UI 与交互规范**：前端统一使用 Element Plus，弹窗与消息提示收口至 `src/utils/feedback.ts`
```

### 第 3 步：裁剪技能包

> 💡 **Agent 辅助**：可以让 AI Agent（如 `dsh`、Claude Code、Codex）根据第 2 步中确定的技术栈，自动完成技能包的裁剪与新增。向 Agent 提供 `docs/architecture/overview.md` 作为上下文即可。

在 `.agents/skills/` 目录中：

- **删除**不适用本项目的技能目录（例如纯后端项目删除 `vue3-frontend/`）
- **保留** `security-and-testing/`（通用安全与测试技能，建议所有项目保留）
- **按需新增**新领域技能（每个技能一个目录，包含 `SKILL.md`，单文件严控 **< 7,800** 字符）

### 第 4 步：搭建技术栈骨架

> 💡 **Agent 辅助**：这一步是 `REQ-000` 的核心工程量，推荐使用 AI Agent 辅助完成。将第 2 步产出的 `docs/architecture/overview.md` 作为需求上下文交给 Agent，由其完成骨架搭建与首条单测编写。注意：此阶段 Agent 需要 `ALLOW_HARNESS_EDIT=1` 权限来修改门禁配置，请在人工监督下执行。

需要完成：

1. **初始化项目结构**：安装框架、创建目录、配置构建工具链
2. **配通 lint + typecheck**：确保 `pnpm lint` 与 `pnpm typecheck`（或对应命令）可正常运行
3. **编写至少一条健康检查单测**：证明测试框架已跑通（例如一个简单的 `app.controller` 测试）
4. **（如有前端）搭建前端项目骨架**：路由、状态管理、API 层基本结构

### 第 5 步：启用完整门禁并合并

> 💡 **Agent 辅助**：可让 Agent 在第 4 步中一并完成 `harness.config.json` 和 CI 配置的更新。但最终的门禁验证结果和合并操作必须经人工确认。

1. **编辑 `harness.config.json`**，将 `bootstrapped` 改为 `true`，并填入项目实际命令：
   ```json
   {
     "bootstrapped": true,
     "artifactsDir": "artifacts",
     "maxSkillChars": 7800,
     "commands": {
       "lint": "pnpm -r lint",
       "typecheck": "pnpm --filter @repo/shared build && pnpm -r typecheck",
       "testUnit": "pnpm --filter @repo/api test:cov && pnpm --filter @repo/web test:unit -- --run",
       "testE2e": "pnpm --filter @repo/api test:e2e",
       "licenseCheck": "npx --yes license-checker-rseidelsohn --production --failOn \"AGPL;GPL-3.0\"",
       "docsVerify": ""
     }
   }
   ```
   > 以上 `commands` 中的值为示例，请替换为你的项目实际命令。`docsVerify` 和 `licenseCheck` 若暂不需要可留空。

2. **编辑 `.github/workflows/ci.yml`**，取消注释依赖安装步骤，替换为项目实际所需：
   ```yaml
   - name: Setup pnpm
     if: steps.mode.outputs.bootstrapped == 'true'
     uses: pnpm/action-setup@v4
     with:
       version: 9

   - name: Install project dependencies
     if: steps.mode.outputs.bootstrapped == 'true'
     run: pnpm install --frozen-lockfile
   ```

3. **运行完整门禁验证**（因修改了门禁基座文件，需加 `ALLOW_HARNESS_EDIT=1`）：
   ```bash
   ALLOW_HARNESS_EDIT=1 node scripts/gate.mjs gate-mvp
   ```

4. **全绿后提交并合并**至受保护的 `main` 分支。此后所有 Agent 和 CI 都将以完整门禁模式运行，Agent 不再拥有 `ALLOW_HARNESS_EDIT` 权限。

### 完成标志

`REQ-000` 完成后，你的项目应满足：

- [x] `docs/architecture/overview.md` 已填写完整
- [x] `AGENTS.md` 第 3 节已填入项目专属红线
- [x] `.agents/skills/` 已按需裁剪
- [x] 技术栈骨架搭建完毕，至少有一条通过的单元测试
- [x] `harness.config.json` 中 `bootstrapped: true`，`commands` 已绑定实际命令
- [x] `node scripts/gate.mjs gate-mvp` 退出码为 `0`
- [x] 已合并至 `main` 分支
- [x] LoopForge 角色与 SOP 流水线已配置完成

### 第 6 步：接入 LoopForge

`REQ-000` 门禁通过并合并至 `main` 后，必须将项目接入 **LoopForge** 进行 AI 驱动的多 Agent 研发。

#### 6.1 配置角色

在 LoopForge 后台创建至少 3 个角色，将 `docs/loopforge/` 下对应文件的内容粘贴为系统 Prompt：

| 角色 | 系统 Prompt 来源 | 推荐执行器 | 说明 |
| --- | --- | --- | --- |
| `Planner` | [`docs/loopforge/role-planner.md`](docs/loopforge/role-planner.md) | DeepSeek Harness (`dsh`) | 将需求转化为设计文档与 AC 清单 |
| `Developer` | [`docs/loopforge/role-developer.md`](docs/loopforge/role-developer.md) | DeepSeek Harness (`dsh`) | 严格按白名单编码并通过门禁 |
| `Reviewer` | [`docs/loopforge/role-reviewer.md`](docs/loopforge/role-reviewer.md) | **异构执行器**（Claude Code / Codex） | 跨模型独立对抗评审 |

> **重要**：Reviewer 必须使用与 Developer **不同的模型或执行器**，确保异构对抗审查的有效性。

#### 6.2 编排 SOP 流水线

按 [`docs/loopforge/README.md`](docs/loopforge/README.md) 中的标准 MVP-SOP 配置 7 节点流水线：

```
Planner → 人工确认设计 → Developer → gate-mvp 门禁 → Reviewer → gate-review 门禁 → 人工批准合并
```

> **关键防线**：`gate_mvp` 与 `gate_review` 均为确定性 Script 节点，LoopForge 沙箱内**不要设置** `ALLOW_HARNESS_EDIT=1`，确保 Agent 无法篡改门禁或绕过评审。

#### 6.3 本地轻量联调（可选）

```bash
npx -y loopforge-cli@latest skills install dsh
npx @deepseek-ai/dsh web    # 浏览器打开 http://127.0.0.1:3080，使用 /devflow "<需求>"
```

---

## 常用门禁命令速查

所有命令在 PowerShell / macOS / Linux / LoopForge 沙箱中行为一致：

| 命令 | 说明 | 使用场景 |
| --- | --- | --- |
| `node scripts/gate.mjs gate-harness` | 基座健康度 + 密钥扫描 + 防绕过检查 | 未建骨架前使用 |
| `node scripts/gate.mjs gate-mvp` | `gate-harness` + `lint` + `typecheck` + `test-unit` | **日常 PR 必过** |
| `node scripts/gate.mjs gate-all` | `gate-mvp` + `license-check` + `test-e2e` | 完整 M/L 级需求门禁 |
| `node scripts/gate.mjs anti-bypass` | 单独运行防绕过门禁检查 | 调试防绕过规则 |
| `node scripts/gate.mjs check-review` | 校验 `artifacts/review.md` 评审裁决 | 验证 Reviewer 输出 |

> **提示**：修改门禁基座文件（`scripts/*`、`harness.config.json`、`AGENTS.md`、`.github/workflows/*`）时，
> 必须加 `ALLOW_HARNESS_EDIT=1` 前缀，否则防篡改检查会阻断。正式开发中 Agent 无此权限。
