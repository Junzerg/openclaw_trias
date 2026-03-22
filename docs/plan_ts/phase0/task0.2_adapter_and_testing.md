# Task 0-B: 适配层实现与测试验证

> **目标**：以 TypeScript 封装一层 OpenClaw Gateway 调用接口（Phase 0 使用 CLI subprocess），通过编写真正的 LLM 获取、Code Execution 工具执行等测试并将其通过 `npm run smoke` 验证。
> **前置依赖**：[Task 0-A](task0.1_project_skeleton.md)
> **对应阶段**：0.4, 0.5
> **预估耗时**：1 会话

## 需求说明

为避免过早陷入复杂的 WebSocket 握手协议细节（如设备身份与签名生成等），**Phase 0 全面采取子进程直接调用 OpenClaw `--message` 的策略。**

### 1. `OpenClawAdapter` 设计 (`src/openclaw/adapter.ts`)

- 提供 `healthCheck` 方法返回 `{cli: boolean, gateway: boolean, details: string}`，验证 `openclaw --version` 的联通情况。
- 提供 `callLLM(systemPrompt, userMessage)` 封装方法：
  - 调用 `execSync` 开启 OpenClaw 子进程进行 `agent --message` 交互。
  - 需要在命令参数上带好 `--agent main` 设定目标 agent。
  - 对 LLM 的返回值进行清理。由于标准输出可能混合了 CLI Banner，ANSI 颜色代码转换成的 ASCII（尤其是类似 `[plugins] feishu_doc: Registered...` 这样的行），必须用严谨正则先行预处理掉。
- 提供 `executeCode(code, language)` 方法：
  - 本阶段依托于 `exec` 工具执行终端命令（如 `node -e` 或 `python3 -c`），并用特殊 prompt 请求它仅仅返回该 Code 块产生的 `stdout` 回显结果。
  - 同样使用 `runCliCommand` 屏蔽掉子进程的 stderr 同步干扰，因为部分环境中，如 `Vitest` Worker 对 I/O 的捕获非常有限制。

### 2. 测试配置 (`Vitest` 与 Smoke Test)

- 必须编写一个完整的 **单元测试集 (`adapter.test.ts`)**，用来保证纯 TS 功能（如抛出不合法环境异常、默认 Config 覆盖等）在 CI 中可以秒回通过。
- 对于依赖了真实的 Gateway 与 CLI 的功能集成代码，需将其包裹成一个专门的**冒烟测试脚本 `npm run smoke`**（利用 `tsx src/openclaw/adapter.ts`），其将顺手执行真实的 `callLLM` 与 `executeCode`：
  - 该决定规避了 T0 阶段用 `Vitest` 捕获 CLI 输出因 Node Worker 执行上下文不同导致输出被无声吞并从而 `rawOutput` 长始终为 `0` 的底层坑。
  - 测试 LLM 返回特定的纯文字：`"连通成功"`。
  - 测试能产生正确的计算结果回显，如 `console.log(1+1)` 输出 `2`。

## 验收维度

- [x] 完成 `adapter.ts` 的编写，代码干净且具备 TypeScript 强类型标注。
- [x] 所有单元测试均成功运转：`npm test` 绿灯通过，含有特定 `skip` 跳过实际调用的测试标识。
- [x] `npm run smoke` 能正确发起真实的对话以及指令：
  - ✅ Health Check
  - ✅ LLM Connectivity (`"连通成功"`)
  - ✅ Exec Tool Verified
- [x] 在 `docs/openclaw_integration_notes.md` 中整理、描述并在后续分享开发期间暴露的坑点（诸如 Vitest 和 ANSI 逃逸），记录成 Phase 0 的心得遗产。

## 产出与后续

0.4 与 0.5 构成了后续架构（Phase 1）的沙箱执行底座，随后可以直接开始对不同特性的 Agent（议长、议员、首席法官等）进行抽象和封层。
→ [Phase 1 · 代理基类与沙箱调度封装](../phase1/phase1_overview.md)
