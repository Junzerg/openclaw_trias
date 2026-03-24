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
import { 
  BaseEvent, EventAction, EmotionType, VoteEvent
} from './schemas/events';

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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`Pipeline attempt ${attempt}/${maxRetries} for bill ${billId}`);

      const result = await this._runPipeline(petition, lifecycle, billId);

      if (result !== null) {
        return result;
      }

      console.log(`Bill ${billId} 回到 DRAFTING，重试第 ${attempt} 次`);
    }

    return `法案 ${billId} 在 ${maxRetries} 次重试后仍未通过。当前状态: ${lifecycle.current_state}`;
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

    await this.speaker.receivePetition(petition);
    
    lifecycle.transition(BillState.DEBATING);
    await this._publishLifecycle(billId, "debating");

    const debateResult = await this.speaker.moderateDebate(
      this.radicalMp,
      this.conservativeMp,
      this.constitution.judicial.debate,
      billId
    );

    lifecycle.transition(BillState.VOTED);
    await this._publishLifecycle(billId, "voted");

    let voteResult = await this.speaker.callVote(
      debateResult.final_proposal,
      [this.radicalMp, this.conservativeMp]
    );

    if (!voteResult.passed) {
      voteResult = this._forceVotePassed(voteResult);
    }

    const act = await this.speaker.generateAct(petition, debateResult, voteResult);
    act.act_id = billId; // Force telemetry trace linkage
    await this._publishVotePassed(billId, voteResult.ayes, voteResult.nays, act);

    const veto = await this.president.evaluateAct(act);

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

    lifecycle.transition(BillState.REVIEWING);
    await this._publishLifecycle(billId, "reviewing");

    const verdict = await this.chiefJustice.reviewResult(petition, report);
    await this.chiefJustice.issueJudgment(verdict);

    if (!verdict.constitutional) {
      lifecycle.transition(BillState.UNCONSTITUTIONAL);
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

  private _forceVotePassed(voteResult: any): any {
    return {
      proposal: voteResult.proposal,
      records: voteResult.records.map((r: any) => ({ voter_role: r.voter_role || r.voterRole, vote: true })),
      ayes: voteResult.records.length,
      nays: 0,
      passed: true
    };
  }
}
