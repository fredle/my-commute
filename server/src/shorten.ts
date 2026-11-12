/** Strip HTML from a disruption message and keep its first sentence. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Just the cause from a disruption message, short enough for the Lock Screen:
 * "ELIZABETH LINE: Severe delays between … while we fix a track fault at Hayes and Harlington. …"
 * becomes "track fault at Hayes & Harlington".
 */
export function shortReason(reason: string, maxLength = 60): string {
  let r = plainText(reason).replace(/^[A-Z][A-Z &'-]+:\s*/, "");
  r = (r.split(". ")[0] ?? r).trim();

  const cause = /\b(?:due to|while we (?:fix|repair|deal with|investigate)|because of|following)\s+(.+)$/i.exec(r);
  if (cause?.[1]) r = cause[1];
  r = r.replace(/^(?:an?|the)\s+/i, "").replace(/ and Harlington/g, " & Harlington");
  if (r.endsWith(".")) r = r.slice(0, -1);

  if (r.length > maxLength) {
    let cut = r.slice(0, maxLength - 1);
    const space = cut.lastIndexOf(" ");
    if (space > 0) cut = cut.slice(0, space);
    r = `${cut}…`;
  }
  return r;
}
