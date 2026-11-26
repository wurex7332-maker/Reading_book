---
name: nestjs-backend
description: 在使用 NestJS 的项目中编写或修改后端模块、接口路由、业务逻辑、数据库查询及后端单元测试时加载（非 NestJS 项目可删除）。
---

# NestJS 后端工程规范

## 1. 模块目录结构
业务领域按以下结构组织于后端 `src/modules/<domain>/`：
- `<domain>.module.ts`：模块注册与依赖注入声明
- `<domain>.controller.ts`：REST 路由（统一前缀 `/api/v1/`）、鉴权守卫与 DTO 校验
- `<domain>.service.ts`：纯业务逻辑、事务编排与领域异常抛出
- `<domain>.repository.ts`：ORM/数据库访问封装（隔离底层 SQL/Prisma/TypeORM）
- `dto/*.dto.ts`：入参校验 DTO（使用 `class-validator` / `zod` 强校验）
- `__tests__/<domain>.service.spec.ts`：单元测试

## 2. 强制编码规范
1. **统一响应结构**：成功响应由全局拦截器包装为 `{ code: 0, message: "ok", data, requestId }`，Controller 直接返回 `data` 负载，禁止手动拼装不统一的外层 JSON。
2. **统一异常处理**：可预期业务错误必须抛出 `BizException(ErrorCode, message)`，由全局异常过滤器统一转换；禁止捕获异常后静默吞错。
3. **严禁 `any` 透传**：Controller 入参必须通过全局 `ValidationPipe`（`whitelist: true, forbidNonWhitelisted: true`），严禁将未校验请求体直接传入 Service。
4. **防 N+1 查询**：禁止在循环内发起数据库查询，批量场景使用 `IN` 查询或联表查询。
5. **配置读取**：所有环境变量通过 `ConfigService` 读取，禁止在业务代码中散落 `process.env.XXX`。

## 3. 接口与测试要求
- 新增或修改接口必须补充集成或 E2E 测试，至少覆盖：**正常流（2xx）+ 参数非法（400）+ 未授权/越权（401/403）**。
- `Service` 层核心分支单元测试覆盖率 ≥ 80%。
- 修改完成后必须通过：`node scripts/gate.mjs gate-mvp`。
