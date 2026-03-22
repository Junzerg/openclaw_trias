import { KillReport, Verdict } from '../../schemas/verdict';

export class KillSwitch {
  /**
   * 物理熔断 — 违宪判定后的强制终止与回滚。
   */
  public async execute(verdict: Verdict): Promise<KillReport> {
    const killed = [`mock_process_${verdict.act_id}`];
    const rollback_ok = true;

    const doc = this._generateJudgmentDocument(verdict);

    return {
      verdict: verdict,
      killed_processes: killed,
      rollback_success: rollback_ok,
      judgment_document: doc,
    };
  }

  private _generateJudgmentDocument(verdict: Verdict): string {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const lines = [
      '============================================================',
      '       JUDGMENT OF THE SUPREME COURT',
      '============================================================',
      `判决编号: ${verdict.verdict_id}`,
      `法案编号: ${verdict.act_id}`,
      `判决时间: ${now}`,
      '------------------------------------------------------------',
      `判决结果: ${verdict.constitutional ? '合宪 (CONSTITUTIONAL)' : '违宪 (UNCONSTITUTIONAL)'}`,
      `判决摘要: ${verdict.ruling}`,
    ];

    if (verdict.violation_type) {
      lines.push(`违宪类型: ${verdict.violation_type}`);
    }

    if (verdict.evidence && verdict.evidence.length > 0) {
      lines.push('------------------------------------------------------------');
      lines.push('证据:');
      verdict.evidence.forEach((ev, i) => {
        lines.push(`  ${i + 1}. ${ev}`);
      });
    }

    if (verdict.remediation) {
      lines.push('------------------------------------------------------------');
      lines.push(`补救建议: ${verdict.remediation}`);
    }

    lines.push('============================================================');
    return lines.join('\n');
  }
}
