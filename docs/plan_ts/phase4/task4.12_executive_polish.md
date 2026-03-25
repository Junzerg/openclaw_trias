# Task 4.12 — 🏢 行政场景动效打磨 (Executive Scene Polish)

> **前置依赖**：Task 4.10
> **涉及端**：🎮 Phaser
> **预估工作量**：⭐⭐

---

## 目标

增强行政场景的动画精度，按 PRD §3.2 补齐双部长格子间、优化代码流显示和签署/否决特效。

## 现状审计

`ExecutiveScene.ts`（200 行）：

| 功能 | 状态 | 详情 |
|------|------|------|
| triggerSign | ✅ 有 | 纯文本"批准"印章 + bounce 动画 |
| triggerVeto | ✅ 有 | 纯文本"否决" + 红色 + 震屏 |
| triggerToolCall | ✅ 有但简陋 | 单行文本上滑消失 + 打字机音效 |
| triggerError | ✅ 有 | 红色 tint + 冒烟粒子 |
| 双 Secretary | ❌ 缺失 | 只有 1 个 secretary sprite |
| 代码流效果 | ⚠️ 简陋 | 单个 text 对象简单 tween |

## 核心改动

### 1. 双 Secretary 格子间

```typescript
create() {
  const { width, height } = this.scale;
  
  // SecEngineering (左侧格子间)
  this.secretaryEng = this.add.sprite(width * 0.55, height * 0.75, 'mp_secretary')
    .setOrigin(0.5);
  this.secretaryEng.play('secretary_idle');
  
  // SecState (右侧格子间)
  this.secretaryState = this.add.sprite(width * 0.80, height * 0.75, 'mp_secretary')
    .setOrigin(0.5).setFlipX(true);
  this.secretaryState.play('secretary_idle');
}
```

- `triggerToolCall()` 时两个 sprite 同时播放 `secretary_type`

### 2. 代码流增强

```typescript
public triggerToolCall(logs: string): Promise<void> {
  return new Promise(resolve => {
    // 多行逐行出现效果
    const lines = logs.split('\n').slice(0, 8); // 最多 8 行
    lines.forEach((line, i) => {
      const lineText = this.add.text(engX, engY - 100 + i * 18, '', {
        fontSize: '12px', color: '#00ff00', fontFamily: 'monospace',
        backgroundColor: '#000000aa'
      }).setDepth(100);
      
      // 逐行延迟出现
      this.time.delayedCall(i * 200, () => {
        lineText.setText(`> ${line}`);
        // 光标闪烁效果
        // ...
      });
    });
    // ...cleanup and resolve
  });
}
```

### 3. 签署/否决印章 sprite 化

- 检查 `ui_stamps` sprite 是否已加载（Phase 2 中已添加：frame 0 = VETO, frame 1 = APPROVED）
- 如果可用，用 sprite 替代纯文本的"批准"/"否决"
- ParliamentScene 的 `triggerVotePassed()` 已使用此 sprite，保持一致

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| MODIFY | `frontend/src/game/scenes/ExecutiveScene.ts` |

## 验证计划

1. 触发 tool_call → 两个 secretary 同时敲键盘 + 多行代码逐行流出
2. 触发 sign → 确认 sprite 印章效果（或增强的文本印章）
3. 触发 veto → 卷轴弹回 + 否决印章
4. 触发 error → 确认冒烟效果正常（双 secretary 中触发的那个变红）
