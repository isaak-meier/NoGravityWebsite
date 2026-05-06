/**
 * Build a tiny self-contained HTML page used for landing screens after
 * magic-link verify, mailing list confirm/unsubscribe, etc.
 *
 * @param {string} title
 * @param {string} message
 * @param {{ ctaUrl?: string, ctaLabel?: string }} [opts]
 * @returns {string}
 */
export function renderHtmlPage(title, message, opts = {}) {
  const cta = opts.ctaUrl
    ? `<p><a class="cta" href="${escapeHtml(opts.ctaUrl)}">${escapeHtml(opts.ctaLabel || "Continue")}</a></p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}
  h1{font-weight:600;margin-bottom:.5rem}
  .cta{display:inline-block;margin-top:1rem;padding:.5rem 1rem;border:1px solid #222;border-radius:.25rem;text-decoration:none;color:#222}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
${cta}
</body></html>`;
}

/**
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
