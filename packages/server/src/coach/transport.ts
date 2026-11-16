// How the server reaches the coach. One interface, one implementation today: a headless Claude
// Code process on the owner's plan login (decision D17). The launch command was confirmed in
// spike S1 (TRACKER, Phase 2). Terminal-attach and an API key are designed for, not built.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type TransportEvents = {
  init: (info: { model: string; tools: string[]; mcpConnected: boolean }) => void;
  /** one turn finished */
  result: (r: { isError: boolean; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; apiMs: number }) => void;
  retry: (detail: string) => void;
  /** plain assistant text: logged, never shown on the page */
  text: (text: string) => void;
  toolUse: (name: string) => void;
  exit: (info: { code: number | null; expected: boolean; stderr: string }) => void;
};

export interface CoachTransport {
  start(): void;
  /** One event for the coach, as the text of a user message. */
  send(text: string): void;
  stop(): void;
  readonly running: boolean;
}

export type HeadlessOptions = {
  claudePath: string;
  cwd: string;
  model: string;
  systemPromptFile: string;
  mcpConfigFile: string;
  events: TransportEvents;
};

export class HeadlessCliTransport implements CoachTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private expectedExit = false;
  private stderr = '';
  private readonly opts: HeadlessOptions;

  constructor(opts: HeadlessOptions) {
    this.opts = opts;
  }

  get running(): boolean {
    return this.child !== null;
  }

  start() {
    const o = this.opts;
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', o.model,
      // the coach gets exactly one tool server and nothing else: no files, no shell, no web
      '--mcp-config', o.mcpConfigFile,
      '--strict-mcp-config',
      '--tools', '',
      '--allowedTools', 'mcp__chess__*',
      '--permission-mode', 'dontAsk',
      // its instructions are the composed coach prompt, not the build instructions in CLAUDE.md,
      // and not the owner's personal plugins and skills
      '--system-prompt-file', o.systemPromptFile,
      '--setting-sources', 'project',
      '--disable-slash-commands',
      '--no-session-persistence',
    ];
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_')) delete env[k];
    env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
    this.expectedExit = false;
    this.stderr = '';
    const child = spawn(o.claudePath, args, { cwd: o.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    let buffer = '';
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) this.onLine(line);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      this.stderr = (this.stderr + d.toString('utf8')).slice(-4000);
    });
    child.stdin.on('error', () => {});
    child.on('error', (e) => {
      this.stderr += `\n${e.message}`;
      this.finish(null);
    });
    child.on('exit', (code) => this.finish(code));
  }

  private finish(code: number | null) {
    if (!this.child) return;
    this.child = null;
    this.opts.events.exit({ code, expected: this.expectedExit, stderr: this.stderr });
  }

  private onLine(line: string) {
    let o: Record<string, any>;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    const ev = this.opts.events;
    if (o.type === 'system' && o.subtype === 'init') {
      const mcp = Array.isArray(o.mcp_servers) ? o.mcp_servers.find((s: any) => s.name === 'chess') : null;
      ev.init({ model: String(o.model ?? ''), tools: Array.isArray(o.tools) ? o.tools : [], mcpConnected: mcp?.status === 'connected' });
    } else if (o.type === 'system' && o.subtype === 'api_retry') {
      ev.retry(String(o.error ?? o.message ?? 'retrying'));
    } else if (o.type === 'assistant') {
      for (const block of o.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) ev.text(block.text);
        else if (block.type === 'tool_use') ev.toolUse(String(block.name));
      }
    } else if (o.type === 'result') {
      const u = o.usage ?? {};
      ev.result({
        isError: !!o.is_error,
        inputTokens: Number(u.input_tokens ?? 0),
        outputTokens: Number(u.output_tokens ?? 0),
        cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
        cacheWriteTokens: Number(u.cache_creation_input_tokens ?? 0),
        costUsd: Number(o.total_cost_usd ?? 0),
        apiMs: Number(o.duration_api_ms ?? 0),
      });
    }
  }

  send(text: string) {
    if (!this.child) throw new Error('the coach process is not running');
    this.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n');
  }

  stop() {
    if (!this.child) return;
    this.expectedExit = true;
    try {
      this.child.stdin.end();
    } catch {
      /* ignore */
    }
    const child = this.child;
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, 300);
  }
}
