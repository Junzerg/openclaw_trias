# Task 0-A: TypeScript 项目骨架与 OpenClaw 部署

> **目标**：创立 TypeScript 后端基础设施，以及配置并运行 OpenClaw Gateway。
> **前置依赖**：无
> **对应阶段**：0.1, 0.2, 0.3
> **预估耗时**：1 会话

## 需求说明

这是重构的起步点，必须确保包管理器、依赖项、项目结构符合现代化 Node.js/TypeScript 最佳实践，并且 OpenClaw 在开发机器上处于可用状态。

### 1. 结构与 `package.json` 初始化

- 创建目录 `backend/`，与现存的 `frontend/`，`config/` 等平级。
- 采用 **ESM 技术栈**（`"type": "module"`）。
- 添加下列开发依赖：
  - `typescript`, `ts-node` 或 `tsx`
  - `eslint` (`@eslint/js`, `typescript-eslint`) 用于代码规范检查。
  - `vitest` 测试框架。
- 添加基本运行时依赖：
  - `zod`：后续负责配置文件及 LLM 返回值的 Schema 校验。
  - `ws`：负责之后 Phase 3 中需要升级的 WebSocket 直连功能。
  - `yaml`：YAML 配置加载。
- 准备基础脚本，包含 `npm run build`, `npm run start`, `npm run lint` 等。

### 2. TypeScript/ESLint/Vitest 基本配置

- 建立 `tsconfig.json` 配置。使用严格模式（`"strict": true`），设定 `ES2022` 编译目标（甚至 Node18/20 环境）。支持类似于 `"@/*": ["./src/*"]` 的 Alias 简化。
- 搭建 ESLint Flat config (`eslint.config.js`)。
- 保证 `backend/.gitignore` 已经包括 `node_modules` 与 `dist` 输出目录，不应有污染提交出现。

### 3. OpenClaw CLI 下发配置

- 进行 OpenClaw 工具链全局安装 `npm install -g openclaw@latest`。
- 执行 `openclaw onboard --install-daemon` 完成基本初始化。
- 配置 LLM 端点：设置可供调用的后台模型（如 `zai/glm-5`），确保计费无误（跳过无效订阅如火山过期模型）。
- 使得 `ws://127.0.0.1:18789` 常驻（可能利用 LaunchAgent 或后台 Terminal 控制）。

## 验收维度

- [x] 后端环境目录和基础配置全部完成，`package.json` 配置能够安装与编译通过 (`npm install`, `npx tsc --noEmit`)。
- [x] 配置目录规划到位，Git 无预期外的污染文件。
- [x] `openclaw` 环境可用：能够用 `openclaw doctor` 与 `openclaw agent --message "hello"` 拿到纯环境测试反馈。

## 产出与后续

完成这些纯“基础设施”搭建后，下一步开始建立适配层并跑通集成测试。参见：
→ [Task 0-B: 适配层实现与测试验证](task0.2_adapter_and_testing.md)
