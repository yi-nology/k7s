import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  runBulk,
  bulkErrorText,
  confirmText,
  listNames,
  plural,
  type ActionId,
} from './actions';
import type { Row } from '../providers/types';

function row(name: string, extra: Partial<Row> = {}): Row {
  return { uid: `uid-${name}`, name, namespace: 'prod', cells: [], ...extra };
}

const ids = (kind: string, rows: Row[]): ActionId[] => actionsFor(kind, rows).map((a) => a.id);

describe('actionsFor — single row', () => {
  it('offers pod actions on a pod', () => {
    const got = ids('pods', [row('p')]);
    expect(got).toContain('delete');
    expect(got).toContain('restart');
    expect(got).toContain('forward');
    expect(got).not.toContain('scale');
    expect(got).not.toContain('cordon');
  });

  it('offers node actions on a node, but not delete', () => {
    const got = ids('nodes', [row('n')]);
    expect(got).toEqual(expect.arrayContaining(['cordon', 'uncordon', 'drain']));
    // Deleting a Node object doesn't decommission a machine; it deregisters it,
    // which is not what a Delete item in a list view implies.
    expect(got).not.toContain('delete');
  });

  it('offers scale only on scalable workloads', () => {
    expect(ids('deployments', [row('d')])).toContain('scale');
    expect(ids('statefulsets', [row('s')])).toContain('scale');
    expect(ids('daemonsets', [row('ds')])).not.toContain('scale');
    expect(ids('pods', [row('p')])).not.toContain('scale');
  });

  /** A Helm row is a view over a storage Secret; deleting it corrupts the release. */
  it('offers nothing destructive on a Helm release', () => {
    expect(ids('helm', [row('rel')])).not.toContain('delete');
  });

  it('offers View pods only when there is a selector to filter by', () => {
    expect(ids('deployments', [row('d', { selector: { app: 'x' } })])).toContain('view-pods');
    expect(ids('deployments', [row('d')])).not.toContain('view-pods');
    expect(ids('deployments', [row('d', { selector: {} })])).not.toContain('view-pods');
  });

  /** Ingress Editor moved from a sidebar nav item to a row action — it now
   *  appears only on the Ingresses table (mirrors the files/pods gate). */
  it('offers edit-ingress only on ingresses', () => {
    expect(ids('ingresses', [row('ing')])).toContain('edit-ingress');
    expect(ids('pods', [row('p')])).not.toContain('edit-ingress');
    expect(ids('services', [row('svc')])).not.toContain('edit-ingress');
  });

  it('offers no actions for a kind with none', () => {
    // Namespaces can't be deleted from here (the cluster manages their
    // lifecycle), and they have no pods, no selector, no replicas to scale —
    // but `download-yaml` is universal and applies (Bxx). The test pins the
    // "nothing else" half of that: delete / scale / restart / etc. must
    // remain absent.
    const ids = actionsFor('namespaces', [row('ns')]).map((a) => a.id);
    expect(ids).toContain('download-yaml');
    expect(ids).not.toContain('delete');
    expect(ids).not.toContain('scale');
    expect(ids).not.toContain('restart');
    expect(ids).not.toContain('view-pods');
    expect(ids).not.toContain('forward');
  });

  it('offers nothing for an empty selection', () => {
    expect(actionsFor('pods', [])).toEqual([]);
  });
});

/**
 * The `download-yaml` action is universal: every row whose provider can fetch
 * its YAML is fair game (Bxx). The selector picks this up by returning true
 * for any kind, including synthetic ones like `helm` and `events`. We pin
 * that here across the full KindId set, because the alternative — an
 * `applies()` switch listing every kind — is a maintenance trap and would
 * have to be touched every time a new kind is added to the sidebar.
 */
describe('actionsFor — download-yaml (Bxx)', () => {
  const allKinds: Array<Parameters<typeof actionsFor>[0]> = [
    'pods',
    'deployments',
    'statefulsets',
    'daemonsets',
    'jobs',
    'cronjobs',
    'services',
    'ingresses',
    'configmaps',
    'secrets',
    'persistentvolumeclaims',
    'nodes',
    'namespaces',
    'helm',
    'events',
  ];

  for (const kind of allKinds) {
    it(`includes download-yaml for kind="${kind}"`, () => {
      // Events live in a synthetic store row with no namespace; pass
      // `namespace: undefined` to match that shape so the test stays
      // representative rather than filtering events out.
      const r: Row = { uid: `u-${kind}`, name: 'x', cells: [] };
      const got = actionsFor(kind, [r]);
      expect(got.map((a) => a.id)).toContain('download-yaml');
    });
  }

  it('download-yaml is bulk-capable (multi-row selection)', () => {
    const got = actionsFor('pods', [row('a'), row('b')]);
    expect(got.map((a) => a.id)).toContain('download-yaml');
  });
});

/**
 * The "modify-image" action is workload-specific (Bxx). Services,
 * ConfigMaps, and PVCs have no `containers:` array to swap, so the
 * selector returns false for them — surfacing the menu item on those
 * pages would only lead to an empty form. The rollout family
 * (Deployment / STS / DS), Jobs, CronJobs, and ReplicaSets are all
 * fair game.
 */
describe('actionsFor — modify-image (Bxx)', () => {
  it('is offered on every workload kind that owns a pod template', () => {
    const workloads: Array<Parameters<typeof actionsFor>[0]> = [
      'deployments',
      'statefulsets',
      'daemonsets',
      'jobs',
      'cronjobs',
      'replicasets',
    ];
    for (const kind of workloads) {
      const got = actionsFor(kind, [row('x')]);
      expect(
        got.map((a) => a.id),
        kind
      ).toContain('modify-image');
    }
  });

  it('is NOT offered on kinds without containers', () => {
    const nonWorkloads: Array<Parameters<typeof actionsFor>[0]> = [
      'services',
      'configmaps',
      'secrets',
      'persistentvolumeclaims',
      'nodes',
      'namespaces',
    ];
    for (const kind of nonWorkloads) {
      const got = actionsFor(kind, [row('x')]);
      expect(
        got.map((a) => a.id),
        kind
      ).not.toContain('modify-image');
    }
  });

  it('is NOT offered on pods (pods are restartable, not modifiable)', () => {
    // Pods have containers but no pod template — the action would
    // patch the Pod, which is not a long-lived object and would be
    // recreated by its controller on the next reconciliation. The
    // form's "Modify image" wouldn't survive a restart. `restart`
    // is the right action for pods.
    const got = actionsFor('pods', [row('p')]);
    expect(got.map((a) => a.id)).not.toContain('modify-image');
  });

  it('modify-image is single-row only (a multi-row dialog would be unwieldy)', () => {
    // The action is `bulk: false`, so a multi-row selection filters it
    // out before the user sees the menu. Verify both halves:
    //   - single-row offers the action
    //   - multi-row does not
    const single = actionsFor('deployments', [row('a')]);
    expect(single.map((a) => a.id)).toContain('modify-image');
    expect(single.find((a) => a.id === 'modify-image')?.bulk).toBe(false);

    const multi = actionsFor('deployments', [row('a'), row('b')]);
    expect(multi.map((a) => a.id)).not.toContain('modify-image');
  });
});

describe('actionsFor — bulk', () => {
  const pods = [row('a'), row('b'), row('c')];

  it('keeps bulk-capable actions', () => {
    const got = ids('pods', pods);
    expect(got).toContain('delete');
    expect(got).toContain('restart');
  });

  /**
   * Both take a parameter that would have to be the same for every row, which is
   * never what someone selecting three different pods means.
   */
  it('drops actions that need a parameter', () => {
    const got = ids('pods', pods);
    expect(got).not.toContain('forward');
    expect(ids('deployments', [row('d1'), row('d2')])).not.toContain('scale');
  });

  /**
   * Draining several nodes at once is how you evict everything with nowhere left
   * to reschedule it — and the progress UI tracks one node at a time regardless.
   */
  it('drops drain, but keeps cordon', () => {
    const nodes = [row('n1'), row('n2')];
    expect(ids('nodes', nodes)).not.toContain('drain');
    expect(ids('nodes', nodes)).toContain('cordon');
  });

  /**
   * An action must apply to every row, not just one — otherwise the menu offers
   * something that fails partway through and leaves the selection half-acted-on.
   */
  it('requires the action to apply to every row', () => {
    const mixed = [row('d1', { selector: { app: 'x' } }), row('d2')];
    expect(ids('deployments', mixed)).not.toContain('view-pods');
  });
});

describe('confirmText', () => {
  it('names the single object', () => {
    expect(confirmText('delete', 'pods', [row('api-7d9f')])).toBe('Delete api-7d9f?');
  });

  /**
   * The whole risk of a bulk action is that the selection isn't what you think.
   * A count alone can't reveal that; the names can.
   */
  it('enumerates the names for a bulk action', () => {
    const text = confirmText('delete', 'pods', [row('a'), row('b'), row('c')]);
    expect(text).toContain('3 pods');
    expect(text).toContain('a, b, c');
  });

  it('truncates a long list instead of printing hundreds of names', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`pod-${i}`));
    const text = confirmText('delete', 'pods', rows);
    expect(text).toContain('30 pods');
    expect(text).toContain('and 22 more');
    expect(text).not.toContain('pod-25');
  });

  /** Pod restart is delete-and-recreate; a rollout is a template patch. */
  it('explains the mechanism, which differs by kind', () => {
    expect(confirmText('restart', 'pods', [row('p')])).toContain('controller recreates it');
    expect(confirmText('restart', 'deployments', [row('d')])).toContain('rollout restart');
  });

  it('uses plural grammar for a bulk pod restart', () => {
    const text = confirmText('restart', 'pods', [row('a'), row('b')]);
    expect(text).toContain('their controllers recreate them');
  });

  /**
   * The whole point of listing names in a confirmation is to reveal what the
   * selection actually holds. Two pods named `api` in different namespaces
   * would otherwise look identical in the dialog; prefixing the namespace
   * makes the cross-namespace selection unambiguous.
   */
  it('prefixes each name with its namespace when the selection spans namespaces', () => {
    const rows = [
      row('api', { namespace: 'default' }),
      row('api', { namespace: 'kube-system' }),
      row('worker', { namespace: 'monitoring' }),
    ];
    const text = confirmText('delete', 'pods', rows);
    expect(text).toContain('default/api, kube-system/api, monitoring/worker');
    // And the count is still right — the namespace prefix doesn't change the
    // shape, only the disambiguation.
    expect(text).toContain('3 pods');
  });

  /**
   * The single-namespace case is unchanged: a user selecting three pods in
   * `prod` sees the same dialog they always have, and a refactor that
   * accidentally introduced a namespace prefix here would be a UX regression.
   */
  it('keeps the bare names when every row is in the same namespace', () => {
    const rows = [
      row('a', { namespace: 'prod' }),
      row('b', { namespace: 'prod' }),
      row('c', { namespace: 'prod' }),
    ];
    const text = confirmText('delete', 'pods', rows);
    expect(text).toContain('a, b, c');
    expect(text).not.toContain('prod/');
  });
});

describe('plural', () => {
  it('singularises and pluralises known kinds', () => {
    expect(plural('pods', 1)).toBe('pod');
    expect(plural('pods', 3)).toBe('pods');
    expect(plural('nodes', 2)).toBe('nodes');
  });

  /** "ingresss" would be visibly wrong in a confirmation. */
  it('handles sibilant endings', () => {
    expect(plural('ingresses', 2)).toBe('ingresses');
  });

  /** Custom kinds are "group/plural" ids; the readable half is after the slash. */
  it('falls back to the plural half of a custom kind id', () => {
    expect(plural('argoproj.io/applications', 1)).toBe('applications');
  });
});

describe('listNames', () => {
  it('joins a short list in full', () => {
    expect(listNames([row('a'), row('b')])).toBe('a, b');
  });

  /**
   * Two pods with the same name in different namespaces must not look
   * identical in a confirmation — the namespace is the disambiguator.
   */
  it('prefixes each name with its namespace when the rows span namespaces', () => {
    expect(
      listNames([row('api', { namespace: 'default' }), row('api', { namespace: 'kube-system' })])
    ).toBe('default/api, kube-system/api');
  });

  /**
   * Truncation still works with the cross-namespace prefix — the limit applies
   * to the row count, not the rendered string length.
   */
  it('truncates a long cross-namespace list and preserves the prefixes', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`p-${i}`, { namespace: i % 2 === 0 ? 'default' : 'kube-system' })
    );
    const text = listNames(rows);
    // Two of the first 8 share a name ("p-0") and would look identical in the
    // dialog — the namespace prefix is the only thing that distinguishes them.
    expect(text).toContain('default/p-0, kube-system/p-1, default/p-2');
    expect(text).toContain('and 4 more');
  });

  /** Cluster-scoped kinds have no namespace; the bare name is enough. */
  it('leaves cluster-scoped names unprefixed', () => {
    const a = row('n1', { namespace: undefined });
    const b = row('n2', { namespace: undefined });
    expect(listNames([a, b])).toBe('n1, n2');
  });

  /**
   * Cluster-scoped + namespaced in the same selection is degenerate (a table
   * only shows one kind), but the helper stays consistent: the rows' namespaces
   * differ, so namespaced rows get prefixed and the cluster-scoped one doesn't.
   */
  it("mixes prefixed and unprefixed names when the rows' namespaces differ", () => {
    const a = row('node-1', { namespace: undefined });
    const b = row('api', { namespace: 'default' });
    expect(listNames([a, b])).toBe('node-1, default/api');
  });
});

describe('bulkErrorText', () => {
  it('is silent when everything worked', () => {
    expect(bulkErrorText({ ok: 3, failures: [] })).toBeNull();
  });

  /**
   * A partial failure is the normal outcome across objects with different owners
   * or permissions, and "some worked" is exactly what the user has to know before
   * deciding what to retry.
   */
  it('reports a partial failure with counts and reasons', () => {
    const text = bulkErrorText({ ok: 2, failures: [{ name: 'b', error: 'forbidden' }] });
    expect(text).toContain('2 succeeded');
    expect(text).toContain('1 failed');
    expect(text).toContain('b: forbidden');
  });

  it('says so when nothing worked', () => {
    const text = bulkErrorText({
      ok: 0,
      failures: [
        { name: 'a', error: 'forbidden' },
        { name: 'b', error: 'forbidden' },
      ],
    });
    expect(text).toContain('all 2 failed');
  });
});

describe('runBulk', () => {
  /**
   * The B39 acceptance criterion: N selected rows issues N calls, each with its
   * own object — not one call, and not a call with only the first row.
   */
  it('calls the operation once per row', async () => {
    const seen: string[] = [];
    const out = await runBulk([row('a'), row('b'), row('c')], async (r) => {
      seen.push(r.name);
    });
    expect(seen.sort()).toEqual(['a', 'b', 'c']);
    expect(out).toEqual({ ok: 3, failures: [] });
  });

  /**
   * One object failing must not abandon the rest half-done — a selection often
   * spans objects with different owners or permissions.
   */
  it('completes the others when one fails, and names the one that did', async () => {
    const out = await runBulk([row('a'), row('b'), row('c')], async (r) => {
      if (r.name === 'b') throw new Error('forbidden');
    });
    expect(out.ok).toBe(2);
    expect(out.failures).toEqual([{ name: 'b', error: 'forbidden' }]);
  });

  it("survives a rejection that isn't an Error", async () => {
    const out = await runBulk([row('a')], async () => {
      throw 'plain string';
    });
    expect(out.failures[0].error).toBe('plain string');
  });

  it('does nothing for an empty selection', async () => {
    expect(await runBulk([], async () => {})).toEqual({ ok: 0, failures: [] });
  });
});
