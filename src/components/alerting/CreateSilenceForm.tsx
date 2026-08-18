/**
 * CreateSilenceForm — form for creating a new silence.
 */

import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import type { CreateSilenceRequest, SilenceMatcher } from '../../providers/types';
import styles from './AlertsPanel.module.css';

const inputStyle = {
  background: 'var(--bg-input)',
  border: '1px solid var(--border-control)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'inherit',
};

const labelStyle = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  marginBottom: 4,
};

export function CreateSilenceForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (req: CreateSilenceRequest) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [matchers, setMatchers] = useState<SilenceMatcher[]>([
    { name: 'alertname', value: '', isRegex: false },
  ]);
  const [comment, setComment] = useState('');
  const [createdBy, setCreatedBy] = useState('k7s');
  const [durationHours, setDurationHours] = useState(4);

  const addMatcher = () =>
    setMatchers((prev) => [...prev, { name: '', value: '', isRegex: false }]);

  const updateMatcher = (i: number, field: keyof SilenceMatcher, val: string | boolean) =>
    setMatchers((prev) => prev.map((m, j) => (j === i ? { ...m, [field]: val } : m)));

  const removeMatcher = (i: number) => setMatchers((prev) => prev.filter((_, j) => j !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const endsAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
    onSubmit({
      matchers: matchers.filter((m) => m.name && m.value),
      comment,
      createdBy,
      startsAt: '',
      endsAt,
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-overlay, rgba(0,0,0,0.5))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-control)',
          borderRadius: 'var(--radius-md)',
          padding: 16,
          width: 480,
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>{t('alerts.silences.createTitle', 'Create Silence')}</h3>

        {/* Matchers */}
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            {t('alerts.silences.matchers', 'Matchers')}
          </legend>
          {matchers.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 4,
                marginBottom: 4,
                alignItems: 'center',
              }}
            >
              <input
                placeholder="name"
                value={m.name}
                onChange={(e) => updateMatcher(i, 'name', e.target.value)}
                style={inputStyle}
              />
              <select
                value={m.isRegex ? '=~' : '='}
                onChange={(e) => updateMatcher(i, 'isRegex', e.target.value === '=~')}
                style={{ ...inputStyle, width: 48 }}
              >
                <option value="=">=</option>
                <option value="=~">=~</option>
              </select>
              <input
                placeholder="value"
                value={m.value}
                onChange={(e) => updateMatcher(i, 'value', e.target.value)}
                style={inputStyle}
              />
              {matchers.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMatcher(i)}
                  style={{ ...inputStyle, width: 28, cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addMatcher} className={styles.btn}>
            + {t('alerts.silences.addMatcher', 'Add Matcher')}
          </button>
        </fieldset>

        {/* Duration */}
        <label style={labelStyle}>
          {t('alerts.silences.duration', 'Duration (hours)')}
          <input
            type="number"
            min={1}
            max={720}
            value={durationHours}
            onChange={(e) => setDurationHours(Number(e.target.value) || 1)}
            style={{ ...inputStyle, width: 80 }}
          />
        </label>

        {/* Comment */}
        <label style={labelStyle}>
          {t('alerts.silences.comment', 'Comment')}
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('alerts.silences.commentPlaceholder', 'Reason for silence')}
            style={inputStyle}
          />
        </label>

        {/* Created by */}
        <label style={labelStyle}>
          {t('alerts.silences.createdBy', 'Created by')}
          <input
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            style={inputStyle}
          />
        </label>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className={styles.btn} onClick={onCancel}>
            {t('chrome.common.cancel', 'Cancel')}
          </button>
          <button
            type="submit"
            className={styles.btn}
            disabled={!matchers.some((m) => m.name && m.value)}
          >
            {t('alerts.silences.createBtn', 'Create')}
          </button>
        </div>
      </form>
    </div>
  );
}
