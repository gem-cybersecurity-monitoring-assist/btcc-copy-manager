/**
 * Enforces least-privilege access for the Copy Center's Bitget verifier.
 * Bitget's overall key permission type must be read-only, and its only scope
 * must be UTA management/read. The scope alone is insufficient because UTA
 * management also has write endpoints when paired with a read-write key.
 */
export function isReadOnlyUtaPermissions(permissions: unknown, permissionType: unknown): boolean {
  if (permissionType !== "read-only") return false;
  if (!Array.isArray(permissions) || permissions.length !== 1) return false;
  return permissions[0] === "uta_mgt";
}
