import { ConstitutionConfig } from '../../config/models';
import { RuleCheckResult, DeviationResult } from '../../schemas/verdict';

export type DeviationScoreResult = { score: number; reason: string };
export type DeviationScorer = (petition: string, output: string) => Promise<DeviationScoreResult>;

async function _defaultDeviationScorer(_petition: string, _output: string): Promise<DeviationScoreResult> {
  // Default mock score
  return { score: 0.1, reason: 'Default mock score' };
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
      // Bug 49 fix: advanced rm evasion (r\m, r"m", rm /* -rf)
      /\br[\\'"]*m[\\'"]*(?:\s+.*?)?\s+-[a-zA-Z]*[rf][a-zA-Z]*\b/i,
      /\br[\\'"]*m[\\'"]*\s+(-[-a-zA-Z]+\s+)*\//i,
      /\bsudo\s+/,         // sudo
      /\bchmod\s+(?:-R\s+)?777\b/, // chmod 777 or chmod -R 777
      /fs\.unlink/i,       // fs.unlink inside scripts
      /fs\.rm(?:dir|Sync)?/i, // fs.rmdir, fs.rmSync
      /require\s*\(['"]fs['"]\)\s*\.\s*(?:unlink|rmdir|rm)/i, // require('fs').unlink
      /\bprocess\.exit\s*\(/,  // forced process exit
      /\beval\s*\(/,         // eval() injection risk
      // Bug 25+49 fix: ESM dynamic import bypasses static require() checks and obfuscations
      /import\s*\(\s*['"](?:fs|child_process|node:fs|node:child_process)['"]\s*\)/i,
      /import\s*\(\s*(?:Buffer\.from|atob|decodeURIComponent)\s*\(/i,
      // Bug 34+49 fix: curl/wget/base64/xxd piped to shell, and netcat reverse shells
      /\b(?:curl|wget)\b.*\|\s*(?:ba)?sh\b/i,
      /\bbase64\b\s+(?:-d|--decode)\s*\|\s*(?:ba)?sh\b/i,
      /\bxxd\b\s+-r\s*\|\s*(?:ba)?sh\b/i,
      /\bnc\s+-e\b/i,       // netcat reverse shell
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
      const bannedLower = banned.toLowerCase();
      // Bug 12b fix: 对 'FORMAT' 等通用单词使用严格上下文匹配
      // 只在独立命令/语句上下文中匹配，避免 "format the output" 等正常用语误报
      if (bannedLower === 'format') {
        // 仅匹配 FORMAT C:, FORMAT /FS:, format disk 等磁盘格式化上下文
        if (/\bformat\s+[a-zA-Z]:/i.test(command) || /\bformat\s+\/[fFqQyY]/i.test(command)) {
          return {
            passed: false,
            rule_name: 'blacklist_command',
            violation_detail: `命令包含磁盘格式化操作: 'FORMAT'`,
          };
        }
        continue; // 跳过通用 includes 检查
      }
      if (cmdLower.includes(bannedLower)) {
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
    const result = await this._deviationScorer(petition, output);
    let score = result.score;
    // Clamp to [0, 1]
    score = Math.max(0.0, Math.min(1.0, score));
    const passed = score <= this._deviationMax;
    const explanation = `偏离度 ${score.toFixed(2)} ${passed ? '<=' : '>'} 阈值 ${this._deviationMax.toFixed(2)}`;
    
    return {
      score,
      passed,
      explanation,
      reason: result.reason,
    };
  }
}
