# Task 1.3: 配置加载与代理基类 (Config & BaseAgent)

> **目标**：建立全局底层载入器（处理 YAML 与 Markdown 内容），并编写至关重要的 Agent 核心准则 `BaseAgent` 注入 LLM 真实调用能力与 RBAC 权限。
> **前置依赖**：[Phase 0](../phase0/phase0_overview.md) 完成适配层，[Task 1.1](task1.1_schemas.md)
> **对应目录**：`backend/src/config/`, `backend/src/agents/base.ts`
> **预估耗时**：1 会话

## 需求说明

1. **`config/models.ts` & `config/loader.ts`**:
   - 用 Zod 校验 `constitution.yaml` 的数据（`ConstitutionConfig`：司法要求、安全定义等）。
   - 实现解析器以读取项目根目录下 `config/souls/` 里的 7 个 `.md` 系统提示词文件，并支持按角色缓存提取。
2. **`agents/base.ts` (核心基类)**:
   - 翻译 5 个 `Permission` (PLAN, EXECUTE, MONITOR, VETO, KILL) 和三大 `Branch` 的 Enum。
   - 实现带有 `requirePermission` 阻断机制的 abstract 类 `BaseAgent`。
   - **革命性升级点** ⚠️ ：不同于 Python 版的 `return ""` Mock。在这里，使用 T0 的 `OpenClawAdapter`！每个派生的 Agent 的 `protected async callLLM(prompt: string)` 的内部实现，直接通过向 Adapter 提供注入的此角色 `SOUL.md` 以及此时的话语 Prompt，真正换取模型输出。

## 验收维度

- [x] 在单测中正确解析 `constitution.yaml` 并获取预设常数；
- [x] `base.test.ts` 测试实现一个 DummyAgent，当且只当它拥有 PLAN 权限时才能调用某测试方法，否则触发鉴权拦截 Error。
- [x] BaseAgent 能够成功拿到 Adapter 实例的引用。
