/**
 * CronJobTimeline — the "Timeline" detail tab for CronJobs.
 *
 * Shows a horizontal timeline of recent Job executions for the selected CronJob.
 * Each Job is a dot on the timeline, colored by status:
 *   - Green  = Complete (succeeded)
 *   - Red    = Failed
 *   - Yellow = Active/Running
 *
 * Clicking a Job navigates to it. Hovering shows details.
 * Also displays the cron schedule and last scheduled time.
 */

import { useMemo } from "react";
import styles from "./CronJobTimeline.module.css";
import { useStore } from "../../store";
import { useTranslation } from "../../hooks/useI18n";
import { useNow } from "../../hooks/useNow";
import { formatAge } from "../../lib/format";
import type { Row } from "../../providers/types";

/** A parsed Job execution for the timeline. */
interface TimelineJob {
  uid: string;
  name: string;
  namespace: string;
  /** Parsed from the AGE cell (index 4) — creation timestamp. */
  creationTs: string;
  /** Display text from the COMPLETIONS cell (index 2). */
  completions: string;
  /** Display text from the DURATION cell (index 3). */
  duration: string;
  /** Derived status: "succeeded" | "failed" | "active". */
  status: "succeeded" | "failed" | "active";
}

/** Max number of recent Jobs to show on the timeline. */
const MAX_TIMELINE_JOBS = 20;

/**
 * Parse a Job row into a TimelineJob. The column contract for Jobs is:
 * NAME (0), NAMESPACE (1), COMPLETIONS (2), DURATION (3), AGE (4).
 */
function parseJobRow(row: { uid: string; name: string; namespace?: string; cells: { text: string; tone: string }[] }): TimelineJob | null {
  if (row.cells.length < 5) return null;
  const creationTs = row.cells[4].text;
  const completions = row.cells[2].text;
  const duration = row.cells[3].text;

  // Derive status from the completions text and tone.
  // Format is "succeeded/completions" (e.g. "1/1", "0/1").
  // Tone: "ok" (green) = complete, "warn" (yellow) = active, "err" (red) = failed.
  const tone = row.cells[2].tone;
  let status: "succeeded" | "failed" | "active";
  if (tone === "ok") {
    status = "succeeded";
  } else if (tone === "err") {
    status = "failed";
  } else {
    // "warn" or "secondary" — check completions to distinguish active vs succeeded.
    const parts = completions.split("/");
    const succeeded = parseInt(parts[0] ?? "0", 10);
    const total = parseInt(parts[1] ?? "1", 10);
    status = succeeded >= total ? "succeeded" : "active";
  }

  return {
    uid: row.uid,
    name: row.name,
    namespace: row.namespace ?? "",
    creationTs,
    completions,
    duration,
    status,
  };
}

/**
 * Determine if a Job was created by a given CronJob.
 * Checks ownerReferences label first (set by the backend mapper), then
 * falls back to name-prefix convention for older backends.
 */
function isJobOwnedByCronJob(job: Row, cronJobName: string): boolean {
  // Primary: check the ownerReferences label the backend sets.
  if (job.labels?.["owner.cronjob"] === cronJobName) return true;
  // Fallback: name-prefix convention ({cronjob-name}-{random-suffix}).
  if (!job.name.startsWith(cronJobName + "-")) return false;
  const suffix = job.name.slice(cronJobName.length + 1);
  return suffix.length > 0;
}

export function CronJobTimeline() {
  const row = useStore((s) => s.selectedRow);
  const rows = useStore((s) => s.rows);
  const navigateTo = useStore((s) => s.navigateTo);
  const { t } = useTranslation();
  const now = useNow();

  // Extract schedule and last scheduled time from the CronJob row cells.
  // CronJob columns: NAME (0), NAMESPACE (1), SCHEDULE (2), LAST RUN (3), AGE (4).
  const schedule = row?.cells[2]?.text ?? "—";
  const lastRun = row?.cells[3]?.text ?? "—";

  // Filter and parse Jobs owned by this CronJob.
  const jobs = useMemo(() => {
    if (!row) return [];
    const cronJobName = row.name;
    const cronJobNs = row.namespace;
    const allJobs = rows.jobs ?? [];

    return allJobs
      .filter((j) => {
        // Must be in the same namespace.
        if (j.namespace !== cronJobNs) return false;
        // Must be owned by this CronJob (ownerRef label or name prefix).
        return isJobOwnedByCronJob(j, cronJobName);
      })
      .map(parseJobRow)
      .filter((j): j is TimelineJob => j !== null)
      .sort((a, b) => {
        // Sort by creation timestamp, newest first.
        const ta = new Date(a.creationTs).getTime();
        const tb = new Date(b.creationTs).getTime();
        return tb - ta;
      })
      .slice(0, MAX_TIMELINE_JOBS);
  }, [row?.name, row?.namespace, rows.jobs]);

  if (!row) {
    return <div className={styles.empty}>{t("timeline.noSelection", "No CronJob selected.")}</div>;
  }

  const handleClick = (job: TimelineJob) => {
    navigateTo({ kind: "jobs", namespace: job.namespace, name: job.name });
  };

  // Count by status for the summary bar.
  const succeeded = jobs.filter((j) => j.status === "succeeded").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const active = jobs.filter((j) => j.status === "active").length;

  return (
    <div className={styles.wrap}>
      {/* Schedule info header */}
      <div className={styles.infoBar}>
        <div className={styles.infoItem}>
          <span className={styles.infoLabel}>{t("timeline.schedule", "Schedule")}</span>
          <span className={styles.infoValue}>{schedule}</span>
        </div>
        <div className={styles.infoItem}>
          <span className={styles.infoLabel}>{t("timeline.lastRun", "Last Run")}</span>
          <span className={styles.infoValue}>{lastRun}</span>
        </div>
      </div>

      {/* Summary counts */}
      {jobs.length > 0 && (
        <div className={styles.summary}>
          <span className={styles.summaryItem}>
            <span className={styles.dot} style={{ background: "var(--status-ok)" }} />
            {t("timeline.succeeded", "Succeeded")}: {succeeded}
          </span>
          <span className={styles.summaryItem}>
            <span className={styles.dot} style={{ background: "var(--status-err)" }} />
            {t("timeline.failed", "Failed")}: {failed}
          </span>
          <span className={styles.summaryItem}>
            <span className={styles.dot} style={{ background: "var(--status-warn)" }} />
            {t("timeline.active", "Active")}: {active}
          </span>
        </div>
      )}

      {/* Timeline */}
      {jobs.length === 0 ? (
        <div className={styles.empty}>
          {t("timeline.noJobs", "No Jobs found for this CronJob.")}
          <div className={styles.emptyHint}>
            {t("timeline.noJobsHint", "Jobs will appear here once the CronJob creates them.")}
          </div>
        </div>
      ) : (
        <div className={styles.timelineContainer}>
          <div className={styles.timeline}>
            {/* The horizontal line */}
            <div className={styles.timelineLine} />

            {/* Job dots */}
            {jobs.map((job, i) => {
              const ageText = formatAge(job.creationTs, now) || job.creationTs;
              const statusColor =
                job.status === "succeeded"
                  ? "var(--status-ok)"
                  : job.status === "failed"
                    ? "var(--status-err)"
                    : "var(--status-warn)";
              const haloColor =
                job.status === "succeeded"
                  ? "var(--status-ok-soft)"
                  : job.status === "failed"
                    ? "var(--status-err-soft)"
                    : "var(--status-warn-soft)";

              return (
                <button
                  key={job.uid}
                  type="button"
                  className={styles.jobDot}
                  style={{
                    left: `${((i + 0.5) / jobs.length) * 100}%`,
                  }}
                  onClick={() => handleClick(job)}
                  title={`${job.name}\n${t("timeline.status", "Status")}: ${job.status}\n${t("timeline.completions", "Completions")}: ${job.completions}\n${t("timeline.duration", "Duration")}: ${job.duration}\n${t("timeline.age", "Age")}: ${ageText}`}
                >
                  <span
                    className={styles.dotCore}
                    style={{
                      background: statusColor,
                      boxShadow: `0 0 0 3px ${haloColor}, 0 0 10px ${haloColor}`,
                    }}
                  />
                  {/* Label below the dot */}
                  <span className={styles.dotLabel}>
                    <span className={styles.dotAge}>{ageText}</span>
                    <span className={styles.dotStatus} style={{ color: statusColor }}>
                      {job.status === "succeeded" ? t("timeline.ok", "OK") :
                       job.status === "failed" ? t("timeline.fail", "Fail") :
                       t("timeline.run", "Run")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Job list below the timeline */}
      {jobs.length > 0 && (
        <div className={styles.jobList}>
          {jobs.map((job) => {
            const ageText = formatAge(job.creationTs, now) || job.creationTs;
            const statusColor =
              job.status === "succeeded"
                ? "var(--status-ok)"
                : job.status === "failed"
                  ? "var(--status-err)"
                  : "var(--status-warn)";

            return (
              <button
                key={job.uid}
                type="button"
                className={styles.jobRow}
                onClick={() => handleClick(job)}
              >
                <span
                  className={styles.jobStatusDot}
                  style={{ background: statusColor }}
                />
                <span className={styles.jobName} title={job.name}>
                  {job.name}
                </span>
                <span className={styles.jobMeta}>
                  {job.completions}
                </span>
                <span className={styles.jobMeta}>
                  {job.duration}
                </span>
                <span className={styles.jobAge}>{ageText}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
