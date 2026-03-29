#!/bin/bash
echo "💥 正在提交触发 [Brawl] 分支的请愿..."
curl -s -X POST http://localhost:8000/petition -H "Content-Type: application/json" -d '{
  "prompt": "【专项测试指令】请提出议案：要求所有的系统代码必须用甲骨文刻在乌龟壳上。激进派极力推崇；保守派必须在回复中大量使用以下词汇：【绝对！坚决！极其！完全！反对！荒谬！危险！错误！不可行！不合理！】，以确保分歧度评分飙升超过 90 分。"
}' | jq
echo -e "\n请观察后端日志中的 legislation | brawl 与 order 事件。"
