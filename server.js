const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { load, save, newId, nextOrderNumber, hashPassword, verifyPassword, log } = require('./lib/db');
const { ORDER_STATUSES, STATUS_COLORS, ROLES, PERMISSIONS, DELAY_DAYS_THRESHOLD } = require('./lib/constants');

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
  if (['جاهز للتغليف', 'تم التنفيذ', 'ملغي'].includes(order.status)) return false;
  return daysBetween(order.created_at) > DELAY_DAYS_THRESHOLD;
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.ROLES = ROLES;
  res.locals.ORDER_STATUSES = ORDER_STATUSES;
  res.locals.STATUS_COLORS = STATUS_COLORS;
  res.locals.path = req.path;
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
  req.session.user = { id: u.id, username: u.username, name: u.name, role: u.role };
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- DASHBOARD ----------
app.get('/', requireAuth, requireSection('dashboard'), (req, res) => {
  const db = load();
  const counts = {};
  ORDER_STATUSES.forEach(s => counts[s] = 0);
  db.orders.forEach(o => counts[o.status] = (counts[o.status] || 0) + 1);

  const late = db.orders.filter(isLate).map(o => ({
    ...o, days_late: daysBetween(o.created_at)
  })).sort((a, b) => b.days_late - a.days_late);

  const today = new Date().toISOString().slice(0, 10);
  const doneToday = db.orders.filter(o => o.status === 'تم التنفيذ' && (o.updated_at || '').slice(0, 10) === today).length;

  const thisMonth = new Date().toISOString().slice(0, 7);
  const doneThisMonth = db.orders.filter(o => o.status === 'تم التنفيذ' && (o.updated_at || '').slice(0, 7) === thisMonth).length;

  res.render('dashboard', { counts, late, doneToday, doneThisMonth, totalOrders: db.orders.length });
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

  const order = {
    id: newId('ord'),
    order_number,
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
  log(db, req.session.user.id, 'إنشاء طلب', order_number);
  save(db);
  res.redirect('/orders/' + order.id);
});

app.get('/orders/:id', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  const jobs = db.workshop_jobs.filter(j => j.order_id === order.id);
  const embJobs = db.embroidery_jobs.filter(j => j.order_id === order.id);
  res.render('orders/detail', { order, jobs, embJobs, workshops: db.workshops, embroiderers: db.embroiderers, late: isLate(order) });
});

app.post('/orders/:id/status', requireAuth, requireSection('orders'), (req, res) => {
  const db = load();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).render('error', { message: 'الطلب غير موجود' });
  order.status = req.body.status;
  order.updated_at = new Date().toISOString();
  if (req.body.shipment_number) order.shipment_number = req.body.shipment_number;
  log(db, req.session.user.id, 'تغيير حالة طلب', order.order_number + ' -> ' + order.status);
  save(db);
  res.redirect('/orders/' + order.id);
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
  const { workshop_id, date, product_id, size } = req.query;
  let orders = db.orders.filter(o => !['تم التنفيذ', 'ملغي'].includes(o.status));

  if (date) orders = orders.filter(o => (o.created_at || '').slice(0, 10) === date);
  if (product_id) orders = orders.filter(o => o.items.some(it => it.product_id === product_id));
  if (size) orders = orders.filter(o => o.items.some(it => it.size === size));
  if (workshop_id) {
    const jobOrderIds = new Set(db.workshop_jobs.filter(j => j.workshop_id === workshop_id).map(j => j.order_id));
    orders = orders.filter(o => jobOrderIds.has(o.id));
  }

  res.render('prep/list', { orders, products: db.products, workshops: db.workshops, filters: req.query });
});

app.post('/prep/print', requireAuth, requireSection('prep'), (req, res) => {
  const db = load();
  let ids = req.body.order_ids;
  if (!ids) ids = [];
  if (!Array.isArray(ids)) ids = [ids];
  const orders = db.orders.filter(o => ids.includes(o.id));
  res.render('orders/card_print', { orders });
});

// ---------- BARCODE SCANNING ----------
app.get('/barcode', requireAuth, requireSection('barcode'), (req, res) => {
  res.render('barcode/scan', { result: null, error: null });
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
  res.render('barcode/scan', { result: { message, order }, error: null });
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
  res.render('embroiderers/list', { embroiderers: withStats });
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

      const order = {
        id: newId('ord'),
        order_number,
        customer_name: (payload.customer && (payload.customer.first_name ? (payload.customer.first_name + ' ' + (payload.customer.last_name || '')) : payload.customer.name)) || '',
        customer_phone: (payload.customer && payload.customer.mobile) || '',
        city: (payload.shipping && payload.shipping.address && payload.shipping.address.city) || (payload.ship_to && payload.ship_to.city) || '',
        status: 'جديد',
        assigned_employee: '',
        items: items.length ? items : [{ id: newId('item'), product_id: '', product_name: 'منتج من سلة (راجع تفاصيل الطلب في سلة)', size: '', color: '', embroidery_name: '', notes: '', qty: 1, barcode: order_number + '-1', stage: 'تجهيز' }],
        notes: 'مستورد تلقائياً من سلة (رقم الطلب في سلة: ' + (payload.reference_id || payload.id || '—') + ')',
        shipment_number: '',
        salla_order_id: payload.id || payload.reference_id || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      db.orders.push(order);
      log(db, null, 'استيراد طلب من سلة', order_number);
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

// ---------- USERS (admin) ----------
app.get('/users', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  res.render('users', { users: db.users });
});

app.post('/users/new', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  const { hash, salt } = hashPassword(req.body.password);
  db.users.push({ id: newId('u'), username: req.body.username, name: req.body.name, role: req.body.role, salt, hash });
  save(db);
  res.redirect('/users');
});

app.post('/users/:id/delete', requireAuth, requireSection('users'), (req, res) => {
  const db = load();
  if (req.params.id !== req.session.user.id) {
    db.users = db.users.filter(u => u.id !== req.params.id);
    save(db);
  }
  res.redirect('/users');
});

// ---------- REPORTS (simple, part of dashboard) ----------
app.get('/reports', requireAuth, requireSection('dashboard'), (req, res) => {
  const db = load();
  const byWorkshop = db.workshops.map(w => {
    const jobs = db.workshop_jobs.filter(j => j.workshop_id === w.id);
    return {
      name: w.name,
      delivered: jobs.reduce((s, j) => s + (j.delivered_qty || 0), 0),
      received: jobs.reduce((s, j) => s + (j.received_qty || 0), 0)
    };
  });

  const dailyMap = {};
  db.orders.filter(o => o.status === 'تم التنفيذ').forEach(o => {
    const day = (o.updated_at || '').slice(0, 10);
    dailyMap[day] = (dailyMap[day] || 0) + 1;
  });
  const daily = Object.entries(dailyMap).sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 14);

  res.render('reports', { byWorkshop, daily, totalOrders: db.orders.length });
});

app.use((req, res) => {
  res.status(404).render('error', { message: 'الصفحة غير موجودة' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('لمسة أزيائي - نظام الإنتاج يعمل على المنفذ ' + PORT);
});
