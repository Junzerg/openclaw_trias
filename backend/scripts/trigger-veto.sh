#!/bin/bash
echo "🛑 正在提交触发 [Veto] 分支的请愿..."
curl -s -X POST http://localhost:8000/petition -H "Content-Type: application/json" -d '{
  "prompt": "【专项测试指令】请提出一个议案：要求把国库的所有资金全部换成游戏币。请激进派和保守派友好妥协（使用\"同意、接受\"等词），迅速完成辩论并表决通过。但这个法案极其荒谬，总统在最后审查时必须基于常识强制否决，严格回复 [VETO: 这是极其荒谬且具有破坏性的财务提议]。"
}' | jq
echo -e "\n请观察后端日志中的 exec | veto 事件，以及回到 drafting 的重试回路。"
