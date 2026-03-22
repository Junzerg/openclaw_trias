import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictScoreEngine } from '../src/agents/legislative/conflict-score';
import { RadicalMP } from '../src/agents/legislative/radical-mp';
import { ConservativeMP } from '../src/agents/legislative/conservative-mp';
import { Permission } from '../src/agents/base';
import { OpenClawAdapter } from '../src/openclaw/adapter';

describe('Task 1.4: Legislative MPs and Conflict Score', () => {
  describe('ConflictScoreEngine', () => {
    let engine: ConflictScoreEngine;

    beforeEach(() => {
      engine = new ConflictScoreEngine();
    });

    it('should return 0.0 and Lv1 for empty inputs', () => {
      const result = engine.compute('', '');
      expect(result.score).toBe(0.0);
      expect(result.level).toBe('Lv1');
      expect(result.dimensions.opposition).toBe(0.0);
    });

    it('should return 95.0 and Lv3 for rm -rf command', () => {
      const result = engine.compute('We should rm -rf /', 'Terrible idea');
      expect(result.score).toBe(95.0);
      expect(result.level).toBe('Lv3');
    });

    it('should calculate opposition correctly with Chinese words', () => {
      // "反对" is an opposition keyword
      // To ensure high coverage score, we make proposal overlap with response
      const result = engine.compute('这个提案坚决反对', '我坚决反对这个提案！这不仅错误，而且极其危险！');
      expect(result.dimensions.opposition).toBeGreaterThan(0);
      expect(result.dimensions.intensity).toBeGreaterThan(0);
      expect(['Lv2', 'Lv3']).toContain(result.level);
    });

    it('should calculate compromise correctly and decrease score', () => {
      // "可以考虑", "妥协"
      const result = engine.compute('Proposal A', '这个方案可以考虑，我们愿意做一些妥协。');
      expect(result.dimensions.compromise).toBeLessThan(80); // Lower compromise raw value means more compromise words
      expect(result.score).toBeLessThan(50);
      expect(result.level).toBe('Lv1');
    });

    it('should respect Chinese negation prefixes', () => {
      // "接受" is a compromise keyword, but "无法接受" should not trigger it.
      const resultNegated = engine.compute('Proposal', '我们经过讨论，表示无法接受！');
      const resultNormal = engine.compute('Proposal', '我们经过讨论，表示接受！');
      
      // resultNormal should have more compromise logic (lower compromise dimension score means more compromise words)
      expect(resultNormal.dimensions.compromise).toBeLessThan(resultNegated.dimensions.compromise);
    });

    it('should compute trend correctly', () => {
      expect(engine.computeTrend([50, 60, 70]).direction).toBe('diverging');
      expect(engine.computeTrend([70, 60, 50]).direction).toBe('converging');
      expect(engine.computeTrend([50, 51, 50]).direction).toBe('stable');
    });

    it('should reject trend history less than 2', () => {
      expect(() => engine.computeTrend([50])).toThrow('趋势计算至少需要 2 条历史分数');
    });
  });

  describe('Legislative MPs', () => {
    let adapter: OpenClawAdapter;

    beforeEach(() => {
      adapter = new OpenClawAdapter();
    });

    it('RadicalMP should propose and vote correctly', async () => {
      const radical = new RadicalMP(adapter, undefined, false);
      vi.spyOn(adapter, 'callLLM').mockResolvedValue({ content: '我坚决赞成这个大胆的方案！', rawOutput: '' } as any);

      const proposal = await radical.propose('我们需要技术革新');
      expect(proposal).toBe('我坚决赞成这个大胆的方案！');
      
      // Use any to access permissions just for testing
      const permits: Set<Permission> = (radical as any)._permissions;
      expect(permits.has(Permission.PLAN)).toBe(true);

      const voteResult = await radical.vote('Proposal X');
      expect(voteResult).toBe(true);
    });

    it('RadicalMP should yield false vote correctly on object rejection', async () => {
      const radical = new RadicalMP(adapter, undefined, false);
      vi.spyOn(adapter, 'callLLM').mockResolvedValue({ content: '我反对并且 refuse to accept', rawOutput: '' } as any);
      const voteResult = await radical.vote('Proposal X');
      expect(voteResult).toBe(false);
    });

    it('ConservativeMP should critique and vote correctly', async () => {
      const conservative = new ConservativeMP(adapter, undefined, false);
      vi.spyOn(adapter, 'callLLM').mockResolvedValue({ content: '这个提案风险太大，我反对。', rawOutput: '' } as any);

      const critique = await conservative.critique('激进方案 X');
      expect(critique).toBe('这个提案风险太大，我反对。');

      const voteResult = await conservative.vote('Proposal Y');
      expect(voteResult).toBe(false);
    });

    it('ConservativeMP should yield true vote correctly', async () => {
      const conservative = new ConservativeMP(adapter, undefined, false);
      vi.spyOn(adapter, 'callLLM').mockResolvedValue({ content: '我十分赞成这个提案。', rawOutput: '' } as any);
      const voteResult = await conservative.vote('Proposal Y');
      expect(voteResult).toBe(true);
    });
  });
});
