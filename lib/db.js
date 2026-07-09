const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function defaultData() {
  const admin = hashPassword('admin123');
  const production = hashPassword('prod123');
  const receiving = hashPassword('recv123');
  const packaging = hashPassword('pack123');
  const accountant = hashPassword('acc123');

  return {
    meta: { orderSeq: 1006 },
    users: [
      { id: 'u1', username: 'admin', name: 'المدير العام', role: 'admin', salt: admin.salt, hash: admin.hash },
      { id: 'u2', username: 'production', name: 'موظف الإنتاج', role: 'production', salt: production.salt, hash: production.hash },
      { id: 'u3', username: 'receiving', name: 'موظف الاستلام والتسليم', role: 'receiving', salt: receiving.salt, hash: receiving.hash },
      { id: 'u4', username: 'packaging', name: 'موظف التغليف والشحن', role: 'packaging', salt: packaging.salt, hash: packaging.hash },
      { id: 'u5', username: 'accountant', name: 'المحاسب', role: 'accountant', salt: accountant.salt, hash: accountant.hash }
    ],
    products: [
      { id: 'p1', name: 'برقع مطرز', category: 'برقع', image_url: '', sizes: ['0-3 شهور','3-6 شهور','6-12 شهور','1-2 سنة','2-3 سنة'], colors: ['أبيض','بيج','وردي'], embroidery: true },
      { id: 'p2', name: 'ثوب كويتي', category: 'ثوب', image_url: '', sizes: ['2 سنة','4 سنة','6 سنة','8 سنة','10 سنة'], colors: ['أبيض','أزرق فاتح'], embroidery: true },
      { id: 'p3', name: 'طقم ثوب وبشت', category: 'طقم', image_url: '', sizes: ['2 سنة','4 سنة','6 سنة','8 سنة'], colors: ['أبيض','كحلي'], embroidery: true },
      { id: 'p4', name: 'دقلة مطرزة', category: 'دقلة', image_url: '', sizes: ['2 سنة','4 سنة','6 سنة'], colors: ['أخضر','عنابي'], embroidery: true }
    ],
    workshops: [
      { id: 'w1', name: 'مشغل النور', phone: '0500000001', price_per_piece: 25, status: 'active' },
      { id: 'w2', name: 'مشغل الإتقان', phone: '0500000002', price_per_piece: 22, status: 'active' }
    ],
    embroiderers: [
      { id: 'e1', name: 'أم سعود للتطريز', price_per_piece: 10 }
    ],
    orders: [],
    workshop_jobs: [],
    embroidery_jobs: [],
    workshop_payments: [],
    embroidery_payments: [],
    materials: [],
    expenses: [],
    activity_logs: []
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
  return JSON.parse(raw);
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

function log(db, userId, action, details) {
  db.activity_logs.unshift({
    id: newId('log'),
    user_id: userId || null,
    action,
    details: details || '',
    at: new Date().toISOString()
  });
  if (db.activity_logs.length > 500) db.activity_logs.length = 500;
}

module.exports = { load, save, newId, nextOrderNumber, hashPassword, verifyPassword, log, DB_PATH };
