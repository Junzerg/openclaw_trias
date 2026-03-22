# Phase 4 - Task 4-A: LLM Provider 适配层

> **前置依赖**: Phase 1~3 完成
> **包含项**: 4.1.1 ~ 4.1.5
> **模块特性**: 后端基础设施 / 跨模块公共依赖

## 📌 目标

为整个三权分立系统注入真正的"大脑"。当前所有 Agent 的 `_call_llm()` 都是返回硬编码字符串的占位实现。本任务要将该方法替换为可配置的、真实的 LLM API 调用通道，同时保留 Mock 开关以便无 API Key 时仍可跑测试。

## 📋 涵盖子项

### 4.1.1 统一 LLM Client 抽象
- 定义 `LLMProvider` 协议（Protocol），包含 `async def chat(messages, **kwargs) -> LLMResponse` 接口。
- 实现 `OpenAIProvider`（兼容 OpenAI / DeepSeek / 硅基流动等 compatible API）。
- 实现 `MockProvider`（返回原有硬编码内容，用于测试和无 API Key 开发）。

### 4.1.2 `_call_llm()` 真实化
- 改造 `BaseAgent`：新增 `llm_provider` 属性注入点。
- 改写 `_call_llm(prompt) -> str`：内部组装 `[{"role":"system", "content": self.system_prompt}, {"role":"user", "content": prompt}]` 并调用 `self.llm_provider.chat()`。
- 所有子类 (`RadicalMP`, `ConservativeMP`, `Speaker`) 的 `_call_llm` 覆写全部删除，统一走基类。

### 4.1.3 Token 计量与回传
- `LLMResponse` 模型包含 `content: str`, `prompt_tokens: int`, `completion_tokens: int`。
- `_call_llm` 返回值增强，使调用者可获取本次调用的 Token 消耗。

### 4.1.4 配置外化
- 新建 `config/llm.yaml`（或复用 `constitution.yaml` 扩展），支持：
  - `provider`: openai / mock
  - `api_key`: 环境变量 `$OPENAI_API_KEY`
  - `model`: 模型 ID
  - `temperature`, `max_tokens`, `timeout`

### 4.1.5 Mock 模式保留
- `MOCK_LLM=true` 环境变量 → 强制使用 `MockProvider`。
- 现有的 39 个测试文件不受影响（默认走 Mock）。

## 🛠️ 关键修改文件

| 操作 | 文件 |
|------|------|
| **[NEW]** | `openclaw_republic/llm/provider.py` — LLMProvider 协议 + OpenAIProvider + MockProvider |
| **[NEW]** | `openclaw_republic/llm/__init__.py` |
| **[NEW]** | `config/llm.yaml` |
| **[MODIFY]** | `openclaw_republic/agents/base.py` — 注入 `llm_provider`, 改写 `_call_llm` |
| **[MODIFY]** | `openclaw_republic/agents/legislative/radical_mp.py` — 删除 `_call_llm` 覆写 |
| **[MODIFY]** | `openclaw_republic/agents/legislative/conservative_mp.py` — 同上 |
| **[MODIFY]** | `openclaw_republic/agents/legislative/speaker.py` — 同上 |
| **[MODIFY]** | `openclaw_republic/government.py` — 初始化时注入 provider |
| **[MODIFY]** | `tests/` — 确保 Mock 模式下全部测试照旧通过 |

## 验收标准

- [ ] 设定 `OPENAI_API_KEY` 后，`radical_mp.propose("写一个排序算法")` 返回真实 LLM 生成的提案文本。
- [ ] 设定 `MOCK_LLM=true` 后，行为与改造前完全一致。
- [ ] 现有全部 39 个测试文件在 Mock 模式下依旧通过 (`pytest tests/`)。
- [ ] Token 计量数据可通过 `LLMResponse` 获取。
