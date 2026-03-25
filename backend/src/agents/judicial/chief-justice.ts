import { randomUUID } from 'node:crypto';
import { BaseAgent, Branch, Permission } from '../base';
import { ConstitutionConfig } from '../../config/models';
import { ExecutionEvent, EventAction, JudgmentEvent } from '../../schemas/events';
import { ExecutionReport } from '../../schemas/act';
import { ProcessReviewResult, Verdict, ViolationType, KillReport } from '../../schemas/verdict';
import { RulesEngine, DeviationScorer } from './rules-engine';
import { ProcessReviewer } from './process-reviewer';
import { ResultReviewer } from './result-reviewer';
import { KillSwitch } from './kill-switch';
import { OpenClawAdapter } from '../../openclaw/adapter';
import { MessageBus } from '../../bus/message-bus';

export class ChiefJustice extends BaseAgent {
  private _rules: RulesEngine;
  private _processReviewer: ProcessReviewer;
  private _resultReviewer: ResultReviewer;
  private _killSwitch: KillSwitch;

  constructor(
    constitution: ConstitutionConfig,
    adapter: OpenClawAdapter,
    bus?: MessageBus,
    customDeviationScorer?: DeviationScorer
  ) {
    super(
      'Chief Justice',
      'chief_justice',
      Branch.JUDICIAL,
      [Permission.MONITOR, Permission.KILL],
      adapter,
      bus
    );

    const deviationScorer = customDeviationScorer || this._createDeviationScorer();

    this._rules = new RulesEngine(constitution, deviationScorer);
    this._processReviewer = new ProcessReviewer(this._rules);
    this._resultReviewer = new ResultReviewer(this._rules);
    this._killSwitch = new KillSwitch();
  }

  private _createDeviationScorer(): DeviationScorer {
    const MAX_SCORER_RETRIES = 2;
    const SAFE_DEFAULT_SCORE = 1.0; // 安全默认：最大偏离（LLM 不可达时宁可误判违宪，不可放过）

    return async (petition: string, output: string): Promise<number> => {
      const prompt = `
请作为最高法院的大法官，严格审查执行产出与选民原始请愿的匹配度。

选民请求 (Petition):
"""
${petition}
"""

执行产出 (Output):
"""
${output}
"""

请评估执行产出偏离选民请求的严重程度（Deviation Score）。
0.0 表示完全满足，毫无偏离（完美）。
1.0 表示彻底偏离，或产生了与请求无关、甚至相反的结果。

你必须返回一段合法的 JSON，不要包含任何其他说明文字或 Markdown 格式包裹（不要返回 \`\`\`json 等）。
JSON 格式如下：
{
  "score": <0.0 到 1.0 之间的数字>,
  "reason": "<在此填写严厉的审查摘要>"
}
`;

      for (let attempt = 1; attempt <= MAX_SCORER_RETRIES; attempt++) {
        try {
          const response = await this.callLLM(prompt);
          const content = response.content.trim();
          // Sometimes LLMs still wrap in ```json ... ``` despite instructions
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          const jsonStr = jsonMatch ? jsonMatch[0] : content;

          const parsed = JSON.parse(jsonStr);
          if (parsed && parsed.score !== undefined) {
            const numScore = Number(parsed.score);
            if (!isNaN(numScore)) return numScore;
          }
          // JSON parsed but no valid score — try again
          console.warn(`[ChiefJustice] Deviation scorer: valid JSON but missing score (attempt ${attempt}/${MAX_SCORER_RETRIES})`);
        } catch (err) {
          console.warn(
            `[ChiefJustice] Deviation scorer parse error (attempt ${attempt}/${MAX_SCORER_RETRIES}):`,
            err instanceof Error ? err.message : err,
          );
          // If we still have retries left, try again
          if (attempt < MAX_SCORER_RETRIES) continue;
        }
      }

      // All retries exhausted — use safe default (no deviation → constitutional)
      console.warn(`[ChiefJustice] Deviation scorer exhausted ${MAX_SCORER_RETRIES} retries, using safe default score ${SAFE_DEFAULT_SCORE}`);
      return SAFE_DEFAULT_SCORE;
    };
  }

  public async monitorExecution(event: ExecutionEvent): Promise<ProcessReviewResult> {
    this.requirePermission(Permission.MONITOR);
    return await this._processReviewer.reviewAction(event);
  }

  /**
   * Bug 23 fix: 重置 ProcessReviewer 的操作历史。
   * 在每次新 Act 执行前调用，防止跨 Act 的死循环误报。
   */
  public resetProcessHistory(): void {
    this._processReviewer.reset();
  }

  public async reviewResult(petition: string, executionReport: ExecutionReport): Promise<Verdict> {
    this.requirePermission(Permission.MONITOR);

    // Bug 44 fix: 不对 petition（用户自然语言请求）做黑名单检测。
    // petition 是用户的请愿问题（如"请解释 rm -rf 命令的危害"），不是实际命令。
    // 改为对执行产出做黑名单检测 — 如果执行产出包含危险指令，才判定违宪。
    for (const taskResult of executionReport.task_results) {
      if (taskResult.status === 'success' && taskResult.output) {
        const outputCheck = this._rules.checkCommand(taskResult.output);
        if (!outputCheck.passed) {
          return {
            verdict_id: randomUUID(),
            act_id: executionReport.act_id,
            constitutional: false,
            ruling: `执行产出中发现危险指令！严重违反 OpenClaw 第 1 条宪法安全底线：${outputCheck.violation_detail}。已紧急下达熔断指令。`,
            violation_type: ViolationType.BLACKLIST_COMMAND,
            evidence: [`执行产出中发现危险内容: ${taskResult.output.substring(0, 200)}`],
            remediation: '立即停止所有相关操作，并对系统进行安全审计。',
            created_at: new Date()
          };
        }
      }
    }

    const resultReview = await this._resultReviewer.reviewDelivery(petition, executionReport);

    if (resultReview.passed) {
      return {
        verdict_id: randomUUID(),
        act_id: executionReport.act_id,
        constitutional: true,
        ruling: '执行结果合宪，偏离度在允许范围内',
        evidence: [],
        result_review: resultReview,
        created_at: new Date()
      };
    }

    return {
      verdict_id: randomUUID(),
      act_id: executionReport.act_id,
      constitutional: false,
      ruling: '执行结果违宪，产出偏离度超标',
      violation_type: ViolationType.DEVIATION_EXCEEDED,
      evidence: [resultReview.deviation.explanation],
      result_review: resultReview,
      remediation: '建议立法分支细化请愿描述并重做',
      created_at: new Date()
    };
  }

  public async issueJudgment(verdict: Verdict): Promise<JudgmentEvent> {
    let killReport: KillReport | undefined;

    if (!verdict.constitutional) {
      this.requirePermission(Permission.KILL);
      killReport = await this._killSwitch.execute(verdict);
    }

    const action = verdict.constitutional ? EventAction.CONSTITUTIONAL : EventAction.UNCONSTITUTIONAL;
    const eventPayload: any = {
      kill_report: killReport,
      verdict: verdict,
      violation_type: verdict.violation_type,
      ruling: verdict.ruling,
      reason: verdict.ruling,
      traceback: killReport ? JSON.stringify(killReport) : undefined,
      evidence: verdict.evidence || []
    };

    // 严格使用 this.emitEvent, 强制组装 JudgmentEvent 契约
    const { event } = this.emitEvent(
      action,
      eventPayload,
      'speaker',
      verdict.act_id
    );

    return event as JudgmentEvent;
  }

  public async act(message: unknown): Promise<unknown> {
    const msg = message as Record<string, unknown>;
    if (msg?.action && msg.tool_name !== undefined) {
      return await this.monitorExecution(msg as ExecutionEvent);
    }
    throw new TypeError(`ChiefJustice 不支持处理该类型消息`);
  }
}
