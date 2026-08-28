/**
 * Tests for HttpProvider's multi-doc apply wiring.
 *
 * `applyYamlBundle` used to be stubbed in HttpProvider (returned `[]` with a
 * "not proxied yet" comment), which silently broke the create-workload
 * wizard's apply step in web mode. It must inherit the faithful
 * `BaseRpcProvider` implementation, i.e. go over the wire as
 * `apply_yaml_bundle` and pass the server's result through — exactly like the
 * sibling `dryRunYamlBundle` already does.
 *
 * The transport layer (`httpInvoke`) is mocked so no real fetch happens; the
 * mock asserts both the wire command name and the result passthrough.
 */

vi.mock('./transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transport')>();
  return {
    ...actual,
    httpInvoke: vi.fn(),
  };
});

import { describe, expect, it, vi } from 'vitest';
import { httpInvoke } from './transport';
import { HttpProvider } from './HttpProvider';
import type { ApplyResult } from './types';
import type { HelmOp } from './types';

const yaml = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nginx\n';

const applyResults: ApplyResult[] = [
  { name: 'nginx', kind: 'Deployment', namespace: 'default', action: 'created', error: null },
];

function makeProvider(): HttpProvider {
  vi.mocked(httpInvoke).mockReset();
  vi.mocked(httpInvoke).mockImplementation(async <T,>(cmd: string) => {
    if (cmd === 'apply_yaml_bundle') return applyResults as T;
    return [] as T;
  });
  return new HttpProvider();
}

describe('HttpProvider.applyYamlBundle', () => {
  it('delegates to rpc apply_yaml_bundle (not stubbed)', async () => {
    const provider = makeProvider();
    const r = await provider.applyYamlBundle(yaml);
    expect(r).toEqual(applyResults);
    expect(httpInvoke).toHaveBeenCalledTimes(1);
    expect(httpInvoke).toHaveBeenCalledWith('apply_yaml_bundle', { yaml });
  });
});

describe('HttpProvider.helmRunOp', () => {
  it('sends the whole HelmOp nested under op — both transports deserialize { op: HelmOp }', async () => {
    vi.mocked(httpInvoke).mockReset();
    vi.mocked(httpInvoke).mockImplementation(async <T,>() =>
      ({ op: 'upgrade', release: 'r', namespace: 'ns', success: true, lines: 0, summary: 'ok' }) as T
    );
    const provider = new HttpProvider();
    const op: HelmOp = {
      op: 'upgrade',
      args: {
        release: 'r',
        chart: '/p',
        version: '',
        namespace: 'ns',
        values: '',
        dryRun: false,
        reuseValues: false,
        rollbackOnFailure: false,
        createNamespace: true,
        atomic: true,
        force: false,
        timeoutSecs: 300,
        set: null,
      },
    };
    await provider.helmRunOp(op);
    // The flat shape (`{ op: 'upgrade', ...args }`) handed the backend a bare
    // string for its internally-tagged enum and no op could ever run; the
    // enum object itself must ride under `op`.
    expect(httpInvoke).toHaveBeenCalledWith('helm_run_op', { op });
  });
});
