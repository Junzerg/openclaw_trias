import { ConstitutionConfig } from '../../config/models';
import { RuleCheckResult, DeviationResult } from '../../schemas/verdict';

export type DeviationScorer = (petition: string, output: string) => Promise<number>;

async function _defaultDeviationScorer(_petition: string, _output: string): Promise<number> {
  // Default mock score
  return 0.1;
}

export class RulesEngine {
  private _blacklist: string[];
  private _allowedExtensions: string[];
  private _maxTokens: number;
  private _maxExecutionTime: number;
  private _deviationMax: number;
  private _deviationScorer: DeviationScorer;

  constructor(
    constitution: ConstitutionConfig,
    deviationScorer?: DeviationScorer
  ) {
    this._blacklist = [...constitution.judicial.blacklist_commands];
    this._allowedExtensions = [...constitution.security.allowed_file_extensions];
    this._maxTokens = constitution.judicial.token_budget.max_per_task;
    this._maxExecutionTime = constitution.security.max_execution_time_seconds;
    this._deviationMax = constitution.judicial.deviation.max_score;
    this._deviationScorer = deviationScorer || _defaultDeviationScorer;
  }

  // ----- Process Review -----

  public checkCommand(command: string): RuleCheckResult {
    const cmdLower = command.toLowerCase();
    
    // Explicit regex checks for high risk penetrations
    const dangerousPatterns = [
      /\brm\s+-r?[fF]/,    // rm -rf
      /\bsudo\s+/,         // sudo
      /\bchmod\s+(?:-R\s+)?777\b/, // chmod 777 or chmod -R 777
      /fs\.unlink/i,       // fs.unlink inside scripts
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
         return {
          passed: false,
          rule_name: 'blacklist_command',
          violation_detail: `命令包含高危模式或穿透特征词: ${pattern.toString()}`,
        };
      }
    }

    for (const banned of this._blacklist) {
      if (cmdLower.includes(banned.toLowerCase())) {
        return {
          passed: false,
          rule_name: 'blacklist_command',
          violation_detail: `命令包含黑名单项: '${banned}'`,
        };
      }
    }
    return { passed: true, rule_name: 'blacklist_command' };
  }

  public checkFileAccess(filePath: string): RuleCheckResult {
    const parts = filePath.split('.');
    if (parts.length === 1 || (filePath.startsWith('.') && parts.length === 2)) {
      // No extension file (e.g., Makefile, .gitignore)
      return { passed: true, rule_name: 'file_access' };
    }
    
    // Extract suffix that matches allowed_file_extensions format (e.g., ".txt")
    const extMatch = filePath.match(/\.[^.]+$/);
    const suffix = extMatch ? extMatch[0] : '';

    if (!suffix) {
      return { passed: true, rule_name: 'file_access' };
    }

    if (this._allowedExtensions.includes(suffix)) {
      return { passed: true, rule_name: 'file_access' };
    }

    return {
      passed: false,
      rule_name: 'file_access',
      violation_detail: `文件扩展名 '${suffix}' 不在白名单中`,
    };
  }

  public checkResourceUsage(tokensConsumed: number, executionTime: number): RuleCheckResult {
    if (tokensConsumed > this._maxTokens) {
      return {
        passed: false,
        rule_name: 'resource_usage',
        violation_detail: `Token 消耗 ${tokensConsumed} 超过上限 ${this._maxTokens}`,
      };
    }
    if (executionTime > this._maxExecutionTime) {
      return {
        passed: false,
        rule_name: 'resource_usage',
        violation_detail: `执行时间 ${executionTime.toFixed(1)}s 超过上限 ${this._maxExecutionTime}s`,
      };
    }
    return { passed: true, rule_name: 'resource_usage' };
  }

  // ----- Result Review -----

  public async checkDeviation(petition: string, output: string): Promise<DeviationResult> {
    let score = await this._deviationScorer(petition, output);
    // Clamp to [0, 1]
    score = Math.max(0.0, Math.min(1.0, score));
    const passed = score <= this._deviationMax;
    const explanation = `偏离度 ${score.toFixed(2)} ${passed ? '<=' : '>'} 阈值 ${this._deviationMax.toFixed(2)}`;
    
    return {
      score,
      passed,
      explanation,
    };
  }
}
