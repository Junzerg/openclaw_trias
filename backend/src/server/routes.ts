/**
 * REST API 路由 — 翻译自 Python server/routes.py。
 *
 * 6 个端点:
 *   POST /petition        — 提交选民请愿
 *   GET  /task/:id/status  — 查询任务状态
 *   GET  /tasks            — 分页查询历史任务
 *   GET  /task/:id/act     — 查询法案 JSON
 *   GET  /task/:id/debate  — 查询辩论记录 + Conflict Score 曲线
 *   GET  /task/:id/verdict — 查询司法判决详情
 */

import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { AppState } from './app';
import { runPetition } from './pipeline-bridge';
import { invalidateSoul, listSoulNames, writeSoulFile, SOULS_DIR } from '../config/loader';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PetitionRequestSchema,
  type PetitionResponse,
  type TaskStatusResponse,
  type TaskListResponse,
  type TaskSummary,
  type ActResponse,
  type DebateRound,
  type DebateResponse,
  type VerdictResponse,
} from './schemas';

/**
 * 获取挂载在 app.locals 上的 AppState。
 */
function getState(req: Request): AppState {
  return req.app.locals.state as AppState;
}

/**
 * 创建并返回包含全部 REST 路由的 Express Router。
 */
export function createRouter(): Router {
  const router = Router();

  // ─── POST /petition ─────────────────────────────────────────

  router.post('/petition', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PetitionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Bad Request',
          detail: parsed.error.issues.map((i) => i.message).join('; '),
        });
        return;
      }

      const { prompt } = parsed.data;
      const taskId = randomUUID();
      const state = getState(req);

      // 存储任务到持久层
      await state.taskStore.createTask(taskId, prompt);

      // 后台运行 Pipeline — 通过 TaskQueue 调度，runPetition 内部维护状态机
      await state.taskQueue.submit(taskId, async () => {
        await runPetition(taskId, prompt, state);
      });

      const body: PetitionResponse = {
        task_id: taskId,
        status: 'pending',
        message: '请愿已提交，三权状态机已启动',
      };
      res.status(202).json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /task/:id/status ───────────────────────────────────

  router.get('/task/:id/status', async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id;
      const state = getState(req);
      const record = await state.taskStore.getTask(taskId);

      if (!record) {
        res.status(404).json({ error: 'Not Found', detail: 'Task not found' });
        return;
      }

      const body: TaskStatusResponse = {
        task_id: record.task_id,
        petition: record.petition,
        status: record.status,
        bill_state: record.bill_state,
        result: record.result,
        created_at: record.created_at,
        updated_at: record.updated_at,
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─── DELETE /task/:id ───────────────────────────────────────

  router.delete('/task/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id;
      const state = getState(req);
      const record = await state.taskStore.getTask(taskId);

      if (!record) {
        res.status(404).json({ error: 'Not Found', detail: 'Task not found' });
        return;
      }

      await state.taskStore.deleteTask(taskId);
      res.json({ message: 'Task deleted successfully' });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /tasks ──────────────────────────────────────────────

  router.get('/tasks', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);
      const rawLimit = parseInt(req.query.limit as string, 10) || 20;
      const limit = Math.min(Math.max(1, rawLimit), 100);

      const state = getState(req);
      const total = await state.taskStore.countTasks();
      const records = await state.taskStore.listTasks(offset, limit);

      const tasks: TaskSummary[] = records.map((r) => ({
        task_id: r.task_id,
        petition: (r.petition || '').length > 100 ? (r.petition || '').slice(0, 100) + '...' : (r.petition || ''),
        status: r.status,
        bill_state: r.bill_state,
        created_at: r.created_at,
      }));

      const body: TaskListResponse = { total, offset, limit, tasks };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /task/:id/act ───────────────────────────────────────

  router.get('/task/:id/act', async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id;
      const state = getState(req);
      const actRow = await state.taskStore.getTaskAct(taskId);

      if (!actRow) {
        res.status(404).json({ error: 'Not Found', detail: 'Act not found for this task' });
        return;
      }

      let actData: Record<string, unknown>;
      try {
        const parsed = JSON.parse(actRow.act_json);
        // 防御性检查：确保是对象字典而不是数组或其他
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          actData = parsed;
        } else {
          throw new Error('Invalid type');
        }
      } catch {
        res.status(500).json({ error: 'Internal Server Error', detail: 'Corrupt act data' });
        return;
      }

      const body: ActResponse = {
        task_id: taskId,
        act: actData,
        created_at: actRow.created_at,
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /task/:id/debate ────────────────────────────────────

  router.get('/task/:id/debate', async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id;
      const state = getState(req);
      const eventRows = await state.taskStore.getTaskEvents(taskId);

      const rounds: DebateRound[] = [];
      const conflictScores: number[] = [];
      const tokenEvents: Array<Record<string, unknown>> = [];

      for (const row of eventRows) {
        if (!['propose', 'debate', 'order', 'brawl', 'token_usage'].includes(row.action)) continue;

        let payload: Record<string, unknown>;
        try {
          const parsed = row.payload ? JSON.parse(row.payload) : {};
          if (parsed && typeof parsed === 'object') {
             payload = parsed;
          } else {
             payload = {};
          }
        } catch {
          // 跳过损坏的 payload
          continue;
        }

        if (row.action === 'token_usage') {
          const innerData = (payload.payload && typeof payload.payload === 'object') 
                            ? payload.payload 
                            : payload;
          tokenEvents.push(innerData as Record<string, unknown>);
          continue;
        }

        const statement: string = String(payload.statement ?? '');
        // 关键陷阱防备：因为 0 是假值，使用 || 会导致 payload 里显式提供的 conflict_score = 0 被后置变量覆盖。改用 ?? 严格空值合并。
        const conflictScore: number = Number(payload.conflict_score ?? payload.intensity) || 0.0;

        // 如果是 Speaker 发出的干预，它没有 explicit 的 round_number，
        // 应该依附于当前（最新）的这一轮进行展示。
        if (row.source_agent === 'speaker') {
           if (rounds.length > 0) {
               rounds[rounds.length - 1].speaker_intervention = statement;
           }
           if (conflictScore > 0 && (conflictScores.length === 0 || conflictScores[conflictScores.length - 1] !== conflictScore)) {
               conflictScores.push(conflictScore);
           }
           continue; // Speaker 解析完毕
        }

        // 状态机劫持防御：如果不是正规的合规议员，坚决不能随便插入事件（防止其他模块意外产生 propose 污染本上下文）
        if (row.source_agent !== 'conservative_mp' && row.source_agent !== 'radical_mp') {
           continue;
        }

        let rawRound = payload.round_number;
        if (rawRound === undefined || rawRound === null) rawRound = 1;
        const roundNum: number = Number(rawRound);

        // 防御性检查：丢弃无效轮次或 0，防止 OOM 内存耗尽攻击（上限 1000）
        if (Number.isNaN(roundNum) || roundNum < 1 || roundNum > 1000) continue;

        // 确保 rounds 数组足够长
        while (rounds.length < roundNum) {
          rounds.push({
            round_number: rounds.length + 1,
            radical_statement: '',
            conservative_statement: '',
            conflict_score: 0.0,
          });
        }

        const r = rounds[roundNum - 1];
        if (row.source_agent === 'conservative_mp') {
          r.conservative_statement = r.conservative_statement 
            ? r.conservative_statement + '\n\n---\n**Rebuttal:**\n' + statement 
            : statement;
        } else {
          r.radical_statement = r.radical_statement 
            ? r.radical_statement + '\n\n---\n**Rebuttal:**\n' + statement 
            : statement;
        }
        // 如果是最终投票事件，不要让 0 分覆盖原有的分歧度和曲线
        if (!statement.includes('[VOTING]')) {
          r.conflict_score = conflictScore;
          // 修复：和 WebSocket 逻辑保持一致，过滤掉连续重复的分数
          if (conflictScores.length === 0 || conflictScores[conflictScores.length - 1] !== conflictScore) {
            conflictScores.push(conflictScore);
          }
        }
      }

      const body: DebateResponse = {
        task_id: taskId,
        rounds,
        conflict_score_curve: conflictScores,
        token_events: tokenEvents,
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /task/:id/verdict ───────────────────────────────────

  router.get('/task/:id/verdict', async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id;
      const state = getState(req);
      const verdictRow = await state.taskStore.getTaskVerdict(taskId);

      if (!verdictRow) {
        res.status(404).json({ error: 'Not Found', detail: 'Verdict not found for this task' });
        return;
      }

      let evidenceList: string[];
      try {
        const parsed = JSON.parse(verdictRow.evidence);
        // 防御性检查：即使 JSON 是有效的字符串或对象，也强制转换为数组，防止前端 .map 崩溃
        evidenceList = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        evidenceList = [];
      }

      const body: VerdictResponse = {
        task_id: taskId,
        constitutional: Boolean(verdictRow.constitutional),
        ruling: verdictRow.ruling,
        evidence: evidenceList,
        created_at: verdictRow.created_at,
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─── Soul Config API (Task 4.9) ─────────────────────────────

  /**
   * 安全校验：名称只允许字母、数字和下划线，杜绝路径穿越。
   * SOUL_TEMPLATE 也是合法名称。
   */
  const SAFE_NAME_RE = /^[A-Za-z0-9_]+$/;

  function isValidSoulName(name: string): boolean {
    return SAFE_NAME_RE.test(name) && name.length > 0 && name.length <= 64;
  }

  // GET /config/souls — 列出所有 soul 文件名
  router.get('/config/souls', (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const names = listSoulNames();
      res.json({ souls: names });
    } catch (err) {
      next(err);
    }
  });

  // GET /config/souls/:name — 读取单个 soul 文件的 Markdown 内容
  router.get('/config/souls/:name', (req: Request<{ name: string }>, res: Response, next: NextFunction): void => {
    try {
      const { name } = req.params;

      if (!isValidSoulName(name)) {
        res.status(400).json({ error: 'Bad Request', detail: 'Invalid soul name. Only alphanumerics and underscores allowed.' });
        return;
      }

      const filePath = join(SOULS_DIR, `${name}.md`);
      if (!existsSync(filePath)) {
        res.status(404).json({ error: 'Not Found', detail: `Soul file not found: ${name}` });
        return;
      }

      const content = readFileSync(filePath, 'utf-8');
      res.json({ name, content });
    } catch (err) {
      next(err);
    }
  });

  // PUT /config/souls/:name — 覆写 soul 文件并使缓存失效
  router.put('/config/souls/:name', (req: Request<{ name: string }>, res: Response, next: NextFunction): void => {
    try {
      const { name } = req.params;

      if (!isValidSoulName(name)) {
        res.status(400).json({ error: 'Bad Request', detail: 'Invalid soul name. Only alphanumerics and underscores allowed.' });
        return;
      }

      const { content } = req.body as { content?: string };
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'Bad Request', detail: 'Request body must include a "content" string field.' });
        return;
      }

      // 写入磁盘
      writeSoulFile(name, content);

      // 使内存缓存失效 — 下次 loadSoul() 会从磁盘重新加载
      invalidateSoul(name);

      res.json({ ok: true, name, message: `Soul "${name}" updated successfully. Cache invalidated.` });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
