/* ===== ORDER FORM ===== */
function addItemRow() {
  const wrap = document.getElementById('items-wrap');
  if (!wrap) return;
  const first = wrap.querySelector('.item-row');
  const clone = first.cloneNode(true);
  clone.querySelectorAll('input,select').forEach(el => {
    if (el.type === 'checkbox') return;
    if (el.name === 'qty') { el.value = '1'; return; }
    if (el.tagName === 'SELECT') { el.selectedIndex = 0; return; }
    el.value = '';
  });
  wrap.appendChild(clone);
}

function removeItemRow(btn) {
  const wrap = document.getElementById('items-wrap');
  const rows = wrap.querySelectorAll('.item-row');
  if (rows.length > 1) btn.closest('.item-row').remove();
}

/* ===== PREP LIST ===== */
function toggleAll(source) {
  document.querySelectorAll('.order-check').forEach(cb => cb.checked = source.checked);
}

/* ===== MOBILE SIDEBAR ===== */
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar) return;
  sidebar.classList.toggle('show');
  if (overlay) overlay.classList.toggle('show');
}

document.addEventListener('DOMContentLoaded', function () {
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) {
    overlay.addEventListener('click', function () {
      document.querySelector('.sidebar')?.classList.remove('show');
      overlay.classList.remove('show');
    });
  }

  /* Active bottom nav */
  const path = window.location.pathname;
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    const href = el.getAttribute('href');
    if (!href) return;
    const match = href === '/' ? path === '/' : path.startsWith(href);
    if (match) el.classList.add('active');
  });
});

/* ===== HTML ESCAPE ===== */
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ===== ORDER SEARCH ===== */
const STATUS_COLORS_MAP = {
  'جديد': 'secondary', 'مراجعة': 'info', 'تجهيز': 'primary',
  'عند المشغل': 'warning', 'مستلم من المشغل': 'warning',
  'عند المطرز': 'purple', 'جاهز للتغليف': 'success',
  'تم التنفيذ': 'dark', 'ملغي': 'danger'
};

let _searchTimer;
function handleSearchInput(val) {
  clearTimeout(_searchTimer);
  const q = val.trim();
  if (q.length < 2) return;
  _searchTimer = setTimeout(() => doSearch(q), 500);
}

function doSearch(q) {
  q = (q || '').trim();
  const resultEl = document.getElementById('search-result');
  if (!resultEl || !q) return;
  resultEl.innerHTML = '<div class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2"></div>جاري البحث…</div>';

  fetch('/api/orders/lookup?q=' + encodeURIComponent(q))
    .then(r => r.json())
    .then(data => renderSearchResult(data, resultEl))
    .catch(() => {
      resultEl.innerHTML = '<div class="alert alert-danger">حدث خطأ في الاتصال. حاول مرة أخرى.</div>';
    });
}

function renderSearchResult(data, el) {
  if (!data.found) {
    el.innerHTML = `<div class="alert alert-warning mt-2">⚠️ ${esc(data.error) || 'لم يتم العثور على طلب'}</div>`;
    return;
  }
  const o = data.order;
  const color = STATUS_COLORS_MAP[esc(o.status)] || 'secondary';
  let html = `
    <div class="scanner-result-card mt-3">
      <div class="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
        <div>
          <h5 class="mb-0 fw-bold" dir="ltr">${esc(o.order_number)}</h5>
          <small class="text-muted">${new Date(o.created_at).toLocaleDateString('ar-SA')}</small>
        </div>
        <span class="badge bg-${esc(color)} fs-6 px-3 py-2">${esc(o.status)}</span>
      </div>
      <hr class="my-2">
      <p class="text-muted small mb-2">القطع (${o.items.length})</p>
  `;
  o.items.forEach(it => {
    // Only allow http/https image URLs to prevent javascript: injection
    const safeImg = it.image_url && /^https?:\/\//i.test(it.image_url.trim());
    html += `
      <div class="item-card-search ${it.is_matched ? 'matched' : ''}">
        ${safeImg
          ? `<img src="${esc(it.image_url)}" class="item-img" alt="${esc(it.product_name)}" onerror="this.replaceWith(makePlaceholder())">`
          : `<div class="item-img-placeholder">👗</div>`
        }
        <div class="flex-grow-1 min-width-0">
          <strong class="d-block">${esc(it.product_name) || '—'}</strong>
          <div class="text-muted small mt-1 d-flex flex-wrap gap-2">
            ${it.size  ? `<span>📐 ${esc(it.size)}</span>` : ''}
            ${it.color ? `<span>🎨 ${esc(it.color)}</span>` : ''}
            <span>📦 الكمية: <strong>${esc(String(it.qty))}</strong></span>
          </div>
          ${it.embroidery_name ? `<div class="small mt-1">🧵 التطريز: <strong>${esc(it.embroidery_name)}</strong></div>` : ''}
          <div class="mt-2 d-flex gap-2 flex-wrap">
            <span class="badge bg-light text-dark border">المرحلة: ${esc(it.stage) || '—'}</span>
            ${it.is_matched ? '<span class="badge bg-warning text-dark">✓ مطابق للباركود</span>' : ''}
          </div>
          <div class="mt-1"><code class="small text-muted">${esc(it.barcode)}</code></div>
        </div>
      </div>
    `;
  });
  html += `
      <div class="mt-3 pt-2 border-top d-flex gap-2">
        <a href="/orders/${esc(o.id)}" class="btn btn-sm btn-outline-secondary flex-grow-1">فتح الطلب</a>
        <a href="/orders/${esc(o.id)}/print" class="btn btn-sm btn-outline-secondary" target="_blank">🖨️ طباعة</a>
      </div>
    </div>`;
  el.innerHTML = html;
}

function makePlaceholder() {
  const d = document.createElement('div');
  d.className = 'item-img-placeholder';
  d.textContent = '👗';
  return d;
}

/* ===== CAMERA BARCODE SCANNER (shared) ===== */
let _activeScanner = null;

function startCameraScanner(readerElementId, onResult) {
  if (typeof Html5QrcodeScanner === 'undefined') {
    alert('مكتبة الكاميرا لم تُحمَّل بعد. تأكد من اتصالك بالإنترنت.');
    return;
  }
  if (_activeScanner) { stopCameraScanner(); }

  _activeScanner = new Html5QrcodeScanner(readerElementId, {
    fps: 10,
    qrbox: { width: 260, height: 160 },
    rememberLastUsedCamera: true,
    showTorchButtonIfSupported: true,
    formatsToSupport: [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
    ]
  }, false);

  _activeScanner.render(
    (decoded) => {
      stopCameraScanner();
      if (onResult) onResult(decoded.trim());
    },
    () => { /* suppress per-frame errors */ }
  );
}

function stopCameraScanner() {
  if (_activeScanner) {
    _activeScanner.clear().catch(() => {});
    _activeScanner = null;
  }
}
