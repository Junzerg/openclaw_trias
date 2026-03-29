import { randomUUID } from 'node:crypto';
import { Speaker } from './agents/legislative/speaker';
import { RadicalMP } from './agents/legislative/radical-mp';
import { ConservativeMP } from './agents/legislative/conservative-mp';
import { President } from './agents/executive/president';
import { SecretaryOfEngineering } from './agents/executive/sec-engineering';
import { SecretaryOfState } from './agents/executive/sec-state';
import { ExecutionEngine, TaskExecutor } from './agents/executive/engine';
import { ChiefJustice } from './agents/judicial/chief-justice';
import { MessageBus } from './bus/message-bus';
import { EventLogger } from './bus/event-log';
import { BillLifecycle, BillState } from './bus/state-machine';
import { loadConstitution, resolveModel } from './config/loader';
import { ConstitutionConfig } from './config/models';
import { OpenClawAdapter } from './openclaw/adapter';
import { VoteResult } from './agents/legislative/debate';
import { 
  BaseEvent, EventAction, EmotionType, VoteEvent
} from './schemas/events';
import { ViolationType } from './schemas/verdict';

const MAX_RETRIES = 1;

export class CyberGovernment {
  private _configDir: string;
  public constitution: ConstitutionConfig;
  public adapter: OpenClawAdapter;
  
  public speaker!: Speaker;
  public radicalMp!: RadicalMP;
  public conservativeMp!: ConservativeMP;
  
  public president!: President;
  public secEngineering!: SecretaryOfEngineering;
  public secState!: SecretaryOfState;
  public executionEngine!: ExecutionEngine;
  
  public chiefJustice!: ChiefJustice;
  
  public bus: MessageBus;
  public eventLogger: EventLogger;

  /** Cumulative token counters per branch */
  private _tokenCounters = { legislative: 0, executive: 0, judicial: 0 };

  constructor(configDir: string, constitution?: ConstitutionConfig) {
    this._configDir = configDir;
    
    if (constitution) {
      this.constitution = constitution;
    } else {
      this.constitution = loadConstitution(this._configDir);
    }

    this.adapter = new OpenClawAdapter();
    this.bus = new MessageBus();
    this.eventLogger = new EventLogger();

    this._initLegislative();
    this._initExecutive();
    this._initJudicial();
    this._applyModelRouting();
    this._registerSubscribers();
  }

  private _initLegislative(): void {
    this.speaker = new Speaker(this.adapter, this.bus);
    this.radicalMp = new RadicalMP(this.adapter, this.bus);
    this.conservativeMp = new ConservativeMP(this.adapter, this.bus);
  }

  private _initExecutive(): void {
    const budget = this.constitution.judicial.token_budget?.execution_budget ?? 50000;
    this.president = new President(this.adapter, this.bus, budget);
    this.secEngineering = new SecretaryOfEngineering(this.adapter, this.bus);
    this.secState = new SecretaryOfState(this.adapter, this.bus);

    const cabinet: Record<string, TaskExecutor> = {
      "CodeExecution": this.secEngineering,
      "Python_Interpreter": this.secEngineering,
      "GitHub": this.secEngineering,
      "WebBrowser": this.secState,
      "Search": this.secState,
    };
    this.executionEngine = new ExecutionEngine(cabinet);
  }

  private _initJudicial(): void {
    this.chiefJustice = new ChiefJustice(this.constitution, this.adapter, this.bus);
  }

  /**
   * Inject per-agent model overrides from constitution.model_routing.
   * Must be called after all agents are initialized.
   */
  private _applyModelRouting(): void {
    const routing = this.constitution.model_routing;
    if (!routing) return;

    const agents = [
      this.speaker, this.radicalMp, this.conservativeMp,
      this.president, this.secEngineering, this.secState,
      this.chiefJustice,
    ];

    for (const agent of agents) {
      agent.modelRef = resolveModel(agent.role, routing);
    }
  }

  private _registerSubscribers(): void {
    const topics = ["legislation", "execution", "judiciary", "lifecycle"] as const;
    for (const topic of topics) {
      this.bus.subscribe(topic, this._logEvent.bind(this));
    }
  }

  private async _logEvent(event: BaseEvent): Promise<void> {
    await this.eventLogger.log(event);
  }

  public async inaugurate(): Promise<void> {
    await this.bus.start();
    console.log("CyberGovernment 已启动");
  }

  public async shutdown(): Promise<void> {
    await this.bus.stop();
    console.log("CyberGovernment 已关闭");
  }

  /**
   * 接收选民请愿，启动完整 Pipeline。
   */
  public async receivePetition(
    petition: string, 
    maxRetries: number = MAX_RETRIES, 
    taskId?: string
  ): Promise<string> {
    const billId = taskId ?? randomUUID();
    const lifecycle = new BillLifecycle(billId);

    for (let attempt = 1; attempt <= 1 + maxRetries; attempt++) {
      console.log(`Pipeline attempt ${attempt}/${1 + maxRetries} for bill ${billId}`);

      try {
        const result = await this._runPipeline(petition, lifecycle, billId);

        if (result !== null) {
          return result;
        }
      } catch (err: any) {
        // Unhandled system-level exception — log and abort
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[CyberGovernment] 系统级异常 in pipeline attempt ${attempt}: ${message}`);

        // Force lifecycle back to DRAFTING for safety
        try { lifecycle.transition(BillState.DRAFTING); } catch { /* ignore transition errors */ }

        return `系统级异常: ${message}。流水线已中止。法案 ${billId} 未完成。`;
      }

      console.log(`Bill ${billId} 回到 DRAFTING，重试第 ${attempt} 次`);
    }

    return `法案 ${billId} 在 ${maxRetries} 次重试后仍未通过。系统已拦截并终止该危险案卷。`;
  }

  private async _runPipeline(
    petition: string, 
    lifecycle: BillLifecycle, 
    billId: string
  ): Promise<string | null> {
    if (lifecycle.current_state !== BillState.DRAFTING) {
      lifecycle.transition(BillState.DRAFTING);
    }
    await this._publishLifecycle(billId, "drafting");

    // Bug 23 fix: 重置 ProcessReviewer 历史，防止跨 Act 死循环误报
    this.chiefJustice.resetProcessHistory();

    await this.speaker.receivePetition(petition);
    
    lifecycle.transition(BillState.DEBATING);
    await this._publishLifecycle(billId, "debating");

    const debateResult = await this.speaker.moderateDebate(
      this.radicalMp,
      this.conservativeMp,
      this.constitution.judicial.debate,
      billId,
      petition  // Bug 40 fix: 显式传递 petition，避免并发 pipeline 竞态
    );

    // Token 埋点①：立法辩论阶段
    // 估算：每轮辩论约 2000 tokens（提案 + 批评 + 反驳 + 议长介入）
    const debateTokens = debateResult.rounds.length * 2000;
    this._tokenCounters.legislative += debateTokens;
    await this._publishTokenUsage(billId, 'legislative', debateTokens, this._tokenCounters.legislative);

    lifecycle.transition(BillState.VOTED);
    await this._publishLifecycle(billId, "voted");

    let voteResult = await this.speaker.callVote(
      debateResult.final_proposal,
      [this.radicalMp, this.conservativeMp],
      debateResult.rounds.length + 1,
      billId
    );

    if (!voteResult.passed) {
      voteResult = this._forceVotePassed(voteResult);
    }

    const act = await this.speaker.generateAct(petition, debateResult, voteResult);
    act.act_id = billId; // Force telemetry trace linkage
    await this._publishVotePassed(billId, voteResult.ayes, voteResult.nays, act);

    const veto = await this.president.evaluateAct(act);

    // Token 埋点②：总统审查法案
    const signTokens = 1500;
    this._tokenCounters.executive += signTokens;
    await this._publishTokenUsage(billId, 'executive', signTokens, this._tokenCounters.executive);

    if (veto !== null && veto !== undefined) {
      lifecycle.transition(BillState.VETOED);
      // President emits VETO event internally
      lifecycle.transition(BillState.DRAFTING);
      return null;
    }

    lifecycle.transition(BillState.SIGNED);
    await this._publishLifecycle(billId, "signed");
    // President emits SIGN_ACT internally during evaluateAct when successful

    lifecycle.transition(BillState.EXECUTING);
    await this._publishLifecycle(billId, "executing");

    const report = await this.executionEngine.executeAct(act);

    // Token 埋点③：内阁执行阶段
    const execTokens = report.total_tokens_consumed || 0;
    this._tokenCounters.executive += execTokens;
    await this._publishTokenUsage(billId, 'executive', execTokens, this._tokenCounters.executive);

    // Bug 6+49 fix: 全失败或部分失败的执行不应送去司法审查
    // partial: 残缺产出送给 ResultReviewer 会因为只有部分成功输出而产生虚假偏离度评分
    // failed: ResultReviewer 会把 '(无有效产出)' 传给偏离度评分器，产生虚假的"合宪"判定
    if (report.overall_status === 'failed' || report.overall_status === 'partial') {
      console.warn(`[CyberGovernment] 执行状态=${report.overall_status} (bill ${billId})，触发自动违宪判决并重试`);
      lifecycle.transition(BillState.REVIEWING);
      await this._publishLifecycle(billId, "reviewing");
      
      const fakeVerdict = {
        verdict_id: randomUUID(),
        act_id: billId,
        constitutional: false,
        ruling: `内阁执行阶段异常 (${report.overall_status})，最高法院依法阻断进程。没有生成有效的执行产出。`,
        violation_type: ViolationType.DEVIATION_EXCEEDED,
        evidence: report.task_results.map(t => `[步骤 ${t.step_index}] ${t.status}: ${t.error ?? '无输出'}`),
        remediation: '建议立法分支细化执行步骤并重发法案',
        created_at: new Date()
      };
      await this.chiefJustice.issueJudgment(fakeVerdict);

      lifecycle.transition(BillState.UNCONSTITUTIONAL);
      await this._publishLifecycle(billId, "unconstitutional");
      lifecycle.transition(BillState.DRAFTING);
      return null;
    }

    lifecycle.transition(BillState.REVIEWING);
    await this._publishLifecycle(billId, "reviewing");

    const verdict = await this.chiefJustice.reviewResult(petition, report);
    await this.chiefJustice.issueJudgment(verdict);

    // Token 埋点④：司法审查阶段
    const judicialTokens = 2000;
    this._tokenCounters.judicial += judicialTokens;
    await this._publishTokenUsage(billId, 'judicial', judicialTokens, this._tokenCounters.judicial);

    if (!verdict.constitutional) {
      lifecycle.transition(BillState.UNCONSTITUTIONAL);
      await this._publishLifecycle(billId, "unconstitutional");
      lifecycle.transition(BillState.DRAFTING);
      return null;
    }

    lifecycle.transition(BillState.CONSTITUTIONAL);
    lifecycle.transition(BillState.DELIVERED);
    await this._publishLifecycle(billId, "delivered");

    return `法案 ${billId} 已交付。\n执行状态: ${report.overall_status}\n判决: ${verdict.ruling}\n总 Token 消耗: ${report.total_tokens_consumed}`;
  }

  private async _publishLifecycle(billId: string, state: string): Promise<void> {
    const event: BaseEvent = {
      timestamp: new Date(),
      source_agent: "government",
      action: EventAction.STATE_CHANGE,
      payload: { bill_id: billId, state },
      task_id: billId,
      emotion: EmotionType.NEUTRAL,
      intensity: 0,
    };
    await this.bus.publish("lifecycle", event);
  }

  private async _publishVotePassed(billId: string, ayes: number, nays: number, act?: any): Promise<void> {
    const event: VoteEvent = {
      timestamp: new Date(),
      source_agent: "speaker",
      ayes,
      nays,
      result: "passed",
      task_id: billId,
      action: EventAction.VOTE_PASSED,
      payload: act ? { act } : {},
      emotion: EmotionType.NEUTRAL,
      intensity: 0.8
    };
    await this.bus.publish("legislation", event);
  }

  private _forceVotePassed(voteResult: VoteResult): VoteResult & { _forced: boolean; _original_vote: { ayes: number; nays: number } } {
    // Bug 13 fix: 记录原始投票结果以供审计
    const originalAyes = voteResult.ayes;
    const originalNays = voteResult.nays;
    console.warn(
      `[CyberGovernment] ⚠️ 民主投票被否决 (ayes=${originalAyes}, nays=${originalNays})，` +
      `启动强制通过。原始投票结果已保留在 _original_vote 字段。`
    );

    return {
      proposal: voteResult.proposal,
      records: voteResult.records.map((r) => ({ voter_role: r.voter_role, vote: true })),
      ayes: voteResult.records.length,
      nays: 0,
      passed: true,
      _forced: true,
      _original_vote: { ayes: originalAyes, nays: originalNays },
    };
  }

  private async _publishTokenUsage(
    billId: string,
    branch: 'legislative' | 'executive' | 'judicial',
    tokensUsed: number,
    cumulative: number
  ): Promise<void> {
    const event: BaseEvent = {
      timestamp: new Date(),
      source_agent: 'government',
      action: EventAction.TOKEN_USAGE,
      payload: { branch, tokens_used: tokensUsed, cumulative },
      task_id: billId,
      emotion: EmotionType.NEUTRAL,
      intensity: 0,
    };
    await this.bus.publish('lifecycle', event);
  }
}
