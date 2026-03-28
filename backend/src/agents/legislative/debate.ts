import { ConflictScoreEngine, ConflictTrend } from './conflict-score';
import type { RadicalMP } from './radical-mp';
import type { ConservativeMP } from './conservative-mp';
import type { Speaker } from './speaker';
import { EventAction } from '../../schemas/events';

// ---------------------------------------------------------------------------
// Config & Protocol
// ---------------------------------------------------------------------------

export interface DebateConfig {
  max_rounds: number;
  min_rounds: number;
  conflict_threshold: number;  // 议长控场阈值
  consensus_threshold: number; // 达成共识阈值
}

export interface VoteOutcome {
  voteValue: boolean;
  reason: string;
}

export interface Voter {
  role: string;
  vote(proposal: string): Promise<VoteOutcome>;
  emitEvent?(action: EventAction, payload?: Record<string, unknown>, targetAgent?: string, taskId?: string): void;
}

// ---------------------------------------------------------------------------
// Data Models
// ---------------------------------------------------------------------------

export interface DebateRound {
  round_number: number;
  proposal: string;
  critique: string;
  rebuttal: string;
  conflict_score: number;
  speaker_intervention: string | null;
}

export interface DebateResult {
  petition: string;
  rounds: DebateRound[];
  final_proposal: string;
  consensus_reached: boolean;
  final_conflict_score: number;
  conflict_trend: ConflictTrend | null;
}

export interface VoteRecord {
  voter_role: string;
  vote: boolean;
}

export interface VoteResult {
  proposal: string;
  records: VoteRecord[];
  ayes: number;
  nays: number;
  passed: boolean; // 简单多数制
}

// ---------------------------------------------------------------------------
// DebateEngine
// ---------------------------------------------------------------------------

export class DebateEngine {
  private config: DebateConfig;
  private conflictEngine: ConflictScoreEngine;

  constructor(config: DebateConfig) {
    this.config = config;
    this.conflictEngine = new ConflictScoreEngine();
  }

  /**
   * 执行完整辩论流程
   */
  async runDebate(
    speaker: Speaker,
    radical: RadicalMP,
    conservative: ConservativeMP,
    petition: string,
    taskId: string
  ): Promise<DebateResult> {
    const rounds: DebateRound[] = [];
    const scoreHistory: number[] = [];
    
    let currentProposal = await radical.propose(petition);
    
    radical.emitEvent(EventAction.PROPOSE, { 
      statement: currentProposal, 
      round_number: 1, 
      conflict_score: 0.0 
    }, undefined, taskId);
    
    let lastRebuttal = '';
    let finalScore = 0.0;

    for (let roundNum = 1; roundNum <= this.config.max_rounds; roundNum++) {
      let critiqueText = '';
      // 首轮为批评，后续为反驳批评
      if (roundNum === 1) {
        critiqueText = await conservative.critique(currentProposal);
      } else {
        critiqueText = await conservative.rebut(currentProposal);
      }

      // 先计算分数，再触发 WS 广播，确保分歧度曲线画的是对的
      const scoreResult = this.conflictEngine.compute(currentProposal, critiqueText);
      let score = scoreResult.score;

      // 如果直接投降，强制分数归零
      if (critiqueText.includes('[CONSENSUS_REACHED]')) {
        score = 0;
      }

      conservative.emitEvent(EventAction.PROPOSE, { 
        statement: critiqueText, 
        round_number: roundNum, 
        conflict_score: score 
      }, undefined, taskId);

      scoreHistory.push(score);

      // 达成共识提前退出
      if (critiqueText.includes('[CONSENSUS_REACHED]')) {
        rounds.push({
          round_number: roundNum,
          proposal: currentProposal,
          critique: critiqueText,
          rebuttal: '',
          conflict_score: 0,
          speaker_intervention: null
        });
        finalScore = 0;
        break; // 提前退出
      }

      let intervention: string | null = null;
      if (score > this.config.conflict_threshold) {
        speaker.emitEvent(EventAction.BRAWL, { 
          intensity: Math.min(1.0, score / 100.0) 
        }, undefined, taskId);
        
        intervention = await speaker.intervene(currentProposal, critiqueText, score);
        
        speaker.emitEvent(EventAction.ORDER, { 
          intensity: Math.min(1.0, score / 100.0),
          statement: intervention
        }, undefined, taskId);

        // 极端分歧下直接终止后续轮次，触发强行表决
        if (score >= 90.0) {
          rounds.push({
            round_number: roundNum,
            proposal: currentProposal,
            critique: critiqueText,
            rebuttal: lastRebuttal,
            conflict_score: score,
            speaker_intervention: intervention
          });
          finalScore = score;
          break;
        }
      }

      rounds.push({
        round_number: roundNum,
        proposal: currentProposal,
        critique: critiqueText,
        rebuttal: lastRebuttal,
        conflict_score: score,
        speaker_intervention: intervention
      });
      finalScore = score;

      // 如果分数已降至共识线以下，且满足最少回合数则停止
      if (score < this.config.consensus_threshold && roundNum >= this.config.min_rounds) {
        break;
      }

      // 还没到最后一轮，则激进派给出 rebuttal 进入下一次迭代的 proposal
      if (roundNum < this.config.max_rounds) {
        lastRebuttal = await radical.rebut(critiqueText);
        radical.emitEvent(EventAction.PROPOSE, { 
          statement: lastRebuttal, 
          round_number: roundNum, 
          conflict_score: score 
        }, undefined, taskId);
        
        // 如果激进派在反驳中举白旗，也硬退出，不覆盖 currentProposal
        if (lastRebuttal.includes('[CONSENSUS_REACHED]')) {
           rounds[rounds.length - 1].rebuttal = lastRebuttal;
           rounds[rounds.length - 1].conflict_score = 0;
           finalScore = 0;
           break;
        }
        
        currentProposal = lastRebuttal;
      }
    }

    let trend: ConflictTrend | null = null;
    if (scoreHistory.length >= 2) {
      trend = this.conflictEngine.computeTrend(scoreHistory);
    }

    const consensus = finalScore < this.config.consensus_threshold;

    return {
      petition,
      rounds,
      final_proposal: currentProposal,
      consensus_reached: consensus,
      final_conflict_score: finalScore,
      conflict_trend: trend
    };
  }
}

// ---------------------------------------------------------------------------
// VotingMachine
// ---------------------------------------------------------------------------

export class VotingMachine {
  async tally(proposal: string, voters: Voter[], voteRound: number = 99, taskId?: string): Promise<VoteResult> {
    const records: VoteRecord[] = [];
    let ayes = 0;
    let nays = 0;

    for (const voter of voters) {
      const outcome = await voter.vote(proposal);
      records.push({ voter_role: voter.role, vote: outcome.voteValue });
      
      if (typeof voter.emitEvent === 'function') {
        voter.emitEvent(EventAction.PROPOSE, {
           statement: `[VOTING] 投票已决：我投**${outcome.voteValue ? '赞成票' : '反对票'}**！\n\n${outcome.reason}`,
           round_number: voteRound,
           conflict_score: 0 // 防止前端因为没有分数走默认 intensity 而画出 50 分的曲折线
        }, undefined, taskId);
      }

      if (outcome.voteValue) {
        ayes++;
      } else {
        nays++;
      }
    }

    const passed = ayes > nays;
    
    return {
      proposal,
      records,
      ayes,
      nays,
      passed,
    };
  }
}
