/**
 * RBAC security audit types.
 */

/** One finding from the RBAC security audit. */
export interface AuditFinding {
  id: string; // rule ID like "wildcard-verbs"
  severity: string; // Critical/High/Medium/Low
  resourceKind: string; // Role/ClusterRole/RoleBinding/ClusterRoleBinding
  resourceName: string;
  namespace: string | null;
  message: string; // human-readable description
}

/** Severity counts rolled up from the findings list. */
export interface AuditSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

/** The result of a completed RBAC security audit. */
export interface AuditReport {
  findings: AuditFinding[];
  summary: AuditSummary;
  scannedAt: string; // ISO 8601
}
