# Task 4.11 — 🏔️ 议会场景动效打磨 (Parliament Scene Polish)

> **前置依赖**：Task 4.10
> **涉及端**：🎮 Phaser
> **预估工作量**：⭐⭐

---

## 目标

增强议会场景的动画精度，按 PRD §3.1 补齐缺失的卷轴/信使入场效果，精调现有辩论和 brawl 动画。

## 现状审计

`ParliamentScene.ts`（409 行）：

| 功能 | 状态 | 详情 |
|------|------|------|
| triggerPropose | ✅ 有但简陋 | 直接弹气泡，无卷轴/信使入场 |
| triggerDebate | ✅ 有 | 气泡对话，颜色区分不明显 |
| triggerBrawl | ✅ 分级 | Lv1 口角 + Lv2 投掷物，无 Lv3 |
| triggerOrder | ✅ 完善 | 法槌 + "肃静！" + 震屏 |
| triggerVotePassed | ✅ 完善 | 绿光 + 印章 + fade → Executive |
| 卷轴入场 | ❌ 缺失 | PRD 规定信使送信/卷轴展开 |
| Brawl Lv3 | ❌ 缺失 | 议长连续敲槌效果 |

## 核心改动

### 1. 卷轴飞入动画（triggerPropose 增强）

```typescript
public async triggerPropose(faction: string, text: string): Promise<void> {
  const mp = this.getMPByFaction(faction);
  
  // 新增：卷轴从画面底部飞入
  const scroll = this.add.sprite(-50, this.scale.height + 50, 'prop_bill')
    .setDisplaySize(40, 40).setDepth(95);
  
  await new Promise<void>(resolve => {
    this.tweens.add({
      targets: scroll,
      x: mp!.x, y: mp!.y - 30,
      duration: 600,
      ease: 'Power2',
      onComplete: () => {
        scroll.destroy();
        resolve();
      }
    });
  });
  
  // 然后执行原有的气泡逻辑
  // ...
}
```

### 2. Brawl Lv3 议长连续敲槌

```typescript
private async triggerPhysicalConflict(intensity: number): Promise<void> {
  // ...existing Lv2 logic...
  
  if (intensity >= 8) {
    // Lv3: 议长连续敲槌 3 次
    for (let i = 0; i < 3; i++) {
      await new Promise(res => this.time.delayedCall(300, res));
      soundManager.play('gavel');
      this.speakerMP.play('speaker_hammer');
      this.cameras.main.shake(200, 0.02);
    }
  }
}
```

### 3. 气泡颜色区分

- 激进派气泡：红色边框 `backgroundColor: '#fff0f0'`
- 保守派气泡：蓝色边框 `backgroundColor: '#f0f0ff'`
- 调整字体到 `16px`（当前 `18px` 偏大导致气泡宽度溢出）

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| MODIFY | `frontend/src/game/scenes/ParliamentScene.ts` |

## 验证计划

1. 触发 propose → 卷轴从底部飞入议员位置 → 然后弹出气泡
2. 触发 brawl(intensity=9) → 议长连续敲槌 3 次 + 3 次震屏
3. 触发 debate → 确认激进派红色气泡 vs 保守派蓝色气泡
4. 完整 Pipeline 中 propose + debate + brawl 连续触发无动画冲突
