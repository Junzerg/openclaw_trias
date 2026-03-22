# Phase 6 · 极致发布 (`import antigravity`)

> **目标**：致敬 Python 极客精神，实现 PRD 的终极飞行体验。
> **前置依赖**：Phase 5（端到端集成完成）
> **预估复杂度**：⭐ 低
> **优先级**：🟢 收尾

---

## 6.1 极简启动脚本

实现 PRD §6.3 描述的终极体验：

```python
from openclaw_republic import CyberGovernment
from openclaw_republic.config import load_constitution

# 载入宪法（全局红线配置）与 SOUL 矩阵
republic = CyberGovernment(constitution=load_constitution("constitution.yaml"))

# 核心魔法：一行代码启动整个国家的引擎，并自动弹开浏览器进入 8-bit 演播厅
import antigravity

if __name__ == "__main__":
    republic.inaugurate(port=8080)  # inaugurate: 举行总统就职典礼
```

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 6.1.1 | **`CyberGovernment` 入口类** | 封装后端 + 前端 + WebSocket 的一键启动 |
| 6.1.2 | **`load_constitution()` API** | 宪法配置加载：校验 + 返回 Pydantic 模型 |
| 6.1.3 | **`inaugurate()` 方法** | 启动 FastAPI 服务 + 自动打开浏览器进入演播厅 |
| 6.1.4 | **CLI 入口** | `python -m openclaw_republic` 或 `openclaw-republic run` |

---

## 6.2 一键部署

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 6.2.1 | **Docker Compose** | 后端 (Python) + 前端 (Node/Static) + 反向代理 (Nginx/Caddy) |
| 6.2.2 | **Dockerfile (后端)** | 多阶段构建，`pip install openclaw-republic` |
| 6.2.3 | **Dockerfile (前端)** | Vite 构建 → Nginx 静态服务 |
| 6.2.4 | **环境变量模板** | `.env.example`：LLM API Key、端口、日志级别等 |

---

## 6.3 README & 文档

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 6.3.1 | **README 美化** | 项目介绍 + GIF 演示 + 快速上手 + 架构图 |
| 6.3.2 | **二创指南** | 如何编写自定义 SOUL.md：给官员换脑子教程 |
| 6.3.3 | **constitution.yaml 指南** | 如何调整宪法红线配置 |
| 6.3.4 | **架构文档** | 三权分立架构图 (Mermaid)、状态机流程图 |
| 6.3.5 | **API 文档** | FastAPI 自动生成 + 补充说明 |

---

## 6.4 PyPI 发布

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 6.4.1 | **包元数据** | `pyproject.toml` 完善：描述、分类、关键词、许可证 |
| 6.4.2 | **构建 & 发布** | `python -m build` + `twine upload` |
| 6.4.3 | **版本管理** | 语义化版本，CHANGELOG.md |

---

## 6.5 开源宣发

| 序号 | 工作项 | 说明 |
|------|--------|------|
| 6.6.1 | **GitHub Release** | Tag + Release Notes + 预编译资源 |
| 6.6.2 | **Demo 文章** | 技术博客 / 掘金 / 知乎专栏 |
| 6.6.3 | **录屏 & 截图** | 议员吵架名场面 GIF、全流程演示视频 |
| 6.6.4 | **社区推广** | HackerNews / Reddit / V2EX / Twitter |

---

## 验收标准

- [ ] `pip install openclaw-republic` 可安装
- [ ] 三行代码可启动整个系统并自动打开浏览器
- [ ] `docker compose up` 一键全栈部署
- [ ] README 包含 GIF 演示和快速上手指南
- [ ] PyPI 包发布成功
- [ ] 社区至少一篇推广文章发布

---

## 后续衔接

- ← 前置：[Phase 5 · 集成 & UX](../phase5/phase5_overview.md)
- 🎉 **项目完成** — 赛博共和国正式建国！
