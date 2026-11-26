---
name: 需求单 (Requirement)
about: 提交给 LoopForge AI 研发流水线的标准化需求单
title: "[REQ-XXX] 需求简明标题"
labels: ["requirement"]
---

## 级别与归属
- 级别：M（S / M / L）
- 影响模块：（填写目录或子包名称）
- 路由 SOP：`SOP-Feature-Backend` / `SOP-Feature-Frontend` / `SOP-Product`

## 背景与目标
- 目标：...
- 明确排除（防 AI 过度发散）：...

## 可测试验收标准（AC）
- [ ] AC-1（功能）：...
- [ ] AC-2（异常/边界）：...
- [ ] AC-3（安全/权限）：...
- [ ] AC-4（性能/指标，如适用）：...

## 修改边界与完成定义（DoD）
- 允许修改路径：（填写文件/目录白名单）
- 必须通过命令：`node scripts/gate.mjs gate-mvp`（或 `gate-all`）
