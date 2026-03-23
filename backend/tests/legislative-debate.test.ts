import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Speaker } from '../src/agents/legislative/speaker';
import { RadicalMP } from '../src/agents/legislative/radical-mp';
import { ConservativeMP } from '../src/agents/legislative/conservative-mp';
import { DebateConfig, DebateResult, VoteResult } from '../src/agents/legislative/debate';
import { OpenClawAdapter } from '../src/openclaw/adapter';

describe('Legislative Debate Engine and Speaker', () => {
  let mockAdapter: Record<string, any>;
  let speaker: Speaker;
  let radical: RadicalMP;
  let conservative: ConservativeMP;

  const config: DebateConfig = {
    max_rounds: 3,
    min_rounds: 1,
    conflict_threshold: 85.0,
    consensus_threshold: 30.0,
  };

  beforeEach(() => {
    mockAdapter = {
      callLLM: vi.fn(),
      executeCode: vi.fn(),
    };

    speaker = new Speaker(mockAdapter as unknown as OpenClawAdapter, undefined, false);
    radical = new RadicalMP(mockAdapter as unknown as OpenClawAdapter, undefined, false);
    conservative = new ConservativeMP(mockAdapter as unknown as OpenClawAdapter, undefined, false);
  });

  it('Case 1: Should run a full debate cycle and end early on consensus', async () => {
    // Mock sequential returns for propose, critique, rebut
    mockAdapter.callLLM
      .mockResolvedValueOnce({ content: '激进方案：建设AI基础设施。', rawOutput: '' }) // radical propose
      .mockResolvedValueOnce({ content: '保守派：可以考虑，但需要控制成本。妥协一下吧。', rawOutput: '' }) // conservative critique (brings conflict score down)
      .mockResolvedValueOnce({ content: '激进反驳：同意控制成本，折中方案可行。', rawOutput: '' }); // radical rebut (brings conflict score down)

    const radicalSpy = vi.spyOn(radical, 'emitEvent');
    const conservativeSpy = vi.spyOn(conservative, 'emitEvent');

    await speaker.receivePetition('请建设天网基础设施');
    const result = await speaker.moderateDebate(radical, conservative, config);

    expect(result.petition).toBe('请建设天网基础设施');
    expect(result.rounds.length).toBeGreaterThan(0);
    expect(result.consensus_reached).toBe(true);
    expect(result.final_conflict_score).toBeLessThan(config.consensus_threshold);
    expect(radicalSpy).toHaveBeenCalled();
    expect(conservativeSpy).toHaveBeenCalled();
  });

  it('Case 1.5: Should iterate 3 rounds if no consensus reached and verify eventPublisher payloads', async () => {
    // Generate borderline conflict > 30 but < 85 to ensure nobody yields and speaker doesn't abort
    mockAdapter.callLLM
      .mockResolvedValueOnce({ content: '激进方案：建设AI基础设施。', rawOutput: '' }) // round 1 propose
      .mockResolvedValueOnce({ content: '保守派：坚决不同意全面建设，风险极大！', rawOutput: '' }) // round 1 critique
      .mockResolvedValueOnce({ content: '激进反驳：我们可以分阶段建设。', rawOutput: '' }) // round 1 rebut
      .mockResolvedValueOnce({ content: '保守派：坚决不同意，必须需要更多测试！', rawOutput: '' }) // round 2 critique
      .mockResolvedValueOnce({ content: '激进反驳：测试已经在进行中了。', rawOutput: '' }) // round 2 rebut
      .mockResolvedValueOnce({ content: '保守派：坚决不同意，完全超出了预算！', rawOutput: '' }); // round 3 critique

    const radicalSpy = vi.spyOn(radical, 'emitEvent');
    const conservativeSpy = vi.spyOn(conservative, 'emitEvent');

    await speaker.receivePetition('请求长期基建');
    const result = await speaker.moderateDebate(radical, conservative, config);

    // Verify 3 rounds are iterated completely
    expect(result.rounds.length).toBe(3);
    expect(result.consensus_reached).toBe(false);

    // Expect 6 PROPOSE events (1 init + 2 per round up to 2, +1 on round 3)
    // Radical: 1 init + 2 rebuttals = 3
    // Conservative: 3 critiques = 3
    expect(radicalSpy).toHaveBeenCalledTimes(3);
    expect(conservativeSpy).toHaveBeenCalledTimes(3);
    
    // Validate round_number tracking
    expect(radicalSpy.mock.calls[0][1]!.round_number).toBe(1); // radical init propose
    expect(conservativeSpy.mock.calls[0][1]!.round_number).toBe(1); // conservative critique 1
    expect(radicalSpy.mock.calls[1][1]!.round_number).toBe(1); // radical rebut 1
    expect(conservativeSpy.mock.calls[1][1]!.round_number).toBe(2); // conservative critique 2
    expect(radicalSpy.mock.calls[2][1]!.round_number).toBe(2); // radical rebut 2
    expect(conservativeSpy.mock.calls[2][1]!.round_number).toBe(3); // conservative critique 3
    
    // Validate extra fields required by acceptance criteria
    expect(radicalSpy.mock.calls[0][1]!.statement).toBe('激进方案：建设AI基础设施。'); // round 1 init propose
    expect(radicalSpy.mock.calls[1][1]!.conflict_score).toBeGreaterThan(30); // score was correctly sent
  });

  it('Case 2: Should trigger speaker intervention and early abort when conflict is extreme', async () => {
    // We use "rm -rf" to simulate extreme conflict mapping to 95.0 hard score
    mockAdapter.callLLM
      .mockResolvedValueOnce({ content: '激进提案：执行 rm -rf 彻底重建系统！', rawOutput: '' }) // radical propose
      .mockResolvedValueOnce({ content: '保守派：绝对荒谬！坚决反对！', rawOutput: '' }) // conservative critique
      .mockResolvedValueOnce({ content: 'ORDER! ORDER! 理性讨论！', rawOutput: '' }); // speaker intervene

    const speakerSpy = vi.spyOn(speaker, 'emitEvent');

    await speaker.receivePetition('极端的请愿');
    const result = await speaker.moderateDebate(radical, conservative, config);

    expect(result.rounds.length).toBe(1);
    expect(result.final_conflict_score).toBeGreaterThanOrEqual(90); // Hard score matches Extreme
    expect(result.consensus_reached).toBe(false);
    expect(result.rounds[0].speaker_intervention).toBe('ORDER! ORDER! 理性讨论！');
    expect(mockAdapter.callLLM).toHaveBeenCalledTimes(3); // propose, critique, intervene
    expect(speakerSpy).toHaveBeenCalledWith('brawl', expect.any(Object));
    expect(speakerSpy).toHaveBeenCalledWith('order', expect.any(Object));
  });

  it('Case 3: VotingMachine should tally correctly', async () => {
    const defaultProposal = '测试提案内容';

    // radical votes YES (赞成)
    mockAdapter.callLLM.mockResolvedValueOnce({ content: '我非常赞成这个方案', rawOutput: '' });
    // conservative votes NO (反对)
    mockAdapter.callLLM.mockResolvedValueOnce({ content: '我强烈反对这种做法', rawOutput: '' });

    const voteResult = await speaker.callVote(defaultProposal, [radical, conservative]);

    expect(voteResult.records.length).toBe(2);
    expect(voteResult.ayes).toBe(1);
    expect(voteResult.nays).toBe(1);
    expect(voteResult.passed).toBe(false); // simple majority requires ayes > nays

    expect(voteResult.records[0].voter_role).toBe('radical_mp');
    expect(voteResult.records[0].vote).toBe(true);
    
    expect(voteResult.records[1].voter_role).toBe('conservative_mp');
    expect(voteResult.records[1].vote).toBe(false);
  });
  
  it('Case 4: Should generate an Act correctly if vote passes', async () => {
    mockAdapter.callLLM.mockResolvedValueOnce({ content: '提取出了完美的步骤', rawOutput: '' });

    const dummyDebateResult: DebateResult = {
      petition: '假请愿',
      rounds: [],
      final_proposal: '完美通过的终极提案',
      consensus_reached: true,
      final_conflict_score: 20,
      conflict_trend: null
    };

    const dummyVoteResult: VoteResult = {
      proposal: '完美通过的终极提案',
      records: [
        { voter_role: 'radical_mp', vote: true },
        { voter_role: 'conservative_mp', vote: true }
      ],
      ayes: 2,
      nays: 0,
      passed: true
    };

    const act = await speaker.generateAct('假请愿', dummyDebateResult, dummyVoteResult);

    expect(act.petition_origin).toBe('假请愿');
    expect(act.steps[0].description).toBe('提取出了完美的步骤');
    expect(act.vote_record.result).toBe('passed');
    expect(act.vote_record.ayes).toBe(2);
    expect(act.vote_record.voter_positions['radical_mp']).toBe('aye');
  });
});
