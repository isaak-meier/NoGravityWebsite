/**
 * Lenient single-line email regex. We don't try to fully validate per RFC; the
 * sender will reject undeliverable addresses anyway. This rejects obvious junk
 * (no `@`, embedded whitespace, missing TLD).
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidEmail(value) {
  return typeof value === "string" && EMAIL_REGEX.test(value);
}
