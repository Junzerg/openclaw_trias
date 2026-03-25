# Task 4.10 — Phaser 场景过渡 & Canvas 响应式

> **前置依赖**：Task 4.1
> **涉及端**：🎮 Phaser
> **预估工作量**：⭐⭐

---

## 目标

解决场景切换的硬切问题（加入 fade 过渡），并将三大场景的硬编码坐标全部改为响应式相对定位。

## 现状审计

| 类目 | 现状 | 问题 |
|------|------|------|
| 场景切换 | `SceneManager.switchTo()` 直接调用 `scene.start()` | 无过渡效果，画面跳闪 |
| ParliamentScene | `width * 0.5` 相对定位 | ✅ 已实现 |
| ExecutiveScene | 硬编码 `(400,300)`、`(180,400)`、`(650,450)` | ❌ 不响应窗口 |
| JudicialScene | 硬编码 `(400,200)`、`(400,450)` | ❌ 不响应窗口 |
| vote_passed 过渡 | `ParliamentScene` L402 直接 `scene.start('ExecutiveScene')` | ❌ 无动画 |

## 核心产出

### 1. SceneManager 过渡引擎

```typescript
public switchTo(status: string): void {
  // 1. 防重入：过渡进行中忽略重复调用
  if (this._transitioning) return;
  this._transitioning = true;

  // 2. Fade out 当前场景（600ms）
  currentScene.cameras.main.fadeOut(600, 0, 0, 0);

  // 3. Fade out 完成后 → scene.start(target)
  currentScene.cameras.main.once(FADE_OUT_COMPLETE, () => {
    currentScene.scene.start(targetScene);
    // 新场景 create() 中 fadeIn(600ms)
    this._transitioning = false;
  });
}
```

- 在 `BaseScene.create()` 或各场景 `create()` 中添加 `this.cameras.main.fadeIn(600)`
- 切场时调用 `SoundManager.stopAll()` 防音效泄漏

### 2. ExecutiveScene 响应式坐标

```typescript
create() {
  const { width, height } = this.scale;
  this.add.image(width / 2, height / 2, 'bg_executive').setDisplaySize(width, height);
  this.president = this.add.sprite(width * 0.25, height * 0.67, 'mp_president');
  this.secretary = this.add.sprite(width * 0.8, height * 0.75, 'mp_secretary');
  this.bill = this.add.sprite(width * 0.25, height * 0.8, 'prop_bill');
  // ... 所有硬编码坐标改为 width/height 比例
}
```

### 3. JudicialScene 响应式坐标

同理：所有 `(400, xxx)` 改为 `(width * ratio, height * ratio)`

### 4. ParliamentScene vote_passed 过渡

- 移除 L402 的直接 `this.scene.start('ExecutiveScene')`
- 改为通过 EventMapper / SceneManager 的 fade 过渡触发

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| MODIFY | `frontend/src/game/SceneManager.ts` |
| MODIFY | `frontend/src/game/scenes/ExecutiveScene.ts` |
| MODIFY | `frontend/src/game/scenes/JudicialScene.ts` |
| MODIFY | `frontend/src/game/scenes/ParliamentScene.ts` |

## 验证计划

1. 手动触发场景切换 → 观察 fade 过渡流畅、无闪烁
2. 调整浏览器窗口大小至不同尺寸 → Executive/Judicial 角色位置自适应
3. 触发 vote_passed → 确认议会→行政使用 fade 而非硬切
4. 快速连续切换场景 → 防重入保护生效（不崩溃）
