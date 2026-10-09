/** Remove only explicit ad-slot rows, preserving sign-in and guest action rows. */
export function removeAdSlotRenderers(items) {
  return Array.isArray(items) ? items.filter(item => !item?.adSlotRenderer) : items;
}
