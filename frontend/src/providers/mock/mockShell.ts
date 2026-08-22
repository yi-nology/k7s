/**
 * Mock shell, logs, and port-forward operations.
 */

import type {
  ForwardInfo,
  LogHandle,
  LogLine,
  LogOptions,
  NodeShellHandle,
  ResourceRef,
  SavedLog,
  ShellHandle,
  Unsub,
} from '../types';
import { MOCK_PODS } from './data';
import { makeLogLine, seedLogLines } from './logs';

/** Interval (ms) between mock log lines. */
const LOG_TICK_MS = 900;

export class MockShellMixin {
  protected forwardCbs = new Set<(f: ForwardInfo[]) => void>();
  protected forwards: ForwardInfo[] = [];

  async startLogs(
    ref: ResourceRef,
    container: string,
    _opts: LogOptions,
    onLines: (lines: LogLine[]) => void,
    _onClosed: (reason: string) => void
  ): Promise<LogHandle> {
    const pod = MOCK_PODS.find((p) => p.name === ref.name);
    const containers = pod?.containers ?? ['app'];
    const tag = () =>
      container === '' ? containers[Math.floor(Math.random() * containers.length)] : container;
    const withTag = (lines: LogLine[]) => lines.map((l) => ({ ...l, container: tag() }));

    onLines(withTag(seedLogLines(ref.name)));
    const timer = setInterval(() => {
      onLines(withTag([makeLogLine(ref.name)]));
    }, LOG_TICK_MS);

    return {
      stop() {
        clearInterval(timer);
      },
    };
  }

  async saveLogs(): Promise<SavedLog | null> {
    return null;
  }

  async startShell(
    _ref: ResourceRef,
    container: string,
    onOutput: (data: string) => void,
    _onClosed: (reason: string) => void
  ): Promise<ShellHandle> {
    const prompt = `\x1b[32m${container}\x1b[0m:/# `;
    onOutput(`demo shell — echoes input (no real container)\r\n${prompt}`);
    return {
      input: (data: string) => {
        onOutput(data === '\r' ? `\r\n${prompt}` : data);
      },
      resize: () => {},
      stop: () => {},
    };
  }

  async startNodeShell(
    node: string,
    onOutput: (data: string) => void,
    _onClosed: (reason: string) => void
  ): Promise<NodeShellHandle> {
    const pod = `k7s-debug-${node}-1`;
    await new Promise((r) => setTimeout(r, 1200));

    const prompt = `\x1b[32mroot@${node}\x1b[0m:~# `;
    onOutput(
      `demo node shell — echoes input (no real node)\r\n` +
        `\x1b[90mreal sessions run in pod ${pod}\x1b[0m\r\n${prompt}`
    );
    return {
      namespace: 'default',
      pod,
      input: (data: string) => {
        onOutput(data === '\r' ? `\r\n${prompt}` : data);
      },
      resize: () => {},
      stop: () => {},
    };
  }

  async startPortForward(ref: ResourceRef, remotePort: number): Promise<ForwardInfo> {
    const isService = ref.kind === 'services';
    const fwd: ForwardInfo = {
      id: `pf-${ref.name}-${remotePort}-${this.forwards.length}`,
      namespace: ref.namespace ?? '',
      pod: isService ? `${ref.name}-6c8d9-mn4p` : ref.name,
      service: isService ? ref.name : undefined,
      remotePort: isService ? 8080 : remotePort,
      servicePort: isService && remotePort !== 8080 ? remotePort : undefined,
      localPort: 20000 + Math.floor(Math.random() * 10000),
    };
    this.forwards.push(fwd);
    this.emitForwards();
    return fwd;
  }

  async stopPortForward(id: string): Promise<void> {
    this.forwards = this.forwards.filter((f) => f.id !== id);
    this.emitForwards();
  }

  async listPortForwards(): Promise<ForwardInfo[]> {
    return this.forwards;
  }

  onForwards(cb: (forwards: ForwardInfo[]) => void): Unsub {
    this.forwardCbs.add(cb);
    return () => {
      this.forwardCbs.delete(cb);
    };
  }

  protected emitForwards(): void {
    for (const cb of this.forwardCbs) cb([...this.forwards]);
  }
}
