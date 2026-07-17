/**
 * Minimal LSP stdio client for the E2E smoke suite: spawns the bundled server, frames
 * JSON-RPC with Content-Length headers, and auto-replies `result: null` to every
 * server→client request (`client/registerCapability` etc.), which is all the smoke
 * flows need from the client side.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';

interface RpcError {
  readonly code: number;
  readonly message: string;
}

interface RpcMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: RpcError;
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
}

const RESPONSE_TIMEOUT_MS = 15_000;

export class LspClient {
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;
  private readonly pending = new Map<number, Pending>();
  private buffer = Buffer.alloc(0);
  private nextId = 1;

  constructor(serverModule: string) {
    this.child = spawn(process.execPath, [serverModule, '--stdio'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    // A dead server must surface as a timed-out request, not an unhandled stream error.
    this.child.stdin.on('error', () => undefined);
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const done = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`${method}: no response within ${String(RESPONSE_TIMEOUT_MS)}ms`));
        }
      }, RESPONSE_TIMEOUT_MS).unref();
    });
    this.send({ jsonrpc: '2.0', id, method, params });
    return (await done) as T;
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  /** `shutdown` + `exit` per the LSP lifecycle, with a SIGKILL fallback so the suite never hangs. */
  async dispose(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return;
    }
    try {
      await this.request('shutdown', null);
      this.notify('exit');
    } catch {
      // Server already gone or unresponsive; the kill below still reaps it.
    }
    const killer = setTimeout(() => this.child.kill('SIGKILL'), 2000);
    await once(this.child, 'exit');
    clearTimeout(killer);
  }

  private send(message: object): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.child.stdin.write(`Content-Length: ${String(body.length)}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  private drain(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const length = /Content-Length: *(\d+)/i.exec(header)?.[1];
      if (length === undefined) {
        throw new Error(`unparsable LSP frame header: ${header}`);
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + Number(length);
      if (this.buffer.length < bodyEnd) {
        return;
      }
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);
      this.dispatch(JSON.parse(body) as RpcMessage);
    }
  }

  private dispatch(message: RpcMessage): void {
    if (message.method !== undefined) {
      if (message.id !== undefined) {
        this.send({ jsonrpc: '2.0', id: message.id, result: null });
      }
      return;
    }
    if (typeof message.id !== 'number') {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${pending.method}: server error ${String(message.error.code)}: ${message.error.message}`));
    } else {
      pending.resolve(message.result);
    }
  }
}
