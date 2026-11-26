## 关联需求
Closes #REQ-XXX

## 变更摘要
<!-- 不超过 5 句话说明核心改动 -->

## AC 验收证据对照表（Human Gate 审批核心依据）
| AC 编号 | 验收结果 | 机器证据路径 / 指标 |
| --- | --- | --- |
| AC-1 | PASS | `artifacts/...` |
| AC-2 | PASS | `artifacts/...` |

## 自动化门禁快照
- [ ] 基座自检与防绕过（`node scripts/gate.mjs gate-harness`）
- [ ] G0 静态检查（`node scripts/gate.mjs lint` / `typecheck`）
- [ ] G2 单元测试与覆盖率达标（`node scripts/gate.mjs test-unit`）
- [ ] G3 容器集成与 E2E 回归（`node scripts/gate.mjs test-e2e`，如适用）
- [ ] G4 跨模型独立 Reviewer 阻断项为 0（附 `artifacts/review.md`）

## 回滚方案
- 代码回滚：Revert 本 PR
- 数据回滚：是否涉及 Schema/数据变更（无 / 有，已验证向下兼容）
