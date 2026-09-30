import { describe, it, expect } from 'vitest';
import { bundleIdOf, bundleOverlaps, coveringBundleOf, withoutBundledParts } from '../shared/cart-bundles';

const dfy = (id: string) => ({ id, type: id === 'dfy_bundle' ? 'dfy_bundle' : 'dfy_service' });
const mod = (n: number) => ({ id: `course_module_${n}`, type: 'course_module', moduleId: n });
const courseBundle = { id: 'course_bundle', type: 'course_bundle' };

describe('cart bundles', () => {
  it('knows what each bundle includes', () => {
    for (const id of ['dfy_formation', 'dfy_gmb_website', 'dfy_seo_ads']) expect(coveringBundleOf(dfy(id))).toBe('dfy_bundle');
    for (const id of ['dfy_seo_first_page', 'dfy_seo_growth', 'dfy_seo_domination', 'dfy_bundle']) expect(coveringBundleOf(dfy(id))).toBeNull();
    expect(coveringBundleOf(mod(3))).toBe('course_bundle');
    expect(coveringBundleOf(courseBundle)).toBeNull();
    // isInCart only has the id: the client's id scheme decides.
    expect(coveringBundleOf({ id: 'course_module_7' })).toBe('course_bundle');
    expect(coveringBundleOf({ id: 'dfy_formation' })).toBe('dfy_bundle');
  });

  it('matches bundles the way checkout prices them', () => {
    expect(bundleIdOf(dfy('dfy_bundle'))).toBe('dfy_bundle');
    expect(bundleIdOf({ id: 'dfy_bundle', type: 'dfy_service' })).toBe('dfy_bundle');
    // The server prices a course bundle by type, whatever id rides along.
    expect(bundleIdOf({ id: 'anything', type: 'course_bundle' })).toBe('course_bundle');
    expect(bundleIdOf(dfy('dfy_formation'))).toBeNull();
    expect(bundleIdOf(mod(1))).toBeNull();
  });

  it('flags a bundle sold alongside its own parts', () => {
    const dfyCart = [dfy('dfy_formation'), dfy('dfy_gmb_website'), dfy('dfy_seo_ads'), dfy('dfy_bundle')];
    expect(bundleOverlaps(dfyCart).map((o) => o.part.id)).toEqual(['dfy_formation', 'dfy_gmb_website', 'dfy_seo_ads']);
    expect(withoutBundledParts(dfyCart).map((i) => i.id)).toEqual(['dfy_bundle']);

    const courseCart = [mod(1), mod(2), mod(3), mod(4), courseBundle];
    expect(bundleOverlaps(courseCart)).toHaveLength(4);
    expect(withoutBundledParts(courseCart)).toEqual([courseBundle]);
  });

  it('leaves carts without an overlap untouched', () => {
    const cart = [dfy('dfy_formation'), mod(2), dfy('dfy_seo_growth')];
    expect(bundleOverlaps(cart)).toEqual([]);
    expect(withoutBundledParts(cart)).toBe(cart);
    // A module and the DFY bundle are different products.
    expect(bundleOverlaps([mod(1), dfy('dfy_bundle')])).toEqual([]);
    expect(bundleOverlaps([dfy('dfy_formation'), courseBundle])).toEqual([]);
  });
});
