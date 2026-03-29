import { RulesEngine } from './rules-engine';
import { ExecutionReport } from '../../schemas/act';
import { ResultReviewResult } from '../../schemas/verdict';

export class ResultReviewer {
  private _rules: RulesEngine;

  constructor(rules: RulesEngine) {
    this._rules = rules;
  }

  public async reviewDelivery(
    petition: string,
    executionReport: ExecutionReport
  ): Promise<ResultReviewResult> {
    const outputs = executionReport.task_results
      .filter(r => r.status === 'success' && r.output)
      .map(r => r.output);
    
    // Bug 5 fix: 当无有效产出时，直接判定为最大偏离，而不是把
    // 字面量 '(无有效产出)' 传给 LLM scorer（会产生随机分数）
    if (outputs.length === 0) {
      return {
        deviation: {
          score: 1.0,
          explanation: '所有执行任务均失败，无有效产出。偏离度强制设为 1.0。',
          passed: false,
        },
        passed: false,
      };
    }

    const combinedOutput = outputs.join('\n');

    const deviation = await this._rules.checkDeviation(petition, combinedOutput);
    
    return {
      deviation,
      passed: deviation.passed,
    };
  }
}
