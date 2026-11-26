---
name: vue3-frontend
description: 在使用 Vue 3 + Element Plus 的项目中编写或修改页面、组件、Pinia 状态、API 请求及前端单元测试时加载（非 Vue 前端项目可删除）。
---

# Vue 3 + Element Plus 前端工程规范

## 1. 目录职责
- `src/api/<domain>.ts`：后端接口封装，入参/出参类型优先复用共享契约包
- `src/stores/<domain>.ts`：Pinia 全局/跨页面状态（局部表单与弹窗状态留在组件内）
- `src/views/<domain>/`：路由级业务页面
- `src/components/`：项目级可复用业务组件
- `src/composables/`：组合式函数（命名以 `use` 开头）
- `src/utils/feedback.ts`：统一封装 `ElMessage`、`ElMessageBox` 与全局错误提示

## 2. Element Plus 使用铁律
1. **组件优先复用**：表单、表格、分页、弹窗、抽屉、选择器优先使用 Element Plus 组件（`ElForm`、`ElTable`、`ElDialog`、`ElDrawer`、`ElPagination`），禁止手写重复基础 UI 轮子。
2. **强类型表单校验**：表单必须绑定 `ref<FormInstance>()` 与 `reactive<FormRules<FormModel>>()`；提交前强制执行 `await formRef.value?.validate()`，提交按钮绑定 `:loading="submitting"` 防重。
3. **弹窗与消息收口**：禁止使用原生 `window.alert` / `window.confirm`；提示与二次确认统一调用 `src/utils/feedback.ts`，删除等高危操作必须有确认弹窗。
4. **图标规范**：统一使用 `@element-plus/icons-vue` 显式导入所需图标。
5. **样式作用域隔离**：
   - 主题色彩优先使用 Element Plus CSS 变量（如 `--el-color-primary`），禁止硬编码散落色值。
   - 严禁在无 `scoped` 样式中覆盖 `.el-*` 全局类名，禁止滥用 `!important`；局部微调写在 `<style scoped>` 根类名下的 `:deep(.el-xxx)` 中。

## 3. Vue 3 通用规范与测试
- 全部使用 `<script setup lang="ts">`，禁止 Options API 与 `any` 断言；`defineProps` / `defineEmits` 使用 TS 泛型。
- `.vue` 文件严禁直接导入 `axios` 或调用 `fetch`；异步页面须覆盖 **加载态（`v-loading`）、空态（`ElEmpty`）、错误态（含重试）、成功态**；禁止 `v-html` 渲染未消毒内容。
- 使用 Vitest + `@vue/test-utils` 测试核心组件、`composables` 与 `stores`（Mock `feedback.ts` 并断言参数）；修改后必须通过 `node scripts/gate.mjs gate-mvp`。
