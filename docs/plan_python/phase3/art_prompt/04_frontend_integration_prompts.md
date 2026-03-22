# 零基础前端整合 AI 提示词 (Frontend Integration Prompt)

**使用场景**: 当你收集齐了所有图片，放入了 `frontend/public/assets/...` 目录后，**你无需自己去学前端怎么写**。
只需直接复制以下整段文本（作为 Prompt），新建一个 AI 对话，发送给你的 AI 辅助编程工具（如当前工程的 AI 面板，或 Github Copilot、Cursor 等），AI 就会为你干完剩下的活。

---

## 复制以下全部内容发送给下一个 AI：

```text
【背景说明】
你好！我是一名没有任何前端开发经验（0基础）的后端开发者。我正在开发一个名为 OpenClaw "Cyber Trias" 的项目。
这是一个基于 Vite + React + Phaser.js 的前端项目，用于将我后端的「三权分立 agent 对战」渲染成类似 16-bit SNES 怀旧像素风游戏的视觉动画。

现在，我手里有一批 AI 生成好的美术素材，它们已经按以下路径存入到我的 codebase 中了：
- 场景：`frontend/public/assets/tiles/bg_parliament.png` 等
- 角色（Sprite Sheet，横排 3 帧动作）：`frontend/public/assets/sprites/mp_radical.png` 等
- 预加载代码：在上个阶段，我的架构师已经帮我把 `frontend/src/game/scenes/PreloaderScene.ts` 写好了，所有的贴图和动画序列（如 `radical_idle`, `radical_throw` 等）已经在那里完成了切割和注册 (anims.create)。

【你的任务】
现在我需要你充当我的「资深前端工程师与游戏客户端主程」。请一步一步带我把主场景在浏览器里跑起来：

1. **创建主场景 `MainGameScene.ts`**：
   - 请帮我编写 `frontend/src/game/scenes/MainGameScene.ts`。
   - 在此场景中，把 `bg_parliament` 设为屏幕中心拉伸铺满的背景。
   - 在屏幕左边靠下位置，添加 `mp_radical` 角色精灵图，右边添加 `mp_conservative`（可能需要 scaleX翻转）。
   - 让两名角色在 create 生命周期里主动播放他们的闲置动画（比如 `.play('radical_idle')`）。

2. **零基础动作触发测试**：
   - 告诉我如何通过最简单的办法（比如监听真实的键盘按键，比如按下 Space 空格），触发右侧的保守派播放一次 `.play('conservative_hammer')` 的敲击动画？把这段逻辑写进代码里。

3. **React 容器集成**：
   - 如果我还没有把 Phaser 挂载到 React 页面上（即我的 `frontend/src/App.tsx` 或类似入口可能还是空白的），请帮我写出挂载 Phaser 的 React 代码。

4. **傻瓜式运行指南**：
   - 写完代码后，请准确告诉我：我要在控制台输入哪（几）条纯文本命令，能在浏览器（如 `http://localhost:5173`）中看见我刚配置的页面和动起来的像素小人？我需要 npm install 哪些依赖？

请给我所有需要修改的文件的「绝对路径」及「完整的、可以直接复制粘贴的无删减代码」。不要假设我懂各种前端缩写或配置，请按最详尽的新人向教程输出！
```
