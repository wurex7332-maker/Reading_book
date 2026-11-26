# 项目架构总览（模板）

> 在基于本模板新建项目后、启动 `REQ-000` 骨架开发前，请用 1 页纸填完以下 4 节内容，作为所有 Planner / Developer / Reviewer Agent 的首要上下文依据。

## 1. 业务定位与核心场景
- **项目名称**：
- **目标用户与核心闭环**：
- **首期（MVP）边界**：
  - 包含：
  - 明确排除：

## 2. 技术栈与目录划分
- **后端**：（如 NestJS / FastAPI / Go）
- **前端**：（如 Vue 3 + Element Plus / 微信小程序 / 无）
- **数据与基础设施**：（如 PostgreSQL / Redis / MinIO）
- **目录职责**：
  - `.../`：

## 3. 核心接口契约与非功能约束
- **统一响应/错误格式**：
- **鉴权与多租户隔离方式**：
- **性能/时延基线**：

## 4. 门禁适配清单（对应 `harness.config.json`）
- `commands.lint`：
- `commands.typecheck`：
- `commands.testUnit`（含覆盖率或报告产物路径）：
- `commands.testE2e`：
