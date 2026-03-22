# Phase 3 Task 3-D: 🏢行政与法院审判场景

> **状态: [已完成]**
> 已完全实现 `ExecutiveScene` 与 `JudicialScene` 的视觉互动、动画映射、Tween 流水线以及自定义 `prop_bill` 资产和 `ParticleEmitter` 粒子特效。验收测试已通过。

## 任务目标
横向推进法案流转，实现总统审批法案及其各部委编码工具调用，最终于法院盖下合宪与违宪戳印的视觉表达。

## 前置依赖
- 承接 [Task 3-C](task3.3_parliament_scene.md) 的渲染经验，重用物理特效工具。

## 具体执行步骤
1. **行政局环境 (The Executive Oval)**
   - 使用镜头横向平移，左边是**总统**（签字桌），右侧是**执行部委**（工程/外交部长）。
   - **签印/否决响应 (`sign_act` / `veto`)**：
     - 如果是 VETO，播放剧烈的红印特效，法案如履带般原路退回。
     - 签署通过后，部长人物进入工作帧(`work` anim)。
   - **工具执行动画 (`tool_call`)**
     - 展示小人在键盘猛敲击动作。
     - 界面外飞出代码流/CLI Log，快速滚动。
     - 如果执行报错：小人变身 `burn` 材质，头顶生成由 Phaser 颗粒发射器 `ParticleEmitter` 生成的 8-bit 黑烟特效。
2. **最高级法院 (The Supreme Court)**
   - 切入纯黑画布，中心上沿放置最高法官，聚光灯打在角色身上。
   - 悬崖勒马前的压抑：法案摆在中央接受审视。
   - **判决时刻 (`constitutional` / `unconstitutional`)**：
     - 如果通过：绿色大字 `CONSTITUTIONAL` 浮起，法槌威严肃穆地敲一下。
     - 遇到违宪/幻觉爆发：屏幕陷入红光暴走(Red strobe light overlay)，Traceback 大段大段像瀑布红雨流下，法案起火化成灰红色碎片。引发整个循环结束。

## 验收标准
- [x] WebSocket 接到违宪 `unconstitutional` 状态能瞬间切入绝望/警报视觉效果（红光暴走、红色Traceback代码瀑布、法案起火烧成灰烬）。
- [x] 当发送 `veto` 或者 `error` 事件时能分别展示打回特效（巨大VETO红印、镜头震动并退回法案）与冒烟的特性（部长红色滤镜及冒黑烟粒子动画）。
- [x] (附加) 成功生成并使用官方风格的法案像素贴图 `prop_bill.png` 替代了纯色矩形，视觉集成完成。
