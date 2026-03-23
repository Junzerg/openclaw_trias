# Phase 3 Task 3-B: 美术资源提取 (AI 辅助生成)

## 任务目标
定义并加载像素风格 (8-bit) 精灵图 (Sprite Sheets)、Tilemap 地图及音效资源。
**所有美术相关资源将利用 Gemini 3.1 Pro 模型生成。** 开发过程将集成提示词沉淀或者自动化拉取图片。

## 具体执行步骤
1. **资源架构准备**
   - 在 `/public/assets` 下建立 `sprites`, `tiles`, `sfx` 等目录，用于存放后续生成的物料。
2. **定义 Gemini 生成提示词 (Prompt Template)**
   - **角色图集 (Sprite Sheets)**
     - *Prompt 模板*: `"A 2D pixel art character sprite sheet for an energetic politician, 16-bit style, clean transparent background. Need 4 frames for idle, 4 frames for walking, 4 frames for throwing an item. Horizontal layout, size exactly 32x32 pixels each frame. Style reference: classic SNES RPG."*
     - 对象涵括：激进派、保守派、议长、总统、各部委部长、最高法官。
   - **大环境 Tilemaps**
     - *Prompt 模板*: `"Pixel art background representing a majestic modern circular debating chamber ('The Parliament'), 16-bit classic game style, 960x540 resolution. Includes wooden podiums, colored seats, and marble pillars."*
     - 对象涵括：议会大厅、白宫内阁、全黑带聚光灯最高大厅。
   - **UI 动效与特效贴图**
     - *Prompt 模板*: `"Pixel art UI stamp that says 'VETO' in vibrant red, 8-bit style, isolated on transparent background, glowing edges."*
3. **Phaser 预加载器 (`Boot` / `Preload` Scene)**
   - 配置全部生成或备用占位图集的相对路径挂载加载逻辑 `this.load.spritesheet(...)`。
4. **统一动画组注册**
   - 通过 `this.anims.create()` 为每一组 Sprite Sheet 切片并设置循环和帧率。

## 验收标准
- [x] 拥有一套经过 AI 生成的相对统一的 8-bit 画风素材。
- [x] 前端可以成功渲染这些图集而不发生任何跨域资源报错和找不到文件的错误。
- [x] Phaser 正确切分了各个人物动作并具备 `startAnimation("talk")` 能力。
