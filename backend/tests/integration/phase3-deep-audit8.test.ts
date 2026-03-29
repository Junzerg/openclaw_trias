/**
 * Phase 3 Deep Audit — Round 8
 *
 * Bugs discovered through zero-trust security and architecture audit.
 *
 * Bug 49: Rules Engine evasion. "r\\m -rf", "base64 -d | sh" bypassed previous blacklists.
 * Bug 50: TaskQueue deadlock. A synchronous exception in factory dropped the slot permanently.
 * Bug 51: Sandbox OOM. truncateOutput converted massive strings to Buffer, risking OOM.
 * Bug 52: DB Transaction Isolation. dbBridge writes were sequential, causing dirty writes on crash.
 * Bug 53: Unhandled rejection swallowing. runPetition swallowed error.stack.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RulesEngine } from '../../src/agents/judicial/rules-engine';
import { truncateOutput } from '../../src/openclaw/sandbox';
import { TaskQueue } from '../../src/server/task-queue';
import { TaskStore } from '../../src/server/task-store';
import type { ConstitutionConfig } from '../../src/config/models';

function makeConstitution(): ConstitutionConfig {
  return {
    version: '1.0',
    judicial: {
      blacklist_commands: ['rm -rf', 'DROP TABLE'],
      token_budget: { max_per_task: 100000, debate_budget: 30000, execution_budget: 50000, review_budget: 20000 },
      debate: { max_rounds: 10, conflict_threshold: 80, consensus_threshold: 30, min_rounds: 2 },
      deviation: { max_score: 0.3 },
    },
    security: {
      sandbox_enabled: true,
      allowed_file_extensions: ['.py', '.js', '.ts'],
      max_execution_time_seconds: 300,
      max_file_size_mb: 10,
      network_access: 'restricted',
    },
    rbac: {
      permissions: ['PLAN', 'EXECUTE', 'MONITOR', 'VETO', 'KILL'],
      role_permissions: {},
    },
  } as ConstitutionConfig;
}

describe('Phase 3 Deep Audit — Round 8', () => {

  describe('Bug 49 [P0]: Rules Engine Evasion', () => {
    it('catches obfuscated rm -rf (r\\m, rm /* -rf)', () => {
      const rules = new RulesEngine(makeConstitution());
      
      const commands = [
        'r\\m -rf /',
        'r"m" -rf /',
        "r'm' -r -f",
        'rm /* -rf',
        'sudo rm -fr /'
      ];

      for (const cmd of commands) {
         expect(rules.checkCommand(cmd).passed).toBe(false);
      }
    });

    it('catches base64 and xxd reverse shells', () => {
      const rules = new RulesEngine(makeConstitution());
      expect(rules.checkCommand('echo "cm0gLXJmIC8=" | base64 -d | sh').passed).toBe(false);
      expect(rules.checkCommand('echo "213" | xxd -r | bash').passed).toBe(false);
    });

    it('catches obfuscated dynamic imports', () => {
      const rules = new RulesEngine(makeConstitution());
      expect(rules.checkCommand('import(Buffer.from("ZnM=", "base64").toString())').passed).toBe(false);
    });
  });

  describe('Bug 50 [P1]: TaskQueue Deadlock on Synchronous Throw', () => {
    it('recovers from a synchronous throw in task factory', async () => {
      const queue = new TaskQueue(1);
      
      let task2Ran = false;

      // task 1 throws synchronously (does not return a Promise)
      await queue.submit('task-1', () => {
        throw new Error('Sync throw');
      });

      // task 2 is a normal async task
      await queue.submit('task-2', async () => {
        task2Ran = true;
      });

      // Wait for queue logic to process things
      await new Promise(r => setTimeout(r, 100));

      // In the bug, task 2 would never run because task 1's sync throw
      // leaves `running.size` at 1 permanently without triggering `.finally`
      expect(task2Ran).toBe(true);
      expect(queue.runningCount).toBe(0);
    });
  });

  describe('Bug 51 [P1]: Sandbox OOM on massive outputs', () => {
    it('safely truncates massive strings without Buffer conversion allocating full size', () => {
      // Generate a string that exceeds maxBytes * 2 + 100
      const maxBytes = 50 * 1024;
      // 200KB string (would allocate 200KB buffer directly before fix).
      // Here we just verify it truncates properly and returns cleanly
      const hugeString = 'A'.repeat(maxBytes * 4);
      
      const result = truncateOutput(hugeString, maxBytes);
      
      expect(result).toContain('[OUTPUT TRUNCATED');
      expect(Buffer.byteLength(result, 'utf8')).toBeLessThan(maxBytes + 100);
      
      // Ensure it works normally for small outputs
      expect(truncateOutput('hello', 50)).toBe('hello');
    });
  });

  describe('Bug 52 [P0]: Database Transaction Isolation', () => {
    it('storeEventBatch uses atomic transaction (rolls back on failure)', async () => {
      const store = new TaskStore(':memory:');
      await store.initialize();

      // Create a task first (foreign key constraint)
      await store.createTask('task-tx', 'Test petition');

      try {
        await store.storeEventBatch(
            'task-tx',
            { sourceAgent: 'test', action: 'TOOL_CALL', emotion: 'neutral', intensity: 0.5, payloadStr: '{}' },
            'running',
            // Pass an invalid value to force SQLite to throw on storeAct step
            // Actually, inserting into `verdicts` without required fields or wrong types
            // For verbs, constitutional integer is NOT NULL. We can pass undefined if not careful,
            // but TS types restrict us. Let's simulate a failure by breaking the DB schema dynamically,
            // or simply relying on the code structure that uses `db.transaction`.
            // Let's pass an execution error condition: Since task_id is primary key, inserting the same act twice will throw PRIMARY KEY violation.
            undefined,
            { constitutional: true, ruling: 'ok', evidence: '[]' }
        );

        // Intentionally cause a Unique Constraint violation in the SAME transaction
        await store.storeEventBatch(
            'task-tx',
            { sourceAgent: 'test', action: 'VOTE', emotion: 'neutral', intensity: 0.5, payloadStr: '{}' },
            'drafting', 
            undefined,
            { constitutional: false, ruling: null as any, evidence: '[]' } // this will throw NOT NULL violation on verdicts.ruling
        );
      } catch (err: any) {
        expect(err.message).toContain('NOT NULL constraint failed: verdicts.ruling');
      }

      // Verify the transaction was completely rolled back!
      // The second batch attempted to insert an event, update state, and insert verdict.
      // Since verdict threw, the entire tx rolls back.
      // So there should only be 1 event globally, and state should still be 'running' (from first batch).
      const task = await store.getTask('task-tx');
      const events = await store.getTaskEvents('task-tx');

      expect(task?.bill_state).toBe('running'); // Did NOT update to 'drafting'
      expect(events.length).toBe(1); // Did NOT save the second event

      await store.close();
    });
  });

});
