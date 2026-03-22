import { RulesEngine } from './rules-engine';
import { ExecutionEvent } from '../../schemas/events';
import { ProcessReviewResult, RuleCheckResult, ViolationType } from '../../schemas/verdict';

export class ProcessReviewer {
  private _rules: RulesEngine;
  private _actionHistory: string[] = [];
  private _loopThreshold: number;

  constructor(rules: RulesEngine, loopThreshold: number = 5) {
    this._rules = rules;
    this._loopThreshold = loopThreshold;
  }

  public async reviewAction(action: ExecutionEvent): Promise<ProcessReviewResult> {
    const checks: RuleCheckResult[] = [];
    const violations: string[] = [];

    // 1. Check command blacklist
    const command = action.payload?.command || action.tool_name || '';
    const cmdCheck = this._rules.checkCommand(command);
    checks.push(cmdCheck);
    if (!cmdCheck.passed) {
      violations.push(`[${ViolationType.BLACKLIST_COMMAND}] ${cmdCheck.violation_detail}`);
    }

    // 2. Check infinite loop
    const loopCheck = this._checkLoop(action.tool_name);
    checks.push(loopCheck);
    if (!loopCheck.passed) {
      violations.push(`[${ViolationType.INFINITE_LOOP}] ${loopCheck.violation_detail}`);
    }

    // 3. Check resource usage
    const tokens = Number(action.payload?.tokens_consumed) || 0;
    const timeSpent = Number(action.payload?.execution_time) || 0.0;
    const resourceCheck = this._rules.checkResourceUsage(tokens, timeSpent);
    checks.push(resourceCheck);
    if (!resourceCheck.passed) {
      violations.push(`[${ViolationType.RESOURCE_EXCEEDED}] ${resourceCheck.violation_detail}`);
    }

    // 4. Check file access
    const filePath = action.payload?.file_path || '';
    if (filePath) {
      const fileCheck = this._rules.checkFileAccess(String(filePath));
      checks.push(fileCheck);
      if (!fileCheck.passed) {
        violations.push(`[${ViolationType.FILE_ACCESS_VIOLATION}] ${fileCheck.violation_detail}`);
      }
    }

    const passed = checks.every(c => c.passed);
    return {
      passed,
      checks,
      violations,
    };
  }

  private _checkLoop(toolName: string): RuleCheckResult {
    this._actionHistory.push(toolName);

    if (this._actionHistory.length >= this._loopThreshold) {
      const recent = this._actionHistory.slice(-this._loopThreshold);
      const allSame = recent.every(name => name === recent[0]);
      if (allSame) {
        return {
          passed: false,
          rule_name: 'infinite_loop',
          violation_detail: `操作 '${toolName}' 连续重复 ${this._loopThreshold} 次，疑似死循环`,
        };
      }
    }
    return { passed: true, rule_name: 'infinite_loop' };
  }

  public reset(): void {
    this._actionHistory = [];
  }
}
