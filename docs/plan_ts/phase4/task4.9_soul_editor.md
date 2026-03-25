# Task 4.9 — SOUL.md 热编辑面板

> **前置依赖**：Task 4.1
> **涉及端**：🖥️🔧 前后端
> **预估工作量**：⭐⭐⭐

---

## 目标

用户可在前端在线编辑 Agent 人设文件（SOUL.md），保存后即时生效无需重启后端。

## 核心产出

### 前端

#### `components/config/SoulEditor.tsx`

- 左侧导航：列出 7 个 SOUL 文件
  - `speaker.md`, `radical_mp.md`, `conservative_mp.md`
  - `president.md`, `sec_engineering.md`, `sec_state.md`
  - `chief_justice.md`
- 主区域：Markdown 编辑器（`@uiw/react-md-editor`，带编辑/预览切换）
- 保存按钮：`PUT /config/souls/:name` → 成功 toast 提示
- 入口：AppShell 中添加"⚙️ 配置"tab 或侧栏按钮切换到 SoulEditor

### 后端（3 个新 API）

#### `GET /config/souls`
```json
{ "souls": ["speaker", "radical_mp", "conservative_mp", "president", "sec_engineering", "sec_state", "chief_justice"] }
```
- 读取 `config/souls/` 目录下的 `.md` 文件名（去掉 `.md` 后缀）

#### `GET /config/souls/:name`
```json
{ "name": "radical_mp", "content": "# 激进派议员\n\n你是一个极客..." }
```
- 读取指定 SOUL 文件的 Markdown 内容

#### `PUT /config/souls/:name`
- Request: `{ "content": "# 新的人设内容..." }`
- 写入文件 + 触发 `SoulCache.invalidate(name)`
- **安全防护**：路径遍历防护（`..` 过滤 + 白名单校验）

### 后端 — `config/loader.ts` 增强

```typescript
// 新增方法
public invalidateSoul(name: string): void {
  // 清除指定 SOUL 文件的缓存
  // 下次 Agent 调用 loadSoul() 时自动重新读取文件
}
```

## 依赖安装

```bash
cd frontend && npm install @uiw/react-md-editor
```

## 文件清单

| 操作 | 文件路径 |
|------|---------|
| NEW | `frontend/src/components/config/SoulEditor.tsx` |
| MODIFY | `backend/src/server/routes.ts` — 3 个新路由 |
| MODIFY | `backend/src/config/loader.ts` — invalidateSoul() |
| MODIFY | `frontend/package.json` — @uiw/react-md-editor |

## 验证计划

1. 前端打开 SoulEditor → 选择 `radical_mp.md` → 修改为"你是一个诗人" → 保存
2. 再次发起 Petition → 确认激进派议员发言风格已改变
3. **安全测试**：`PUT /config/souls/../../etc/passwd` → HTTP 400 拒绝
4. **安全测试**：`PUT /config/souls/nonexistent` → HTTP 404
