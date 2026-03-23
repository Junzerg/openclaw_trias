import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CyberGovernment } from './government';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log("=============================================");
  console.log("       🏛️ OpenClaw Republic - Phase 1       ");
  console.log("          Terminal Mock End-to-End         ");
  console.log("=============================================\n");

  const configDir = resolve(__dirname, '../../config');
  
  console.log(">>> [System] 初始化中央政府与部门...");
  const gov = new CyberGovernment(configDir);
  
  console.log(">>> [System] 启动消息总线...");
  await gov.inaugurate();

  // 挂载一个额外的全局监听器，以便我们清晰看到前端会收到什么类型的数据
  console.log(">>> [System] 挂载 WebSocket 模拟监听器...");
  let wsEventCount = 0;
  const topics = ['legislation', 'execution', 'judiciary', 'lifecycle'] as const;
  for (const topic of topics) {
    gov.bus.subscribe(topic, (event) => {
      wsEventCount++;
      console.log(`\n[WebSocket 推送 - ${topic.toUpperCase()}]`);
      console.log(JSON.stringify(event, null, 2));
    });
  }

  const petition = "帮我写一个 Python 的 HelloWorld 本地终端程序并运行它";
  console.log(`\n📜 [选民请愿] 提交法案诉求: "${petition}"\n`);
  
  console.log("------------------ PIPELINE 开始 ------------------");
  const result = await gov.receivePetition(petition, 1);
  console.log("------------------ PIPELINE 结束 ------------------\n");

  console.log("🎉 [最终交付结果]:");
  console.log(result);

  console.log(`\n[统计] 运行期间共广播了 ${wsEventCount} 个 WebSocket 级事件。`);

  console.log("\n>>> [System] 关闭政府...");
  await gov.shutdown();
}

main().catch(console.error);
