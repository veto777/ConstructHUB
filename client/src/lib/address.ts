/** Street line plus city, state and ZIP. New locations store only the street line in `address`; older rows
 *  (and Places text-search adds) hold Google's full formatted address, so don't append the locality twice. */
export function fullAddress(l: { address?: string | null; city?: string | null; state?: string | null; zipCode?: string | null }): string {
  const street = l.address?.trim() || '';
  if (street && l.city && l.state && street.includes(`${l.city}, ${l.state}`)) return street;
  return [street, l.city, [l.state, l.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
