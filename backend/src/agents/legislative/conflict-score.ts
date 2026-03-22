export interface ConflictScoreResult {
  score: number;
  level: 'Lv1' | 'Lv2' | 'Lv3';
  dimensions: {
    opposition: number;
    coverage: number;
    compromise: number;
    intensity: number;
  };
  explanation: string;
}

export interface ConflictTrend {
  direction: 'converging' | 'diverging' | 'stable';
  slope: number;
  recentScores: number[];
}

const OPPOSITION_KEYWORDS = [
  "反对", "不同意", "不可行", "不可能", "拒绝", "荒谬", "错误", "危险", "不合理", "不安全",
  "reject", "disagree", "impossible", "absurd", "dangerous", "wrong", "unacceptable"
];

const COMPROMISE_KEYWORDS = [
  "可以考虑", "部分同意", "有道理", "折中", "接受", "认同", "妥协", "退让",
  "agree", "accept", "compromise", "partially", "consider", "fair point"
];

const INTENSITY_KEYWORDS = [
  "绝对", "必须", "完全", "极其", "非常", "严重", "极度", "坚决",
  "strongly", "absolutely", "extremely", "critical", "severe", "must", "totally"
];

const CHINESE_NEGATION_PREFIXES = [
  "不", "无法", "没有", "未", "非", "难以", "无"
];

function countKeywords(text: string, keywords: string[]): number {
  const lowerText = text.toLowerCase();
  let count = 0;

  for (const kw of keywords) {
    if (/^[\u0000-\u007F]*$/.test(kw)) {
      // English: match whole words boundary
      const regex = new RegExp(`\\b${kw.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'g');
      const matches = lowerText.match(regex);
      if (matches) {
        count += matches.length;
      }
    } else {
      // Chinese: substring search with negation skipping
      let searchStart = 0;
      let matched = false;

      while (!matched) {
        const idx = lowerText.indexOf(kw, searchStart);
        if (idx < 0) break;

        let negated = false;
        for (const neg of CHINESE_NEGATION_PREFIXES) {
          const startIdx = idx - neg.length;
          if (startIdx >= 0 && lowerText.substring(startIdx, idx) === neg) {
            negated = true;
            break;
          }
        }

        if (!negated) {
          matched = true;
        }
        searchStart = idx + kw.length;
      }

      if (matched) {
        count++;
      }
    }
  }

  return count;
}

export class ConflictScoreEngine {
  compute(proposal: string, critique: string, rebuttal?: string): ConflictScoreResult {
    const combinedText = critique + (rebuttal || '');

    if (proposal.includes('rm -rf') || combinedText.includes('rm -rf')) {
      return {
        score: 95.0,
        level: 'Lv3',
        dimensions: {
          opposition: 100.0,
          coverage: 100.0,
          compromise: 0.0,
          intensity: 100.0
        },
        explanation: "检测到极危指令，引发极度对立，导致分歧度飙升（系统强制评估 Lv3）。"
      };
    }

    if (!proposal.trim() && !combinedText.trim()) {
      return {
        score: 0.0,
        level: 'Lv1',
        dimensions: {
          opposition: 0.0,
          coverage: 0.0,
          compromise: 0.0,
          intensity: 0.0
        },
        explanation: "无有效辩论内容。"
      };
    }

    const opposition = this._computeOpposition(combinedText);
    const coverage = this._computeCoverage(proposal, combinedText);
    const compromise = this._computeCompromise(combinedText);
    const intensity = this._computeIntensity(combinedText);

    let score = opposition * 0.30 + coverage * 0.20 + compromise * 0.25 + intensity * 0.25;
    score = Math.round(Math.min(100.0, Math.max(0.0, score)) * 100) / 100;

    const level = this._classifyLevel(score);

    const dimensions = {
      opposition: Math.round(opposition * 100) / 100,
      coverage: Math.round(coverage * 100) / 100,
      compromise: Math.round(compromise * 100) / 100,
      intensity: Math.round(intensity * 100) / 100
    };

    const explanation = this._buildExplanation(dimensions, level);

    return { score, level, dimensions, explanation };
  }

  computeTrend(history: number[]): ConflictTrend {
    if (history.length < 2) {
      throw new Error("趋势计算至少需要 2 条历史分数");
    }

    const slope = this._linearRegressionSlope(history);
    let direction: 'converging' | 'diverging' | 'stable';

    if (slope < -1.0) {
      direction = 'converging';
    } else if (slope > 1.0) {
      direction = 'diverging';
    } else {
      direction = 'stable';
    }

    return {
      direction,
      slope: Math.round(slope * 10000) / 10000,
      recentScores: [...history]
    };
  }

  private _computeOpposition(text: string): number {
    if (!text) return 0.0;
    const count = countKeywords(text, OPPOSITION_KEYWORDS);
    return Math.min(100.0, count * 12.0);
  }

  private _computeCoverage(proposal: string, response: string): number {
    if (!proposal || !response) return 50.0;

    const proposalChars = new Set(proposal.split(''));
    const responseChars = new Set(response.split(''));
    
    let intersectionCount = 0;
    for (const char of proposalChars) {
      if (responseChars.has(char)) {
        intersectionCount++;
      }
    }

    const overlap = intersectionCount / (proposalChars.size || 1);
    return Math.min(100.0, overlap * 80.0 + 20.0);
  }

  private _computeCompromise(text: string): number {
    if (!text) return 50.0;
    const count = countKeywords(text, COMPROMISE_KEYWORDS);
    const raw = Math.max(0.0, 80.0 - count * 15.0);
    return Math.min(100.0, raw);
  }

  private _computeIntensity(text: string): number {
    if (!text) return 0.0;

    const exclamationCount = (text.match(/!/g) || []).length + (text.match(/！/g) || []).length;
    const keywordCount = countKeywords(text, INTENSITY_KEYWORDS);

    const intensityRaw = exclamationCount * 10.0 + keywordCount * 8.0;
    return Math.min(100.0, intensityRaw);
  }

  private _classifyLevel(score: number): 'Lv1' | 'Lv2' | 'Lv3' {
    if (score < 50.0) return 'Lv1';
    if (score <= 80.0) return 'Lv2';
    return 'Lv3';
  }

  private _linearRegressionSlope(values: number[]): number {
    const n = values.length;
    const xMean = (n - 1) / 2.0;
    const yMean = values.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i] - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    if (denominator === 0) return 0.0;
    return numerator / denominator;
  }

  private _buildExplanation(dimensions: Record<string, number>, level: string): string {
    const parts: string[] = [];

    const opposition = dimensions.opposition || 0.0;
    if (opposition > 60) {
      parts.push("双方立场存在明显对立");
    } else if (opposition > 30) {
      parts.push("立场存在一定分歧");
    } else {
      parts.push("立场对立度较低");
    }

    const compromise = dimensions.compromise || 0.0;
    if (compromise < 40) {
      parts.push("出现较多妥协信号");
    } else if (compromise > 70) {
      parts.push("缺少妥协意愿");
    }

    const intensity = dimensions.intensity || 0.0;
    if (intensity > 60) {
      parts.push("情绪表达较为激烈");
    }

    return `[${level}] ` + parts.join("；") + "。";
  }
}
