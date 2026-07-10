const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { classifyOrder } = require('./classify');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return check === hash;
}

const DEFAULT_SETTINGS = {
  company:  { name: 'لمسة أزيائي', address: '', phone: '', email: '', taxNumber: '', website: '' },
  security: { hideCustomerFromProduction: true, sessionTimeout: 480 },
  barcode:  { type: 'QR', size: 'medium', showName: true, showOrder: true, showSize: true, showColor: false },
  printing: { paper: 'A4', logo: true, headerNote: '' },
  language: { currency: 'SAR', dateFormat: 'DD/MM/YYYY' },
  notifications: { lowStock: true, delay: true },
  backup:   { lastExport: null }
};

function defaultData() {
  const admin      = hashPassword('admin123');
  const production = hashPassword('prod123');
  const receiving  = hashPassword('recv123');
  const packaging  = hashPassword('pack123');
  const accountant = hashPassword('acc123');

  return {
    meta: { orderSeq: 1006, settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) },
    users: [
      { id: 'u1', username: 'admin',      name: 'المدير العام',              role: 'admin',      active: true, salt: admin.salt,      hash: admin.hash,      created_at: new Date().toISOString() },
      { id: 'u2', username: 'production', name: 'موظف الإنتاج',              role: 'production', active: true, salt: production.salt, hash: production.hash, created_at: new Date().toISOString() },
      { id: 'u3', username: 'receiving',  name: 'موظف الاستلام والتسليم',    role: 'receiving',  active: true, salt: receiving.salt,  hash: receiving.hash,  created_at: new Date().toISOString() },
      { id: 'u4', username: 'packaging',  name: 'موظف التغليف والشحن',       role: 'packaging',  active: true, salt: packaging.salt,  hash: packaging.hash,  created_at: new Date().toISOString() },
      { id: 'u5', username: 'accountant', name: 'المحاسب',                   role: 'accountant', active: true, salt: accountant.salt, hash: accountant.hash, created_at: new Date().toISOString() }
    ],
    products: [
      { id: 'p1', name: 'برقع مطرز',    category: 'برقع', image_url: '', sizes: ['0-3 شهور','3-6 شهور','6-12 شهور','1-2 سنة','2-3 سنة'], colors: ['أبيض','بيج','وردي'], embroidery: true },
      { id: 'p2', name: 'ثوب كويتي',    category: 'ثوب',  image_url: '', sizes: ['2 سنة','4 سنة','6 سنة','8 سنة','10 سنة'],            colors: ['أبيض','أزرق فاتح'], embroidery: true },
      { id: 'p3', name: 'طقم ثوب وبشت', category: 'طقم',  image_url: '', sizes: ['2 سنة','4 سنة','6 سنة','8 سنة'],                    colors: ['أبيض','كحلي'], embroidery: true },
      { id: 'p4', name: 'دقلة مطرزة',   category: 'دقلة', image_url: '', sizes: ['2 سنة','4 سنة','6 سنة'],                            colors: ['أخضر','عنابي'], embroidery: true }
    ],
    workshops: [
      { id: 'w1', name: 'مشغل النور',    phone: '0500000001', price_per_piece: 25, status: 'active' },
      { id: 'w2', name: 'مشغل الإتقان',  phone: '0500000002', price_per_piece: 22, status: 'active' }
    ],
    embroiderers: [
      { id: 'e1', name: 'أم سعود للتطريز', price_per_piece: 10 }
    ],
    orders:              [],
    workshop_jobs:       [],
    embroidery_jobs:     [],
    workshop_payments:   [],
    embroidery_payments: [],
    materials:           [],
    expenses:            [],
    activity_logs:       []
  };
}

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData(), null, 2), 'utf8');
  }
}

function load() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const data = JSON.parse(raw);
  let dirty = false;

  // Lazy migration 1: backfill order_type for orders that predate the field
  (data.orders || []).forEach(o => {
    if (!o.order_type) { o.order_type = 'إنتاج'; dirty = true; }
  });

  // One-time migration: re-classify orders that were defaulted to 'إنتاج' by
  // the lazy migration above but may actually be fulfillable from inventory now
  // that inventory is set up. Guarded by a flag so it only runs once.
  if (!data.meta.reclassifiedOrInventoryMigrated) {
    const inventory = data.inventory_items || [];
    if (inventory.length > 0) {
      (data.orders || []).forEach(o => {
        if (o.order_type === 'إنتاج' && Array.isArray(o.items) && o.items.length > 0) {
          const newType = classifyOrder(o.items, inventory);
          if (newType !== o.order_type) {
            o.order_type = newType;
          }
        }
      });
    }
    data.meta.reclassifiedOrInventoryMigrated = true;
    dirty = true;
  }

  if (dirty) fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function nextOrderNumber() {
  const db = load();
  db.meta.orderSeq += 1;
  save(db);
  return 'LMS-' + db.meta.orderSeq;
}

/**
 * Write an activity log entry.
 * @param {object} db        - loaded db object (caller must save() after)
 * @param {string} userId    - acting user id
 * @param {string} action    - short action label (e.g. 'تغيير حالة طلب')
 * @param {string} details   - human-readable summary
 * @param {object} [extra]   - optional enrichment: { module, type, before, after }
 *   module: section name ('orders','production','settings',…)
 *   type:   'create'|'update'|'delete'|'status_change'|'login'|'security'|'export'
 *   before: previous value (string/object serialized)
 *   after:  new value
 */
function log(db, userId, action, details, extra) {
  db.activity_logs.unshift({
    id:          newId('log'),
    user_id:     userId || null,
    action,
    details:     details || '',
    module:      extra?.module      || null,
    action_type: extra?.type        || null,
    before:      extra?.before != null ? String(extra.before) : null,
    after:       extra?.after  != null ? String(extra.after)  : null,
    at:          new Date().toISOString()
  });
  if (db.activity_logs.length > 1000) db.activity_logs.length = 1000;
}

module.exports = {
  load, save, newId, nextOrderNumber,
  hashPassword, verifyPassword, log, DB_PATH,
  DEFAULT_SETTINGS
};
