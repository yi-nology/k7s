/**
 * StepFields — the form fragments for steps 1-3 of the create-workload wizard.
 *
 * Three dumb, fully controlled fragments (`Basics`, `Container`, `Mounts`).
 * They take the whole {@link WorkloadForm} and report patches upward via
 * `onChange(patch)`; step state, validation gating, and YAML generation all
 * live in the wizard shell (CreateWorkloadWizard.tsx). Array rows (ports, env,
 * mounts) follow the IngressEditor rules pattern: an add button appends a
 * blank row, a per-row × removes it. Advanced blocks (command/args, resources,
 * probes) collapse behind native `<details>` — zero JS, keyboard accessible.
 */

import { useState, type ReactNode } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { isValidK8sName, isValidNamespace } from '../../lib/security';
import { emptyWorkloadForm, type WorkloadForm, type WorkloadType } from './workloadSpec';
import styles from './CreateWorkloadWizard.module.css';

/** Blur defaults for cleared number fields — one definition, from the same
 * factory that seeds the wizard's initial form (replicas 1, port 80,
 * readiness delay 5, liveness delay 15). */
const DEFAULTS = emptyWorkloadForm();

/** Shared props: the whole form + an upward patch. */
interface StepFieldsProps {
  form: WorkloadForm;
  onChange: (patch: Partial<WorkloadForm>) => void;
}

/**
 * Number input that tolerates being cleared (P3 Task 5). The old clamping
 * onChange — `Math.max(min, Number(v) || 0)` — coerced '' to the min the
 * instant the field was cleared (a cleared probe port snapped back to 1), so
 * select-all + retype was impossible. While the field holds a value,
 * clamping is unchanged; a cleared field stays visually empty while the form
 * keeps its last number, and blur commits `fallback`. WorkloadForm stays
 * pure numbers — '' can never reach generateWorkloadYaml, which renders its
 * values verbatim (a ''/NaN would land straight in the manifest).
 */
function NumberField({
  value,
  min,
  fallback,
  onCommit,
  id,
  className,
}: {
  value: number;
  min: number;
  /** Committed on blur when the user cleared the field. */
  fallback: number;
  onCommit: (n: number) => void;
  id?: string;
  className?: string;
}) {
  // True between the clearing keystroke and the blur — the only window in
  // which the input is allowed to show ''.
  const [cleared, setCleared] = useState(false);
  return (
    <input
      id={id}
      className={className}
      type="number"
      min={min}
      value={cleared ? '' : value}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') {
          // Stay empty locally; the form keeps its last committed number.
          setCleared(true);
          return;
        }
        setCleared(false);
        const n = Number(raw);
        if (!Number.isNaN(n)) onCommit(Math.max(min, n));
      }}
      onBlur={() => {
        if (!cleared) return;
        setCleared(false);
        onCommit(fallback);
      }}
    />
  );
}

/** Unstyled add-row / remove-row buttons (the IngressEditor idiom). */
function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.addBtn} onClick={onClick}>
      + {label}
    </button>
  );
}

function RemoveRow({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className={styles.removeBtn} onClick={onClick} aria-label={label}>
      ×
    </button>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — basics
// ---------------------------------------------------------------------------

export function Basics({ form, onChange }: StepFieldsProps) {
  const { t } = useTranslation();
  // Only flag pattern errors once the user typed something — the empty-state
  // is signalled by the disabled Next button instead of red on every field.
  const nameBad = form.name !== '' && !isValidK8sName(form.name);
  const nsBad = form.namespace !== '' && !isValidNamespace(form.namespace);

  return (
    <div className={styles.fields}>
      <label className={styles.field} htmlFor="wizard-name">
        {t('wizard.field.name', 'Name')}
        <input
          id="wizard-name"
          data-testid="wizard-name"
          className={styles.input}
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {nameBad && <span className={styles.error}>{t('wizard.invalidName', 'Invalid name (lowercase alphanumerics and hyphens)')}</span>}
      </label>
      <label className={styles.field} htmlFor="wizard-namespace">
        {t('wizard.field.namespace', 'Namespace')}
        <input
          id="wizard-namespace"
          className={styles.input}
          value={form.namespace}
          onChange={(e) => onChange({ namespace: e.target.value })}
        />
        {nsBad && <span className={styles.error}>{t('wizard.invalidNamespace', 'Invalid namespace name')}</span>}
      </label>
      <label className={styles.field} htmlFor="wizard-type">
        {t('wizard.field.type', 'Type')}
        <select
          id="wizard-type"
          className={styles.input}
          value={form.workloadType}
          onChange={(e) => onChange({ workloadType: e.target.value as WorkloadType })}
        >
          <option value="deployment">Deployment</option>
          <option value="statefulset">StatefulSet</option>
          <option value="daemonset">DaemonSet</option>
        </select>
      </label>
      {/* DaemonSet pods run one per node — the replicas knob does nothing
          (generateWorkloadYaml omits it), so don't offer it. */}
      {form.workloadType !== 'daemonset' && (
        <label className={styles.field} htmlFor="wizard-replicas">
          {t('wizard.field.replicas', 'Replicas')}
          <NumberField
            id="wizard-replicas"
            className={styles.input}
            value={form.replicas}
            min={0}
            fallback={DEFAULTS.replicas}
            onCommit={(replicas) => onChange({ replicas })}
          />
        </label>
      )}
      <label className={styles.fieldWide} htmlFor="wizard-image">
        {t('wizard.field.image', 'Image')}
        <input
          id="wizard-image"
          data-testid="wizard-image"
          className={styles.input}
          placeholder="nginx:1.27"
          value={form.image}
          onChange={(e) => onChange({ image: e.target.value })}
        />
      </label>
      <label className={styles.field} htmlFor="wizard-pull">
        {t('wizard.field.imagePullPolicy', 'Pull Policy')}
        <select
          id="wizard-pull"
          className={styles.input}
          value={form.imagePullPolicy}
          onChange={(e) => onChange({ imagePullPolicy: e.target.value as WorkloadForm['imagePullPolicy'] })}
        >
          <option value="IfNotPresent">IfNotPresent</option>
          <option value="Always">Always</option>
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — container config
// ---------------------------------------------------------------------------

/** One collapsed advanced block (native <details> — no JS, no state). */
function Advanced({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className={styles.advanced}>
      <summary className={styles.summary}>{summary}</summary>
      <div className={styles.advancedBody}>{children}</div>
    </details>
  );
}

/** A probe editor (readiness/liveness share the same ProbeCfg shape). */
function ProbeFields({
  probe,
  delayFallback,
  onChange,
}: {
  probe: WorkloadForm['readiness'];
  /** Blur default for a cleared delay — readiness 5s, liveness 15s. */
  delayFallback: number;
  onChange: (patch: Partial<WorkloadForm['readiness']>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.fields}>
      <label className={styles.fieldInline}>
        <input
          type="checkbox"
          checked={probe.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        {t('wizard.field.enabled', 'Enabled')}
      </label>
      {probe.enabled && (
        <>
          {/* No id/htmlFor here: ProbeFields renders twice on step 2
              (readiness + liveness) and a shared id would be invalid HTML
              that points both labels at the first probe's inputs. The
              wrapping <label> already associates label ↔ input. */}
          <label className={styles.field}>
            {t('wizard.field.path', 'Path')}
            <input
              className={styles.input}
              value={probe.path}
              onChange={(e) => onChange({ path: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            {t('wizard.field.port', 'Port')}
            <NumberField
              className={styles.input}
              value={probe.port}
              min={1}
              fallback={DEFAULTS.readiness.port}
              onCommit={(port) => onChange({ port })}
            />
          </label>
          <label className={styles.field}>
            {t('wizard.field.initialDelay', 'Initial delay (s)')}
            <NumberField
              className={styles.input}
              value={probe.initialDelay}
              min={0}
              fallback={delayFallback}
              onCommit={(initialDelay) => onChange({ initialDelay })}
            />
          </label>
        </>
      )}
    </div>
  );
}

export function Container({ form, onChange }: StepFieldsProps) {
  const { t } = useTranslation();
  const setPort = (i: number, patch: Partial<WorkloadForm['ports'][number]>) =>
    onChange({ ports: form.ports.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const setEnv = (i: number, patch: Partial<WorkloadForm['env'][number]>) =>
    onChange({ env: form.env.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <div className={styles.stepBody}>
      {/* Ports */}
      <fieldset className={styles.group}>
        <legend className={styles.legend}>
          {t('wizard.field.ports', 'Ports')}
          <AddRow
            label={t('wizard.addPort', 'Add port')}
            onClick={() => onChange({ ports: [...form.ports, { name: '', port: 80, protocol: 'TCP' }] })}
          />
        </legend>
        {form.ports.map((p, i) => (
          <div key={i} className={styles.row}>
            <label className={styles.field}>
              {t('wizard.field.portName', 'Port name')}
              <input
                className={styles.input}
                value={p.name}
                onChange={(e) => setPort(i, { name: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              {t('wizard.field.portNumber', 'Port')}
              <NumberField
                className={styles.input}
                value={p.port}
                min={1}
                fallback={DEFAULTS.readiness.port}
                onCommit={(port) => setPort(i, { port })}
              />
            </label>
            <label className={styles.field}>
              {t('wizard.field.protocol', 'Protocol')}
              <select
                className={styles.input}
                value={p.protocol}
                onChange={(e) => setPort(i, { protocol: e.target.value as 'TCP' | 'UDP' })}
              >
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
              </select>
            </label>
            <RemoveRow label={t('wizard.removeRow', 'Remove row')} onClick={() => onChange({ ports: form.ports.filter((_, j) => j !== i) })} />
          </div>
        ))}
      </fieldset>

      {/* Env vars */}
      <fieldset className={styles.group}>
        <legend className={styles.legend}>
          {t('wizard.field.env', 'Environment Variables')}
          <AddRow
            label={t('wizard.addEnv', 'Add variable')}
            onClick={() => onChange({ env: [...form.env, { key: '', value: '' }] })}
          />
        </legend>
        {form.env.map((e, i) => (
          <div key={i} className={styles.row}>
            <label className={styles.field}>
              {t('wizard.field.envKey', 'Key')}
              <input className={styles.input} value={e.key} onChange={(ev) => setEnv(i, { key: ev.target.value })} />
            </label>
            <label className={styles.fieldWide}>
              {t('wizard.field.envValue', 'Value')}
              <input className={styles.input} value={e.value} onChange={(ev) => setEnv(i, { value: ev.target.value })} />
            </label>
            <RemoveRow label={t('wizard.removeRow', 'Remove row')} onClick={() => onChange({ env: form.env.filter((_, j) => j !== i) })} />
          </div>
        ))}
      </fieldset>

      {/* Advanced: collapsed by default, zero-JS <details>. */}
      <Advanced summary={t('wizard.field.commandArgs', 'Command & args')}>
        <div className={styles.fields}>
          <label className={styles.fieldWide} htmlFor="wizard-command">
            {t('wizard.field.command', 'Command')}
            <input
              id="wizard-command"
              className={styles.input}
              placeholder="sh -c"
              value={form.command}
              onChange={(e) => onChange({ command: e.target.value })}
            />
          </label>
          <label className={styles.fieldWide} htmlFor="wizard-args">
            {t('wizard.field.args', 'Args')}
            <input
              id="wizard-args"
              className={styles.input}
              placeholder="-c echo hello"
              value={form.args}
              onChange={(e) => onChange({ args: e.target.value })}
            />
            {/* Carry-forward from Task 2's review: the split semantics must be
                visible at the input — args are whitespace-separated tokens. */}
            <span className={styles.hint}>{t('wizard.field.argsHint', 'space-separated; quote args containing spaces')}</span>
          </label>
        </div>
      </Advanced>

      <Advanced summary={t('wizard.field.resources', 'Resources')}>
        <div className={styles.row}>
          <label className={styles.field}>
            {t('wizard.field.cpuRequest', 'CPU request')}
            <input className={styles.input} placeholder="100m" value={form.cpuRequest} onChange={(e) => onChange({ cpuRequest: e.target.value })} />
          </label>
          <label className={styles.field}>
            {t('wizard.field.memRequest', 'Memory request')}
            <input className={styles.input} placeholder="128Mi" value={form.memRequest} onChange={(e) => onChange({ memRequest: e.target.value })} />
          </label>
          <label className={styles.field}>
            {t('wizard.field.cpuLimit', 'CPU limit')}
            <input className={styles.input} placeholder="500m" value={form.cpuLimit} onChange={(e) => onChange({ cpuLimit: e.target.value })} />
          </label>
          <label className={styles.field}>
            {t('wizard.field.memLimit', 'Memory limit')}
            <input className={styles.input} placeholder="256Mi" value={form.memLimit} onChange={(e) => onChange({ memLimit: e.target.value })} />
          </label>
        </div>
      </Advanced>

      <Advanced summary={t('wizard.field.readinessProbe', 'Readiness probe')}>
        <ProbeFields
          probe={form.readiness}
          delayFallback={DEFAULTS.readiness.initialDelay}
          onChange={(patch) => onChange({ readiness: { ...form.readiness, ...patch } })}
        />
      </Advanced>

      <Advanced summary={t('wizard.field.livenessProbe', 'Liveness probe')}>
        <ProbeFields
          probe={form.liveness}
          delayFallback={DEFAULTS.liveness.initialDelay}
          onChange={(patch) => onChange({ liveness: { ...form.liveness, ...patch } })}
        />
      </Advanced>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — storage & config (PVC mounts)
// ---------------------------------------------------------------------------

export function Mounts({ form, onChange }: StepFieldsProps) {
  const { t } = useTranslation();
  const setMount = (i: number, patch: Partial<WorkloadForm['mounts'][number]>) =>
    onChange({ mounts: form.mounts.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>
        {t('wizard.field.mounts', 'Volume mounts')}
        <AddRow
          label={t('wizard.addMount', 'Add mount')}
          onClick={() => onChange({ mounts: [...form.mounts, { pvcName: '', mountPath: '', readOnly: false }] })}
        />
      </legend>
      {form.mounts.map((m, i) => (
        <div key={i} className={styles.row}>
          <label className={styles.field}>
            {t('wizard.field.mountPvc', 'PVC name')}
            <input className={styles.input} placeholder="data" value={m.pvcName} onChange={(e) => setMount(i, { pvcName: e.target.value })} />
          </label>
          <label className={styles.fieldWide}>
            {t('wizard.field.mountPath', 'Mount path')}
            <input className={styles.input} placeholder="/data" value={m.mountPath} onChange={(e) => setMount(i, { mountPath: e.target.value })} />
          </label>
          <label className={styles.fieldInline}>
            <input type="checkbox" checked={m.readOnly} onChange={(e) => setMount(i, { readOnly: e.target.checked })} />
            {t('wizard.field.readOnly', 'Read-only')}
          </label>
          <RemoveRow label={t('wizard.removeRow', 'Remove row')} onClick={() => onChange({ mounts: form.mounts.filter((_, j) => j !== i) })} />
        </div>
      ))}
    </fieldset>
  );
}
