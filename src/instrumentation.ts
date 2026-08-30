export function register() {
  // Compatibility bridge for the temporary misspelled Vercel variable.
  // Keep the canonical STEEL_CONTROL_SECRET as the preferred name.
  if (!process.env.STEEL_CONTROL_SECRET?.trim() && process.env.STELL_CONTROL_SECRET?.trim()) {
    process.env.STEEL_CONTROL_SECRET = process.env.STELL_CONTROL_SECRET;
  }
}
