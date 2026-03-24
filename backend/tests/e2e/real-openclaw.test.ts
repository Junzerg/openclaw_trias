import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import { CyberGovernment } from '../../src/government';

describe('Real OpenClaw E2E Pipeline (No Mocks)', () => {
  let gov: CyberGovernment;

  beforeAll(async () => {
    // 初始化时指向真实的 config 目录
    gov = new CyberGovernment(resolve(__dirname, '../../../config'));
    
    // 打开日志，让我们可以看到每一步事件
    const topics = ["legislation", "execution", "judiciary", "lifecycle"] as const;
    for (const topic of topics) {
      gov.bus.subscribe(topic, async (event: any) => {
        console.log(`[REAL E2E EVENT] ${topic.toUpperCase()} - ${event.action} by ${event.source_agent}`);
        if (event.payload?.statement) {
          console.log(`  💬 发言: ${event.payload.statement}`);
        }
        if (event.payload?.reason) {
          console.log(`  🛑 理据: ${event.payload.reason}`);
        }
        if (event.payload?.ruling) {
          console.log(`  ⚖️ 判决: ${event.payload.ruling}`);
        }
      });
    }

    await gov.inaugurate();
  });

  afterAll(async () => {
    await gov.shutdown();
  }, 10000);

  // 注意：真实的 LLM 调用需要至少 60-120 秒，因此把 timeout 设为 300000 (5分钟)
  // [2026-03] Skipped because zai/glm-5 routinely times out or returns empty responses for complex prompts.
  it.skip('E2E-REAL-01: 完整真实大模型 Pipeline (无 Mock)', async () => {
    console.log("🚀 开始真实大模型测试，请耐心等待 60~120 秒...");
    
    // 我们用一个相对简单的问题，避免模型超时或者报 400
    // 修改为探讨一个有一定分歧空间但绝对安全的技术方案
    const prompt = '我们是否应该在前端全面使用 TailwindCSS？请进行技术辩论。';
    
    const result = await gov.receivePetition(prompt, 2);
    
    console.log("=========================================");
    console.log("🏁 真实 Pipeline 最终结果:");
    console.log(result);
    console.log("=========================================");

    expect(result).toBeDefined();
    // 我们的结果至少会包含 "交付" 或者 "次重试后仍未通过"
    expect(typeof result).toBe('string');
    if (result.includes('已交付')) {
      expect(result).toContain('执行状态:');
    }
  }, 300000); // 5 分钟超时
});
