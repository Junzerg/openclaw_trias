# 产品需求文档 (PRD)：OpenClaw 「赛博三权分立」可视化多智能体系统

**项目代号**：DangZongTong (当总统) / OpenClaw-Republic
**文档版本**：V 2.0 (基于 danghuangshang 架构打磨升级)
**产品基调**：极客浪漫、政治模拟、可视化工作流、像素风 (Pixel Art)
**底层驱动**：OpenClaw / Python (`import antigravity`)

## 1. 产品概述 (Product Overview)

### 1.1 项目背景与核心理念

传统的“集权式”单向工作流（皇帝下旨 ➔ 内阁拆解 ➔ 六部干活）在执行确定性任务时效率极高，但在面对复杂、发散性需求时，容易产生大模型“幻觉（Hallucination）”的级联放大（即“屎山代码传递”），且底层高危工具的调用缺乏旁路制衡。

本项目旨在完成从“封建帝制”到“现代共和”的架构进化。基于 **OpenClaw** 构建**“三权分立”（立法、行政、司法）**多智能体系统，引入 Agent 间的**横向制衡、对抗辩论（Debate Prompting）与物理熔断机制**。并配以 WebSocket 驱动的**像素风动态演播厅**，将枯燥的后台运行日志转化为极具观赏性的“电子政治盆栽”。

### 1.2 核心目标

1. **多视角辩论（防幻觉）**：剥离规划权与执行权。通过左右翼议员激辩达成共识，利用大模型的自我纠偏生成最优执行法案（SOP）。
2. **绝对安全合规（防越权）**：行政分支无规划权（只能按法案调 Tool 干活），司法分支有一票否决权（监控沙箱，对高危行为进行物理熔断）。
3. **高观赏性监控（可视化）**：将 Token 消耗、状态流转、CoT（思维链）映射为生动的 8-bit 像素动画（提案、议员吵架、法官敲槌）。

---

## 2. 核心架构：职能映射与权限隔离 (Core Agentic Orchestration)

> **✨ 架构打磨说明**：全面采用“政体职能隐喻”和独立的 **`SOUL.md`** 人设配置。严格执行 RBAC（基于角色的权限控制）和 Workspace 物理隔离。

在系统中，**用户不再是“皇帝”，而是“选民 (Voter)”**。选民通过前端提交原始需求（请愿/Prompt），触发国家机器运转：

### 2.1 🏛️ 立法分支 (Legislative Branch) —— “方案规划与红蓝对抗”

- **架构本质**：Planner & Router。
- **权限设定**：**绝对无执行权**。被物理剥夺调用代码/终端/文件系统的权限，只能进行纯文本推理与架构设计。
- **Agent 角色矩阵 (目录: `agents/legislative/`)**：
  - **议长 (Speaker)**：流程控制枢纽。接收选民请愿，控制两派议员的辩论 Token 消耗，判定何时终止辩论并发起表决，最终产出结构化 JSON 格式的《执行法案 (Act)》。
  - **激进派议员 (Radical MP)**：通过 `SOUL.md` 注入极客/激进人设。偏好前沿技术栈，追求代码极简和效率，提议大胆但容易产生边界幻觉。
  - **保守派议员 (Conservative MP)**：通过 `SOUL.md` 注入防御性/保守人设（Red Team）。天生的 Critique（找茬者），专挑性能瓶颈、内存泄漏、安全漏洞的刺。
- **核心机制**：通过激进与保守的互相博弈强制对齐，直到分歧度（Conflict Score）降至阈值以下，生成经过严密论证的法案。

### 2.2 🏢 行政分支 (Executive Branch) —— “工具调用与苦力干活”

- **架构本质**：Worker Nodes 集群。
- **权限设定**：**满载执行工具，但无自主规划权**。只能严格按照《执行法案》的内容，调用 OpenClaw 的底层 Skills 照章办事。
- **Agent 角色矩阵 (目录: `agents/executive/`)**：
  - **总统 (President)**：任务分派枢纽。接收法案，拥有**【行政否决权 (Veto)】**。若校验发现 Token 预算不足，或当前系统未挂载法案要求的底层 Tools，直接打回立法分支重构。校验通过后，拆解 Task 派发给内阁。
  - **工程部长 (Sec. of Engineering)**：对标原“兵部/工部”。挂载 `CodeExecution`, `Python_Interpreter`, `GitHub` 技能，负责实际编码与环境操作。
  - **国务卿 (Sec. of State)**：对标原“礼部/鸿胪寺”。挂载 `WebBrowser`, `Search` 技能，负责联网查阅最新文档与外部 API 交互。

### 2.3 ⚖️ 司法分支 (Judicial Branch) —— “合规审查与安全护栏”

- **架构本质**：LLM-as-a-Judge (最终 QA 与安全沙箱)。
- **权限设定**：全局只读监控权 + 最高级别的**物理熔断权 (Kill Switch)**。系统最底层的 Guardrails。
- **Agent 角色矩阵 (目录: `agents/judicial/`)**：
  - **首席大法官 (Chief Justice)**：对标原“都察院/刑部”。配置最高级别的安全审查提示词。
- **核心机制**：
  - **过程违宪审查（旁路沙箱监听）**：实时监控行政分支的 Shell/Python 动作。若检测到 `rm -rf`、死循环、越权读取私钥等危险操作，大法官立刻判定**“违宪 (Unconstitutional)”**，强制物理 Kill 容器。
  - **结果违宪审查（交付验收）**：在交付前，比对《选民原始请愿》与《最终产物》。如果行政部写跑题了（大模型幻觉），敲下法槌，将 Error Traceback 和判决书打回重做。

---

## 3. 动态像素场景引擎 (Pixel Art Visual Dashboard) ⭐ 核心高光

系统通过 FastAPI + WebSocket 实时解析 OpenClaw 后端日志流和大模型的情感（CoT），驱动前端 2D 像素引擎（如 Phaser.js）。

### 3.1 事件流与 WebSocket 映射协议

| 触发阶段 | OpenClaw 后端状态 / 判定          | WebSocket 推送指令 (示例)                     | 前端像素动画响应                                                                                    |
| :------- | :-------------------------------- | :-------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| **立法** | `radical_mp` 输出提案草案         | `{"action": "propose", "emotion": "excited"}` | 议员走上演讲台，展开卷轴，头顶冒出打字机气泡。                                                      |
| **立法** | 分歧度飙升 (Conflict_Score > 80)  | `{"action": "brawl", "intensity": 9}`         | **名场面**：左右议席小人脸红，离开座位跨党派**互扔像素纸团、皮鞋**（带抛物线物理引擎），爆出 `🤬`。 |
| **立法** | 共识达成，生成《执行法案》        | `{"action": "vote_passed"}`                   | 议长狂敲法槌，全场亮绿灯，卷轴经传送带发往白宫。                                                    |
| **行政** | `cabinet_eng` 调用 Skill 运行代码 | `{"action": "tool_call", "skill": "code"}`    | 总统盖章 `APPROVED`，格子间部长小人疯狂敲击键盘，屏幕闪烁代码。报错时冒黑烟。                       |
| **司法** | 触发安全护栏 / 判定跑题           | `{"action": "unconstitutional"}`              | 聚光灯打向法庭，法官高跃重砸法槌，甩出红色印章，法案碎裂燃烧，全屏震动红光警报。                    |

---

## 4. 极致的工程化部署体验 (The Antigravity Magic)

借鉴优秀开源项目的开发者体验（DX），本项目做到“一行代码治国”，让开源玩家欲罢不能。

### 4.1 SOUL.md 人设配置驱动

将所有 Agent 的 Prompt、性格设定、能力边界，全部抽离到 `config/souls/` 目录下的 Markdown 文件中（如 `radical_mp.md`, `chief_justice.md`）。用户只需修改文本，就能“给官员换脑子”，调整整个国家的政策基调，极大地促进社区二创。

### 4.2 终极起飞：`import antigravity`

利用 Python 的模块化优势，编写极简的入口启动脚本。致敬 Python 经典的漫画彩蛋，当用户在终端配置完环境后，只需在 `main.py` 写下以下代码：

```python
from openclaw_republic import CyberGovernment
from openclaw_republic.config import load_constitution

# 载入宪法（全局红线配置）与 SOUL 矩阵
republic = CyberGovernment(constitution=load_constitution("constitution.yaml"))

# 核心魔法：一行代码启动整个国家的引擎，并自动弹开浏览器进入 8-bit 演播厅
import antigravity

if __name__ == "__main__":
    republic.inaugurate(port=8080) # inaugurate: 举行总统就职典礼，AI 国家开始运转
```
