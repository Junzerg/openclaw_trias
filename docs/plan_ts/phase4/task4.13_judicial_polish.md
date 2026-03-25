# Task 4.13 — ⚖️ 司法场景动效打磨 & 音效扩充 (Judicial Scene Polish + SoundManager)

> **前置依赖**：Task 4.10
> **涉及端**：🎮 Phaser
> **预估工作量**：⭐⭐

---

## 目标

修复司法场景已知 Bug，增强判决动画视觉冲击力，并完成全局 SoundManager 音效库扩充。

## 现状审计

`JudicialScene.ts`（181 行）：

| 功能 | 状态 | 详情 |
|------|------|------|
| triggerConstitutional | ✅ 有 | 绿光法槌 + "合宪"文字印章 |
| triggerUnconstitutional | ✅ 有 | 红光频闪 + 粒子瀑布 + 卷轴燃烧 |
| resetSceneState | ⚠️ Bug | L172: `setScale(1)` 与 `setDisplaySize(64,64)` 冲突 |
| 聚光灯 | ⚠️ 可优化 | 静态三角形 fillTriangle |

`SoundManager.ts`（47 行）：

| 功能 | 状态 | 详情 |
|------|------|------|
| 音效播放 | ✅ 有 | play(), stopAll(), try/catch 降级 |
| 已有 key | ⚠️ 不全 | gavel, typewriter, hit, murmur, alert 共 5 种 |
| 切场保护 | ❌ 缺失 | 切换场景时不 stopAll |

## 核心改动

### 1. resetSceneState Bug 修复

```typescript
// BEFORE (Bug):
private resetSceneState() {
  this.bill.setScale(1);  // ← 会覆盖 displaySize
  this.bill.setDisplaySize(64, 64);  // ← 这行才是正确的

// AFTER (Fixed):
private resetSceneState() {
  // 统一使用 setDisplaySize 控制尺寸，不用 setScale
  this.bill.setDisplaySize(64, 64);
  this.bill.setAlpha(1);
  this.tweens.killTweensOf(this.bill);
  // ...
}
```

### 2. 聚光灯动态化

```typescript
create() {
  // ...
  const spotlight = this.add.graphics();
  spotlight.fillStyle(0xffffff, 0.1);
  spotlight.fillTriangle(400, 50, 200, 500, 600, 500);
  
  // 新增：轻微摇摆
  this.tweens.add({
    targets: spotlight,
    alpha: { from: 0.08, to: 0.15 },
    duration: 2000,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut'
  });
}
```

### 3. 判决动画增强

**合宪**：法槌落下后 → bill sprite 发出金色光晕
```typescript
// 在 triggerConstitutional 的印章出现后添加
const glow = this.add.circle(this.bill.x, this.bill.y, 50, 0xffdd00, 0.3).setDepth(5);
this.tweens.add({
  targets: glow, scale: 2, alpha: 0, duration: 1000,
  onComplete: () => glow.destroy()
});
```

**违宪**：增强震屏强度（`0.015 → 0.025`）+ 闪烁加速（`150ms → 100ms`）

### 4. SoundManager 全局音效扩充

```typescript
// 扩充音效 key 映射（实际音频文件由 PreloaderScene 加载）
// 新增 key 说明：
// murmur_long - 议会长喧嚣（用于 brawl Lv2+）
// crash      - 碰撞音效（用于投掷物命中）
// pen_scratch - 签字音效（用于总统签署）
```

- 在 `SceneManager.switchTo()` 的 fadeOut 前调用 `soundManager.stopAll()`

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| MODIFY | `frontend/src/game/scenes/JudicialScene.ts` |
| MODIFY | `frontend/src/game/SoundManager.ts` |
| MODIFY | `frontend/src/game/SceneManager.ts` — 切场 stopAll |

## 验证计划

1. 依次触发 unconstitutional → constitutional → 确认 bill sprite 尺寸 64x64 正确、无 scale 残留
2. 观察聚光灯摇摆效果（alpha 在 0.08~0.15 间缓慢交替）
3. 合宪判决 → 观察 bill 金色光晕
4. 切换场景后 → DevTools Console 无音效 warn 日志
5. 切换场景 → 前一场景音效停止（无泄漏）
