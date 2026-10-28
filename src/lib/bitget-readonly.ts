/**
 * Enforces least-privilege access for the Copy Center's Bitget verifier.
 * The verifier only needs Unified Trading Account management/read permission.
 * Fail closed when the API's permission response is missing, malformed, or broader.
 */
export function isReadOnlyUtaPermissions(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  return value[0] === "uta_mgt";
}
