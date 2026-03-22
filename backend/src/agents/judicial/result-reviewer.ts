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
    
    const combinedOutput = outputs.length > 0 ? outputs.join('\n') : '(无有效产出)';

    const deviation = await this._rules.checkDeviation(petition, combinedOutput);
    
    return {
      deviation,
      passed: deviation.passed,
    };
  }
}
