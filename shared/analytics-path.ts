/** Remove bearer credentials from page paths and absolute referrer URLs. */
export function analyticsPath(value: string): string {
  return value.split("?")[0].split("#")[0]
    .replace(/^(https?:\/\/[^/]+)?\/(e|i|co|portal|lead-form|review)\/[^/]+/i, "$1/$2/:token")
    .replace(/^(https?:\/\/[^/]+)?\/contract\/sign\/[^/]+/i, "$1/contract/sign/:token");
}
