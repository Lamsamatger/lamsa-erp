/**
 * Classify an order as 'مخزون' or 'إنتاج' based on available inventory.
 *
 * Matching priority (most-specific first):
 *   1. product_id + size + color  (exact variant)
 *   2. product_id + size          (same product, same size, any color)
 *   3. product_id only            (same product, any variant)
 */
function classifyOrder(orderItems, inventoryItems) {
  if (!inventoryItems || inventoryItems.length === 0) return 'إنتاج';
  for (const oi of orderItems) {
    const pid   = oi.product_id;
    const size  = (oi.size  || '').trim().toLowerCase();
    const color = (oi.color || '').trim().toLowerCase();
    const need  = Number(oi.qty) || 1;

    // Try most-specific match first, then progressively broader
    let candidates = inventoryItems.filter(inv =>
      inv.product_id === pid &&
      (inv.size  || '').trim().toLowerCase() === size &&
      (inv.color || '').trim().toLowerCase() === color
    );
    if (!candidates.length && size) {
      candidates = inventoryItems.filter(inv =>
        inv.product_id === pid &&
        (inv.size || '').trim().toLowerCase() === size
      );
    }
    if (!candidates.length) {
      candidates = inventoryItems.filter(inv => inv.product_id === pid);
    }

    const available = candidates.reduce((s, inv) => s + (Number(inv.qty) || 0), 0);
    if (available < need) return 'إنتاج';
  }
  return 'مخزون';
}

module.exports = { classifyOrder };
