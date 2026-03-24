/**
 * OpenClaw Transport Layer — Abstraction for CLI / WebSocket communication
 *
 * Phase 3.1: `CliTransport` uses `child_process.spawn` (async, non-blocking).
 * Phase 4:   `WebSocketTransport` will implement the same `ITransport` interface
 *            for direct Gateway streaming — zero changes to `OpenClawAdapter`.
 */

import { spawn, type ChildProcess } from 'node:child_process';

// ─── Interface ───────────────────────────────────────────────────────────────

export interface ITransport {
  /** Send a command and wait for the complete response. */
  send(args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<string>;

  /**
   * Register a progress callback. Called every ~3 s while a command is running.
   * Useful for pushing heartbeat events during long LLM calls.
   */
  onProgress?(callback: (elapsedMs: number) => void): void;

  /** Clean up resources (kill lingering processes, close sockets, etc.). */
  dispose?(): void;
}

// ─── CLI Transport ───────────────────────────────────────────────────────────

/** Maximum output buffer size (bytes). Matches the old execSync maxBuffer. */
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

export class CliTransport implements ITransport {
  private cliBin: string;
  private progressCallback?: (elapsedMs: number) => void;

  constructor(cliBin: string = 'openclaw') {
    this.cliBin = cliBin;
  }

  onProgress(callback: (elapsedMs: number) => void): void {
    this.progressCallback = callback;
  }

  async send(args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // Spawn the CLI binary directly — no bash wrapper.
      // This ensures SIGTERM on timeout kills the actual process (not just a
      // bash shell), and avoids orphaned child processes.  Node.js's execvp
      // handles PATH lookup, so no shell is needed.
      const child: ChildProcess = spawn(
        this.cliBin,
        args,
        { env: env ? { ...process.env, ...env } : { ...process.env } },
      );

      let output = '';
      let outputBytes = 0;
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (heartbeat) clearInterval(heartbeat);
        fn();
      };

      // Collect stdout + stderr into a single buffer (matches old execSync behaviour)
      // Capped at MAX_BUFFER to prevent OOM from runaway CLI output.
      const appendOutput = (chunk: Buffer) => {
        if (outputBytes >= MAX_BUFFER) return;
        const str = chunk.toString();
        output += str;
        outputBytes += chunk.length;
      };
      child.stdout?.on('data', appendOutput);
      child.stderr?.on('data', appendOutput);

      // Timeout protection: SIGTERM first, SIGKILL fallback after 2 s
      // .unref() so the timer doesn't prevent Node.js exit in short-lived scripts
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        // If the process ignores SIGTERM, escalate after 2 s
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, 2000).unref();
        settle(() =>
          reject(new Error(`CLI timeout after ${timeoutMs}ms`)),
        );
      }, timeoutMs);
      timer.unref();

      // Progress heartbeat every 3 s (only if a callback is registered)
      // .unref() so the interval doesn't prevent Node.js exit
      let elapsedMs = 0;
      const heartbeat = this.progressCallback
        ? setInterval(() => {
            elapsedMs += 3000;
            this.progressCallback?.(elapsedMs);
          }, 3000)
        : undefined;
      heartbeat?.unref();

      // Resolve on close (even non-zero exit — existing behaviour)
      child.on('close', () => {
        settle(() => resolve(output));
      });

      child.on('error', (err: Error) => {
        settle(() => reject(err));
      });
    });
  }

  dispose(): void {
    this.progressCallback = undefined;
  }
}
