# 产品需求文档 (PRD)：OpenClaw 「赛博三权分立」可视化多智能体系统

**项目代号**：OpenClaw-Republic / DangZongTong (当总统)
**文档版本**：V 3.0 (整合 V1 场景设计 + V2 架构精度)
**产品基调**：极客浪漫、政治模拟、可视化工作流、像素风 (Pixel Art)
**底层驱动**：OpenClaw / Python (`import antigravity`)

---

## 1. 产品概述 (Product Overview)

### 1.1 项目背景与核心理念

传统的"集权式"单向工作流（中央控制器下发指令 ➔ 规划器拆解任务 ➔ 执行器干活）在执行确定性任务时效率极高，但在面对复杂、发散性需求时，容易产生大模型"幻觉（Hallucination）"的级联放大（即"屎山代码传递"），且底层高危工具的调用缺乏旁路制衡。

本项目旨在完成从"集权式单体"到"共和制分权"的架构进化。借鉴美式三权分立（Separation of Powers）理念，基于 **OpenClaw** 构建**"三权分立"（立法 Legislative、行政 Executive、司法 Judicial）**多智能体系统，引入 Agent 间的**横向制衡（Checks and Balances）、对抗辩论（Debate Prompting）与物理熔断机制**。并配以 WebSocket 驱动的**像素风动态演播厅**，将枯燥的后台运行日志转化为极具观赏性的"赛博政局"与"电子政治盆栽"。

### 1.2 核心目标

1. **多视角辩论（防幻觉）**：剥离规划权与执行权。通过左右翼议员激辩达成共识，利用大模型的自我纠偏生成最优执行法案（SOP）。
2. **绝对安全合规（防越权）**：行政分支无规划权（只能按法案调 Tool 干活），司法分支有一票否决权（监控沙箱，对高危行为进行物理熔断）。
3. **高观赏性监控（可视化）**：将 Token 消耗、状态流转、CoT（思维链）映射为生动的 8-bit 像素动画（提案、议员吵架、法官敲槌）。

---

## 2. 核心架构：职能映射与权限隔离 (Core Agentic Orchestration)

> **✨ 架构设计原则**：全面采用"政体职能隐喻"和独立的 **`SOUL.md`** 人设配置。严格执行 RBAC（基于角色的权限控制）和 Workspace 物理隔离。

在系统中，**用户不再是"皇帝"，而是"选民 (Voter)"**。选民通过前端提交原始需求（请愿/Prompt），触发国家机器运转：

### 2.1 🏛️ 立法分支 (Legislative Branch) —— "方案规划与红蓝对抗"

- **架构本质**：Planner & Router。
- **权限设定**：**绝对无执行权**。被物理剥夺调用代码/终端/文件系统的权限，只能进行纯文本推理与架构设计。
- **Agent 角色矩阵 (目录: `agents/legislative/`)**：
  - **议长 (Speaker)**：流程控制枢纽。接收选民请愿，控制两派议员的辩论 Token 消耗，判定何时终止辩论并发起表决，最终产出结构化 JSON 格式的《执行法案 (Act)》。
  - **激进派议员 (Radical MP)**：通过 `SOUL.md` 注入极客/激进人设。偏好前沿技术栈，追求代码极简和效率，提议大胆但容易产生边界幻觉。
  - **保守派议员 (Conservative MP)**：通过 `SOUL.md` 注入防御性/保守人设（Red Team）。天生的 Critique（找茬者），专挑性能瓶颈、内存泄漏、安全漏洞的刺。
- **核心机制【议会辩论】**：
  - 方案必须经过两派的互相 Critique（互评）→ Rebuttal（反驳），激进与保守互相博弈强制对齐。
  - 直到分歧度（Conflict Score）降至阈值以下，达成共识并投票通过，生成正式的《执行法案》（JSON 格式的工作流描述）。

### 2.2 🏢 行政分支 (Executive Branch) —— "工具调用与苦力干活"

- **架构本质**：Worker Nodes 集群。
- **权限设定**：**满载执行工具，但无自主规划权**。只能严格按照《执行法案》的内容，调用 OpenClaw 的底层 Skills 照章办事。
- **Agent 角色矩阵 (目录: `agents/executive/`)**：
  - **总统 (President)**：任务分派枢纽。接收法案，拥有**【行政否决权 (Veto)】**——若校验发现 Token 预算不足，或当前系统未挂载法案要求的底层 Tools，直接打回立法分支重构。校验通过后，拆解 Task 派发给内阁。
  - **工程部长 (Sec. of Engineering)**：挂载 `CodeExecution`, `Python_Interpreter`, `GitHub` 技能，负责实际编码与环境操作。
  - **国务卿 (Sec. of State)**：挂载 `WebBrowser`, `Search` 技能，负责联网查阅最新文档与外部 API 交互。

### 2.3 ⚖️ 司法分支 (Judicial Branch) —— "合规审查与安全护栏"

- **架构本质**：LLM-as-a-Judge (最终 QA 与安全沙箱)。
- **权限设定**：全局只读监控权 + 最高级别的**物理熔断权 (Kill Switch)**。系统最底层的 Guardrails。
- **Agent 角色矩阵 (目录: `agents/judicial/`)**：
  - **首席大法官 (Chief Justice)**：配置最高级别的安全审查提示词。
- **核心机制【违宪审查】**：
  - **过程违宪审查（旁路沙箱监听）**：实时监控行政分支的 Shell/Python 动作。若检测到 `rm -rf`、死循环、越权读取私钥等危险操作，大法官立刻判定**"违宪 (Unconstitutional)"**，强制物理 Kill 容器。
  - **结果违宪审查（交付验收）**：在交付前，比对《选民原始请愿》与《最终产物》。如果行政部写跑题了（大模型幻觉），敲下法槌，将 Error Traceback 和判决书打回立法重做。

---

## 3. 动态像素场景引擎 (Pixel Art Visual Dashboard) ⭐ 核心高光

前端通过 WebSocket 实时解析 OpenClaw 后端 Agent 的通信日志流与大模型情感（CoT），驱动 2D 像素引擎（如 Phaser.js / PixiJS），实现行为高度可视化。

### 3.1 场景一：🏛️ 议会大厅 (The Parliament)

- **视觉布局**：左右对立的阶梯状议席，中央为演讲台。
- **【提案环节】**：
  - 代表用户 Prompt 的信使将信件送入大厅。
  - 议员小人走上【演讲台】，展开卷轴，头顶冒出气泡（打字机效果显示方案拆解步骤）。
- **【名场面：议员吵架】**：当激进派与保守派 Agent 产生逻辑分歧，进入对齐阶段时触发。
  - **Lv1 正常辩论**：座位上的小人交替冒出文字气泡（如："这会导致内存泄漏！"）。
  - **Lv2 激烈冲突**：当分歧度（Conflict Score）飙升，两拨小人脸部变红，离开议席互相靠近。**画面中开始跨党派互扔像素纸团、皮鞋、咖啡杯（带抛物线物理特效）**，气泡爆出 `🤬`、`💢`。
  - **Lv3 议长控场**：屏幕微震，议长疯狂敲击法槌，伴随 8-bit `咚咚咚` 音效和巨大 `ORDER!` 飘字，强制双方冷静。
- **【表决通过】**：议长敲槌一声定音，全场亮绿灯，卷轴经传送带发往白宫。

### 3.2 场景二：🏢 行政格子间 (The Oval Office & Bureaucracy)

- **视觉布局**：横向卷轴的总统办公室与下属格子间。
- **动态交互**：
  - 法案通过后，总统拿起羽毛笔签字，触发绿色 `APPROVED` 盖章特效。
  - 格子间里的"部长"小人们开始疯狂敲击键盘，屏幕闪烁代码流（代表 OpenClaw 正在调用 Skill 执行耗时操作）。
  - 报错时小人头上会冒黑烟 💨。
  - Token 预算不足时，总统甩出红色 `VETO` 盖章，法案卷轴弹回议会。

### 3.3 场景三：⚖️ 最高法院 (The Supreme Court)

- **视觉布局**：全黑背景，聚光灯打在高高在上的像素大法官身上。
- **动态交互**：任务交付前进入审查期。
  - **合宪通过 ✅**：法官高举法槌落下，闪烁绿光，浮现 `CONSTITUTIONAL`，任务成果打包发给用户。
  - **违宪驳回 ❌**：屏幕剧烈震动，红光警报。法槌重砸，甩出红色 `UNCONSTITUTIONAL` 印章，法案卷轴碎裂燃烧，强制退回议会重做。

### 3.4 美术资源清单

| 类别 | 资源项 | 说明 |
|------|--------|------|
| **Sprite Sheets** | 角色帧动画 | 议员(站/坐/说话/扔东西/脸红)、总统(签字/盖章)、法官(敲槌/宣判)、信使 |
| **场景背景** | Tilemap | 议会大厅、白宫办公室+格子间、法院 |
| **道具特效** | 投掷物 & 印章 | 纸团、皮鞋、咖啡杯（带抛物线）、卷轴、APPROVED/VETO/印章、火焰碎裂 |
| **音效** | 8-bit SFX | 法槌敲击、扔东西碰撞、打字机、议会喧嚣、红色警报 |

---

## 4. 数据字典与事件流 (WebSocket Event Mapping)

为实现后端逻辑与前端渲染的解耦，定义统一的 JSON 事件推送流：

| 触发阶段 | OpenClaw 后端状态 / 判定          | WebSocket 推送指令 (示例)                     | 前端像素动画响应 |
| :------- | :-------------------------------- | :-------------------------------------------- | :--------------- |
| **立法** | `radical_mp` 输出提案草案         | `{"action": "propose", "emotion": "excited"}` | 议员上台，展开卷轴，打字机气泡 |
| **立法** | 分歧度飙升 (Conflict_Score > 80)  | `{"action": "brawl", "intensity": 9}`         | Lv2 互扔纸团/皮鞋，爆出 `🤬` |
| **立法** | 议长介入控场                      | `{"action": "order", "intensity": 10}`        | Lv3 屏幕微震 + `ORDER!` 飘字 |
| **立法** | 共识达成，生成《执行法案》        | `{"action": "vote_passed"}`                   | 议长敲槌，全场亮绿灯，卷轴发往白宫 |
| **行政** | 总统签署法案                      | `{"action": "sign_act"}`                      | 总统签字 + `APPROVED` 盖章 |
| **行政** | 总统否决                          | `{"action": "veto", "reason": "..."}`         | `VETO` 盖章，卷轴弹回议会 |
| **行政** | `cabinet_eng` 调用 Skill 运行代码 | `{"action": "tool_call", "skill": "code"}`    | 部长敲键盘，屏闪代码。报错冒黑烟 |
| **司法** | 合宪通过                          | `{"action": "constitutional"}`                | 法官敲槌绿光，`CONSTITUTIONAL` |
| **司法** | 触发安全护栏 / 判定跑题           | `{"action": "unconstitutional"}`              | 法槌重砸，红色印章，卷轴碎裂燃烧，全屏震动 |

---

## 5. 工程化设计 (Engineering Design)

### 5.1 SOUL.md 人设配置驱动

将所有 Agent 的 Prompt、性格设定、能力边界，全部抽离到 `config/souls/` 目录下的 Markdown 文件中（如 `radical_mp.md`, `chief_justice.md`）。用户只需修改文本，就能"给官员换脑子"，调整整个国家的政策基调，极大地促进社区二创。

### 5.2 宪法配置 (`constitution.yaml`)

全局红线配置文件，定义司法分支的违宪审查规则：
- 黑名单命令列表（`rm -rf`, `DROP TABLE`, etc.）
- Token 预算上限
- 最大辩论轮次
- 产出偏离度阈值

### 5.3 终极起飞：`import antigravity`

致敬 Python 经典的漫画彩蛋。用户配置完环境后，只需写下以下代码：

```python
from openclaw_republic import CyberGovernment
from openclaw_republic.config import load_constitution

# 载入宪法（全局红线配置）与 SOUL 矩阵
republic = CyberGovernment(constitution=load_constitution("constitution.yaml"))

# 核心魔法：一行代码启动整个国家的引擎，并自动弹开浏览器进入 8-bit 演播厅
import antigravity

if __name__ == "__main__":
    republic.inaugurate(port=8080)  # inaugurate: 举行总统就职典礼，AI 国家开始运转
```
