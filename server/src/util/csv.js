/**
 * Render rows as RFC 4180 CSV. Quotes only when necessary; embedded quotes are
 * doubled. Each row is terminated by CRLF.
 *
 * @param {string[]} columns
 * @param {Iterable<Record<string, unknown>>} rows
 * @returns {string}
 */
export function rowsToCsv(columns, rows) {
  const out = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    out.push(columns.map((c) => csvCell(row[c])).join(","));
  }
  return out.join("\r\n") + "\r\n";
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}
