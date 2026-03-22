import { Act, ActStep, ExecutionReport, ExecutionTask, TaskResult } from '../../schemas/act';
import { randomUUID } from 'node:crypto';

export interface TaskExecutor {
  role: string;
  executeTask(task: ExecutionTask): Promise<TaskResult>;
}

export class ExecutionEngine {
  private _cabinet: Map<string, TaskExecutor>;

  constructor(cabinet: Record<string, TaskExecutor>) {
    this._cabinet = new Map(Object.entries(cabinet));
  }

  public async executeAct(act: Act): Promise<ExecutionReport> {
    const startTime = performance.now();
    const levels = this._topologicalSort(act.steps);
    const results: Map<number, TaskResult> = new Map();
    const failedSteps: Set<number> = new Set();

    for (const level of levels) {
      const toRun: ActStep[] = [];
      
      for (const step of level) {
        // check if dependencies failed
        const blockedDeps = step.dependencies.filter(dep => failedSteps.has(dep));
        if (blockedDeps.length > 0) {
          results.set(step.index, {
            task_id: randomUUID(),
            step_index: step.index,
            status: 'skipped',
            output: `跳过：依赖步骤 [${blockedDeps.join(', ')}] 失败`,
            tokens_consumed: 0,
          });
          failedSteps.add(step.index);
        } else {
          toRun.push(step);
        }
      }

      if (toRun.length > 0) {
        const promises = toRun.map(step => this._executeStep(step, act.act_id));
        const settled = await Promise.allSettled(promises);
        
        for (let i = 0; i < toRun.length; i++) {
          const step = toRun[i];
          const outcome = settled[i];

          if (outcome.status === 'rejected') {
            const errResult: TaskResult = {
              task_id: randomUUID(),
              step_index: step.index,
              status: 'failed',
              error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
              output: '',
              tokens_consumed: 0,
            };
            results.set(step.index, errResult);
            failedSteps.add(step.index);
          } else {
            const res = outcome.value;
            results.set(step.index, res);
            if (res.status === 'failed') {
              failedSteps.add(step.index);
            }
          }
        }
      }
    }

    const elapsedMs = performance.now() - startTime;
    const orderedResults: TaskResult[] = [];
    let totalTokens = 0;

    // Ordered output
    const sortedIndices = Array.from(results.keys()).sort((a, b) => a - b);
    for (const idx of sortedIndices) {
      const r = results.get(idx)!;
      orderedResults.push(r);
      if (r.tokens_consumed) {
        totalTokens += r.tokens_consumed;
      }
    }

    const statuses = new Set(orderedResults.map(r => r.status));
    let overall: 'completed' | 'partial' | 'failed';
    if (statuses.size === 1 && statuses.has('success')) {
      overall = 'completed';
    } else if (statuses.has('success')) {
      overall = 'partial';
    } else {
      overall = 'failed';
    }

    return {
      act_id: act.act_id,
      overall_status: overall,
      task_results: orderedResults,
      total_tokens_consumed: totalTokens,
      execution_time_seconds: Number((elapsedMs / 1000).toFixed(3)),
    };
  }

  public resolveSkill(skillName: string): TaskExecutor | undefined {
    return this._cabinet.get(skillName);
  }

  private async _executeStep(step: ActStep, actId: string): Promise<TaskResult> {
    const executor = this.resolveSkill(step.required_skill);
    if (!executor) {
      return {
        task_id: randomUUID(),
        step_index: step.index,
        status: 'failed',
        error: `无法找到 Skill '${step.required_skill}' 对应的执行者`,
        output: '',
        tokens_consumed: 0,
      };
    }

    const task: ExecutionTask = {
      task_id: actId,
      act_id: actId,
      step: step,
      assigned_to: executor.role,
    };

    return await executor.executeTask(task);
  }

  private _topologicalSort(steps: ActStep[]): ActStep[][] {
    const stepMap = new Map<number, ActStep>();
    const inDegree = new Map<number, number>();
    const dependents = new Map<number, number[]>();

    for (const step of steps) {
      stepMap.set(step.index, step);
      inDegree.set(step.index, 0);
      dependents.set(step.index, []);
    }

    for (const step of steps) {
      for (const dep of step.dependencies) {
        if (stepMap.has(dep)) {
          dependents.get(dep)!.push(step.index);
          inDegree.set(step.index, inDegree.get(step.index)! + 1);
        }
      }
    }

    let queue: number[] = [];
    for (const [idx, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(idx);
      }
    }

    const levels: ActStep[][] = [];

    while (queue.length > 0) {
      const currentLevel: ActStep[] = [];
      const nextQueue: number[] = [];

      for (const idx of queue) {
        currentLevel.push(stepMap.get(idx)!);
        for (const depIdx of dependents.get(idx)!) {
          const deg = inDegree.get(depIdx)! - 1;
          inDegree.set(depIdx, deg);
          if (deg === 0) {
            nextQueue.push(depIdx);
          }
        }
      }

      levels.push(currentLevel);
      queue = nextQueue;
    }

    const sortedCount = levels.reduce((acc, level) => acc + level.length, 0);
    if (sortedCount !== steps.length) {
      throw new Error('检测到循环依赖，法案步骤拓扑排序失败');
    }

    return levels;
  }
}
