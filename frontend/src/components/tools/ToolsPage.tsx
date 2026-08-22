/**
 * ToolsPage — 运维工具目录页(P1 IA 重构)。原侧边栏 Tools 组的 14 个入口
 * 改为分类卡片;点击调用既有 openOverlay(key),面板组件与渲染机制零改动
 * (Dashboard 除外 —— 它现在是 overview 分区的内嵌内容,不再是 overlay)。
 *
 * iPadOS 上被平台隐藏的 overlay(IPADOS_HIDDEN_OVERLAYS)不渲染卡片;
 * 整组都被隐藏时分组标题也不渲染。
 */

import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { IPADOS_HIDDEN_OVERLAYS } from '../../lib/platform';
import type { OverlayKey } from '../../store';
import styles from './ToolsPage.module.css';

interface ToolCard {
  key: OverlayKey;
  labelKey: string;
  fallback: string;
}

/** English fallbacks for `tools.category.*` — same belt-and-braces pattern as
 *  SubNav's GROUP_FALLBACK: a missing dictionary key is a compile error, this
 *  only keeps `t()` from ever rendering the raw id. */
const CATEGORY_FALLBACK: Record<string, string> = {
  observability: 'Observability',
  helm: 'Helm',
  images: 'Images',
  security: 'Security',
  network: 'Network',
  cluster: 'Cluster Tools',
};

const CATEGORIES: { id: string; tools: ToolCard[] }[] = [
  {
    id: 'observability',
    tools: [
      { key: 'metrics', labelKey: 'chrome.sidebar.tools.metrics', fallback: 'Metrics' },
      { key: 'grafana', labelKey: 'chrome.sidebar.tools.grafana', fallback: 'Grafana' },
      { key: 'alerting', labelKey: 'chrome.sidebar.tools.alerting', fallback: 'Alerting' },
    ],
  },
  {
    id: 'helm',
    tools: [
      { key: 'helm-market', labelKey: 'chrome.sidebar.tools.helmMarket', fallback: 'Helm Market' },
      { key: 'templates', labelKey: 'chrome.sidebar.tools.templates', fallback: 'Templates' },
    ],
  },
  {
    id: 'images',
    tools: [
      { key: 'image-repos', labelKey: 'chrome.sidebar.tools.imageRepos', fallback: 'Image Registries' },
      { key: 'image-transfer', labelKey: 'chrome.sidebar.tools.imageTransfer', fallback: 'Image Transfer' },
    ],
  },
  {
    id: 'security',
    tools: [
      { key: 'sbom', labelKey: 'chrome.sidebar.tools.sbom', fallback: 'SBOM' },
      { key: 'audit', labelKey: 'chrome.sidebar.tools.audit', fallback: 'Audit' },
    ],
  },
  {
    id: 'network',
    tools: [
      { key: 'topology', labelKey: 'chrome.sidebar.tools.topology', fallback: 'Service Topology' },
      { key: 'ingress-routes', labelKey: 'chrome.sidebar.tools.ingressRoutes', fallback: 'Ingress Routes' },
      { key: 'endpoints', labelKey: 'chrome.sidebar.tools.endpoints', fallback: 'Endpoints' },
    ],
  },
  {
    id: 'cluster',
    tools: [
      { key: 'diff', labelKey: 'chrome.sidebar.tools.diff', fallback: 'Diff' },
      { key: 'plugins', labelKey: 'chrome.sidebar.tools.plugins', fallback: 'Plugins' },
    ],
  },
];

export function ToolsPage() {
  const openOverlay = useStore((s) => s.openOverlay);
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      {CATEGORIES.map((cat) => {
        const tools = cat.tools.filter((x) => !IPADOS_HIDDEN_OVERLAYS.has(x.key));
        if (!tools.length) return null;
        return (
          <section key={cat.id} className={styles.category}>
            <h2 className={styles.categoryTitle}>
              {t(`tools.category.${cat.id}`, CATEGORY_FALLBACK[cat.id] ?? cat.id)}
            </h2>
            <div className={styles.grid}>
              {tools.map((tool) => (
                <button
                  key={tool.key}
                  type="button"
                  className={styles.card}
                  title={t(tool.labelKey, tool.fallback)}
                  onClick={() => openOverlay(tool.key)}
                >
                  <span className={styles.cardTitle}>{t(tool.labelKey, tool.fallback)}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
