/**
 * ExtrasSection — structured "extras" for template parameters.
 *
 * Renders labels (chip list) and resource requests (CPU + memory inputs)
 * as their own section card.
 */

import { useTranslation } from '../../hooks/useI18n';
import type { TemplateExtras } from '../../lib/templates';
import { LabelsEditor } from './LabelsEditor';
import styles from './TemplatePicker.module.css';

export function ExtrasSection({
  extras,
  labels,
  resources,
  onLabelsChange,
  onResourcesChange,
}: {
  extras: TemplateExtras;
  labels: Record<string, string>;
  resources: { cpu?: string; memory?: string };
  onLabelsChange: (labels: Record<string, string>) => void;
  onResourcesChange: (r: { cpu?: string; memory?: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {extras.labels && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('tpl.extras.labels', 'Labels')}</h3>
          <LabelsEditor labels={labels} onChange={onLabelsChange} />
        </section>
      )}
      {extras.resources && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('tpl.extras.resources', 'Resource requests')}</h3>
          <div className={styles.resourcesRow}>
            <label className={styles.resourceField}>
              <span className={styles.fieldLabel}>{t('tpl.extras.cpu', 'CPU')}</span>
              <input
                type="text"
                value={resources.cpu ?? ''}
                placeholder={extras.resources.default.cpu ?? '100m'}
                onChange={(e) => onResourcesChange({ ...resources, cpu: e.target.value })}
              />
            </label>
            <label className={styles.resourceField}>
              <span className={styles.fieldLabel}>{t('tpl.extras.memory', 'Memory')}</span>
              <input
                type="text"
                value={resources.memory ?? ''}
                placeholder={extras.resources.default.memory ?? '128Mi'}
                onChange={(e) => onResourcesChange({ ...resources, memory: e.target.value })}
              />
            </label>
          </div>
        </section>
      )}
    </>
  );
}
