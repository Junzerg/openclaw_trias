# Phase 4 - Task 4-E: SKILL.md 指令教学系统

> **前置依赖**: Task 4-C (沙箱引擎已就绪)
> **包含项**: 4.5.1 ~ 4.5.3
> **模块特性**: 配置层 / Agent 能力注册 / 自然语言工具教学

## 📌 目标

借鉴 [danghuangshang](https://github.com/wanikua/danghuangshang) 的 SKILL.md 模式，为内阁部长们建立标准化的"工具使用说明书"机制。每个 Skill（工具能力）用一份 Markdown 文件描述其功能、调用方法和约束，Agent 初始化时自动将所挂载的 SKILL.md 注入 System Prompt，从而让 LLM 知道"该怎么用这个工具"。

## 📋 涵盖子项

### 4.5.1 Skill 注册表
- 建立 `config/skills/` 目录结构：
  ```
  config/skills/
  ├── CodeExecution/
  │   └── SKILL.md
  ├── Python_Interpreter/
  │   └── SKILL.md
  ├── Search/
  │   └── SKILL.md
  └── WebBrowser/
      └── SKILL.md
  ```
- 定义 SKILL.md 统一格式（YAML frontmatter + Markdown body）：
  ```yaml
  ---
  name: Python_Interpreter
  description: "在隔离沙箱中执行 Python 代码"
  output_format: "stdout/stderr"
  timeout: 30
  ---
  ```

### 4.5.2 Skill 上下文注入
- 改造 `BaseAgent.__init__()` 或 `SecretaryOfEngineering.__init__()`：
  - 读取 `_available_tools` 列表。
  - 对每个 tool name，加载对应的 `config/skills/<tool>/SKILL.md`。
  - 将 SKILL.md 内容追加到 `self.system_prompt` 的 `[工具使用指南]` 段落。
- 这样 LLM 在生成代码时就有了"教学手册"上下文。

### 4.5.3 首批 Skill 编写
编写 3 份核心 SKILL.md 教学文件：

**CodeExecution.md**
- 告诉 LLM：你可以生成一段 Python 代码，系统会在沙箱中执行，并返回 stdout/stderr。
- 示例：如何写可执行的完整 Python 脚本、如何通过 print() 返回结果。
- 限制：禁止网络访问、禁止读写沙箱外文件、30 秒超时。

**Python_Interpreter.md**
- 与 CodeExecution 类似但强调交互式 REPL 场景。
- 告诉 LLM 如何分步骤执行、上一步结果如何传递。

**Search.md**
- 告诉国务卿 LLM：你可以执行网络搜索。
- 输入格式：搜索关键词字符串。
- 输出：搜索结果摘要列表。

## 🛠️ 关键修改文件

| 操作 | 文件 |
|------|------|
| **[NEW]** | `config/skills/CodeExecution/SKILL.md` |
| **[NEW]** | `config/skills/Python_Interpreter/SKILL.md` |
| **[NEW]** | `config/skills/Search/SKILL.md` |
| **[MODIFY]** | `openclaw_republic/agents/base.py` 或 `sec_engineering.py` — SKILL.md 加载注入 |
| **[NEW]** | `openclaw_republic/config/skill_loader.py` — Skill 注册表加载器 |

## 验收标准

- [ ] `config/skills/` 目录下存在至少 3 份格式规范的 SKILL.md 文件。
- [ ] 工程部长初始化时，其 `system_prompt` 尾部包含所挂载 Skill 的完整教学文本。
- [ ] 用真实 LLM 模式发起一次请愿 → 工程部长产出的代码质量受 SKILL.md 引导（包含正确的输出格式、沙箱约束提示等）。
- [ ] 新增或修改一份 SKILL.md 后，无需改动 Python 代码，Agent 下次初始化自动加载新 Skill。
