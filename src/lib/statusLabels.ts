/**
 * Status badge localization — a fixed status → {zh label, cause hint} table.
 *
 * Why not the i18n dictionaries: the status vocabulary is closed (one-to-one
 * with the statuses the Rust backend's pod mapper emits), the hint is a
 * per-status data column rather than UI chrome, and a `t()` lookup per pill
 * would buy nothing over a single map lookup here. The label also bypasses
 * `t()` by design — this module is the one place that maps locale → text for
 * statuses. Any *other* user-visible strings still go through the
 * dictionaries.
 */

/** A localized status: display label, one-line cause/next-step hint, and the raw backend string. */
export interface StatusLocal {
  label: string;
  hint: string;
  raw: string;
}

/** One table row: the Chinese label plus one-sentence cause hints per locale. */
interface StatusEntry {
  /** Chinese label shown on the pill when locale is "zh". */
  zh: string;
  /** zh hint: one short sentence on the likely cause / next step. */
  hint: string;
  /** en hint; falls back to the raw status when absent. */
  hintEn?: string;
}

/**
 * The K8s status vocabulary the backend emits (pod mapper), plus the statuses
 * used by nodes/PVCs/namespaces list tables. Unknown statuses intentionally
 * return null — the pill then shows the raw string, which is always truthful.
 */
const STATUS_TABLE: Record<string, StatusEntry> = {
  Running: {
    zh: '运行中',
    hint: '容器正在运行',
    hintEn: 'container is running',
  },
  Pending: {
    zh: '待调度',
    hint: '等待调度或容器创建',
    hintEn: 'waiting to be scheduled or containers created',
  },
  ContainerCreating: {
    zh: '容器创建中',
    hint: '正在创建容器,拉取镜像可能较慢',
    hintEn: 'creating containers; image pull may be slow',
  },
  CrashLoopBackOff: {
    zh: '崩溃循环',
    hint: '应用反复崩溃退出,查看日志或上一个容器的日志',
    hintEn: 'app keeps crashing; check logs or previous container logs',
  },
  ImagePullBackOff: {
    zh: '镜像拉取失败',
    hint: '镜像拉不下来,检查镜像名与仓库凭据',
    hintEn: 'image pull failed; check image name and registry credentials',
  },
  Evicted: {
    zh: '已驱逐',
    hint: '节点资源不足,Pod 被驱逐',
    hintEn: 'evicted due to node resource pressure',
  },
  Terminating: {
    zh: '终止中',
    hint: '正在终止,等待优雅退出完成',
    hintEn: 'shutting down, waiting for graceful exit',
  },
  Completed: {
    zh: '已完成',
    hint: '已执行完成,不再重启',
    hintEn: 'finished; will not restart',
  },
  Succeeded: {
    zh: '成功',
    hint: '所有容器成功退出',
    hintEn: 'all containers exited successfully',
  },
  Failed: {
    zh: '失败',
    hint: '至少一个容器以失败退出,查看事件与日志',
    hintEn: 'a container exited with failure; check events and logs',
  },
  Error: {
    zh: '错误',
    hint: '发生错误,查看事件了解原因',
    hintEn: 'something went wrong; check events',
  },
  Ready: {
    zh: '就绪',
    hint: '就绪,可以接收流量',
    hintEn: 'ready to serve traffic',
  },
  Bound: {
    zh: '已绑定',
    hint: '已绑定到持久卷',
    hintEn: 'bound to a PersistentVolume',
  },
  Active: {
    zh: '活跃',
    hint: '资源处于活跃状态',
    hintEn: 'resource is active',
  },
  Unknown: {
    zh: '未知',
    hint: '状态未知,节点可能失联',
    hintEn: 'state unknown; node may be unreachable',
  },
};

/**
 * Localize a status string for the pill.
 *
 * @param status - Raw status from the backend (e.g. "CrashLoopBackOff").
 * @param locale - Target locale.
 * @returns `{label, hint, raw}` on a hit; `null` for unknown statuses, so the
 *   caller can fall back to showing the raw string.
 */
export function localizeStatus(status: string, locale: 'en' | 'zh'): StatusLocal | null {
  const entry = STATUS_TABLE[status];
  if (!entry) return null;
  // en keeps the raw string as the label — it is already the English term.
  return locale === 'zh'
    ? { label: entry.zh, hint: entry.hint, raw: status }
    : { label: status, hint: entry.hintEn ?? status, raw: status };
}
