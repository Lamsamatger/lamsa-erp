const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { load, save, newId, nextOrderNumber, hashPassword, verifyPassword, log, DEFAULT_SETTINGS } = require('./lib/db');
const { ORDER_TYPES, ORDER_STATUSES, STATUS_COLORS, ROLES, ROLE_PERMISSIONS, HIDE_CUSTOMER_ROLES, PERMISSIONS, DELAY_DAYS_THRESHOLD } = require('./lib/constants');
const { classifyOrder } = require('./lib/classify');

const app = express();
const PORT = process.env.PORT || 5000;

// Startup security checks
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET is not set — using hardcoded fallback. Set it in Replit Secrets before going live.');
}
if (!process.env.SALLA_WEBHOOK_SECRET) {
  console.warn('⚠️  SALLA_WEBHOOK_SECRET is not set — webhook signature verification is disabled (dev/test mode only).');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; } // needed to verify Salla's X-Salla-Signature exactly
}));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'lamsa-azyai-production-erp-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }
}));

// ---------- helpers ----------
function daysBetween(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function isLate(order) {
  if (['جاهز للتغليف','في التغليف','تم التغليف','تم الشحن','تم التنفيذ','ملغي'].includes(order.status)) return false;
  return daysBetween(order.created_at) > DELAY_DAYS_THRESHOLD;
}

// Settings cache — avoids a full DB load on every request just for hideCustomer
let _settingsSecCache = null;
let _settingsSecCacheAt = 0;
const SETTINGS_CACHE_TTL = 30 * 1000; // 30 seconds

function getCachedSecuritySettings() {
  const now = Date.now();
  if (_settingsSecCache === null || now - _settingsSecCacheAt > SETTINGS_CACHE_TTL) {
    try {
      const _db = load();
      _settingsSecCache = _db.meta?.settings?.security || {};
      _settingsSecCacheAt = now;
    } catch (e) { _settingsSecCache = {}; }
  }
  return _settingsSecCache;
}
// Call this after saving settings to get fresh values immediately
function invalidateSettingsCache() { _settingsSecCache = null; }

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.ROLES = ROLES;
  res.locals.ORDER_STATUSES = ORDER_STATUSES;
  res.locals.STATUS_COLORS = STATUS_COLORS;
  res.locals.path = req.path;
  const role = req.session.user?.role || '';
  const perms = ROLE_PERMISSIONS[role] || { view: true };
  res.locals.userCan = perms;

  if (req.session.user) {
    // One DB read per authenticated request — covers security, modules, sidebar, embroidery badge
    try {
      const _db = load();
      const s = _db.meta?.settings || {};
      const secSettings = s.security || {};
      const sysHide = secSettings.hideCustomerFromProduction !== false;
      res.locals.hideCustomer = perms.hideCustomer === true && sysHide;
      res.locals.moduleSettings = { ...DEFAULT_SETTINGS.modules, ...(s.modules || {}) };
      res.locals.sidebarOrder   = s.sidebar_order || [...DEFAULT_SETTINGS.sidebar_order];
      res.locals.unassignedEmbroideryCount = (_db.embroidery_jobs || [])
        .filter(j => !j.embroiderer_id).length;
    } catch (e) {
      res.locals.hideCustomer = false;
      res.locals.moduleSettings = { ...DEFAULT_SETTINGS.modules };
      res.locals.sidebarOrder   = [...DEFAULT_SETTINGS.sidebar_order];
      res.locals.unassignedEmbroideryCount = 0;
    }
  } else {
    const secSettings = getCachedSecuritySettings();
    const sysHide = secSettings.hideCustomerFromProduction !== false;
    res.locals.hideCustomer = perms.hideCustomer === true && sysHide;
    res.locals.moduleSettings = { ...DEFAULT_SETTINGS.modules };
    res.locals.sidebarOrder   = [...DEFAULT_SETTINGS.sidebar_order];
    res.locals.unassignedEmbroideryCount = 0;
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireSection(section) {
  return (req, res, next) => {
    const allowed = PERMISSIONS[section] || [];
    if (!req.session.user || !allowed.includes(req.session.user.role)) {
      return res.status(403).render('error', { message: 'ليس لديك صلاحية للوصول لهذا القسم' });
    }
    next();
  };
}

// ---------- AUTH ----------
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const db = load();
  const u = db.users.find(x => x.username === username);
  if (!u || !verifyPassword(password, u.salt, u.hash)) {
    return res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  if (u.active === false) {
    return res.render('login', { error: 'هذا الحساب معطل — تواصل مع المدير' });
  }
  log(db, u.id, 'تسجيل دخول', u.name + ' (' + (ROLES[u.role] || u.role) + ')',
    { module: 'auth', type: 'security' });
  save(db);
  req.session.user = { id: u.id, username: u.username, name: u.name, role: u.role };
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- DASHBOARD ----------
app.get('/', requireAuth, requireSection('dashboard'), (req, res) => {
  const db = load();
  const orders      = db.orders          || [];
  const workshops   = db.workshops       || [];
  const wsJobs      = db.workshop_jobs   || [];
  const embJobs     = db.embroidery_jobs || [];
  const inventory   = db.inventory_items || [];

  // Progress % per order status
  const STATUS_PROGRESS = {
    'جديد': 5, 'مراجعة': 15, 'تجهيز': 25,
    'عند المشغل': 40, 'مستلم من المشغل': 52,
    'عند المطرز': 63, 'جاهز للتغليف': 72,
    'في التغليف': 82, 'تم التغليف': 90,
    'تم الشحن': 96, 'تم التنفيذ': 100, 'ملغي': 0
  };

  // Status counts
  const counts = {};
  ORDER_STATUSES.forEach(s => counts[s] = 0);
  orders.forEach(o => counts[o.status] = (counts[o.status] || 0) + 1);

  // KPI values
  const activeOrders    = orders.filter(o => o.status !== 'ملغي');
  const newOrders       = counts['جديد'] || 0;
  const inProdStatuses  = ['تجهيز','عند المشغل','مستلم من المشغل','عند المطرز','جاهز للتغليف','في التغليف'];
  const inProduction    = orders.filter(o => inProdStatuses.includes(o.status)).length;
  const lateOrders      = orders.filter(isLate);
  const readyToShip     = orders.filter(o => ['تم التغليف','تم الشحن'].includes(o.status)).length;
  const completedOrders = counts['تم التنفيذ'] || 0;
  const progressPct     = activeOrders.length === 0 ? 0 :
    Math.round(activeOrders.reduce((s, o) => s + (STATUS_PROGRESS[o.status] || 0), 0) / activeOrders.length);

  const today      = new Date().toISOString().slice(0, 10);
  const thisMonth  = new Date().toISOString().slice(0, 7);
  const doneToday  = orders.filter(o => o.status === 'تم التنفيذ' && (o.updated_at || '').slice(0, 10) === today).length;
  const doneThisMonth = orders.filter(o => o.status === 'تم التنفيذ' && (o.updated_at || '').slice(0, 7) === thisMonth).length;

  // Production pipeline funnel (6 stage groups)
  const stageFunnel = [
    { label: 'جديد',           icon: '🆕', statuses: ['جديد'],                                      color: '#6c757d' },
    { label: 'مراجعة وتجهيز',  icon: '🗂️', statuses: ['مراجعة','تجهيز'],                             color: '#0d6efd' },
    { label: 'المشغل',         icon: '✂️', statuses: ['عند المشغل','مستلم من المشغل'],               color: '#ffc107' },
    { label: 'التطريز',        icon: '🧵', statuses: ['عند المطرز'],                                 color: '#7c3aed' },
    { label: 'التغليف',        icon: '📦', statuses: ['جاهز للتغليف','في التغليف','تم التغليف'],     color: '#0d9488' },
    { label: 'شحن وإنجاز',    icon: '✅', statuses: ['تم الشحن','تم التنفيذ'],                       color: '#198754' },
  ];
  const pipeTotal = activeOrders.length || 1;
  stageFunnel.forEach(sf => {
    sf.count = sf.statuses.reduce((s, st) => s + (counts[st] || 0), 0);
    sf.pct   = Math.min(100, Math.round(sf.count / pipeTotal * 100));
    sf.link  = '/orders?status=' + encodeURIComponent(sf.statuses[0]);
  });

  // Late orders detail
  const late = lateOrders.map(o => ({
    ...o, days_late: daysBetween(o.created_at)
  })).sort((a, b) => b.days_late - a.days_late);

  // Workshop performance (statuses: 'قيد الانتظار' | 'عند المشغل' | 'مستلم')
  const wsPerf = workshops.filter(w => w.status === 'active').map(w => {
    const jobs      = wsJobs.filter(j => j.workshop_id === w.id);
    const activeJ   = jobs.filter(j => j.status === 'عند المشغل').length;
    const waitingJ  = jobs.filter(j => j.status === 'قيد الانتظار').length;
    const doneJ     = jobs.filter(j => j.status === 'مستلم').length;
    return { id: w.id, name: w.name, activeJobs: activeJ, waitingJobs: waitingJ, doneJobs: doneJ, total: jobs.length };
  });

  // Embroidery performance
  const embPerf = {
    totalJobs:     embJobs.length,
    totalReceived: embJobs.reduce((s, j) => s + (j.received_qty || 0), 0),
    totalDone:     embJobs.reduce((s, j) => s + (j.done_qty     || 0), 0),
    totalErrors:   embJobs.reduce((s, j) => s + (j.errors       || 0), 0),
  };
  embPerf.doneRate  = embPerf.totalReceived > 0 ? Math.round(embPerf.totalDone  / embPerf.totalReceived * 100) : 0;
  embPerf.errorRate = embPerf.totalReceived > 0 ? Math.round(embPerf.totalErrors/ embPerf.totalReceived * 100) : 0;

  // Low inventory alerts (qty <= low_stock_threshold)
  const lowInventory = inventory
    .filter(i => (i.qty || 0) <= (i.low_stock_threshold || 0))
    .map(i => ({ ...i, deficit: Math.max(0, (i.low_stock_threshold || 0) - (i.qty || 0)) }));

  // Recent orders (last 10)
  const recentOrders = orders.slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
    .map(o => ({
      ...o,
      progress:  STATUS_PROGRESS[o.status] || 0,
      late:      isLate(o),
      days_late: isLate(o) ? daysBetween(o.created_at) : 0,
      totalQty:  (o.items || []).reduce((s, i) => s + (i.qty || 1), 0)
    }));

  // Chart data – daily (last 14 days)
  const dailyData = [];
  for (let d = 13; d >= 0; d--) {
    const dt = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    dailyData.push({
      label: dt.slice(5),
      count: orders.filter(o => (o.created_at || '').slice(0, 10) === dt).length,
      done:  orders.filter(o => o.status === 'تم التنفيذ' && (o.updated_at || '').slice(0, 10) === dt).length
    });
  }

  // Chart data – weekly (last 8 weeks)
  const weeklyData = [];
  for (let w = 7; w >= 0; w--) {
    const wStart = new Date(Date.now() - w * 7 * 86400000);
    const wEnd   = new Date(Date.now() - (w - 1) * 7 * 86400000);
    weeklyData.push({
      label: wStart.toISOString().slice(5, 10),
      count: orders.filter(o => { const d = new Date(o.created_at || 0); return d >= wStart && d < wEnd; }).length,
      done:  orders.filter(o => { const d = new Date(o.updated_at  || 0); return o.status === 'تم التنفيذ' && d >= wStart && d < wEnd; }).length
    });
  }

  // Chart data – monthly (last 12 months)
  const monthlyData = [];
  for (let m = 11; m >= 0; m--) {
    const dt = new Date(); dt.setMonth(dt.getMonth() - m);
    const mKey = dt.toISOString().slice(0, 7);
    monthlyData.push({
      label: mKey.slice(5) + '/' + mKey.slice(2, 4),
      count: orders.filter(o => (o.created_at || '').slice(0, 7) === mKey).length,
      done:  orders.filter(o => o.status === 'تم التنفيذ' && (o.updated_at || '').slice(0, 7) === mKey).length
    });
  }

  // ── New KPI row values ──
  const newOrdersCount         = orders.filter(o => o.status === 'جديد').length;
  const productionOrdersCount  = orders.filter(o => (o.order_type || 'إنتاج') === 'إنتاج' && o.status !== 'ملغي').length;
  const stockOrdersCount       = orders.filter(o => o.order_type === 'مخزون' && o.status !== 'ملغي').length;
  const atWorkshopCount        = orders.filter(o => ['عند المشغل','مستلم من المشغل'].includes(o.status)).length;
  const embroideryPendingCount = orders.filter(o => o.status === 'عند المطرز').length;
  const readyForPackagingCount = orders.filter(o => o.status === 'جاهز للتغليف').length;
  const readyForShippingCount  = orders.filter(o => ['في التغليف','تم التغليف','تم الشحن'].includes(o.status)).length;
  const delayedOrdersCount     = lateOrders.length;

  res.render('dashboard', {
    // KPIs
    totalOrders: orders.length, newOrders, inProduction,
    lateCount: lateOrders.length, readyToShip, completedOrders, progressPct,
    doneToday, doneThisMonth,
    // New KPI row
    newOrdersCount, productionOrdersCount, stockOrdersCount, atWorkshopCount,
    embroideryPendingCount, readyForPackagingCount, readyForShippingCount, delayedOrdersCount,
    // Stage data
    counts, stageFunnel,
    // Detail lists
    late, lowInventory, recentOrders,
    // Performance
    wsPerf, embPerf,
    // Chart JSON strings (unescaped in template with <%-  %>)
    chartDaily:   JSON.stringify(dailyData),
    chartWeekly:  JSON.stringify(weeklyData),
    chartMonthly: JSON.stringify(monthlyData),
  });
});

// ---------- ORDERS ----------
app.get('/orders', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  let orders = db.orders.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const { status, city, q } = req.query;
  if (status) orders = orders.filter(o => o.status === status);
  if (city) orders = orders.filter(o => (o.city || '').includes(city));
  if (q) orders = orders.filter(o =>
    o.order_number.includes(q) ||
    (o.customer_name || '').includes(q) ||
    (o.customer_phone || '').includes(q)
  );

  orders = orders.map(o => ({ ...o, late: isLate(o) }));
  res.render('orders/list', { orders, filters: req.query, workshops: db.workshops });
});

app.get('/orders/new', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  res.render('orders/new', { products: db.products, error: null });
});

app.post('/orders/new', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  const { customer_name, customer_phone, city, notes } = req.body;
  let productIds = req.body.product_id;
  let sizes = req.body.size;
  let colors = req.body.color;
  let embroideryNames = req.body.embroidery_name;
  let qtys = req.body.qty;
  let itemNotes = req.body.item_notes;

  if (!Array.isArray(productIds)) {
    productIds = [productIds]; sizes = [sizes]; colors = [colors];
    embroideryNames = [embroideryNames]; qtys = [qtys]; itemNotes = [itemNotes];
  }

  const order_number = nextOrderNumber();
  const items = productIds.filter(Boolean).map((pid, i) => {
    const product = db.products.find(p => p.id === pid);
    return {
      id: newId('item'),
      product_id: pid,
      product_name: product ? product.name : '',
      size: sizes[i] || '',
      color: colors[i] || '',
      embroidery_name: embroideryNames[i] || '',
      notes: itemNotes[i] || '',
      qty: parseInt(qtys[i] || '1', 10),
      barcode: order_number + '-' + (i + 1),
      stage: 'تجهيز'
    };
  });

  const inventory = db.inventory_items || [];
  const orderType = classifyOrder(items, inventory);

  const order = {
    id: newId('ord'),
    order_number,
    order_type: orderType,
    customer_name: customer_name || '',
    customer_phone: customer_phone || '',
    city: city || '',
    status: 'جديد',
    assigned_employee: req.session.user.name,
    items,
    notes: notes || '',
    shipment_number: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.orders.push(order);
  log(db, req.session.user.id, 'إنشاء طلب', `${order_number} (${orderType})`);
  save(db);
  res.redirect('/orders/' + order.id);
});

app.get('/orders/:id', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const jobs = db.workshop_jobs.filter(j => j.order_id === order.id);
  const embJobs = db.embroidery_jobs.filter(j => j.order_id === order.id);
  // Build status history timeline from activity logs
  const userMap = {};
  db.users.forEach(u => { userMap[u.id] = u; });
  const statusHistory = db.activity_logs
    .filter(l => l.details && l.details.includes(order.order_number))
    .slice(0, 50)
    .map(l => {
      const u = userMap[l.user_id];
      return {
        ...l,
        user_name: u ? u.name : 'غير معروف',
        user_role: u ? (ROLES[u.role] || '') : ''
      };
    });
  res.render('orders/detail', { order, jobs, embJobs, workshops: db.workshops, embroiderers: db.embroiderers, late: isLate(order), statusHistory });
});

app.post('/orders/:id/status', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const newStatus = (req.body.status || '').trim();
  if (!ORDER_STATUSES.includes(newStatus))
    return res.status(400).render('error', { message: 'حالة غير معروفة: ' + newStatus });
  order.status = newStatus;
  order.updated_at = new Date().toISOString();
  if (req.body.shipment_number) order.shipment_number = req.body.shipment_number;
  log(db, req.session.user.id, 'تغيير حالة طلب', order.order_number + ' -> ' + order.status,
    { module: 'orders', type: 'status_change', after: newStatus });
  // Auto-queue embroidery job when entering عند المطرز
  if (newStatus === 'عند المطرز') {
    const existingEmb = db.embroidery_jobs.find(j => j.order_id === order.id && j.auto_queued && !j.embroiderer_id);
    if (!existingEmb) {
      db.embroidery_jobs.push({
        id: newId('ejob'),
        order_id:       order.id,
        order_number:   order.order_number,
        embroiderer_id: null,
        received_qty:   order.items.reduce((s, i) => s + (Number(i.qty) || 1), 0),
        done_qty: 0,
        errors:   0,
        notes:    '',
        auto_queued: true,
        created_at: new Date().toISOString()
      });
    }
  }
  save(db);
  // Support safe relative-path redirect (used by production module tabs)
  const redirectRaw = (req.body.redirect || '').trim();
  const safeRedirect = /^\/[^/\\]/.test(redirectRaw) ? redirectRaw : '/orders/' + order.id;
  res.redirect(safeRedirect);
});

app.post('/orders/:id/assign-workshop', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const job = {
    id: newId('wjob'),
    order_id: order.id,
    workshop_id: req.body.workshop_id,
    delivered_qty: parseInt(req.body.qty || '0', 10),
    received_qty: 0,
    delivered_at: null,
    received_at: null,
    status: 'قيد الانتظار'
  };
  db.workshop_jobs.push(job);
  order.status = 'تجهيز';
  order.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'تعيين مشغل', order.order_number);
  save(db);
  res.redirect('/orders/' + order.id);
});

app.get('/orders/:id/print', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  res.render('orders/card_print', { orders: [order] });
});

// ---------- PREPARATION LISTS ----------
app.get('/prep', requireAuth, requireSection('prep'), (req, res) => {
  const db = load();
  const { workshop_id, date, product_id, size, color, stage, tab } = req.query;

  // Build product map for image enrichment
  const productMap = {};
  db.products.forEach(p => { productMap[p.id] = p; });

  let orders = db.orders.filter(o => !['تم التنفيذ', 'ملغي'].includes(o.status));

  // Tab filter
  if (tab === 'new')        orders = orders.filter(o => o.status === 'جديد');
  else if (tab === 'production') orders = orders.filter(o => (o.order_type || 'إنتاج') === 'إنتاج');
  else if (tab === 'stock') orders = orders.filter(o => o.order_type === 'مخزون');
  else if (tab === 'printing')  orders = orders.filter(o => ['جديد','مراجعة','تجهيز'].includes(o.status));
  else if (tab === 'packaging') orders = orders.filter(o => o.status === 'جاهز للتغليف');

  if (date)       orders = orders.filter(o => (o.created_at || '').slice(0, 10) === date);
  if (product_id) orders = orders.filter(o => o.items.some(it => it.product_id === product_id));
  if (size)       orders = orders.filter(o => o.items.some(it => it.size === size));
  if (color)      orders = orders.filter(o => o.items.some(it => it.color === color));
  if (stage)      orders = orders.filter(o => o.status === stage || o.items.some(it => it.stage === stage));
  if (workshop_id) {
    const jobOrderIds = new Set(db.workshop_jobs.filter(j => j.workshop_id === workshop_id).map(j => j.order_id));
    orders = orders.filter(o => jobOrderIds.has(o.id));
  }

  // Flatten to item-level cards (enriched with order info + product image)
  const items = [];
  orders.forEach(order => {
    const orderTotalPieces = order.items.reduce((s, i) => s + i.qty, 0);
    order.items.forEach(item => {
      // Apply item-level filters
      if (size       && item.size  !== size)  return;
      if (color      && item.color !== color) return;
      if (product_id && item.product_id !== product_id) return;
      if (stage      && item.stage !== stage && order.status !== stage) return;
      const product = productMap[item.product_id];
      items.push({
        ...item,
        image_url: (product && product.image_url) ? product.image_url : '',
        order_id: order.id,
        order_number: order.order_number,
        order_status: order.status,
        order_total_pieces: orderTotalPieces,
        created_at: order.created_at,
      });
    });
  });

  res.render('prep/list', {
    orders, items,
    products: db.products,
    workshops: db.workshops,
    filters: req.query,
    ORDER_STATUSES
  });
});

// Strip customer PII from orders for print card rendering
function stripCustomerFields(order) {
  const { customer_name, customer_phone, city, payment_method, payment_status, ...safe } = order;
  return safe;
}

app.post('/prep/print', requireAuth, requireSection('prep'), (req, res) => {
  const db = load();
  let ids = req.body.order_ids;
  if (!ids) ids = [];
  if (!Array.isArray(ids)) ids = [ids];
  const cardsPerPage = parseInt(req.body.layout) === 16 ? 16 : 12;
  const baseUrl = process.env.APP_BASE_URL || (req.protocol + '://' + req.hostname);
  const orders = db.orders
    .filter(o => ids.includes(o.id))
    .sort((a, b) => a.order_number.localeCompare(b.order_number))
    .map(order => {
      const totalPieces = order.items.reduce((s, i) => s + Math.max(0, Number(i.qty) || 0), 0);
      return {
        ...stripCustomerFields(order), totalPieces,
        items: order.items.map(it => {
          const product = db.products.find(p => p.id === it.product_id);
          return { ...it, image_url: product ? product.image_url : '' };
        })
      };
    });
  const cardSettings = { ...DEFAULT_SETTINGS.card_designer, ...(db.meta?.settings?.card_designer || {}) };
  res.render('prep/print_cards', { orders, STATUS_COLORS, cardsPerPage, baseUrl, cardSettings });
});

app.get('/prep/print-all', requireAuth, requireSection('prep'), (req, res) => {
  const db = load();
  const savedLayout = db.meta?.settings?.card_designer?.default_layout;
  const cardsPerPage = parseInt(req.query.layout) || savedLayout || 12;
  const baseUrl = process.env.APP_BASE_URL || (req.protocol + '://' + req.hostname);
  const orders = db.orders
    .filter(o => !['تم التنفيذ', 'ملغي'].includes(o.status))
    .sort((a, b) => a.order_number.localeCompare(b.order_number))
    .map(order => {
      const totalPieces = order.items.reduce((s, i) => s + Math.max(0, Number(i.qty) || 0), 0);
      return {
        ...stripCustomerFields(order), totalPieces,
        items: order.items.map(it => {
          const product = db.products.find(p => p.id === it.product_id);
          return { ...it, image_url: product ? product.image_url : '' };
        })
      };
    });
  const cardSettings = { ...DEFAULT_SETTINGS.card_designer, ...(db.meta?.settings?.card_designer || {}) };
  res.render('prep/print_cards', { orders, STATUS_COLORS, cardsPerPage, baseUrl, cardSettings });
});

// ---------- ITEM STAGE UPDATE ----------
app.post('/orders/:id/items/:itemId/stage', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const item = order.items.find(it => it.id === req.params.itemId);
  if (!item) return res.status(404).render('error', { message: 'القطعة غير موجودة' });
  const newItemStage = (req.body.stage || '').trim();
  if (newItemStage && !ITEM_STAGES.includes(newItemStage))
    return res.status(400).render('error', { message: 'مرحلة غير معروفة: ' + newItemStage });
  item.stage = newItemStage || item.stage;
  order.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'تحديث مرحلة قطعة', order.order_number + ' → ' + item.stage);
  save(db);
  // Allow redirect back to item detail or order detail (constrain to same-origin relative paths)
  const redirectRaw = req.body.redirect || '';
  const redirect = /^\/[^/\\]/.test(redirectRaw) ? redirectRaw : '/orders/' + order.id;
  res.redirect(redirect);
});

// ═══════════════════════════════════════════════════════
// PRODUCTION QR SCANNER MODULE
// ═══════════════════════════════════════════════════════
const ITEM_STAGES = ['تجهيز','عند المشغل','مستلم من المشغل','عند المطرز','جاهز للتغليف','تم التنفيذ'];

app.get('/scanner', requireAuth, requireSection('scanner'), (req, res) => {
  const db = load();
  // Collect up to 6 sample barcodes from active orders so employees can tap quickly
  const sampleBarcodes = [];
  for (const o of db.orders) {
    if (['تم التنفيذ','ملغي'].includes(o.status)) continue;
    for (const it of o.items) {
      if (sampleBarcodes.length >= 6) break;
      sampleBarcodes.push(it.barcode);
    }
    if (sampleBarcodes.length >= 6) break;
  }
  res.render('scanner/index', { sampleBarcodes, error: req.query.error || null });
});

// Safe barcode decode helper — returns null on malformed input
function decodeSafeBarcode(raw) {
  try { return decodeURIComponent(raw).trim(); } catch { return null; }
}

app.get('/scanner/item/:barcode', requireAuth, requireSection('scanner'), (req, res) => {
  const db = load();
  const barcode = decodeSafeBarcode(req.params.barcode);
  if (!barcode) return res.redirect('/scanner?error=' + encodeURIComponent('باركود غير صالح'));

  // Locate item across all orders
  let foundOrder = null, foundItem = null;
  for (const order of db.orders) {
    const item = order.items.find(it => it.barcode === barcode);
    if (item) { foundOrder = order; foundItem = item; break; }
  }
  if (!foundOrder) {
    return res.redirect('/scanner?error=' + encodeURIComponent(barcode));
  }

  // Enrich item with product image
  const product = db.products.find(p => p.id === foundItem.product_id);
  const item = { ...foundItem, image_url: product ? (product.image_url || '') : '' };

  // Stage position + next stage (stock orders skip workshop/embroidery)
  const STOCK_ITEM_STAGES = ['تجهيز','جاهز للتغليف','تم التنفيذ'];
  const isStock = (foundOrder.order_type || 'إنتاج') === 'مخزون';
  const activeStages = isStock ? STOCK_ITEM_STAGES : ITEM_STAGES;
  const curIdx   = activeStages.indexOf(foundItem.stage);
  const nextStage = (curIdx >= 0 && curIdx < activeStages.length - 1) ? activeStages[curIdx + 1] : null;

  // Order progress % — average stage position across all items
  const stageSum = foundOrder.items.reduce((s, it) => {
    const idx = ITEM_STAGES.indexOf(it.stage || '');
    return s + (idx >= 0 ? idx : 0);
  }, 0);
  const progressPct = Math.round((stageSum / foundOrder.items.length) / (ITEM_STAGES.length - 1) * 100);

  // Current workshop assignment (latest active job)
  const workshopJob     = db.workshop_jobs.filter(j => j.order_id === foundOrder.id).slice(-1)[0];
  const currentWorkshop = workshopJob ? db.workshops.find(w => w.id === workshopJob.workshop_id) : null;

  // Current embroiderer assignment (latest job)
  const embroideryJob      = db.embroidery_jobs.filter(j => j.order_id === foundOrder.id).slice(-1)[0];
  const currentEmbroiderer = embroideryJob ? db.embroiderers.find(e => e.id === embroideryJob.embroiderer_id) : null;

  // Activity logs for this order — enrich with user name + role
  const userMap = {};
  db.users.forEach(u => { userMap[u.id] = u; });
  const logs = db.activity_logs
    .filter(l => l.details && l.details.includes(foundOrder.order_number))
    .slice(0, 30)
    .map(l => {
      const u = userMap[l.user_id];
      return {
        ...l,
        user_name: u ? u.name : 'غير معروف',
        user_role: u ? (ROLES[u.role] || '') : ''
      };
    });

  res.render('scanner/item', {
    order: foundOrder,
    item,
    nextStage,
    ITEM_STAGES: activeStages,
    curIdx,
    progressPct,
    isStock,
    currentWorkshop,
    currentEmbroiderer,
    workshops:   db.workshops.filter(w => w.status === 'active'),
    embroiderers: db.embroiderers,
    logs,
    totalPieces: foundOrder.items.reduce((s, i) => s + i.qty, 0)
  });
});

// POST: advance or override item stage
app.post('/scanner/item/:barcode/stage', requireAuth, requireSection('scanner'), (req, res) => {
  const db = load();
  const barcode = decodeSafeBarcode(req.params.barcode);
  if (!barcode) return res.redirect('/scanner?error=' + encodeURIComponent('باركود غير صالح'));

  const newStage = (req.body.stage || '').trim();
  // Enforce allowlist — only accept known production stages
  if (!ITEM_STAGES.includes(newStage)) {
    return res.status(400).render('error', { message: 'مرحلة إنتاج غير معروفة: ' + newStage });
  }

  let foundOrder = null, foundItem = null;
  for (const order of db.orders) {
    const it = order.items.find(i => i.barcode === barcode);
    if (it) { foundOrder = order; foundItem = it; break; }
  }
  if (!foundOrder || !foundItem) return res.redirect('/scanner?error=' + encodeURIComponent(barcode));

  foundItem.stage = newStage;
  foundOrder.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'تحديث مرحلة قطعة',
    `${foundOrder.order_number} — ${foundItem.barcode} → ${newStage}`);
  save(db);
  res.redirect('/scanner/item/' + encodeURIComponent(barcode));
});

// POST: update order-level status
app.post('/scanner/order/:orderId/status', requireAuth, requireSection('scanner'), (req, res) => {
  const db = load();
  // Validate orderId is a known id (not an arbitrary string)
  const order = db.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  const newStatus = (req.body.status || '').trim();
  // Enforce allowlist
  if (!ORDER_STATUSES.includes(newStatus)) {
    return res.status(400).render('error', { message: 'حالة غير معروفة: ' + newStatus });
  }

  order.status = newStatus;
  order.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'تغيير حالة طلب', `${order.order_number} → ${newStatus}`,
    { module: 'scanner', type: 'status_change', after: newStatus });
  // Auto-queue embroidery job when entering عند المطرز
  if (newStatus === 'عند المطرز') {
    const existingEmb = db.embroidery_jobs.find(j => j.order_id === order.id && j.auto_queued && !j.embroiderer_id);
    if (!existingEmb) {
      db.embroidery_jobs.push({
        id: newId('ejob'),
        order_id:       order.id,
        order_number:   order.order_number,
        embroiderer_id: null,
        received_qty:   order.items.reduce((s, i) => s + (Number(i.qty) || 1), 0),
        done_qty: 0,
        errors:   0,
        notes:    '',
        auto_queued: true,
        created_at: new Date().toISOString()
      });
    }
  }
  save(db);

  // Redirect back to the item that triggered the action (safe relative path only)
  const barcode = (req.body.barcode || '').trim();
  if (barcode) return res.redirect('/scanner/item/' + encodeURIComponent(barcode));
  res.redirect('/scanner');
});

// POST: assign workshop
app.post('/scanner/order/:orderId/workshop', requireAuth, requireSection('scanner'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  const { workshop_id, barcode } = req.body;
  const workshop = db.workshops.find(w => w.id === workshop_id);
  if (workshop) {
    // Update or create workshop job
    let job = db.workshop_jobs.find(j => j.order_id === order.id && j.status === 'قيد الانتظار');
    if (!job) {
      job = {
        id: newId('wjob'),
        order_id: order.id,
        workshop_id,
        delivered_qty: order.items.reduce((s, i) => s + i.qty, 0),
        received_qty: 0,
        delivered_at: new Date().toISOString(),
        received_at: null,
        status: 'عند المشغل'
      };
      db.workshop_jobs.push(job);
    } else {
      job.workshop_id = workshop_id;
      job.delivered_at = new Date().toISOString();
      job.status = 'عند المشغل';
    }
    order.status = 'عند المشغل';
    order.updated_at = new Date().toISOString();
    log(db, req.session.user.id, 'تعيين مشغل', `${order.order_number} → ${workshop.name}`);
    save(db);
  }

  const redirectBarcode = (barcode || '').trim();
  if (redirectBarcode) return res.redirect('/scanner/item/' + encodeURIComponent(redirectBarcode));
  res.redirect('/scanner');
});

// POST: assign embroiderer
app.post('/scanner/order/:orderId/embroiderer', requireAuth, requireSection('scanner'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  const { embroiderer_id, barcode } = req.body;
  const embroiderer = db.embroiderers.find(e => e.id === embroiderer_id);
  if (embroiderer) {
    // Reuse auto-queued job if one exists; otherwise create a new one
    const autoJob = db.embroidery_jobs.find(j => j.order_id === order.id && j.auto_queued && !j.embroiderer_id);
    if (autoJob) {
      autoJob.embroiderer_id = embroiderer_id;
      autoJob.updated_at = new Date().toISOString();
    } else {
      db.embroidery_jobs.push({
        id: newId('ejob'),
        order_id: order.id,
        order_number: order.order_number,
        embroiderer_id,
        received_qty: order.items.reduce((s, i) => s + (Number(i.qty) || 1), 0),
        done_qty: 0,
        errors: 0,
        notes: '',
        auto_queued: false,
        created_at: new Date().toISOString()
      });
    }
    order.status = 'عند المطرز';
    order.updated_at = new Date().toISOString();
    log(db, req.session.user.id, 'تعيين مطرز', `${order.order_number} → ${embroiderer.name}`);
    save(db);
  }

  const redirectBarcode = (barcode || '').trim();
  if (redirectBarcode) return res.redirect('/scanner/item/' + encodeURIComponent(redirectBarcode));
  res.redirect('/scanner');
});

// POST: add a note to order activity log (scanner)
app.post('/scanner/order/:orderId/notes', requireAuth, requireSection('scanner'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.orderId);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const noteRaw = (req.body.note || '').trim();
  const note    = noteRaw.slice(0, 500); // cap at 500 chars
  const barcode = (req.body.barcode || '').trim();
  if (!note) {
    const redir = barcode ? '/scanner/item/' + encodeURIComponent(barcode) : '/scanner';
    return res.redirect(redir);
  }
  log(db, req.session.user.id, 'ملاحظة إنتاج', `${order.order_number}: ${note}`,
    { module: 'scanner', type: 'note' });
  save(db);
  if (barcode) return res.redirect('/scanner/item/' + encodeURIComponent(barcode));
  res.redirect('/scanner');
});

// ═══════════════════════════════════════════════════════
// PRODUCTION MANAGEMENT MODULE
// ═══════════════════════════════════════════════════════

app.get('/production', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  db.production_errors = db.production_errors || [];
  db.qc_records        = db.qc_records        || [];

  const activeOrders = db.orders.filter(o => !['تم التنفيذ','ملغي'].includes(o.status));

  // KPIs
  const today        = new Date().toISOString().slice(0, 10);
  const doneToday    = db.orders.filter(o => o.status === 'تم التنفيذ' && (o.updated_at||'').slice(0,10) === today).length;
  const delayedList  = activeOrders.filter(isLate);
  const totalPieces  = activeOrders.reduce((s, o) => s + o.items.reduce((s2,i) => s2 + i.qty, 0), 0);
  const completedPieces = activeOrders.reduce((s, o) =>
    s + o.items.filter(i => i.stage === 'تم التنفيذ').reduce((s2, i) => s2 + i.qty, 0), 0);
  const qcRejected   = db.qc_records.reduce((s, r) => s + (r.rejected_qty || 0), 0);
  const openErrors   = db.production_errors.filter(e => !e.resolved);

  // Stage counts for pipeline
  const stageCountMap = {};
  ORDER_STATUSES.forEach(s => stageCountMap[s] = 0);
  activeOrders.forEach(o => stageCountMap[o.status] = (stageCountMap[o.status] || 0) + 1);

  // Delayed count per stage
  const delayedByStage = {};
  delayedList.forEach(o => {
    delayedByStage[o.status] = (delayedByStage[o.status] || 0) + 1;
  });

  // Workshop performance stats
  const workshopStats = db.workshops.map(w => {
    const jobs = db.workshop_jobs.filter(j => j.workshop_id === w.id);
    const activeJobs    = jobs.filter(j => j.status === 'عند المشغل').length;
    const totalDelivered = jobs.reduce((s, j) => s + (j.delivered_qty || 0), 0);
    const totalReceived  = jobs.reduce((s, j) => s + (j.received_qty  || 0), 0);
    return { ...w, activeJobs, totalDelivered, totalReceived, pending: totalDelivered - totalReceived };
  });

  // Enrich active orders for the list
  const productMap  = {};  db.products.forEach(p => { productMap[p.id] = p; });
  const workshopMap = {};  db.workshops.forEach(w => { workshopMap[w.id] = w; });

  let enrichedOrders = activeOrders.map(o => {
    const wjob = db.workshop_jobs.filter(j => j.order_id === o.id).slice(-1)[0];
    const totalQty = o.items.reduce((s, i) => s + i.qty, 0);
    const doneQty  = o.items.filter(i => i.stage === 'تم التنفيذ').reduce((s, i) => s + i.qty, 0);
    const stageSum = o.items.reduce((s, i) => {
      const idx = ITEM_STAGES.indexOf(i.stage || '');
      return s + (idx >= 0 ? idx : 0);
    }, 0);
    const progressPct = o.items.length > 0
      ? Math.round(stageSum / o.items.length / (ITEM_STAGES.length - 1) * 100) : 0;
    const errCount = db.production_errors.filter(e => e.order_id === o.id && !e.resolved).length;
    return {
      ...o,
      late:        isLate(o),
      daysSince:   daysBetween(o.created_at),
      totalQty, doneQty,
      remainingQty: totalQty - doneQty,
      progressPct,
      workshop:    wjob ? workshopMap[wjob.workshop_id] : null,
      errors:      errCount
    };
  });

  // Apply filters
  const { status, workshop_id, delay } = req.query;
  if (status)      enrichedOrders = enrichedOrders.filter(o => o.status === status);
  if (workshop_id) enrichedOrders = enrichedOrders.filter(o => o.workshop && o.workshop.id === workshop_id);
  if (delay === '1') enrichedOrders = enrichedOrders.filter(o => o.late);

  res.render('production/dashboard', {
    title: 'إدارة الإنتاج',
    kpi: { active: activeOrders.length, delayed: delayedList.length, doneToday, totalPieces, completedPieces, qcRejected, openErrors: openErrors.length },
    stageCountMap,
    delayedByStage,
    workshopStats,
    openErrors: openErrors.slice(0, 8),
    orders: enrichedOrders,
    workshops:     db.workshops,
    filters:       req.query,
    ORDER_STATUSES,
    ITEM_STAGES,
    DELAY_DAYS_THRESHOLD
  });
});

app.get('/production/order/:id', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  db.production_errors = db.production_errors || [];
  db.qc_records        = db.qc_records        || [];

  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  // Enrich items with product images
  const productMap = {};
  db.products.forEach(p => { productMap[p.id] = p; });
  const items = order.items.map(it => ({
    ...it,
    image_url: (productMap[it.product_id] && productMap[it.product_id].image_url) || ''
  }));

  const totalQty  = items.reduce((s, i) => s + i.qty, 0);
  const stageSum  = items.reduce((s, i) => {
    const idx = ITEM_STAGES.indexOf(i.stage || '');
    return s + (idx >= 0 ? idx : 0);
  }, 0);
  const progressPct = items.length > 0
    ? Math.round(stageSum / items.length / (ITEM_STAGES.length - 1) * 100) : 0;

  // Stage breakdown by qty
  const stageBreakdown = {};
  ITEM_STAGES.forEach(s => stageBreakdown[s] = 0);
  items.forEach(i => { stageBreakdown[i.stage] = (stageBreakdown[i.stage] || 0) + i.qty; });

  // Workshop jobs enriched
  const workshopJobs = db.workshop_jobs
    .filter(j => j.order_id === order.id)
    .map(j => ({
      ...j,
      workshop: db.workshops.find(w => w.id === j.workshop_id) || { name: 'غير معروف' }
    }));

  // Embroidery jobs enriched
  const embJobs = db.embroidery_jobs
    .filter(j => j.order_id === order.id)
    .map(j => ({
      ...j,
      embroiderer: db.embroiderers.find(e => e.id === j.embroiderer_id) || { name: 'غير معروف' }
    }));

  // QC records + totals
  const qcRecords = db.qc_records.filter(r => r.order_id === order.id);
  const qcTotals  = qcRecords.reduce(
    (s, r) => ({ accepted: s.accepted + (r.accepted_qty||0), rejected: s.rejected + (r.rejected_qty||0), rework: s.rework + (r.rework_qty||0) }),
    { accepted: 0, rejected: 0, rework: 0 }
  );

  // Production errors for this order
  const errors = db.production_errors.filter(e => e.order_id === order.id);

  // Activity logs enriched
  const userMap = {};
  db.users.forEach(u => { userMap[u.id] = u; });
  const logs = db.activity_logs
    .filter(l => l.details && l.details.includes(order.order_number))
    .slice(0, 50)
    .map(l => {
      const u = userMap[l.user_id];
      return { ...l, user_name: u ? u.name : 'غير معروف', user_role: u ? (ROLES[u.role] || '') : '' };
    });

  res.render('production/order', {
    title: order.order_number + ' — الإنتاج',
    tab: req.query.tab || 'stages',
    order,
    items,
    progressPct,
    totalQty,
    stageBreakdown,
    workshopJobs,
    embJobs,
    qcRecords,
    qcTotals,
    errors,
    logs,
    workshops:    db.workshops.filter(w => w.status === 'active'),
    embroiderers: db.embroiderers,
    ITEM_STAGES,
    late:      isLate(order),
    daysSince: daysBetween(order.created_at)
  });
});

// POST: bulk update all items to same stage
app.post('/production/order/:id/items/stage', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const newStage = (req.body.stage || '').trim();
  if (!ITEM_STAGES.includes(newStage))
    return res.status(400).render('error', { message: 'مرحلة غير معروفة' });
  order.items.forEach(i => { i.stage = newStage; });
  order.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'تحديث مرحلة جميع القطع', `${order.order_number} → ${newStage}`);
  save(db);
  res.redirect('/production/order/' + order.id + '?tab=stages');
});

// POST: send to workshop
app.post('/production/order/:id/workshop', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const { workshop_id, qty } = req.body;
  const workshop = db.workshops.find(w => w.id === workshop_id);
  if (workshop) {
    const deliveredQty = parseInt(qty || '') || order.items.reduce((s, i) => s + i.qty, 0);
    db.workshop_jobs.push({
      id: newId('wjob'),
      order_id: order.id,
      workshop_id,
      delivered_qty: deliveredQty,
      received_qty: 0,
      delivered_at: new Date().toISOString(),
      received_at: null,
      status: 'عند المشغل'
    });
    order.status = 'عند المشغل';
    order.updated_at = new Date().toISOString();
    log(db, req.session.user.id, 'إرسال للمشغل', `${order.order_number} → ${workshop.name} (${deliveredQty} قطعة)`);
    save(db);
  }
  res.redirect('/production/order/' + order.id + '?tab=workshop');
});

// POST: receive from workshop
app.post('/production/order/:id/workshop-receive', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const { job_id, received_qty } = req.body;
  const job = db.workshop_jobs.find(j => j.id === job_id && j.order_id === order.id);
  if (job) {
    job.received_qty = parseInt(received_qty || '0', 10);
    job.received_at  = new Date().toISOString();
    job.status       = 'مستلم';
    order.status     = 'مستلم من المشغل';
    order.updated_at = new Date().toISOString();
    log(db, req.session.user.id, 'استلام من المشغل', `${order.order_number} — ${job.received_qty} قطعة`);
    save(db);
  }
  res.redirect('/production/order/' + order.id + '?tab=workshop');
});

// POST: assign embroiderer
app.post('/production/order/:id/embroiderer', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const { embroiderer_id, qty } = req.body;
  const embroiderer = db.embroiderers.find(e => e.id === embroiderer_id);
  if (embroiderer) {
    const rcvQty = parseInt(qty || '') || order.items.reduce((s, i) => s + i.qty, 0);
    db.embroidery_jobs.push({
      id: newId('ejob'),
      order_id:       order.id,
      embroiderer_id,
      received_qty:   rcvQty,
      done_qty: 0,
      errors:   0,
      notes:    '',
      created_at: new Date().toISOString()
    });
    order.status     = 'عند المطرز';
    order.updated_at = new Date().toISOString();
    log(db, req.session.user.id, 'إرسال للمطرز', `${order.order_number} → ${embroiderer.name}`);
    save(db);
  }
  res.redirect('/production/order/' + order.id + '?tab=embroidery');
});

// POST: update embroidery job progress
app.post('/production/order/:id/embroidery-update', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const { job_id, done_qty, errors: errCount, notes } = req.body;
  const job = db.embroidery_jobs.find(j => j.id === job_id && j.order_id === order.id);
  if (job) {
    job.done_qty = parseInt(done_qty  || '0', 10);
    job.errors   = parseInt(errCount  || '0', 10);
    job.notes    = notes || '';
    order.updated_at = new Date().toISOString();
    log(db, req.session.user.id, 'تحديث تطريز', `${order.order_number} — ${job.done_qty} منجز`);
    save(db);
  }
  res.redirect('/production/order/' + order.id + '?tab=embroidery');
});

// POST: add QC record
app.post('/production/order/:id/qc', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  db.qc_records = db.qc_records || [];
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const { accepted_qty, rejected_qty, rework_qty, notes } = req.body;
  const record = {
    id:           newId('qc'),
    order_id:     order.id,
    order_number: order.order_number,
    accepted_qty: parseInt(accepted_qty || '0', 10),
    rejected_qty: parseInt(rejected_qty || '0', 10),
    rework_qty:   parseInt(rework_qty   || '0', 10),
    notes:        notes || '',
    checked_by:   req.session.user.id,
    at:           new Date().toISOString()
  };
  db.qc_records.push(record);
  // Auto-advance: zero rejections → packaging ready (regardless of accepted count); any rejection → review
  order.status     = record.rejected_qty === 0 ? 'جاهز للتغليف' : 'مراجعة';
  order.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'تسجيل مراقبة جودة',
    `${order.order_number} — قبول: ${record.accepted_qty}، رفض: ${record.rejected_qty}`);
  save(db);
  res.redirect('/production/order/' + order.id + '?tab=quality');
});

// POST: record production error
app.post('/production/order/:id/error', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  db.production_errors = db.production_errors || [];
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const { error_type, reason, department, item_barcode } = req.body;
  db.production_errors.push({
    id:           newId('perr'),
    order_id:     order.id,
    order_number: order.order_number,
    item_barcode: (item_barcode || '').trim(),
    error_type:   error_type || 'أخرى',
    reason:       reason     || '',
    department:   department || '',
    recorded_by:  req.session.user.id,
    at:           new Date().toISOString(),
    resolved:     false,
    resolved_at:  null
  });
  log(db, req.session.user.id, 'تسجيل خطأ إنتاجي',
    `${order.order_number} — ${error_type || 'أخرى'}`);
  save(db);
  res.redirect('/production/order/' + order.id + '?tab=errors');
});

// POST: resolve production error
app.post('/production/error/:errorId/resolve', requireAuth, requireSection('production'), (req, res) => {
  const db = load();
  db.production_errors = db.production_errors || [];
  const err = db.production_errors.find(e => e.id === req.params.errorId);
  if (!err) return res.status(404).render('error', { message: 'السجل غير موجود' });
  err.resolved    = true;
  err.resolved_at = new Date().toISOString();
  log(db, req.session.user.id, 'حل خطأ إنتاجي', `${err.order_number} — ${err.error_type}`);
  save(db);
  res.redirect('/production/order/' + err.order_id + '?tab=errors');
});

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// PACKAGING & SHIPPING MODULE
// ═══════════════════════════════════════════════════════

const SHIPPING_STATUSES = ['جاهز للشحن','تم الشحن','تم التسليم','فشل التسليم'];

// ── Dashboard ────────────────────────────────────────
app.get('/packaging', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  db.packages  = db.packages  || [];
  db.shipments = db.shipments || [];

  const today = new Date().toISOString().slice(0, 10);
  const productMap = {};
  db.products.forEach(p => { productMap[p.id] = p; });
  const shipmentMap = {};
  db.shipments.forEach(s => { shipmentMap[s.order_id] = s; });
  const pkgMap = {};
  db.packages.forEach(p => { pkgMap[p.order_id] = p; });

  // KPIs
  const readyForPkg = db.orders.filter(o => o.status === 'جاهز للتغليف').length;
  const inPackaging = db.orders.filter(o => o.status === 'في التغليف').length;
  const shippedToday = db.shipments.filter(s =>
    s.status === 'تم الشحن' && (s.shipped_at || s.created_at || '').slice(0,10) === today
  ).length;
  const delivered = db.shipments.filter(s => s.status === 'تم التسليم').length;

  // Packaging queue: جاهز للتغليف + في التغليف + تم التغليف
  const queueStatuses = ['جاهز للتغليف','في التغليف','تم التغليف'];
  const queueOrders = db.orders
    .filter(o => queueStatuses.includes(o.status))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map(o => {
      const totalQty = o.items.reduce((s, i) => s + i.qty, 0);
      return {
        ...o,
        late: isLate(o),
        daysSince: daysBetween(o.created_at),
        totalQty,
        pkg: pkgMap[o.id] || null,
        enrichedItems: o.items.map(it => ({
          ...it,
          image_url: (productMap[it.product_id] && productMap[it.product_id].image_url) || ''
        }))
      };
    });

  // Active shipments
  const activeShipments = db.shipments
    .filter(s => !['تم التسليم','فشل التسليم'].includes(s.status))
    .slice(-20)
    .map(s => ({ ...s, order_number: s.order_number || '' }));

  // Recent completed (تم التنفيذ, ordered by updated_at desc, last 10)
  const recentDone = db.orders
    .filter(o => ['تم التنفيذ','تم الشحن'].includes(o.status))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10)
    .map(o => ({
      ...o,
      totalQty: o.items.reduce((s, i) => s + i.qty, 0),
      latestShipment: db.shipments.filter(s => s.order_id === o.id).slice(-1)[0] || null
    }));

  res.render('packaging/dashboard', {
    title: 'التغليف والشحن',
    kpi: { readyForPkg, inPackaging, shippedToday, delivered },
    queueOrders,
    activeShipments,
    recentDone,
    STATUS_COLORS
  });
});

// ── Order packaging + shipping detail ────────────────
app.get('/packaging/order/:id', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  db.packages  = db.packages  || [];
  db.shipments = db.shipments || [];

  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  const productMap = {};
  db.products.forEach(p => { productMap[p.id] = p; });
  const items = order.items.map(it => ({
    ...it,
    image_url: (productMap[it.product_id] && productMap[it.product_id].image_url) || ''
  }));

  const pkg       = db.packages.filter(p => p.order_id === order.id).slice(-1)[0] || null;
  const shipments = db.shipments.filter(s => s.order_id === order.id);

  // Activity logs for this order
  const userMap = {};
  db.users.forEach(u => { userMap[u.id] = u; });
  const logs = db.activity_logs
    .filter(l => l.details && l.details.includes(order.order_number))
    .slice(0, 50)
    .map(l => {
      const u = userMap[l.user_id];
      return { ...l, user_name: u ? u.name : 'غير معروف', user_role: u ? (ROLES[u.role] || '') : '' };
    });

  res.render('packaging/order', {
    title: 'تغليف — ' + order.order_number,
    tab:   req.query.tab || 'packaging',
    order,
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    pkg,
    shipments,
    logs,
    late:      isLate(order),
    daysSince: daysBetween(order.created_at),
    STATUS_COLORS,
    SHIPPING_STATUSES
  });
});

// ── Start packaging ───────────────────────────────────
app.post('/packaging/order/:id/start', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  db.packages = db.packages || [];
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  // Create or update package record
  let pkg = db.packages.find(p => p.order_id === order.id);
  if (!pkg) {
    pkg = {
      id: newId('pkg'), order_id: order.id, order_number: order.order_number,
      status: 'في التغليف', started_at: new Date().toISOString(),
      completed_at: null, confirmed_at: null, pieces_count: order.items.reduce((s, i) => s + i.qty, 0),
      notes: '', packed_by: req.session.user.id, created_at: new Date().toISOString()
    };
    db.packages.push(pkg);
  } else {
    pkg.status = 'في التغليف';
    pkg.started_at = pkg.started_at || new Date().toISOString();
    pkg.packed_by  = req.session.user.id;
  }

  order.status     = 'في التغليف';
  order.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'بدء التغليف', order.order_number);
  save(db);
  res.redirect('/packaging/order/' + order.id + '?tab=packaging');
});

// ── Complete packaging ────────────────────────────────
app.post('/packaging/order/:id/complete', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  db.packages = db.packages || [];
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  let pkg = db.packages.find(p => p.order_id === order.id);
  if (!pkg) {
    pkg = {
      id: newId('pkg'), order_id: order.id, order_number: order.order_number,
      status: 'تم التغليف', started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(), confirmed_at: new Date().toISOString(),
      pieces_count: order.items.reduce((s, i) => s + i.qty, 0),
      notes: '', packed_by: req.session.user.id, created_at: new Date().toISOString()
    };
    db.packages.push(pkg);
  } else {
    pkg.status       = 'تم التغليف';
    pkg.completed_at = new Date().toISOString();
    pkg.confirmed_at = new Date().toISOString();
  }

  order.status     = 'تم التغليف';
  order.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'إتمام التغليف', order.order_number);
  save(db);
  res.redirect('/packaging/order/' + order.id + '?tab=packaging');
});

// ── Update packaging notes ────────────────────────────
app.post('/packaging/order/:id/notes', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  db.packages = db.packages || [];
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  let pkg = db.packages.find(p => p.order_id === order.id);
  if (!pkg) {
    pkg = {
      id: newId('pkg'), order_id: order.id, order_number: order.order_number,
      status: 'في انتظار التغليف', started_at: null, completed_at: null,
      pieces_count: order.items.reduce((s, i) => s + i.qty, 0),
      notes: '', packed_by: req.session.user.id, created_at: new Date().toISOString()
    };
    db.packages.push(pkg);
  }
  pkg.notes = (req.body.notes || '').trim().substring(0, 500);
  log(db, req.session.user.id, 'ملاحظات تغليف', order.order_number);
  save(db);
  res.redirect('/packaging/order/' + order.id + '?tab=packaging');
});

// ── Create shipment ───────────────────────────────────
app.post('/packaging/order/:id/shipment', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  db.shipments = db.shipments || [];
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });

  const { shipping_company, tracking_number, notes } = req.body;
  const initStatus = (req.body.status || 'جاهز للشحن').trim();
  const safeStatus = SHIPPING_STATUSES.includes(initStatus) ? initStatus : 'جاهز للشحن';

  if (!shipping_company) return res.redirect('/packaging/order/' + order.id + '?tab=shipping&err=company');

  const shipment = {
    id: newId('shp'),
    order_id:         order.id,
    order_number:     order.order_number,
    shipping_company: shipping_company.trim(),
    tracking_number:  (tracking_number || '').trim(),
    status:           safeStatus,
    notes:            (notes || '').trim(),
    shipped_at:       safeStatus === 'تم الشحن' ? new Date().toISOString() : null,
    delivered_at:     null,
    failed_at:        null,
    created_by:       req.session.user.id,
    created_at:       new Date().toISOString()
  };
  db.shipments.push(shipment);

  // Advance order status
  const newOrderStatus = safeStatus === 'تم الشحن' ? 'تم الشحن' : 'تم التغليف';
  if (ORDER_STATUSES.includes(newOrderStatus)) {
    order.status = newOrderStatus;
  }
  // Also store tracking number on the order for backward compatibility
  if (tracking_number) order.shipment_number = tracking_number.trim();
  order.updated_at = new Date().toISOString();

  log(db, req.session.user.id, 'إنشاء شحنة',
    `${order.order_number} → ${shipping_company}${tracking_number ? ' · ' + tracking_number : ''}`);
  save(db);
  res.redirect('/packaging/order/' + order.id + '?tab=shipping');
});

// ── Update shipment status ────────────────────────────
app.post('/packaging/shipment/:shpId/status', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  db.shipments = db.shipments || [];
  const shipment = db.shipments.find(s => s.id === req.params.shpId);
  if (!shipment) return res.status(404).render('error', { message: 'الشحنة غير موجودة' });

  const newStatus = (req.body.status || '').trim();
  if (!SHIPPING_STATUSES.includes(newStatus))
    return res.status(400).render('error', { message: 'حالة شحن غير معروفة' });

  shipment.status = newStatus;
  if (newStatus === 'تم الشحن')    shipment.shipped_at   = shipment.shipped_at   || new Date().toISOString();
  if (newStatus === 'تم التسليم')  shipment.delivered_at = new Date().toISOString();
  if (newStatus === 'فشل التسليم') shipment.failed_at    = new Date().toISOString();

  // Sync order status
  const order = db.orders.find(o => o.id === shipment.order_id);
  if (order) {
    if (newStatus === 'تم التسليم')  order.status = 'تم التنفيذ';
    else if (newStatus === 'تم الشحن') order.status = 'تم الشحن';
    else if (newStatus === 'فشل التسليم') order.status = 'تم الشحن'; // stays shipped, retry
    order.updated_at = new Date().toISOString();
    log(db, req.session.user.id, 'تحديث حالة الشحنة',
      `${order.order_number} → ${newStatus}`);
  }
  save(db);
  const returnTo = order ? '/packaging/order/' + order.id + '?tab=shipping' : '/packaging';
  res.redirect(returnTo);
});

// ── QR Scanner for packaging ──────────────────────────
app.get('/packaging/scan', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  // Collect sample barcodes from packaging-queue orders
  const sampleBarcodes = [];
  for (const o of db.orders) {
    if (!['جاهز للتغليف','في التغليف','تم التغليف'].includes(o.status)) continue;
    for (const it of o.items) {
      if (sampleBarcodes.length >= 6) break;
      sampleBarcodes.push({ barcode: it.barcode, order_id: o.id, order_number: o.order_number });
    }
    if (sampleBarcodes.length >= 6) break;
  }
  res.render('packaging/scan', { sampleBarcodes, error: req.query.error || null });
});

// ── Barcode → packaging order redirect ───────────────
app.get('/packaging/scan/item/:barcode', requireAuth, requireSection('packaging'), (req, res) => {
  const db = load();
  const barcode = decodeSafeBarcode(req.params.barcode);
  if (!barcode) return res.redirect('/packaging/scan?error=' + encodeURIComponent('باركود غير صالح'));

  let foundOrder = null;
  for (const o of db.orders) {
    if (o.items.find(it => it.barcode === barcode)) { foundOrder = o; break; }
  }
  if (!foundOrder) return res.redirect('/packaging/scan?error=' + encodeURIComponent(barcode));
  res.redirect('/packaging/order/' + foundOrder.id);
});

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// INVENTORY MANAGEMENT MODULE
// ═══════════════════════════════════════════════════════

const ITEM_CATEGORIES  = ['قماش', 'إكسسوار', 'منتج جاهز', 'أخرى'];
const INVENTORY_UNITS  = ['متر', 'قطعة', 'كيلو', 'رول', 'كرتون', 'دزينة', 'لتر', 'طقم'];
const MOVEMENT_TYPES   = ['استلام', 'صرف', 'إرجاع', 'تسوية', 'جرد'];

function initInv(db) {
  db.inventory_items     = db.inventory_items     || [];
  db.inventory_movements = db.inventory_movements || [];
}

// ── Dashboard ──────────────────────────────────────────
app.get('/inventory', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load();
  initInv(db);

  const outOfStockItems = db.inventory_items.filter(i => i.qty <= 0);
  const lowStockItems   = db.inventory_items.filter(i => i.qty > 0 && i.qty <= (i.low_stock_threshold || 0));

  const catStats = {};
  ITEM_CATEGORIES.forEach(c => { catStats[c] = { count: 0, totalQty: 0, lowCount: 0 }; });
  db.inventory_items.forEach(i => {
    const c = i.category || 'أخرى';
    if (!catStats[c]) catStats[c] = { count: 0, totalQty: 0, lowCount: 0 };
    catStats[c].count++;
    catStats[c].totalQty += i.qty || 0;
    if (i.qty <= 0 || i.qty <= (i.low_stock_threshold || 0)) catStats[c].lowCount++;
  });

  const userMap = {}; db.users.forEach(u => { userMap[u.id] = u; });
  const itemMap = {}; db.inventory_items.forEach(i => { itemMap[i.id] = i; });
  const recentMovements = db.inventory_movements.slice(0, 15).map(m => ({
    ...m,
    user_name: userMap[m.performed_by] ? userMap[m.performed_by].name : 'غير معروف',
    item: itemMap[m.item_id] || { name: m.item_name, unit: '' }
  }));

  res.render('inventory/dashboard', {
    title: 'المخزون',
    kpi: {
      totalSkus:   db.inventory_items.length,
      outOfStock:  outOfStockItems.length,
      lowStock:    lowStockItems.length,
      totalValue:  db.inventory_items.reduce((s, i) => s + (i.qty || 0) * (i.cost_per_unit || 0), 0)
    },
    catStats,
    outOfStockItems: outOfStockItems.slice(0, 5),
    lowStockItems:   lowStockItems.slice(0, 8),
    recentMovements,
    ITEM_CATEGORIES,
    allItems: db.inventory_items
  });
});

// ── Items list ─────────────────────────────────────────
app.get('/inventory/items', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load();
  initInv(db);
  let items = [...db.inventory_items];
  const { category, status, q } = req.query;
  if (category) items = items.filter(i => i.category === category);
  if (status === 'low') items = items.filter(i => i.qty > 0 && i.qty <= (i.low_stock_threshold || 0));
  if (status === 'out') items = items.filter(i => i.qty <= 0);
  if (status === 'ok')  items = items.filter(i => i.qty > (i.low_stock_threshold || 0));
  if (q) {
    const ql = q.toLowerCase();
    items = items.filter(i =>
      (i.name || '').toLowerCase().includes(ql) ||
      (i.sku  || '').toLowerCase().includes(ql) ||
      (i.color|| '').toLowerCase().includes(ql)
    );
  }
  res.render('inventory/items', { title: 'أصناف المخزون', items, filters: req.query, ITEM_CATEGORIES, INVENTORY_UNITS });
});

// ── New item form ───────────────────────────────────────
app.get('/inventory/items/new', requireAuth, requireSection('inventory'), (req, res) => {
  res.render('inventory/item_form', { title: 'صنف جديد', item: null, ITEM_CATEGORIES, INVENTORY_UNITS });
});

// ── Create item ─────────────────────────────────────────
app.post('/inventory/items/new', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load();
  initInv(db);
  const { name, sku, category, unit, color, qty, low_stock_threshold, cost_per_unit, supplier, notes } = req.body;
  if (!name || !category || !unit)
    return res.status(400).render('error', { message: 'الاسم والفئة والوحدة مطلوبة' });
  if (!ITEM_CATEGORIES.includes(category))
    return res.status(400).render('error', { message: 'فئة غير معروفة' });
  if (!INVENTORY_UNITS.includes(unit))
    return res.status(400).render('error', { message: 'وحدة قياس غير معروفة' });

  const initialQty = Math.max(0, parseFloat(qty || '0') || 0);
  const item = {
    id: newId('inv'), name: name.trim(), sku: (sku || '').trim().substring(0, 30),
    category, unit, color: (color || '').trim(),
    qty: initialQty,
    low_stock_threshold: Math.max(0, parseFloat(low_stock_threshold || '10') || 10),
    cost_per_unit: Math.max(0, parseFloat(cost_per_unit || '0') || 0),
    supplier: (supplier || '').trim(), notes: (notes || '').trim().substring(0, 300),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  db.inventory_items.push(item);

  if (initialQty > 0) {
    db.inventory_movements.unshift({
      id: newId('mov'), item_id: item.id, item_name: item.name,
      type: 'استلام', qty: initialQty, qty_before: 0, qty_after: initialQty,
      reference: 'رصيد افتتاحي', order_id: null, order_number: null,
      notes: 'رصيد افتتاحي', performed_by: req.session.user.id,
      at: new Date().toISOString()
    });
  }
  log(db, req.session.user.id, 'إضافة صنف مخزون', item.name + (item.sku ? ' (' + item.sku + ')' : ''));
  save(db);
  res.redirect('/inventory/items/' + item.id);
});

// ── Item detail ─────────────────────────────────────────
app.get('/inventory/items/:id', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load();
  initInv(db);
  const item = db.inventory_items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).render('error', { message: 'الصنف غير موجود' });

  const userMap = {}; db.users.forEach(u => { userMap[u.id] = u; });
  const movements = db.inventory_movements
    .filter(m => m.item_id === item.id).slice(0, 50)
    .map(m => ({ ...m, user_name: userMap[m.performed_by] ? userMap[m.performed_by].name : 'غير معروف' }));
  const activeOrders = db.orders
    .filter(o => !['تم التنفيذ','ملغي'].includes(o.status))
    .map(o => ({ id: o.id, order_number: o.order_number, status: o.status }));

  res.render('inventory/item', {
    title: item.name, tab: req.query.tab || 'log',
    item, movements, activeOrders, ITEM_CATEGORIES, INVENTORY_UNITS,
    error: req.query.error || null, success: req.query.success || null
  });
});

// ── Receive stock ───────────────────────────────────────
app.post('/inventory/items/:id/receive', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load(); initInv(db);
  const item = db.inventory_items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).render('error', { message: 'الصنف غير موجود' });
  const qty = parseFloat(req.body.qty || '0');
  if (!qty || qty <= 0)
    return res.redirect('/inventory/items/' + item.id + '?tab=receive&error=' + encodeURIComponent('الكمية يجب أن تكون أكبر من صفر'));
  const before = item.qty;
  item.qty = Math.round((item.qty + qty) * 1000) / 1000;
  item.updated_at = new Date().toISOString();
  db.inventory_movements.unshift({
    id: newId('mov'), item_id: item.id, item_name: item.name,
    type: 'استلام', qty, qty_before: before, qty_after: item.qty,
    reference: (req.body.reference || '').trim().substring(0, 50),
    order_id: null, order_number: null,
    notes: (req.body.notes || '').trim().substring(0, 200),
    performed_by: req.session.user.id, at: new Date().toISOString()
  });
  log(db, req.session.user.id, 'استلام مواد', `${item.name}: +${qty} ${item.unit}`);
  save(db);
  res.redirect('/inventory/items/' + item.id + '?tab=log&success=' + encodeURIComponent('تم تسجيل الاستلام'));
});

// ── Issue to production ─────────────────────────────────
app.post('/inventory/items/:id/issue', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load(); initInv(db);
  const item = db.inventory_items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).render('error', { message: 'الصنف غير موجود' });
  const qty = parseFloat(req.body.qty || '0');
  if (!qty || qty <= 0)
    return res.redirect('/inventory/items/' + item.id + '?tab=issue&error=' + encodeURIComponent('كمية غير صالحة'));
  if (qty > item.qty)
    return res.redirect('/inventory/items/' + item.id + '?tab=issue&error=' + encodeURIComponent('الكمية المطلوبة أكبر من المتوفر (' + item.qty + ' ' + item.unit + ')'));
  const order = db.orders.find(o => o.id === req.body.order_id);
  const before = item.qty;
  item.qty = Math.round((item.qty - qty) * 1000) / 1000;
  item.updated_at = new Date().toISOString();
  db.inventory_movements.unshift({
    id: newId('mov'), item_id: item.id, item_name: item.name,
    type: 'صرف', qty: -qty, qty_before: before, qty_after: item.qty,
    reference: '', order_id: order ? order.id : null, order_number: order ? order.order_number : null,
    notes: (req.body.notes || '').trim().substring(0, 200),
    performed_by: req.session.user.id, at: new Date().toISOString()
  });
  log(db, req.session.user.id, 'صرف مواد للإنتاج',
    `${item.name}: -${qty} ${item.unit}${order ? ' → ' + order.order_number : ''}`);
  save(db);
  res.redirect('/inventory/items/' + item.id + '?tab=log&success=' + encodeURIComponent('تم تسجيل الصرف'));
});

// ── Return unused material ──────────────────────────────
app.post('/inventory/items/:id/return', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load(); initInv(db);
  const item = db.inventory_items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).render('error', { message: 'الصنف غير موجود' });
  const qty = parseFloat(req.body.qty || '0');
  if (!qty || qty <= 0)
    return res.redirect('/inventory/items/' + item.id + '?tab=return&error=' + encodeURIComponent('كمية غير صالحة'));
  const order = db.orders.find(o => o.id === req.body.order_id);
  const before = item.qty;
  item.qty = Math.round((item.qty + qty) * 1000) / 1000;
  item.updated_at = new Date().toISOString();
  db.inventory_movements.unshift({
    id: newId('mov'), item_id: item.id, item_name: item.name,
    type: 'إرجاع', qty, qty_before: before, qty_after: item.qty,
    reference: '', order_id: order ? order.id : null, order_number: order ? order.order_number : null,
    notes: (req.body.notes || '').trim().substring(0, 200),
    performed_by: req.session.user.id, at: new Date().toISOString()
  });
  log(db, req.session.user.id, 'إرجاع مواد',
    `${item.name}: +${qty} ${item.unit}${order ? ' ← ' + order.order_number : ''}`);
  save(db);
  res.redirect('/inventory/items/' + item.id + '?tab=log&success=' + encodeURIComponent('تم تسجيل الإرجاع'));
});

// ── Adjust / count ──────────────────────────────────────
app.post('/inventory/items/:id/adjust', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load(); initInv(db);
  const item = db.inventory_items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).render('error', { message: 'الصنف غير موجود' });

  const isAbsolute = req.body.adjust_type === 'absolute';
  const movType    = ['تسوية','جرد'].includes(req.body.mov_type) ? req.body.mov_type : 'تسوية';
  let newQty, delta;

  if (isAbsolute) {
    newQty = parseFloat(req.body.qty || '0');
    if (isNaN(newQty) || newQty < 0)
      return res.redirect('/inventory/items/' + item.id + '?tab=adjust&error=' + encodeURIComponent('كمية غير صالحة'));
    delta = newQty - item.qty;
  } else {
    delta  = parseFloat(req.body.qty || '0');
    if (isNaN(delta))
      return res.redirect('/inventory/items/' + item.id + '?tab=adjust&error=' + encodeURIComponent('كمية غير صالحة'));
    newQty = item.qty + delta;
    if (newQty < 0)
      return res.redirect('/inventory/items/' + item.id + '?tab=adjust&error=' + encodeURIComponent('الكمية الناتجة لا يمكن أن تكون سالبة'));
  }

  const before   = item.qty;
  item.qty       = Math.round(newQty * 1000) / 1000;
  item.updated_at = new Date().toISOString();
  db.inventory_movements.unshift({
    id: newId('mov'), item_id: item.id, item_name: item.name,
    type: movType, qty: Math.round(delta * 1000) / 1000,
    qty_before: before, qty_after: item.qty,
    reference: (req.body.reference || '').trim().substring(0, 50),
    order_id: null, order_number: null,
    notes: (req.body.notes || '').trim().substring(0, 200),
    performed_by: req.session.user.id, at: new Date().toISOString()
  });
  log(db, req.session.user.id, movType + ' مخزون', `${item.name}: ${before} → ${item.qty} ${item.unit}`);
  save(db);
  res.redirect('/inventory/items/' + item.id + '?tab=log&success=' + encodeURIComponent('تم حفظ التسوية'));
});

// ── Edit item details ───────────────────────────────────
app.post('/inventory/items/:id/edit', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load(); initInv(db);
  const item = db.inventory_items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).render('error', { message: 'الصنف غير موجود' });
  const { name, sku, category, unit, color, low_stock_threshold, cost_per_unit, supplier, notes } = req.body;
  if (!name || !category || !unit)
    return res.status(400).render('error', { message: 'الاسم والفئة والوحدة مطلوبة' });
  if (!ITEM_CATEGORIES.includes(category))
    return res.status(400).render('error', { message: 'فئة غير معروفة' });
  if (!INVENTORY_UNITS.includes(unit))
    return res.status(400).render('error', { message: 'وحدة قياس غير معروفة' });
  item.name = name.trim(); item.sku = (sku || '').trim().substring(0, 30);
  item.category = category; item.unit = unit;
  item.color = (color || '').trim();
  item.low_stock_threshold = Math.max(0, parseFloat(low_stock_threshold || '10') || 10);
  item.cost_per_unit = Math.max(0, parseFloat(cost_per_unit || '0') || 0);
  item.supplier = (supplier || '').trim(); item.notes = (notes || '').trim().substring(0, 300);
  item.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'تعديل صنف مخزون', item.name);
  save(db);
  res.redirect('/inventory/items/' + item.id + '?tab=log&success=' + encodeURIComponent('تم حفظ البيانات'));
});

// ── Delete item (admin only) ────────────────────────────
app.post('/inventory/items/:id/delete', requireAuth, requireSection('inventory'), (req, res) => {
  if (req.session.user.role !== 'admin')
    return res.status(403).render('error', { message: 'الحذف للمدير فقط' });
  const db = load(); initInv(db);
  const idx = db.inventory_items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).render('error', { message: 'الصنف غير موجود' });
  const name = db.inventory_items[idx].name;
  db.inventory_items.splice(idx, 1);
  log(db, req.session.user.id, 'حذف صنف مخزون', name);
  save(db);
  res.redirect('/inventory/items');
});

// ── Movements log ───────────────────────────────────────
app.get('/inventory/movements', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load(); initInv(db);
  const userMap = {}; db.users.forEach(u => { userMap[u.id] = u; });
  const itemMap = {}; db.inventory_items.forEach(i => { itemMap[i.id] = i; });
  const { type, category, q, date_from, date_to } = req.query;

  let movements = db.inventory_movements.map(m => ({
    ...m,
    user_name:     userMap[m.performed_by] ? userMap[m.performed_by].name : 'غير معروف',
    item_category: itemMap[m.item_id] ? itemMap[m.item_id].category : '',
    item_unit:     itemMap[m.item_id] ? itemMap[m.item_id].unit     : ''
  }));

  if (type)      movements = movements.filter(m => m.type === type);
  if (category)  movements = movements.filter(m => m.item_category === category);
  if (q) { const ql = q.toLowerCase();
    movements = movements.filter(m =>
      (m.item_name||'').toLowerCase().includes(ql) ||
      (m.order_number||'').toLowerCase().includes(ql) ||
      (m.user_name||'').toLowerCase().includes(ql)); }
  if (date_from) movements = movements.filter(m => m.at >= date_from);
  if (date_to)   movements = movements.filter(m => m.at <= date_to + 'T23:59:59');

  res.render('inventory/movements', {
    title: 'حركات المخزون', movements: movements.slice(0, 200),
    filters: req.query, MOVEMENT_TYPES, ITEM_CATEGORIES
  });
});

// ── Reports ─────────────────────────────────────────────
app.get('/inventory/reports', requireAuth, requireSection('inventory'), (req, res) => {
  const db = load(); initInv(db);
  const userMap = {}; db.users.forEach(u => { userMap[u.id] = u; });

  const stockByCat = {};
  ITEM_CATEGORIES.forEach(c => { stockByCat[c] = { items: [], totalQty: 0, totalValue: 0 }; });
  db.inventory_items.forEach(i => {
    const c = i.category || 'أخرى';
    if (!stockByCat[c]) stockByCat[c] = { items: [], totalQty: 0, totalValue: 0 };
    stockByCat[c].items.push(i);
    stockByCat[c].totalQty   += i.qty || 0;
    stockByCat[c].totalValue += (i.qty || 0) * (i.cost_per_unit || 0);
  });

  const usageByOrder = {};
  db.inventory_movements.filter(m => m.type === 'صرف' && m.order_number).forEach(m => {
    const k = m.order_number;
    if (!usageByOrder[k]) usageByOrder[k] = { order_number: k, order_id: m.order_id, items: [] };
    usageByOrder[k].items.push({ ...m, user_name: userMap[m.performed_by] ? userMap[m.performed_by].name : '—' });
  });

  res.render('inventory/reports', {
    title: 'تقارير المخزون', tab: req.query.tab || 'stock',
    stockByCat, usageByOrder: Object.values(usageByOrder),
    totalValue: db.inventory_items.reduce((s, i) => s + (i.qty||0)*(i.cost_per_unit||0), 0),
    totalItems: db.inventory_items.length,
    ITEM_CATEGORIES,
    recentMovements: db.inventory_movements.slice(0, 100).map(m => ({
      ...m, user_name: userMap[m.performed_by] ? userMap[m.performed_by].name : 'غير معروف'
    }))
  });
});

// ═══════════════════════════════════════════════════════
// ---------- BARCODE SCANNING ----------
app.get('/barcode', requireAuth, requireSection('barcode'), (req, res) => {
  res.render('barcode/scan', { result: null, error: null });
});

// Redirect from item-detail scan form (GET) → item page
app.get('/barcode/item-redirect', requireAuth, requireSection('barcode'), (req, res) => {
  const code = (req.query.code || '').trim();
  if (!code) return res.redirect('/barcode');
  res.redirect('/barcode/item/' + encodeURIComponent(code));
});

app.post('/barcode/scan', requireAuth, requireSection('barcode'), (req, res) => {
  const db = load();
  const { code, event, workshop_id, embroiderer_id } = req.body;

  // code can be an order_number, an order id, or item barcode (order_number-n)
  const orderNumber = code.split('-').slice(0, 2).join('-'); // handles LMS-1006-1 -> LMS-1006
  const order = db.orders.find(o => o.order_number === code || o.order_number === orderNumber || o.id === code);

  if (!order) {
    return res.render('barcode/scan', { result: null, error: 'لم يتم العثور على طلب بهذا الباركود: ' + code });
  }

  let message = '';
  if (event === 'out_workshop') {
    let job = db.workshop_jobs.find(j => j.order_id === order.id && j.status === 'قيد الانتظار');
    if (!job) {
      job = { id: newId('wjob'), order_id: order.id, workshop_id: workshop_id || (db.workshops[0] && db.workshops[0].id), delivered_qty: order.items.reduce((s, i) => s + i.qty, 0), received_qty: 0, delivered_at: null, received_at: null, status: 'قيد الانتظار' };
      db.workshop_jobs.push(job);
    }
    job.delivered_at = new Date().toISOString();
    job.status = 'عند المشغل';
    order.status = 'عند المشغل';
    message = 'تم تسجيل خروج الطلب ' + order.order_number + ' إلى المشغل';
  } else if (event === 'in_workshop') {
    const job = db.workshop_jobs.filter(j => j.order_id === order.id).slice(-1)[0];
    if (job) { job.received_at = new Date().toISOString(); job.status = 'مستلم'; job.received_qty = job.delivered_qty; }
    order.status = 'مستلم من المشغل';
    message = 'تم تسجيل استلام الطلب ' + order.order_number + ' من المشغل';
  } else if (event === 'in_embroiderer') {
    const ejob = { id: newId('ejob'), order_id: order.id, embroiderer_id: embroiderer_id || (db.embroiderers[0] && db.embroiderers[0].id), received_qty: order.items.reduce((s, i) => s + i.qty, 0), done_qty: 0, errors: 0, notes: '' };
    db.embroidery_jobs.push(ejob);
    order.status = 'عند المطرز';
    message = 'تم تسجيل دخول الطلب ' + order.order_number + ' عند المطرز';
  } else if (event === 'ready_pack') {
    order.status = 'جاهز للتغليف';
    message = 'تم تسجيل الطلب ' + order.order_number + ' كجاهز للتغليف';
  }

  order.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'مسح باركود - ' + event, order.order_number);
  save(db);
  // Include the original scanned code so the template can build item-detail links
  res.render('barcode/scan', { result: { message, order, code }, error: null });
});

// ---------- PRODUCTS ----------
app.get('/products', requireAuth, requireSection('products'), (req, res) => {
  const db = load();
  res.render('products/list', { products: db.products });
});

app.get('/products/new', requireAuth, requireSection('products'), (req, res) => {
  res.render('products/form', { product: null });
});

app.post('/products/new', requireAuth, requireSection('products'), (req, res) => {
  const db = load();
  const product = {
    id: newId('prod'),
    name: req.body.name,
    category: req.body.category,
    image_url: req.body.image_url || '',
    sizes: (req.body.sizes || '').split(',').map(s => s.trim()).filter(Boolean),
    colors: (req.body.colors || '').split(',').map(s => s.trim()).filter(Boolean),
    embroidery: !!req.body.embroidery
  };
  db.products.push(product);
  log(db, req.session.user.id, 'إضافة منتج', product.name);
  save(db);
  res.redirect('/products');
});

app.get('/products/:id/edit', requireAuth, requireSection('products'), (req, res) => {
  const db = load();
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).render('error', { message: 'المنتج غير موجود' });
  res.render('products/form', { product });
});

app.post('/products/:id/edit', requireAuth, requireSection('products'), (req, res) => {
  const db = load();
  const product = db.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).render('error', { message: 'المنتج غير موجود' });
  product.name = req.body.name;
  product.category = req.body.category;
  product.image_url = req.body.image_url || '';
  product.sizes = (req.body.sizes || '').split(',').map(s => s.trim()).filter(Boolean);
  product.colors = (req.body.colors || '').split(',').map(s => s.trim()).filter(Boolean);
  product.embroidery = !!req.body.embroidery;
  save(db);
  res.redirect('/products');
});

app.post('/products/:id/delete', requireAuth, requireSection('products'), (req, res) => {
  const db = load();
  db.products = db.products.filter(p => p.id !== req.params.id);
  save(db);
  res.redirect('/products');
});

// ---------- WORKSHOPS ----------
app.get('/workshops', requireAuth, requireSection('workshops'), (req, res) => {
  const db = load();
  const withStats = db.workshops.map(w => {
    const jobs = db.workshop_jobs.filter(j => j.workshop_id === w.id);
    const pending = jobs.filter(j => j.status === 'عند المشغل').length;
    const totalDelivered = jobs.reduce((s, j) => s + (j.delivered_qty || 0), 0);
    const totalReceived = jobs.reduce((s, j) => s + (j.received_qty || 0), 0);
    return { ...w, jobsCount: jobs.length, pending, totalDelivered, totalReceived };
  });
  res.render('workshops/list', { workshops: withStats });
});

app.post('/workshops/new', requireAuth, requireSection('workshops'), (req, res) => {
  const db = load();
  db.workshops.push({
    id: newId('ws'),
    name: req.body.name,
    phone: req.body.phone || '',
    price_per_piece: parseFloat(req.body.price_per_piece || '0'),
    status: 'active'
  });
  save(db);
  res.redirect('/workshops');
});

app.get('/workshops/:id', requireAuth, requireSection('workshops'), (req, res) => {
  const db = load();
  const workshop = db.workshops.find(w => w.id === req.params.id);
  if (!workshop) return res.status(404).render('error', { message: 'المشغل غير موجود' });
  const jobs = db.workshop_jobs.filter(j => j.workshop_id === workshop.id).map(j => {
    const order = db.orders.find(o => o.id === j.order_id);
    return { ...j, order_number: order ? order.order_number : '—' };
  });
  const payments = db.workshop_payments.filter(p => p.workshop_id === workshop.id);
  const totalDue = jobs.reduce((s, j) => s + (j.received_qty || 0), 0) * workshop.price_per_piece;
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  res.render('workshops/detail', { workshop, jobs, payments, totalDue, totalPaid, remaining: totalDue - totalPaid });
});

app.post('/workshops/:id/payment', requireAuth, requireSection('accounts'), (req, res) => {
  const db = load();
  db.workshop_payments.push({
    id: newId('wpay'),
    workshop_id: req.params.id,
    amount: parseFloat(req.body.amount || '0'),
    date: new Date().toISOString(),
    notes: req.body.notes || ''
  });
  log(db, req.session.user.id, 'دفعة مشغل', req.params.id);
  save(db);
  res.redirect('/workshops/' + req.params.id);
});

// ---------- EMBROIDERERS ----------
app.get('/embroiderers', requireAuth, requireSection('embroiderers'), (req, res) => {
  const db = load();
  const withStats = db.embroiderers.map(e => {
    const jobs = db.embroidery_jobs.filter(j => j.embroiderer_id === e.id);
    const totalDone = jobs.reduce((s, j) => s + (j.done_qty || 0), 0);
    const totalErrors = jobs.reduce((s, j) => s + (j.errors || 0), 0);
    return { ...e, jobsCount: jobs.length, totalDone, totalErrors };
  });
  // Pending jobs: auto-queued with no embroiderer assigned yet
  const pendingJobs = (db.embroidery_jobs || [])
    .filter(j => !j.embroiderer_id)
    .map(j => {
      const order = (db.orders || []).find(o => o.id === j.order_id);
      return {
        ...j,
        order_number:   order ? order.order_number : (j.order_number || '—'),
        order_id:       j.order_id,
        customer_name:  order ? (order.customer_name || '') : '',
        received_qty:   j.received_qty || 0,
      };
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  res.render('embroiderers/list', { embroiderers: withStats, pendingJobs });
});

app.post('/embroiderers/assign-pending', requireAuth, requireSection('embroiderers'), (req, res) => {
  const db = load();
  const { job_id, embroiderer_id } = req.body;
  const job = db.embroidery_jobs.find(j => j.id === job_id && !j.embroiderer_id);
  if (!job) return res.status(404).render('error', { message: 'المهمة غير موجودة أو تم تعيينها مسبقاً' });
  const embroiderer = db.embroiderers.find(e => e.id === embroiderer_id);
  if (!embroiderer) return res.status(404).render('error', { message: 'المطرز غير موجود' });
  job.embroiderer_id = embroiderer_id;
  job.assigned_at = new Date().toISOString();
  const order = (db.orders || []).find(o => o.id === job.order_id);
  log(db, req.session.user.id, 'تعيين مطرز', `${order ? order.order_number : job.order_id} → ${embroiderer.name}`,
    { module: 'embroiderers', type: 'update' });
  save(db);
  res.redirect('/embroiderers');
});

app.post('/embroiderers/new', requireAuth, requireSection('embroiderers'), (req, res) => {
  const db = load();
  db.embroiderers.push({
    id: newId('emb'),
    name: req.body.name,
    price_per_piece: parseFloat(req.body.price_per_piece || '0')
  });
  save(db);
  res.redirect('/embroiderers');
});

app.get('/embroiderers/:id', requireAuth, requireSection('embroiderers'), (req, res) => {
  const db = load();
  const embroiderer = db.embroiderers.find(e => e.id === req.params.id);
  if (!embroiderer) return res.status(404).render('error', { message: 'المطرز غير موجود' });
  const jobs = db.embroidery_jobs.filter(j => j.embroiderer_id === embroiderer.id).map(j => {
    const order = db.orders.find(o => o.id === j.order_id);
    return { ...j, order_number: order ? order.order_number : '—' };
  });
  const payments = db.embroidery_payments.filter(p => p.embroiderer_id === embroiderer.id);
  const totalDue = jobs.reduce((s, j) => s + (j.done_qty || 0), 0) * embroiderer.price_per_piece;
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  res.render('embroiderers/detail', { embroiderer, jobs, payments, totalDue, totalPaid, remaining: totalDue - totalPaid });
});

app.post('/embroiderers/:id/job-update', requireAuth, requireSection('embroiderers'), (req, res) => {
  const db = load();
  const job = db.embroidery_jobs.find(j => j.id === req.body.job_id);
  if (job) {
    job.done_qty = parseInt(req.body.done_qty || '0', 10);
    job.errors = parseInt(req.body.errors || '0', 10);
    job.notes = req.body.notes || '';
  }
  save(db);
  res.redirect('/embroiderers/' + req.params.id);
});

app.post('/embroiderers/:id/payment', requireAuth, requireSection('accounts'), (req, res) => {
  const db = load();
  db.embroidery_payments.push({
    id: newId('epay'),
    embroiderer_id: req.params.id,
    amount: parseFloat(req.body.amount || '0'),
    date: new Date().toISOString(),
    notes: req.body.notes || ''
  });
  save(db);
  res.redirect('/embroiderers/' + req.params.id);
});

// ---------- ACCOUNTS ----------
app.get('/accounts', requireAuth, requireSection('accounts'), (req, res) => {
  const db = load();
  const totalMaterials = db.materials.reduce((s, m) => s + (m.cost || 0), 0);
  const totalExpenses = db.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalWorkshopPaid = db.workshop_payments.reduce((s, p) => s + p.amount, 0);
  const totalEmbroideryPaid = db.embroidery_payments.reduce((s, p) => s + p.amount, 0);
  res.render('accounts', {
    materials: db.materials.slice().reverse(),
    expenses: db.expenses.slice().reverse(),
    totalMaterials, totalExpenses, totalWorkshopPaid, totalEmbroideryPaid,
    grandTotal: totalMaterials + totalExpenses + totalWorkshopPaid + totalEmbroideryPaid
  });
});

app.post('/accounts/material', requireAuth, requireSection('accounts'), (req, res) => {
  const db = load();
  db.materials.push({
    id: newId('mat'),
    name: req.body.name,
    type: req.body.type,
    qty: parseFloat(req.body.qty || '0'),
    cost: parseFloat(req.body.cost || '0'),
    date: new Date().toISOString()
  });
  save(db);
  res.redirect('/accounts');
});

app.post('/accounts/expense', requireAuth, requireSection('accounts'), (req, res) => {
  const db = load();
  db.expenses.push({
    id: newId('exp'),
    title: req.body.title,
    amount: parseFloat(req.body.amount || '0'),
    notes: req.body.notes || '',
    date: new Date().toISOString()
  });
  save(db);
  res.redirect('/accounts');
});

// ---------- SALLA WEBHOOK ----------
// Real integration checklist (see README "ربط متجر سلة"):
// 1) Create a free "تطبيق خاص" (Private App) at https://portal.salla.partners using your store's own login.
// 2) Complete the store-authorization (OAuth) step so the app is installed on your store.
// 3) In the app's settings in the Partners Portal, add this URL under Webhooks:
//      https://<your-repl-name>.<your-username>.repl.co/api/webhook/salla
//    and subscribe to: order.created, order.status.updated, order.cancelled
// 4) Copy the Webhook "Secret" shown in the Partners Portal and set it as an environment
//    variable named SALLA_WEBHOOK_SECRET in Replit's "Secrets" tool (padlock icon in sidebar).
//    Without this secret set, signature verification is skipped (fine for local testing only).

function verifySallaSignature(req) {
  const secret = process.env.SALLA_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured yet -> allow through (dev/test mode)
  const signature = req.header('x-salla-signature');
  if (!signature || !req.rawBody) return false;
  const computed = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  } catch (e) {
    return false; // length mismatch etc.
  }
}

app.post('/api/webhook/salla', (req, res) => {
  if (!verifySallaSignature(req)) {
    console.warn('Salla webhook: invalid signature, rejected.');
    return res.status(401).json({ ok: false, error: 'invalid signature' });
  }

  const db = load();
  try {
    const event = req.body.event;
    // Salla wraps the resource under "data" for store-event webhooks (API v2).
    const payload = req.body.data || {};

    if (event === 'order.created') {
      const order_number = nextOrderNumber();
      const rawItems = payload.items || [];
      const items = rawItems.map((it, i) => {
        const opts = it.options || it.product_options || [];
        const findOpt = (names) => {
          const hit = Array.isArray(opts) ? opts.find(o => names.some(n => (o.name || '').includes(n))) : null;
          return hit ? (hit.value || hit.display_value || '') : '';
        };
        return {
          id: newId('item'),
          product_id: '',
          product_name: (it.product && it.product.name) || it.name || '',
          size: findOpt(['مقاس', 'Size']),
          color: findOpt(['لون', 'Color']),
          embroidery_name: findOpt(['تطريز', 'اسم', 'Embroidery', 'Name']),
          notes: it.notes || '',
          qty: it.quantity || 1,
          barcode: order_number + '-' + (i + 1),
          stage: 'تجهيز'
        };
      });

      const finalItems = items.length ? items : [{ id: newId('item'), product_id: '', product_name: 'منتج من سلة (راجع تفاصيل الطلب في سلة)', size: '', color: '', embroidery_name: '', notes: '', qty: 1, barcode: order_number + '-1', stage: 'تجهيز' }];
      const orderType = classifyOrder(finalItems, db.inventory_items || []);

      const order = {
        id: newId('ord'),
        order_number,
        order_type: orderType,
        customer_name: (payload.customer && (payload.customer.first_name ? (payload.customer.first_name + ' ' + (payload.customer.last_name || '')) : payload.customer.name)) || '',
        customer_phone: (payload.customer && payload.customer.mobile) || '',
        city: (payload.shipping && payload.shipping.address && payload.shipping.address.city) || (payload.ship_to && payload.ship_to.city) || '',
        status: 'جديد',
        assigned_employee: '',
        items: finalItems,
        notes: 'مستورد تلقائياً من سلة (رقم الطلب في سلة: ' + (payload.reference_id || payload.id || '—') + ')',
        shipment_number: '',
        salla_order_id: payload.id || payload.reference_id || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      db.orders.push(order);
      log(db, null, 'استيراد طلب من سلة', order_number + ' (' + orderType + ')');
      save(db);
    } else if (event === 'order.status.updated' || event === 'order.cancelled') {
      const sallaId = payload.id || payload.reference_id;
      const order = db.orders.find(o => o.salla_order_id == sallaId);
      if (order) {
        const statusName = (payload.status && (payload.status.name || payload.status.slug)) || '';
        if (event === 'order.cancelled' || statusName.includes('ملغي') || statusName.toLowerCase().includes('cancel')) {
          order.status = 'ملغي';
          order.updated_at = new Date().toISOString();
          log(db, null, 'إلغاء طلب من سلة', order.order_number);
          save(db);
        }
      }
    }
    // Always acknowledge quickly so Salla doesn't retry unnecessarily.
    res.json({ ok: true });
  } catch (err) {
    console.error('Salla webhook error:', err);
    res.status(200).json({ ok: false, error: 'processed with warnings' });
  }
});

// ════════════════════════════════════════════════════════
// SETTINGS & PERMISSIONS MODULE
// ════════════════════════════════════════════════════════

function initSettings(db) {
  if (!db.meta.settings) db.meta.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.keys(DEFAULT_SETTINGS).forEach(k => {
    if (!db.meta.settings[k]) db.meta.settings[k] = { ...DEFAULT_SETTINGS[k] };
  });
  return db.meta.settings;
}

// ── Settings hub ─────────────────────────────────────
app.get('/settings', requireAuth, requireSection('settings'), (req, res) => {
  const db = load();
  const settings = initSettings(db);
  const users = db.users || [];
  res.render('settings/index', {
    title: 'الإعدادات',
    settings,
    userCount:     users.length,
    activeUsers:   users.filter(u => u.active !== false).length,
    disabledUsers: users.filter(u => u.active === false).length,
    logCount:      (db.activity_logs || []).length,
    roleCount:     Object.keys(ROLES).length
  });
});

// ── User list ─────────────────────────────────────────
app.get('/settings/users', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  let users = [...(db.users || [])];
  const { role: rFilter, status: sFilter, q } = req.query;
  if (rFilter) users = users.filter(u => u.role === rFilter);
  if (sFilter === 'active')   users = users.filter(u => u.active !== false);
  if (sFilter === 'disabled') users = users.filter(u => u.active === false);
  if (q) {
    const ql = q.toLowerCase();
    users = users.filter(u =>
      (u.name||'').toLowerCase().includes(ql) ||
      (u.username||'').toLowerCase().includes(ql)
    );
  }
  const userMap = {}; (db.users||[]).forEach(u => { userMap[u.id] = u; });
  const lastActivity = {};
  (db.activity_logs||[]).forEach(l => {
    if (l.user_id && !lastActivity[l.user_id]) lastActivity[l.user_id] = l.at;
  });
  res.render('settings/users', {
    title: 'إدارة المستخدمين',
    users: users.map(u => ({ ...u, lastActivity: lastActivity[u.id] || null })),
    filters: req.query,
    ROLES, ROLE_PERMISSIONS,
    totalCount: (db.users||[]).length,
    activeCount: (db.users||[]).filter(u => u.active !== false).length,
    success: req.query.success || null
  });
});

// ── New user form ─────────────────────────────────────
app.get('/settings/users/new', requireAuth, requireSection('users'), (req, res) => {
  res.render('settings/user_form', {
    title: 'مستخدم جديد', editUser: null, logs: [],
    error: null, success: null, ROLES, ROLE_PERMISSIONS
  });
});

app.post('/settings/users/new', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  const { name, username, password, role, phone } = req.body;
  const err = (msg) => res.render('settings/user_form', {
    title: 'مستخدم جديد', editUser: null, logs: [], error: msg, success: null, ROLES, ROLE_PERMISSIONS
  });
  if (!name || !username || !password || !role) return err('جميع الحقول المطلوبة يجب ملؤها');
  if (!ROLES[role]) return err('دور غير معروف');
  if (password.length < 6) return err('كلمة المرور قصيرة جداً (6 أحرف على الأقل)');
  if ((db.users||[]).find(u => u.username === username.trim()))
    return err('اسم المستخدم مستخدم بالفعل');
  const { hash, salt } = hashPassword(password);
  const newUser = {
    id: newId('u'), username: username.trim(), name: name.trim(),
    role, phone: (phone||'').trim(), active: true, salt, hash,
    created_at: new Date().toISOString()
  };
  db.users.push(newUser);
  log(db, req.session.user.id, 'إضافة مستخدم',
    newUser.name + ' — ' + ROLES[role],
    { module: 'settings', type: 'create', after: role });
  save(db);
  res.redirect('/settings/users?success=' + encodeURIComponent('تم إضافة المستخدم ' + newUser.name));
});

// ── Edit user form ────────────────────────────────────
app.get('/settings/users/:id', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  const editUser = (db.users||[]).find(u => u.id === req.params.id);
  if (!editUser) return res.status(404).render('error', { message: 'المستخدم غير موجود' });
  const logs = (db.activity_logs||[]).filter(l => l.user_id === editUser.id).slice(0, 15)
    .map(l => ({ ...l, user_name: editUser.name }));
  res.render('settings/user_form', {
    title: 'تعديل المستخدم', editUser, logs,
    error: req.query.error || null, success: req.query.success || null,
    ROLES, ROLE_PERMISSIONS
  });
});

app.post('/settings/users/:id/edit', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  const editUser = (db.users||[]).find(u => u.id === req.params.id);
  if (!editUser) return res.status(404).render('error', { message: 'المستخدم غير موجود' });
  const { name, role, phone } = req.body;
  if (!name || !role || !ROLES[role])
    return res.redirect('/settings/users/' + req.params.id + '?error=' + encodeURIComponent('بيانات غير صحيحة'));
  const prevRole = editUser.role;
  editUser.name  = name.trim();
  editUser.role  = role;
  editUser.phone = (phone||'').trim();
  editUser.updated_at = new Date().toISOString();
  if (req.session.user.id === editUser.id) {
    req.session.user.name = editUser.name;
    req.session.user.role = editUser.role;
  }
  log(db, req.session.user.id, 'تعديل مستخدم',
    editUser.name + (prevRole !== role ? ' — الدور: ' + ROLES[prevRole] + ' → ' + ROLES[role] : ''),
    { module: 'settings', type: 'update', before: prevRole, after: role });
  save(db);
  res.redirect('/settings/users/' + req.params.id + '?success=' + encodeURIComponent('تم حفظ البيانات'));
});

// ── Change password ───────────────────────────────────
app.post('/settings/users/:id/password', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  const editUser = (db.users||[]).find(u => u.id === req.params.id);
  if (!editUser) return res.status(404).render('error', { message: 'المستخدم غير موجود' });
  const { password, confirm } = req.body;
  if (!password || password.length < 6)
    return res.redirect('/settings/users/' + req.params.id + '?error=' + encodeURIComponent('كلمة المرور قصيرة جداً (6 أحرف)'));
  if (password !== confirm)
    return res.redirect('/settings/users/' + req.params.id + '?error=' + encodeURIComponent('كلمتا المرور غير متطابقتين'));
  const { hash, salt } = hashPassword(password);
  editUser.hash = hash; editUser.salt = salt;
  editUser.updated_at = new Date().toISOString();
  log(db, req.session.user.id, 'تغيير كلمة المرور', editUser.name,
    { module: 'settings', type: 'security' });
  save(db);
  res.redirect('/settings/users/' + req.params.id + '?success=' + encodeURIComponent('تم تغيير كلمة المرور'));
});

// ── Enable / Disable ──────────────────────────────────
app.post('/settings/users/:id/toggle', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  const editUser = (db.users||[]).find(u => u.id === req.params.id);
  if (!editUser) return res.status(404).render('error', { message: 'المستخدم غير موجود' });
  if (editUser.id === req.session.user.id)
    return res.redirect('/settings/users?error=' + encodeURIComponent('لا يمكنك تعطيل حسابك الخاص'));
  editUser.active = editUser.active === false ? true : false;
  editUser.updated_at = new Date().toISOString();
  log(db, req.session.user.id,
    editUser.active ? 'تفعيل مستخدم' : 'تعطيل مستخدم',
    editUser.name, { module: 'settings', type: 'security' });
  save(db);
  res.redirect('/settings/users');
});

// ── Delete user (admin only) ──────────────────────────
app.post('/settings/users/:id/delete', requireAuth, requireSection('users'), (req, res) => {
  if (req.session.user.role !== 'admin')
    return res.status(403).render('error', { message: 'الحذف للمدير فقط' });
  const db = load();
  const editUser = (db.users||[]).find(u => u.id === req.params.id);
  if (!editUser) return res.status(404).render('error', { message: 'المستخدم غير موجود' });
  if (editUser.id === req.session.user.id)
    return res.redirect('/settings/users?error=' + encodeURIComponent('لا يمكنك حذف حسابك الخاص'));
  db.users = db.users.filter(u => u.id !== req.params.id);
  log(db, req.session.user.id, 'حذف مستخدم', editUser.name,
    { module: 'settings', type: 'delete' });
  save(db);
  res.redirect('/settings/users?success=' + encodeURIComponent('تم حذف المستخدم ' + editUser.name));
});

// ── Roles & permissions view ──────────────────────────
app.get('/settings/roles', requireAuth, requireSection('settings'), (req, res) => {
  res.render('settings/roles', {
    title: 'الأدوار والصلاحيات',
    ROLES, ROLE_PERMISSIONS, PERMISSIONS
  });
});

// ── Activity log ──────────────────────────────────────
app.get('/settings/activity', requireAuth, (req, res) => {
  const role = req.session.user.role;
  if (!['admin', 'production_mgr'].includes(role))
    return res.status(403).render('error', { message: 'ليس لديك صلاحية لعرض سجل النشاط' });
  const db = load();
  const { user_id, type: typeFilter, q, date_from, date_to } = req.query;
  const userMap = {}; (db.users||[]).forEach(u => { userMap[u.id] = u; });

  let logs = (db.activity_logs||[]).map(l => ({
    ...l,
    user_name: userMap[l.user_id]?.name || 'النظام',
    user_role: ROLES[userMap[l.user_id]?.role] || ''
  }));
  if (user_id)    logs = logs.filter(l => l.user_id === user_id);
  if (typeFilter) logs = logs.filter(l => l.action_type === typeFilter);
  if (q) {
    const ql = q.toLowerCase();
    logs = logs.filter(l =>
      (l.action||'').toLowerCase().includes(ql) ||
      (l.details||'').toLowerCase().includes(ql) ||
      (l.user_name||'').toLowerCase().includes(ql)
    );
  }
  if (date_from) logs = logs.filter(l => (l.at||'') >= date_from);
  if (date_to)   logs = logs.filter(l => (l.at||'') <= date_to + 'T23:59:59');

  const types   = [...new Set((db.activity_logs||[]).map(l => l.action_type).filter(Boolean))];
  const modules = [...new Set((db.activity_logs||[]).map(l => l.module).filter(Boolean))];

  res.render('settings/activity', {
    title: 'سجل النشاط',
    logs: logs.slice(0, 300),
    users: db.users || [],
    filters: req.query,
    types, modules, ROLES,
    totalCount: (db.activity_logs||[]).length
  });
});

// ── System settings ───────────────────────────────────
app.get('/settings/system', requireAuth, requireSection('settings'), (req, res) => {
  const db = load();
  const settings = initSettings(db);
  save(db);
  res.render('settings/system', {
    title: 'إعدادات النظام',
    settings, DEFAULT_SETTINGS,
    tab: req.query.tab || 'company',
    success: req.query.success || null,
    error: req.query.error || null
  });
});

app.post('/settings/system', requireAuth, requireSection('settings'), (req, res) => {
  const db = load();
  const settings = initSettings(db);
  const section = req.body.section;
  const ALLOWED = ['company','security','barcode','printing','language','notifications','backup'];
  if (!ALLOWED.includes(section))
    return res.redirect('/settings/system?tab=company&error=' + encodeURIComponent('قسم غير معروف'));

  // Copy current section, then overwrite with form values
  const updated = { ...settings[section] };
  // Identify boolean fields per section
  const BOOL_FIELDS = {
    security:      ['hideCustomerFromProduction'],
    barcode:       ['showName','showOrder','showSize','showColor'],
    printing:      ['logo'],
    notifications: ['lowStock','delay']
  };
  const boolFields = new Set(BOOL_FIELDS[section] || []);

  // Apply all non-boolean form fields
  Object.keys(req.body).forEach(k => {
    if (k !== 'section' && !boolFields.has(k)) updated[k] = req.body[k];
  });
  // Apply booleans (checkbox absent = false)
  boolFields.forEach(f => { updated[f] = req.body[f] === 'on'; });

  settings[section] = updated;
  db.meta.settings  = settings;
  log(db, req.session.user.id, 'تعديل إعدادات النظام',
    'قسم: ' + section, { module: 'settings', type: 'update' });
  save(db);
  if (section === 'security') invalidateSettingsCache();
  res.redirect('/settings/system?tab=' + section + '&success=' + encodeURIComponent('تم حفظ الإعدادات'));
});

// ── Backward-compat /users redirects (full validation preserved) ──
app.get('/users', requireAuth, requireSection('users'), (req, res) => {
  res.redirect('/settings/users');
});
app.post('/users/new', requireAuth, requireSection('users'), (req, res) => {
  // Full validation identical to /settings/users/new
  const db = load();
  const { name, username, password, role } = req.body;
  if (!name || !username || !password || !role || !ROLES[role] || password.length < 6) {
    return res.redirect('/settings/users/new');
  }
  if ((db.users||[]).find(u => u.username === username.trim())) {
    return res.redirect('/settings/users/new');
  }
  const { hash, salt } = hashPassword(password);
  const newUser = {
    id: newId('u'), username: username.trim(), name: name.trim(),
    role, active: true, salt, hash, created_at: new Date().toISOString()
  };
  db.users.push(newUser);
  log(db, req.session.user.id, 'إضافة مستخدم',
    newUser.name + ' — ' + ROLES[role], { module: 'settings', type: 'create', after: role });
  save(db);
  res.redirect('/settings/users');
});
app.post('/users/:id/delete', requireAuth, requireSection('users'), (req, res) => {
  if (req.session.user.role !== 'admin') return res.redirect('/settings/users');
  const db = load();
  const target = (db.users||[]).find(u => u.id === req.params.id);
  if (target && target.id !== req.session.user.id) {
    db.users = db.users.filter(u => u.id !== req.params.id);
    log(db, req.session.user.id, 'حذف مستخدم', target.name,
      { module: 'settings', type: 'delete' });
    save(db);
  }
  res.redirect('/settings/users');
});

// ═══════════════════════════════════════════════════════
// ADMIN CONTROL PANEL
// ═══════════════════════════════════════════════════════

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).render('error', { message: 'هذه الصفحة للمدير فقط' });
  next();
}

// ── Admin hub ─────────────────────────────────────────
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const db = load();
  const settings = initSettings(db);
  save(db);
  res.render('admin/index', {
    title: 'لوحة التحكم المتقدمة',
    settings,
    userCount:     (db.users||[]).length,
    activeUsers:   (db.users||[]).filter(u => u.active !== false).length,
    productCount:  (db.products||[]).length,
    workshopCount: (db.workshops||[]).length,
    orderCount:    (db.orders||[]).length,
    logCount:      (db.activity_logs||[]).length
  });
});

// ── Module & sidebar settings ──────────────────────────
app.get('/admin/modules', requireAuth, requireAdmin, (req, res) => {
  const db = load();
  const settings = initSettings(db);
  save(db);
  res.render('admin/modules', {
    title: 'تحكم بالوحدات',
    moduleSettings: { ...DEFAULT_SETTINGS.modules, ...(settings.modules || {}) },
    sidebarOrder:   settings.sidebar_order || [...DEFAULT_SETTINGS.sidebar_order],
    DEFAULT_SETTINGS,
    success: req.query.success || null,
    error:   req.query.error   || null
  });
});

app.post('/admin/modules', requireAuth, requireAdmin, (req, res) => {
  const db = load();
  const settings = initSettings(db);
  // Visibility toggles
  const newModules = {};
  Object.keys(DEFAULT_SETTINGS.modules).forEach(k => {
    newModules[k] = req.body['module_' + k] === 'on';
  });
  // Settings always visible to admin
  newModules.settings = true;
  // Sidebar order (comma-separated list from hidden input)
  const orderStr = (req.body.sidebar_order || '').trim();
  const allKeys  = Object.keys(DEFAULT_SETTINGS.modules);
  const newOrder = orderStr
    ? orderStr.split(',').filter(k => allKeys.includes(k))
    : [...DEFAULT_SETTINGS.sidebar_order];
  // Append any keys not present in the submitted order
  allKeys.forEach(k => { if (!newOrder.includes(k)) newOrder.push(k); });
  settings.modules       = newModules;
  settings.sidebar_order = newOrder;
  db.meta.settings = settings;
  log(db, req.session.user.id, 'تعديل إعدادات الوحدات',
    'تحديث رؤية الوحدات وترتيب الشريط الجانبي', { module: 'admin', type: 'update' });
  save(db);
  invalidateSettingsCache();
  res.redirect('/admin/modules?success=' + encodeURIComponent('تم حفظ إعدادات الوحدات'));
});

// ── Card designer ──────────────────────────────────────
app.get('/admin/card-designer', requireAuth, requireAdmin, (req, res) => {
  const db = load();
  const settings = initSettings(db);
  save(db);
  res.render('admin/card_designer', {
    title: 'مصمم بطاقة التجهيز',
    cardSettings: { ...DEFAULT_SETTINGS.card_designer, ...(settings.card_designer || {}) },
    success: req.query.success || null,
    error:   req.query.error   || null
  });
});

app.post('/admin/card-designer', requireAuth, requireAdmin, (req, res) => {
  const db = load();
  const settings = initSettings(db);
  const BOOL_FIELDS = [
    'show_image','show_order_number','show_product_name','show_sku',
    'show_size','show_color','show_quantity','show_pieces_count',
    'show_embroidery','show_production_notes','show_qr','show_barcode_text',
    'show_stage','show_type_badge','show_checklist'
  ];
  const updated = { ...DEFAULT_SETTINGS.card_designer };
  BOOL_FIELDS.forEach(f => { updated[f] = req.body[f] === 'on'; });
  updated.default_layout = [12, 16].includes(Number(req.body.default_layout))
    ? Number(req.body.default_layout) : 12;
  updated.margin_mm = Math.max(0, Math.min(10, Number(req.body.margin_mm) || 2));
  updated.qr_size   = ['small','medium','large'].includes(req.body.qr_size)
    ? req.body.qr_size : 'medium';
  settings.card_designer = updated;
  db.meta.settings = settings;
  log(db, req.session.user.id, 'تعديل مصمم بطاقة التجهيز',
    'تحديث إعدادات بطاقة التجهيز', { module: 'admin', type: 'update' });
  save(db);
  invalidateSettingsCache();
  res.redirect('/admin/card-designer?success=' + encodeURIComponent('تم حفظ إعدادات البطاقة'));
});

// ---------- REPORTS (simple, part of dashboard) ----------
app.get('/reports', requireAuth, requireSection('dashboard'), (req, res) => {
  const db = load();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const thisMonth = now.toISOString().slice(0, 7);

  // ── Helper ─────────────────────────────────────────────────────
  function durationDays(iso1, iso2) {
    const t1 = new Date(iso1).getTime();
    const t2 = iso2 ? new Date(iso2).getTime() : Date.now();
    return Math.floor((t2 - t1) / (1000 * 60 * 60 * 24));
  }

  // ── Period filter ──────────────────────────────────────────────
  const period = parseInt(req.query.period || '30') || 30;
  const cutoff = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();

  // ── Orders segmentation ────────────────────────────────────────
  const allOrders       = db.orders     || [];
  const allWorkshops    = db.workshops  || [];
  const allEmbroiderers = db.embroiderers || [];
  const allUsers        = db.users      || [];

  const completedOrders = allOrders.filter(o => o.status === 'تم التنفيذ');
  const cancelledOrders = allOrders.filter(o => o.status === 'ملغي');
  const activeOrders    = allOrders.filter(o => !['تم التنفيذ', 'ملغي'].includes(o.status));
  const lateOrders      = activeOrders.filter(isLate);

  // Period-scoped datasets (creation date within window)
  const periodOrders    = allOrders.filter(o => (o.created_at || '') >= cutoff);
  const periodCancelled = periodOrders.filter(o => o.status === 'ملغي');
  const periodCompleted = periodOrders.filter(o => o.status === 'تم التنفيذ');

  // ── KPI 1: Production Efficiency (period-scoped) ───────────────
  const pEligible = periodOrders.length - periodCancelled.length;
  const productionEfficiency = pEligible > 0
    ? Math.round((periodCompleted.length / pEligible) * 100) : 0;

  // ── KPI 2: On-time Completion (period-scoped) ──────────────────
  const onTimeOrders = periodCompleted.filter(o =>
    durationDays(o.created_at, o.updated_at) <= DELAY_DAYS_THRESHOLD
  );
  const onTimeRate = periodCompleted.length > 0
    ? Math.round((onTimeOrders.length / periodCompleted.length) * 100) : 0;

  // ── KPI 3: Delay Rate — always current snapshot ────────────────
  const delayRate = activeOrders.length > 0
    ? Math.round((lateOrders.length / activeOrders.length) * 100) : 0;

  // ── KPI 4: Embroidery Error Rate (period-scoped by order) ──────
  const embroideryJobs = db.embroidery_jobs || [];
  // Match jobs to orders in the period
  const periodOrderIds = new Set(periodOrders.map(o => o.id));
  const periodEmbJobs  = embroideryJobs.filter(j => periodOrderIds.has(j.order_id));
  const totalEmbReceived = (periodEmbJobs.length > 0 ? periodEmbJobs : embroideryJobs)
    .reduce((s, j) => s + (j.received_qty || 0), 0);
  const totalEmbErrors   = (periodEmbJobs.length > 0 ? periodEmbJobs : embroideryJobs)
    .reduce((s, j) => s + (j.errors || 0), 0);
  const errorRate = totalEmbReceived > 0
    ? Math.round((totalEmbErrors / totalEmbReceived) * 100) : 0;

  // ── Status funnel ──────────────────────────────────────────────
  const statusCounts = {};
  ORDER_STATUSES.forEach(s => { statusCounts[s] = 0; });
  allOrders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
  const maxStatusCount = Math.max(1, ...Object.values(statusCounts));

  // ── Items by stage ─────────────────────────────────────────────
  const ITEM_STAGES_ALL = ['تجهيز','عند المشغل','مستلم من المشغل','عند المطرز','جاهز للتغليف','تم التنفيذ'];
  const stageCounts = {};
  ITEM_STAGES_ALL.forEach(s => { stageCounts[s] = 0; });
  allOrders.forEach(o => {
    (o.items || []).forEach(item => {
      const s = item.stage || 'تجهيز';
      stageCounts[s] = (stageCounts[s] || 0) + (item.qty || 1);
    });
  });
  const totalItemsInPipeline = Math.max(1, Object.values(stageCounts).reduce((s, v) => s + v, 0));

  // ── Workshop performance (period-scoped by order link) ────────
  const workshopJobs    = db.workshop_jobs || [];
  const periodWsJobs    = workshopJobs.filter(j => periodOrderIds.has(j.order_id));
  const wjSrc           = periodWsJobs.length > 0 ? periodWsJobs : workshopJobs;
  const byWorkshop = allWorkshops.map(w => {
    const jobs       = wjSrc.filter(j => j.workshop_id === w.id);
    const delivered  = jobs.reduce((s, j) => s + (j.delivered_qty || 0), 0);
    const received   = jobs.reduce((s, j) => s + (j.received_qty  || 0), 0);
    const pending    = jobs.filter(j => j.status === 'عند المشغل').length;
    const efficiency = delivered > 0 ? Math.round((received / delivered) * 100) : 0;
    const completedJobs = jobs.filter(j => j.delivered_at && j.received_at);
    const avgDays = completedJobs.length > 0
      ? (completedJobs.reduce((s, j) => s + durationDays(j.delivered_at, j.received_at), 0) / completedJobs.length).toFixed(1)
      : '—';
    return { id: w.id, name: w.name, delivered, received, pending, efficiency, avgDays, totalJobs: jobs.length };
  });
  const wsDelivered  = byWorkshop.reduce((s, w) => s + w.delivered, 0);
  const wsReceived   = byWorkshop.reduce((s, w) => s + w.received, 0);
  const wsEfficiency = wsDelivered > 0 ? Math.round((wsReceived / wsDelivered) * 100) : 0;

  // ── Embroidery per embroiderer (period-scoped) ────────────────
  const periodEmbSrc = periodEmbJobs.length > 0 ? periodEmbJobs : embroideryJobs;
  const byEmbroiderer = allEmbroiderers.map(e => {
    const jobs     = periodEmbSrc.filter(j => j.embroiderer_id === e.id);
    const received = jobs.reduce((s, j) => s + (j.received_qty || 0), 0);
    const done     = jobs.reduce((s, j) => s + (j.done_qty     || 0), 0);
    const errors   = jobs.reduce((s, j) => s + (j.errors       || 0), 0);
    const errPct   = received > 0 ? Math.round((errors / received) * 100) : 0;
    return { name: e.name, received, done, errors, errPct, jobs: jobs.length };
  });

  // ── Packaging stats (period-scoped) ───────────────────────────
  const allPackages  = db.packages || [];
  const packages     = allPackages.filter(p => !p.created_at || p.created_at >= cutoff);
  const pkgSrc       = packages.length > 0 ? packages : allPackages;
  const pkgDone      = pkgSrc.filter(p => p.status === 'تم التغليف').length;
  const pkgRate      = pkgSrc.length > 0 ? Math.round((pkgDone / pkgSrc.length) * 100) : 0;
  const timedPkgs    = pkgSrc.filter(p => p.started_at && p.completed_at);
  const avgPkgMins   = timedPkgs.length > 0
    ? Math.round(timedPkgs.reduce((s, p) =>
        s + (new Date(p.completed_at) - new Date(p.started_at)) / 60000, 0) / timedPkgs.length)
    : 0;
  const totalPieces  = pkgSrc.reduce((s, p) => s + (p.pieces_count || 0), 0);

  // ── Shipping stats (period-scoped) ────────────────────────────
  const allShipments = db.shipments || [];
  const shipments    = allShipments.filter(s => !s.created_at || s.created_at >= cutoff);
  const shpSrc       = shipments.length > 0 ? shipments : allShipments;
  const shpDelivered = shpSrc.filter(s => s.status === 'تم التسليم').length;
  const shpFailed    = shpSrc.filter(s => s.status === 'فشل التسليم').length;
  const shpRate      = shpSrc.length > 0 ? Math.round((shpDelivered / shpSrc.length) * 100) : 0;
  const byCompany    = {};
  shpSrc.forEach(s => {
    const co = s.shipping_company || 'غير محدد';
    if (!byCompany[co]) byCompany[co] = { count: 0, delivered: 0, failed: 0 };
    byCompany[co].count++;
    if (s.status === 'تم التسليم') byCompany[co].delivered++;
    if (s.status === 'فشل التسليم') byCompany[co].failed++;
  });
  const byCompanyArr = Object.entries(byCompany).map(([name, d]) => ({
    name, ...d,
    rate: d.count > 0 ? Math.round((d.delivered / d.count) * 100) : 0
  })).sort((a, b) => b.count - a.count);

  // ── Barcode scan activity (period-scoped) ──────────────────────
  const activityLogs     = db.activity_logs || [];
  const periodActLogs    = activityLogs.filter(l => (l.at || '') >= cutoff);
  const scanLogs         = activityLogs.filter(l => l.action && l.action.includes('مسح باركود'));
  const periodScanLogs   = scanLogs.filter(l => (l.at || '') >= cutoff);
  const scansByDay       = {};
  periodScanLogs.forEach(l => {
    const day = (l.at || '').slice(0, 10);
    if (day) scansByDay[day] = (scansByDay[day] || 0) + 1;
  });
  const scanDailyArr  = Object.entries(scansByDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  const scansToday    = scansByDay[today] || 0;
  const scansTotal    = periodScanLogs.length;
  const scansOut      = periodScanLogs.filter(l => l.action.includes('out_workshop')).length;
  const scansIn       = periodScanLogs.filter(l => l.action.includes('in_workshop')).length;

  // ── Inventory usage (period-scoped) ───────────────────────────
  const invMovements     = db.inventory_movements || [];
  const periodInvMoves   = invMovements.filter(m => (m.at || '') >= cutoff);
  const invSrc           = periodInvMoves.length > 0 ? periodInvMoves : invMovements;
  const issuedMoves      = invSrc.filter(m => m.type === 'صرف');
  const movTypeBreakdown = {
    'استلام': invSrc.filter(m => m.type === 'استلام').length,
    'صرف':    issuedMoves.length,
    'إرجاع':  invSrc.filter(m => m.type === 'إرجاع').length,
    'تسوية':  invSrc.filter(m => m.type === 'تسوية').length,
    'جرد':    invSrc.filter(m => m.type === 'جرد').length
  };
  const usageByItem = {};
  issuedMoves.forEach(m => {
    const k = m.item_name || m.item_id;
    if (!usageByItem[k]) usageByItem[k] = { name: k, qty: 0, txns: 0 };
    usageByItem[k].qty  += Math.abs(m.qty || 0);
    usageByItem[k].txns++;
  });
  const topIssuedItems  = Object.values(usageByItem).sort((a, b) => b.qty - a.qty).slice(0, 8);
  const usageByOrder    = {};
  issuedMoves.filter(m => m.order_number).forEach(m => {
    const k = m.order_number;
    if (!usageByOrder[k]) usageByOrder[k] = { order_number: k, order_id: m.order_id, items: [] };
    usageByOrder[k].items.push(m);
  });
  const usageByOrderArr = Object.values(usageByOrder).slice(0, 10);

  // ── Daily completion trend (last 14 active days) ───────────────
  const dailyMap = {};
  completedOrders.forEach(o => {
    const day = (o.updated_at || '').slice(0, 10);
    if (day) dailyMap[day] = (dailyMap[day] || 0) + 1;
  });
  const daily         = Object.entries(dailyMap).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  const maxDailyCount = Math.max(1, ...daily.map(d => d[1]));

  // ── Activity log (period-scoped, last 50) ─────────────────────
  const userMap = {};
  allUsers.forEach(u => { userMap[u.id] = u; });
  const recentActivity = periodActLogs.slice(0, 50).map(l => ({
    ...l,
    user_name: userMap[l.user_id] ? userMap[l.user_id].name : 'غير معروف',
    user_role: userMap[l.user_id] ? userMap[l.user_id].role : ''
  }));
  const actionCounts = {};
  periodActLogs.forEach(l => {
    const a = l.action || 'أخرى';
    actionCounts[a] = (actionCounts[a] || 0) + 1;
  });
  const topActions = Object.entries(actionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // ── Status-change history (period-scoped) ─────────────────────
  const statusChangeLog = periodActLogs
    .filter(l => l.action === 'تغيير حالة طلب')
    .slice(0, 30).map(l => ({ ...l, user_name: userMap[l.user_id] ? userMap[l.user_id].name : '—' }));

  // ── Monthly/today summary ──────────────────────────────────────
  const doneToday     = completedOrders.filter(o => (o.updated_at||'').slice(0,10) === today).length;
  const doneThisMonth = completedOrders.filter(o => (o.updated_at||'').slice(0,7) === thisMonth).length;
  const newThisMonth  = allOrders.filter(o => (o.created_at||'').slice(0,7) === thisMonth).length;

  res.render('reports', {
    title: 'التقارير',
    tab: req.query.tab || 'overview',
    period,
    // KPIs
    kpi: {
      productionEfficiency, onTimeRate, delayRate, errorRate,
      wsEfficiency, pkgRate, shpRate
    },
    // Counts
    counts: {
      total: allOrders.length, active: activeOrders.length,
      completed: completedOrders.length, cancelled: cancelledOrders.length,
      late: lateOrders.length, doneToday, doneThisMonth, newThisMonth,
      periodOrders: periodOrders.length, periodCompleted: periodCompleted.length
    },
    // Overview
    statusCounts, maxStatusCount, ORDER_STATUSES, STATUS_COLORS,
    stageCounts, ITEM_STAGES_ALL, totalItemsInPipeline,
    daily, maxDailyCount,
    // Production
    byWorkshop, wsDelivered, wsReceived,
    byEmbroiderer, totalEmbErrors, totalEmbReceived,
    scanDailyArr, scansToday, scansTotal, scansOut, scansIn,
    statusChangeLog,
    // Packaging & Shipping
    packages: pkgSrc, pkgDone, pkgRate, avgPkgMins, totalPieces,
    shipments: shpSrc, shpDelivered, shpFailed, shpRate, byCompanyArr,
    // Inventory
    invMovements, movTypeBreakdown, topIssuedItems, usageByOrderArr,
    totalInventoryItems: (db.inventory_items || []).length,
    // Activity
    recentActivity, topActions,
    DELAY_DAYS_THRESHOLD
  });
});

// ---------- BARCODE ITEM DETAIL ----------
app.get('/barcode/item/:barcode', requireAuth, requireSection('barcode'), (req, res) => {
  const db = load();
  const barcode = decodeURIComponent(req.params.barcode);

  // Find the order containing this item barcode
  let foundOrder = null;
  let foundItem = null;
  for (const order of db.orders) {
    const item = order.items.find(it => it.barcode === barcode);
    if (item) { foundOrder = order; foundItem = item; break; }
  }

  if (!foundOrder) {
    return res.status(404).render('error', { message: 'لم يتم العثور على قطعة بهذا الباركود: ' + barcode });
  }

  // Enrich item with product image
  const product = db.products.find(p => p.id === foundItem.product_id);
  const itemWithImg = { ...foundItem, image_url: product ? (product.image_url || '') : '' };

  // Determine next stage
  const ITEM_STAGES = ['تجهيز','عند المشغل','مستلم من المشغل','عند المطرز','جاهز للتغليف','تم التنفيذ'];
  const curIdx = ITEM_STAGES.indexOf(foundItem.stage);
  const nextStage = (curIdx >= 0 && curIdx < ITEM_STAGES.length - 1) ? ITEM_STAGES[curIdx + 1] : null;

  // Activity logs relevant to this order
  const logs = db.activity_logs
    .filter(l => l.ref && l.ref.includes(foundOrder.order_number))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.render('barcode/item', {
    order: foundOrder,
    item: itemWithImg,
    nextStage,
    logs
  });
});

// ---------- ORDER SEARCH ----------
app.get('/search', requireAuth, (req, res) => {
  res.render('search', {});
});

app.get('/api/orders/lookup', requireAuth, (req, res) => {
  const db = load();
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ found: false, error: 'أدخل رقم الطلب أو الباركود' });

  const qUpper = q.toUpperCase();

  // Exact match: order_number, salla_order_id, item barcode
  let order = db.orders.find(o =>
    (o.order_number || '').toUpperCase() === qUpper ||
    String(o.salla_order_id || '') === q ||
    o.items.some(it => it.barcode === q)
  );

  // Fallback: partial match
  if (!order) {
    order = db.orders.find(o =>
      (o.order_number || '').toUpperCase().includes(qUpper) ||
      String(o.salla_order_id || '').includes(q)
    );
  }

  if (!order) return res.json({ found: false, error: 'لم يتم العثور على طلب بهذا الرقم أو الباركود' });

  const items = order.items.map(it => {
    const product = db.products.find(p => p.id === it.product_id);
    return {
      id: it.id,
      product_name: it.product_name,
      size: it.size || '',
      color: it.color || '',
      embroidery_name: it.embroidery_name || '',
      qty: it.qty,
      barcode: it.barcode,
      stage: it.stage || '',
      notes: it.notes || '',
      image_url: product ? (product.image_url || '') : '',
      is_matched: it.barcode === q
    };
  });

  res.json({
    found: true,
    order: {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      created_at: order.created_at,
      items
    }
  });
});

app.use((req, res) => {
  res.status(404).render('error', { message: 'الصفحة غير موجودة' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('لمسة أزيائي - نظام الإنتاج يعمل على المنفذ ' + PORT);
});
