/** Redact credentials from text that may be shown or logged. */
export function redactText(value: string) {
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[redacted private key]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})/g,
      "[redacted token]",
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|secret|password|authorization)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"'}]+/gi,
      "$1[redacted]",
    );
}
