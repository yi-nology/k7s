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

// ---------------------------------------------------------------------------
// RBAC Permission Matrix types
// ---------------------------------------------------------------------------

/** A subject in the permission matrix (User, Group, or ServiceAccount). */
export interface MatrixSubject {
  kind: string; // "User", "Group", "ServiceAccount"
  name: string;
  namespace?: string;
}

/** A verb+resource+apiGroup action key. */
export interface ActionKey {
  verb: string;
  resource: string;
  apiGroup: string;
}

/** One cell in the matrix: which binding/role grants this permission. */
export interface GrantSource {
  role: string;
  binding: string;
  bindingKind: string; // "RoleBinding" or "ClusterRoleBinding"
}

/** A sparse matrix entry: a subject has a specific action via a grant source. */
export interface MatrixGrant {
  subjectIdx: number;
  actionIdx: number;
  source: GrantSource;
}

/** The full RBAC permission matrix. */
export interface PermissionMatrix {
  subjects: MatrixSubject[];
  actions: ActionKey[];
  grants: MatrixGrant[];
}
