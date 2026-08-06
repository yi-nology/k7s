/**
 * Properties tab (B13, B18): what the selected object is actually wired to.
 *
 * The backend decides both the content and the shape — it returns an ordered list
 * of sections, each a field grid, a table, or chips (see
 * src-tauri/src/kube/properties.rs). This renders that document generically, so a
 * pod's containers/volumes/services and a node's taints/capacity go through the
 * same code and adding a kind needs no change here.
 *
 * Fetched in one backend call on open / selection change.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './PropertiesTab.module.css';
import { useStore } from '../../store';
import { formatError, getProvider } from '../../providers';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import { useNow } from '../../hooks/useNow';
import { useTranslation } from '../../hooks/useI18n';
import { formatAge } from '../../lib/format';
import { toneColor } from '../../lib/tone';
import type {
  Cell,
  Field,
  NavTarget,
  Properties,
  SecretEntry,
  Section,
} from '../../providers/types';

export function PropertiesTab() {
  const row = useStore((s) => s.selectedRow);
  const kind = useStore((s) => s.nav);
  const [props, setProps] = useState<Properties | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const { t } = useTranslation();

  // Secret decode state.
  const [showSecrets, setShowSecrets] = useState(false);
  const [secretData, setSecretData] = useState<SecretEntry[] | null>(null);
  const [secretLoading, setSecretLoading] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset secret state when selection changes.
  useEffect(() => {
    setShowSecrets(false);
    setSecretData(null);
    setSecretLoading(false);
    setSecretError(null);
    setExpandedKeys(new Set());
    setCopiedKey(null);
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
  }, [row?.uid]);

  useAsyncEffect(async (isMounted) => {
    if (!row) return;
    setProps(null);
    setError(null);
    try {
      const p = await getProvider().getProperties({
        kind,
        namespace: row.namespace,
        name: row.name,
      });
      if (isMounted()) setProps(p);
    } catch (e) {
      if (isMounted()) setError(formatError(e));
    }
  }, [row, kind]);

  // Fetch decoded secret data on first toggle.
  const handleToggleSecrets = useCallback(() => {
    if (showSecrets) {
      setShowSecrets(false);
      return;
    }
    setShowSecrets(true);
    if (secretData !== null) return; // already cached
    if (!row) return;
    setSecretLoading(true);
    setSecretError(null);
    void getProvider()
      .getSecretData(row.namespace ?? '', row.name)
      .then((data) => {
        setSecretData(data);
        setSecretLoading(false);
      })
      .catch((e) => {
        setSecretError(formatError(e));
        setSecretLoading(false);
      });
  }, [showSecrets, secretData, row]);

  const handleCopy = useCallback((key: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopiedKey(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedKey(null), 1200);
  }, []);

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (error) return <div className={styles.state}>{error}</div>;
  if (!props) return <div className={styles.state}>{t('properties.loading')}</div>;

  const isSecret = kind === 'secrets';

  return (
    <div className={styles.wrap}>
      {props.sections.map((s) => (
        <SectionView
          key={s.title}
          section={s}
          now={now}
          isSecret={isSecret}
          isDataSection={isSecret && s.title === 'Data'}
          showSecrets={showSecrets}
          secretData={secretData}
          secretLoading={secretLoading}
          secretError={secretError}
          expandedKeys={expandedKeys}
          copiedKey={copiedKey}
          onToggleSecrets={handleToggleSecrets}
          onCopy={handleCopy}
          onToggleExpand={toggleExpand}
        />
      ))}
    </div>
  );
}

/** Props forwarded from PropertiesTab for secret-decode support. */
interface SecretDecodeProps {
  isSecret: boolean;
  isDataSection: boolean;
  showSecrets: boolean;
  secretData: SecretEntry[] | null;
  secretLoading: boolean;
  secretError: string | null;
  expandedKeys: Set<string>;
  copiedKey: string | null;
  onToggleSecrets: () => void;
  onCopy: (key: string, value: string) => void;
  onToggleExpand: (key: string) => void;
}

/** Length at which a secret value is truncated with an expand toggle. */
const SECRET_TRUNCATE_LEN = 80;

/** One section: header (with a row count for tables) plus its body. */
function SectionView({
  section,
  now,
  isSecret: _isSecret,
  isDataSection,
  showSecrets,
  secretData,
  secretLoading,
  secretError,
  expandedKeys,
  copiedKey,
  onToggleSecrets,
  onCopy,
  onToggleExpand,
}: { section: Section; now: number } & SecretDecodeProps) {
  const { body } = section;
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        {section.title}
        {/* Counts belong on lists, not on the Overview grid or chip groups. */}
        {body.type === 'table' && !isDataSection && ` (${body.rows.length})`}
      </div>

      {/* Secret decode toggle: appears above the Data table for secrets. */}
      {isDataSection && (
        <button type="button" className={styles.secretToggle} onClick={onToggleSecrets}>
          {showSecrets ? '\uD83D\uDE48 Hide Values' : '\uD83D\uDC41 Show Values'}
        </button>
      )}

      {body.type === 'fields' && (
        <div className={styles.grid}>
          {body.fields.map((f) => (
            <FieldRow key={f.label} field={f} now={now} />
          ))}
        </div>
      )}

      {body.type === 'table' && isDataSection && showSecrets ? (
        // Decoded secret values view.
        secretLoading ? (
          <div className={styles.empty}>Decoding...</div>
        ) : secretError ? (
          <div className={styles.empty}>{secretError}</div>
        ) : secretData && secretData.length > 0 ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Key</th>
                  <th className={styles.th}>Value</th>
                </tr>
              </thead>
              <tbody>
                {secretData.map((entry) => {
                  const isLong = entry.value.length > SECRET_TRUNCATE_LEN;
                  const isExpanded = expandedKeys.has(entry.key);
                  const displayValue =
                    isLong && !isExpanded ? entry.value.slice(0, SECRET_TRUNCATE_LEN) : entry.value;
                  return (
                    <tr key={entry.key}>
                      <td className={[styles.td, styles.tdName].join(' ')}>{entry.key}</td>
                      <td className={[styles.td, styles.tdWrap, styles.secretValue].join(' ')}>
                        <span onClick={() => onCopy(entry.key, entry.value)} title="Click to copy">
                          {displayValue}
                          {isLong && (
                            <button
                              type="button"
                              className={styles.expandToggle}
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand(entry.key);
                              }}
                            >
                              {isExpanded
                                ? ' [collapse]'
                                : ` [+${entry.value.length - SECRET_TRUNCATE_LEN}]`}
                            </button>
                          )}
                        </span>
                        {copiedKey === entry.key && (
                          <span className={styles.copiedToast}>Copied</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>No data entries</div>
        )
      ) : (
        body.type === 'table' &&
        (body.rows.length === 0 ? (
          <div className={styles.empty}>{section.emptyNote}</div>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {body.columns.map((h) => (
                    <th key={h} className={styles.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.rows.map((cells, i) => (
                  <tr key={i}>
                    {cells.map((cell, j) => (
                      <td
                        className={[
                          styles.td,
                          j === 0 ? styles.tdName : '',
                          wraps(cell) ? styles.tdWrap : '',
                        ].join(' ')}
                        key={j}
                        style={{ color: toneColor(cell.tone) }}
                      >
                        {cell.nav ? (
                          <NavLink target={cell.nav}>{cellText(cell, now)}</NavLink>
                        ) : (
                          cellText(cell, now)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {body.type === 'chips' && (
        <div className={styles.chips}>
          {body.chips.map((kv) => (
            <span key={kv.key} className={styles.chip} title={`${kv.key}=${kv.value}`}>
              <span className={styles.chipKey}>{kv.key}</span>
              <span className={styles.chipVal}>{kv.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A reference to another object, rendered as a click-through link (B33, B40).
 * Inherits the surrounding colour so a linked status keeps its tone; the
 * underline is what marks it navigable. Memoized: used inside table rows that
 * re-render on the 30s age tick.
 */
const NavLink = React.memo(function NavLink({
  target,
  children,
}: {
  target: NavTarget;
  children: React.ReactNode;
}) {
  const navigateTo = useStore((s) => s.navigateTo);
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={styles.navLink}
      title={t('properties.navTitle', target.kind, target.name)}
      onClick={() => navigateTo(target)}
    >
      {children}
    </button>
  );
});

/** One key/value row in a field grid. A field with a nav target (B33) renders as
 * a click-through link (e.g. a pod's owner → its Deployment). Memoized: the
 * properties grid can have dozens of rows that only change on selection change. */
const FieldRow = React.memo(function FieldRow({ field, now }: { field: Field; now: number }) {
  const { label, value, nav } = field;
  const color = toneColor(value.tone);
  return (
    <>
      <span className={styles.gridKey}>{label}</span>
      <span className={styles.gridVal} style={{ color }}>
        {nav ? <NavLink target={nav}>{cellText(value, now)}</NavLink> : cellText(value, now)}
      </span>
    </>
  );
});

/** Cell text, formatting age cells like the resource tables do. */
function cellText(cell: Cell, now: number): string {
  return cell.format === 'age' ? formatAge(cell.text, now) : cell.text;
}

/**
 * Length past which a value is allowed to wrap instead of holding the column open.
 * Sized to sit above the values that should stay on one line ("100m / 1",
 * "8080/TCP", "ReadWriteOnce") and below the ones that shouldn't hold a column
 * open (images, PV names, mount paths, condition messages).
 */
const WRAP_AT = 24;

/**
 * Whether a cell may wrap. Decided by the value, not the column: the renderer is
 * generic, so it can't know that column 2 is an image here and a phase there —
 * but it can see that "registry.murphy-yi.io/valkyrie-api:2.14.0" needs to wrap and
 * "Running" does not. Wrapping short values would let them break mid-token.
 */
function wraps(cell: Cell): boolean {
  // Ages are rendered short ("4d2h") whatever the timestamp's length.
  if (cell.format === 'age') return false;
  return cell.text.length > WRAP_AT;
}
