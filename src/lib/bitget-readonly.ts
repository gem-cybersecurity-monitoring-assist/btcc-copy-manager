/**
 * Enforces least-privilege access for the Copy Center's Bitget connection.
 *
 * Bitget's live /api/v3/account/info returns permType "readonly" (no hyphen)
 * while its documentation writes "read-only"; both spellings are accepted.
 * "read_only", "read-and-write" and any other value are rejected.
 *
 * The permission list must contain "uta_mgt" and none of the trading,
 * withdrawal or copy-trading permissions. The overall read-only type is still
 * required because UTA management also has write endpoints when paired with a
 * read-write key.
 */
export const FORBIDDEN_UTA_PERMISSIONS = [
  "uta_trade",
  "withdraw",
  "copy_futures_position",
  "copy_futures_order",
] as const;

export function isReadOnlyPermissionType(permissionType: unknown): boolean {
  return typeof permissionType === "string" && permissionType.replace(/-/g, "").toLowerCase() === "readonly";
}

export function isReadOnlyUtaPermissions(permissions: unknown, permissionType: unknown): boolean {
  if (!isReadOnlyPermissionType(permissionType)) return false;
  if (!Array.isArray(permissions) || permissions.length === 0) return false;
  if (!permissions.every((permission) => typeof permission === "string")) return false;
  if (!permissions.includes("uta_mgt")) return false;
  return !FORBIDDEN_UTA_PERMISSIONS.some((permission) => permissions.includes(permission));
}
