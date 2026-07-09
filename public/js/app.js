// Add another product line in the new-order form
function addItemRow() {
  const wrap = document.getElementById('items-wrap');
  if (!wrap) return;
  const first = wrap.querySelector('.item-row');
  const clone = first.cloneNode(true);
  clone.querySelectorAll('input,select').forEach(el => { if (el.type !== 'checkbox') el.value = ''; });
  wrap.appendChild(clone);
}

function removeItemRow(btn) {
  const wrap = document.getElementById('items-wrap');
  const rows = wrap.querySelectorAll('.item-row');
  if (rows.length > 1) btn.closest('.item-row').remove();
}

// simple checkbox "select all" helper for prep list printing
function toggleAll(source) {
  document.querySelectorAll('.order-check').forEach(cb => cb.checked = source.checked);
}
