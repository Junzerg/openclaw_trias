/**
 * OpenClaw Gateway Adapter — Minimal integration layer (Phase T0 → T3.1)
 *
 * Strategy: Use `openclaw` CLI as a subprocess for LLM calls and code execution.
 * Phase 3.1 upgrade: async `spawn` via `ITransport` (no more `execSync` / tmp files).
 *
 * Phase T4 will upgrade the transport to direct WebSocket communication for
 * streaming and finer-grained control. The public API (`callLLM`, `executeCode`)
 * stays the same — only the transport layer changes.
 */

import WebSocket from 'ws';
import { CliTransport, type ITransport } from './transport.js';
import { OpenClawError, OpenClawErrorType, classifyOutputError } from './errors.js';
import { withRetry } from './retry.js';

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { CliTransport, type ITransport } from './transport.js';
export { OpenClawError, OpenClawErrorType, classifyOutputError } from './errors.js';
export { withRetry, getRetryConfigForType, type RetryConfig } from './retry.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OpenClawAdapterConfig {
  /** OpenClaw Gateway WebSocket URL (default: ws://127.0.0.1:18789) */
  gatewayUrl: string;
  /** Default LLM model ref, e.g. "anthropic/claude-sonnet-4-20250514" */
  defaultModel?: string;
  /** CLI request timeout in seconds (default: 120) */
  timeoutSeconds: number;
  /** Path to the `openclaw` binary (default: "openclaw" — uses PATH) */
  cliBin: string;
  /** OpenClaw agent ID to use (default: "main") */
  agentId: string;
}

export interface LLMResponse {
  /** The text content of the LLM reply */
  content: string;
  /** Raw CLI stdout (for debugging) */
  rawOutput: string;
}

export interface ExecResult {
  /** Standard output from the executed code */
  stdout: string;
  /** Standard error from the executed code */
  stderr: string;
  /** Exit code (0 = success) */
  exitCode: number;
  /** Raw CLI stdout (for debugging) */
  rawOutput: string;
}

export type HealthStatus = {
  gateway: boolean;
  cli: boolean;
  details: string;
};

// ─── Default config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: OpenClawAdapterConfig = {
  gatewayUrl: 'ws://127.0.0.1:18789',
  timeoutSeconds: 120,
  cliBin: 'openclaw',
  agentId: 'main',
};

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class OpenClawAdapter {
  private config: OpenClawAdapterConfig;
  private transport: ITransport;

  constructor(config?: Partial<OpenClawAdapterConfig>, transport?: ITransport) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.transport = transport ?? new CliTransport(this.config.cliBin);
  }

  // ── Health Check ─────────────────────────────────────────────────────────

  /**
   * Check if the OpenClaw Gateway is reachable and the CLI is available.
   */
  async healthCheck(): Promise<HealthStatus> {
    const result: HealthStatus = {
      gateway: false,
      cli: false,
      details: '',
    };

    // 1. Check CLI availability
    try {
      const output = await this.runCliCommand(['--version']);
      if (output) {
        result.cli = true;
        // extractLLMContent may throw on banner-only output — fallback to raw
        let versionInfo: string;
        try {
          versionInfo = this.extractLLMContent(output);
        } catch {
          versionInfo = output.trim().substring(0, 200);
        }
        result.details += `CLI version: ${versionInfo}\n`;
      } else {
        result.details += `CLI not available: no output\n`;
        return result;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.details += `CLI not available: ${message}\n`;
      return result;
    }

    // 2. Check Gateway WebSocket connectivity
    try {
      await this.pingGateway();
      result.gateway = true;
      result.details += `Gateway reachable at ${this.config.gatewayUrl}\n`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.details += `Gateway not reachable: ${message}\n`;
    }

    return result;
  }

  /**
   * Attempt a basic WebSocket connection to the Gateway to verify it's online.
   * We don't complete the full handshake — just check TCP connectivity.
   */
  private pingGateway(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.config.gatewayUrl);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error('Gateway connection timeout (5s)'));
      }, 5000);
      timer.unref();

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve();
      });

      ws.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ── LLM Call ─────────────────────────────────────────────────────────────

  /**
   * Call an LLM via the OpenClaw CLI.
   *
   * Uses: `openclaw agent --message "<prompt>"`
   *
   * The system prompt is prepended to the user message as context.
   * In Phase T4, this will use the WebSocket API with proper session management.
   */
  async callLLM(systemPrompt: string, userMessage: string, model?: string): Promise<LLMResponse> {
    // Compose the full prompt with system context
    const fullMessage = [
      '=== SYSTEM INSTRUCTIONS (follow these strictly) ===',
      systemPrompt,
      '',
      '=== USER MESSAGE ===',
      userMessage,
    ].join('\n');

    const args = ['agent', '--agent', this.config.agentId, '--message', fullMessage];

    // Model priority: explicit param > config.defaultModel > omit
    const effectiveModel = model ?? this.config.defaultModel;
    const envOverride: NodeJS.ProcessEnv = {};
    if (effectiveModel) {
      envOverride.OPENCLAW_MODEL = effectiveModel;
      console.log(`[OpenClawAdapter] callLLM using OPENCLAW_MODEL=${effectiveModel}`);
    }

    // Wrap with withRetry — uses a static conservative config (maxRetries=2, exponential).
    // All retryable OpenClawErrors are retried with the same strategy.
    // Per-error-type configs (DEFAULT_RETRY_CONFIGS) are exported for downstream consumers.
    return withRetry(
      async () => {
        try {
          const rawOutput = await this.runCliCommand(args, envOverride);
          const content = this.extractLLMContent(rawOutput);
          return { content, rawOutput };
        } catch (err) {
          throw this.wrapError('callLLM', err);
        }
      },
      this.resolveRetryConfig(),
      (msg) => console.log(`[OpenClawAdapter] ${msg}`),
    );
  }

  /**
   * Extract meaningful LLM content from CLI stdout.
   *
   * The `openclaw agent` CLI may include status lines, thinking indicators,
   * or other decorations. We try to extract just the assistant's reply.
   */
  private extractLLMContent(stdout: string): string {
    // Strip ANSI escape codes first (the CLI outputs colored text)
    const ansiStripped = stdout.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*[a-zA-Z]/g,
      '',
    );

    const lines = ansiStripped.split('\n');
    const cleanLines = lines.filter((line) => {
      const trimmed = line.trim();
      // Skip spinner characters
      if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◓◇│]/.test(trimmed)) return false;
      // Skip OpenClaw banner
      if (trimmed.startsWith('🦞')) return false;
      // Skip timestamp log lines (e.g. "20:30:42 [plugins] ...")
      if (/^\d{2}:\d{2}:\d{2}\s+\[/.test(trimmed)) return false;
      // Skip [module] log lines that may leak from stderr (e.g. "[plugins] ...", "[core] ...")
      // 必须是全小写字母且带空格，避免误伤大模型输出的 [SIGN] / [CONSENSUS_REACHED] 等标签
      if (/^\[[a-z_]+\]\s/.test(trimmed)) {
        // Bug 5 fix: KEEP tool execution results! That's the actual payload!
        if (trimmed.includes('Result:') || trimmed.includes('args:')) {
          return true;
        }
        return false;
      }
      // Skip the tagline lines
      if (trimmed.startsWith('Automation with') || trimmed.startsWith('Runs on a')) return false;
      if (trimmed.startsWith('No $') || trimmed.startsWith('Alexa,')) return false;
      return true;
    });

    const result = cleanLines.join('\n').trim();

    // Detect hard failures from OpenClaw CLI/Gateway output.
    // Uses the centralized pattern table in errors.ts for classification.
    const errorType = classifyOutputError(cleanLines);
    if (errorType) {
      throw new OpenClawError(
        errorType,
        `OpenClaw error (${errorType}):\n${result.substring(0, 500)}`,
      );
    }

    if (!result) {
      console.error(`[OpenClawAdapter] extractLLMContent failed. Raw stdout was:\n---\n${stdout}\n---`);
      throw new OpenClawError(
        OpenClawErrorType.JSON_PARSE_ERROR,
        'LLM returned empty or unparseable response.',
      );
    }
    return result;
  }

  // ── Code Execution ───────────────────────────────────────────────────────

  /**
   * Execute code via the OpenClaw CLI's exec tool.
   *
   * Strategy: Ask the agent to run the code using the `exec` built-in tool.
   * The prompt is carefully crafted to get structured output.
   */
  async executeCode(
    code: string,
    language: string = 'javascript',
    model?: string,
  ): Promise<ExecResult> {
    const runtimeMap: Record<string, string> = {
      javascript: 'node -e',
      typescript: 'npx tsx -e',
      python: 'python3 -c',
      bash: 'bash -c',
      shell: 'bash -c',
    };

    const runtime = runtimeMap[language.toLowerCase()];
    if (!runtime) {
      throw new Error(
        `Unsupported language: ${language}. Supported: ${Object.keys(runtimeMap).join(', ')}`,
      );
    }

    // Build the command directly
    const command = `${runtime} ${JSON.stringify(code)}`;

    // Ask the agent to execute using the exec tool
    const prompt = [
      'Execute the following command using the exec tool. Return ONLY the raw output, no commentary:',
      '',
      '```',
      command,
      '```',
      '',
      'Important:',
      '- Use the exec tool to run this command',
      '- Do not modify the command',
      '- After execution, reply with exactly the stdout output, nothing else',
    ].join('\n');

    const args = ['agent', '--agent', this.config.agentId, '--message', prompt];

    const effectiveModel = model ?? this.config.defaultModel;
    const envOverride: NodeJS.ProcessEnv = {};
    if (effectiveModel) {
      envOverride.OPENCLAW_MODEL = effectiveModel;
      console.log(`[OpenClawAdapter] executeCode using OPENCLAW_MODEL=${effectiveModel}`);
    }

    return withRetry(
      async () => {
        try {
          const rawOutput = await this.runCliCommand(args, envOverride);
          const parsedOutput = this.extractLLMContent(rawOutput);

          // Bug 4 fix: 检测执行输出中的错误模式，而不是硬编码 exitCode=0
          const exitCode = this._inferExitCode(parsedOutput);

          return {
            stdout: exitCode === 0 ? parsedOutput : '',
            stderr: exitCode !== 0 ? parsedOutput : '',
            exitCode,
            rawOutput,
          };
        } catch (err) {
          throw this.wrapError('executeCode', err);
        }
      },
      this.resolveRetryConfig(),
      (msg) => console.log(`[OpenClawAdapter] ${msg}`),
    );
  }
  // ── Exit Code Inference ──────────────────────────────────────────────────

  /**
   * Infer the exit code from CLI execution output.
   *
   * Since the OpenClaw CLI wraps exec tool output in an LLM response,
   * we can't rely on process exit codes. Instead, we pattern-match
   * common error signatures from Python, Node.js, and shell.
   */
  private _inferExitCode(output: string): number {
    const ERROR_PATTERNS = [
      // Bug 27 fix: Python traceback — require the follow-up `  File "..."` line
      // to distinguish real tracebacks from LLM educational content mentioning "Traceback"
      /^Traceback \(most recent call last\):\n\s+File /m,
      // Named errors: require start-of-line (not inside quoted prose)
      /^(?:Syntax|ModuleNotFound|Import|FileNotFound|Permission|OS|Type|Value|Key|Attribute|Runtime|ZeroDivision)Error: /m,
      /^\w*Exception: /m,                              // Python exceptions
      /^node:internal\/|^ {4}at .+\(\d+:\d+\)/m,      // Node.js stack trace
      /^\/bin\/[a-z]+: .+: (not found|Permission denied)/m, // Shell errors
      /command not found/i,                            // Missing commands
      /exit code[:\s]+([1-9]\d*)/i,                    // Explicit exit code mention
      /exited with status ([1-9]\d*)/i,                // Exit status mention
    ];

    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(output)) {
        return 1;
      }
    }

    return 0;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Run an OpenClaw CLI command asynchronously via the injected transport.
   *
   * Phase 3.1: Replaced `execSync` + temp file with `ITransport.send()`.
   */
  private async runCliCommand(args: string[], envOverrides?: NodeJS.ProcessEnv): Promise<string> {
    return this.transport.send(args, this.config.timeoutSeconds * 1000, envOverrides);
  }

  /**
   * Resolve retry config. If the error is an OpenClawError, use its type-specific
   * config. Otherwise use a conservative fallback.
   */
  private resolveRetryConfig(): import('./retry.js').RetryConfig {
    // We use a generic config here because the error type isn't known until fn throws.
    // withRetry handles the type-based logic internally (retryable check).
    return { maxRetries: 2, backoff: 'exponential', baseDelayMs: 2000 };
  }

  private wrapError(method: string, err: unknown): Error {
    // Preserve OpenClawError — don't double-wrap classified errors
    if (err instanceof OpenClawError) {
      return err;
    }
    if (err instanceof Error) {
      // Classify transport-level CLI timeout as LLM_TIMEOUT so it's retryable
      if (/CLI timeout/i.test(err.message)) {
        return new OpenClawError(
          OpenClawErrorType.LLM_TIMEOUT,
          `[OpenClawAdapter.${method}] ${err.message}`,
          { cause: err },
        );
      }
      return new Error(`[OpenClawAdapter.${method}] ${err.message}`, { cause: err });
    }
    return new Error(`[OpenClawAdapter.${method}] ${String(err)}`);
  }
}

// ─── Smoke Test (run with: npx tsx src/openclaw/adapter.ts) ──────────────────

const isMainModule = process.argv[1]?.endsWith('adapter.ts') ||
                     process.argv[1]?.endsWith('adapter.js');

if (isMainModule) {
  (async () => {
  console.log('🦞 OpenClaw Adapter — Smoke Test\n');
  console.log('='.repeat(60));

  const adapter = new OpenClawAdapter();

  // Step 1: Health Check
  console.log('\n📡 Step 1: Health Check...');
  const health = await adapter.healthCheck();
  console.log(`   CLI available: ${health.cli ? '✅' : '❌'}`);
  console.log(`   Gateway reachable: ${health.gateway ? '✅' : '❌'}`);
  console.log(`   Details:\n${health.details.split('\n').map(l => `     ${l}`).join('\n')}`);

  if (!health.cli) {
    console.error('\n❌ OpenClaw CLI not found. Install with: npm install -g openclaw@latest');
    console.error('   Then run: openclaw onboard');
    process.exit(1);
  }

  if (!health.gateway) {
    console.error('\n⚠️  Gateway not reachable. Start it with: openclaw gateway');
    console.error('   Continuing with CLI-only tests (may still work if gateway starts automatically)...\n');
  }

  // Step 2: LLM Call
  console.log('\n🤖 Step 2: LLM Call...');
  try {
    const llmResponse = await adapter.callLLM(
      '你是一个极其简洁的助手，只用中文回答。',
      '请回复"连通成功"四个字，不要有任何其他内容。',
    );
    console.log(`   ✅ LLM Response: "${llmResponse.content.substring(0, 200)}"`);
    if (llmResponse.content.includes('连通成功')) {
      console.log('   🎉 LLM connectivity verified!');
    } else {
      console.log('   ⚠️  Got a response, but not the expected content (this is fine — LLM is working)');
    }
  } catch (err) {
    console.error(`   ❌ LLM Call failed: ${err instanceof Error ? err.message : err}`);
  }

  // Step 3: Code Execution
  console.log('\n💻 Step 3: Code Execution...');
  try {
    const execResult = await adapter.executeCode(
      'console.log("hello from openclaw"); console.log(2 + 2);',
      'javascript',
    );
    console.log(`   ✅ Exec stdout: "${execResult.stdout.substring(0, 200)}"`);
    if (execResult.stdout.includes('hello from openclaw')) {
      console.log('   🎉 Code execution verified!');
    } else {
      console.log('   ⚠️  Got output, but not the expected content');
    }
  } catch (err) {
    console.error(`   ❌ Code Execution failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 Smoke test complete.\n');
  })();
}
