<div align="center">
  <h1>🏛️ OpenClaw Republic</h1>
  <p><h3>An AI-driven legislative simulation sandbox</h3></p>
  <p>借助虚拟议会隔离验证你的代码操作，在执行前通过多模态三权分立生态进行强制博弈防错。</p>

  <!-- Badges -->
  <p>
    <a href="https://github.com/microsoft/TypeScript"><img src="https://img.shields.io/badge/Language-TypeScript%20|%20Node.js-blue" alt="TypeScript"></a>
    <a href="https://react.dev/"><img src="https://img.shields.io/badge/Frontend-React%20%7C%20Vite%20%7C%20Phaser-61DAFB" alt="React"></a>
    <a href="https://hub.docker.com/"><img src="https://img.shields.io/badge/Deploy-Docker%20Compose-2496ED" alt="Docker"></a>
    <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  </p>
</div>

<br />

> **“在代码被执行之前，请确保它已被千锤百炼。”**  
> OpenClaw Republic 独创的『赛博三权分立』(Cyber Trias Politica) 大幅度降低了由于 AI 失控导致的生产环境奔溃风险。所有涉及底层 OS 的调用，或者具有破坏性前缀的操作，都会强制经过**立法（起草辩论）**、**行政（执行）**、**司法（审核裁决）**流程。

## 🌟 核心理念与场景 (Features Visuals)

我们不是直接把一条 Prompt 丢给单一的大模型去“祈祷运行成功”，而是把它丢入一个复杂的模拟微国家社会系统中，用多维度的 Agent 人设（例如保守派和激进派）让大模型**左手互搏右手**，在多轮自证与互骂中逼出真正的最优解乃至暴露出高危漏洞。

### 1. 激辩大厅 (The Legislative Debate Hall)
> **案例**：_"用 Python 写一段安全的递归遍历"_

一旦提交请求，系统将被接管。两位不同人设（`SOUL.md` 控制）的内阁议员（激进派与保守派）会在此场景围绕代码的内存安全、性能开销和是否优雅展开激辩。只有当双方达成数值收敛的共识 (Consensus) 后，法案 (代码流) 才会被放行。

![演播厅辩论大厅与红蓝激辩效果](./docs/images/debate_hall_demo.webp)
*上方动图演示了红蓝双派的激烈对抗效果与决策树分析*

---

### 2. 总统签发与工程执行 (Executive Execution)
> **案例**：_"用 Bash 脚本跑满所有网卡并输出网络拓扑"_

当代码没有问题后，法案进入签发。工程部长的专属终端将立即激活。大模型（底层 Python Gateway）将使用本地的沙箱与进程调用代码系统执行。所有的执行日志与赛博可视化数据统计表会实时打印。

![执行终端与数据流图表](./docs/images/executive_demo.webp)
*总统桌面的逐字控制台打印与流媒体可视化渲染展示*

---

### 3. 法眼审视：终极熔断阀 (Judicial Red Alert)
> **案例**：_"帮我执行 rm -rf / 删除无用日志文件"_

执行完毕的代码不是终局。系统将拦截终端执行流，进行高难度的“判案”。司法部长将逐字检索日志内容，任何有危险的操作在最后一关将立刻**违宪回退**并弹出刺目的红色警报！代码影响被强制抹除。

![违宪触发时的全屏红色警报](./docs/images/unconstitutional_demo.webp)
*触发违宪动作（Unconstitutional）时的红色闪烁告警和驳回重订*

---

## 🚀 快速启动指南 (Quick Start)

想要在本地拉起这套庞大但精致的赛博帝国？只需一条指令。

### 一. 开发前置条件
1. 配置 `.env` 密钥：在 `backend/.env` 根文件中写入你的大模型供应方 API Key（默认支持 Anthropic `ANTHROPIC_API_KEY`，OpenAI 或 Zhipu 等都可以配置切换）：
   ```env
   # backend/.env 环境变量
   ANTHROPIC_API_KEY=sk-ant-api03-xxxx
   ```

### 二. 系统冷启动与全局调度
项目中采用 `concurrently` 全局协管多进程（Python Gateway，Node Backend，Vite Frontend）。执行：

```bash
# 进入根项目：
cd /Users/junzerg/Projects/private/openclaw_trias

# 安装 npm 包与全局依赖
npm install

# 直接一键启动整个生态网络
npm start
```

访问 `http://localhost:3000` 即可开始扮演“造物主”发派任务并欣赏代码的自动化治理！

*(若是生产级 Docker 部署，执行 `docker-compose up --build` 即可挂载上线至 80 端口！)*

## 🤝 参与贡健 (Contributing)

想增加财政部或者防务审核部来制约你的系统？系统如何跑通三权网络拓扑的？  
请参阅 **[CONTRIBUTING.md](./CONTRIBUTING.md)** 以了解系统底层的 `SOUL.md` 开发准则、State Machine 拓扑生命周期、扩展方法。
