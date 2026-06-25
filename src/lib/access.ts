// ---------------------------------------------------------------------------
// Access control — the training matrix shares the Supabase auth pool with other
// Fortuna apps, so we gate by an explicit email allowlist. Only these accounts
// may use the app. Update this list to grant/revoke access.
// ---------------------------------------------------------------------------
export const ALLOWED_EMAILS = [
  "kainesmith123@live.com",
  "james@fortunacivilsltd.co.uk",
];

export function isAllowedEmail(email?: string | null): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}
