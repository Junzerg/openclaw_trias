/**
 * 法案生命周期状态机。
 *
 * 管理法案从请愿到交付的全流程状态流转，
 * 包含 Vetoed→Drafting 和 Unconstitutional→Drafting 回路。
 */

export class InvalidTransitionError extends Error {
  constructor(public fromState: BillState, public toState: BillState) {
    super(`非法状态转换: ${fromState} → ${toState}`);
    this.name = 'InvalidTransitionError';
  }
}

export enum BillState {
  PETITION = 'petition',
  DRAFTING = 'drafting',
  DEBATING = 'debating',
  VOTED = 'voted',
  SIGNED = 'signed',
  VETOED = 'vetoed',
  EXECUTING = 'executing',
  REVIEWING = 'reviewing',
  CONSTITUTIONAL = 'constitutional',
  UNCONSTITUTIONAL = 'unconstitutional',
  DELIVERED = 'delivered',
}

export const VALID_TRANSITIONS: Record<BillState, Set<BillState>> = {
  [BillState.PETITION]: new Set([BillState.DRAFTING]),
  [BillState.DRAFTING]: new Set([BillState.DEBATING]),
  [BillState.DEBATING]: new Set([BillState.VOTED]),
  [BillState.VOTED]: new Set([BillState.SIGNED, BillState.VETOED]),
  [BillState.SIGNED]: new Set([BillState.EXECUTING]),
  [BillState.VETOED]: new Set([BillState.DRAFTING]), // 回到起草
  [BillState.EXECUTING]: new Set([BillState.REVIEWING]),
  [BillState.REVIEWING]: new Set([BillState.CONSTITUTIONAL, BillState.UNCONSTITUTIONAL]),
  [BillState.CONSTITUTIONAL]: new Set([BillState.DELIVERED]),
  [BillState.UNCONSTITUTIONAL]: new Set([BillState.DRAFTING]), // 回到起草
  [BillState.DELIVERED]: new Set(), // 终态
};

export interface StateTransition {
  from_state: BillState;
  to_state: BillState;
  timestamp: Date;
}

export class BillLifecycle {
  public readonly bill_id: string;
  public current_state: BillState;
  private _history: StateTransition[];

  constructor(bill_id: string) {
    this.bill_id = bill_id;
    this.current_state = BillState.PETITION;
    this._history = [];
  }

  public transition(to_state: BillState): StateTransition {
    const validTargets = VALID_TRANSITIONS[this.current_state];
    if (!validTargets || !validTargets.has(to_state)) {
      throw new InvalidTransitionError(this.current_state, to_state);
    }

    const record: StateTransition = {
      from_state: this.current_state,
      to_state: to_state,
      timestamp: new Date(),
    };

    this._history.push(record);
    this.current_state = to_state;
    return record;
  }

  public get history(): StateTransition[] {
    return [...this._history];
  }

  public get is_terminal(): boolean {
    return this.current_state === BillState.DELIVERED;
  }

  /**
   * Bug 10 fix: 强制重置状态到 DRAFTING，用于异常恢复。
   * 跳过正常的状态转换验证，但记录在历史中以供审计。
   */
  public forceReset(): StateTransition {
    const record: StateTransition = {
      from_state: this.current_state,
      to_state: BillState.DRAFTING,
      timestamp: new Date(),
    };
    console.warn(
      `[BillLifecycle] ⚠️ 强制重置: ${this.current_state} → ${BillState.DRAFTING} (bill ${this.bill_id})`
    );
    this._history.push(record);
    this.current_state = BillState.DRAFTING;
    return record;
  }
}
