# LoopForge 接线与 SOP 配置指南

本目录存放与本仓库门禁基座配套的 **LoopForge 角色系统 Prompt** 与标准 SOP 编排结构。新建项目在 LoopForge 绑定仓库后，直接按以下清单复制配置即可。

## 1. 角色配置清单（建议至少 3 角色）

| 角色名 | 推荐执行器 | 推荐模型 | 系统 Prompt 来源 |
| --- | --- | --- | --- |
| `Planner` | DeepSeek Harness (`dsh`) | 推理型模型 | `docs/loopforge/role-planner.md` |
| `Developer` | DeepSeek Harness (`dsh`) | 编码型模型 | `docs/loopforge/role-developer.md` |
| `Reviewer` | **异构执行器**（Claude Code / Codex）或不同模型家族 | 强推理模型 | `docs/loopforge/role-reviewer.md` |

## 2. 推荐标准 MVP-SOP

| 顺序 | 节点 ID | 类型 | 角色 / 执行命令 | 失败打回策略 |
| --- | --- | --- | --- | --- |
| 1 | `plan` | Agent | `Planner`（M 级小需求可跳过；L 级必跑） | — |
| 2 | `gate_design` | Human Gate | 人工确认 `artifacts/design.md` 的范围、AC 与修改白名单 | 打回 `plan` |
| 3 | `implement` | Agent | `Developer` | — |
| 4 | `gate_mvp` | Script | `node scripts/gate.mjs gate-mvp` | `on_fail -> implement`（`max_auto_retry: 3`） |
| 5 | `review` | Agent | `Reviewer`（输出 `artifacts/review.md`） | — |
| 6 | `gate_review` | Script | `node scripts/gate.mjs check-review` | `on_fail -> implement`（`max_auto_retry: 3`） |
| 7 | `gate_accept` | Human Gate | 审阅 `artifacts/review.md` + 测试证据包 → 批准提 PR | 打回 `implement` |

> **关键防线**：`gate_mvp` 与 `gate_review` 均为确定性 Script 节点，且 LoopForge 沙箱内**不要设置** `ALLOW_HARNESS_EDIT=1`，确保任何 Agent 都无法篡改门禁文件或绕过独立评审。
