const ORDER_STATUSES = [
  'جديد',
  'مراجعة',
  'تجهيز',
  'عند المشغل',
  'مستلم من المشغل',
  'عند المطرز',
  'جاهز للتغليف',
  'في التغليف',
  'تم التغليف',
  'تم الشحن',
  'تم التنفيذ',
  'ملغي'
];

const STATUS_COLORS = {
  'جديد':             'secondary',
  'مراجعة':           'info',
  'تجهيز':            'primary',
  'عند المشغل':       'warning',
  'مستلم من المشغل':  'warning',
  'عند المطرز':       'purple',
  'جاهز للتغليف':     'success',
  'في التغليف':       'info',
  'تم التغليف':       'teal',
  'تم الشحن':         'primary',
  'تم التنفيذ':       'dark',
  'ملغي':             'danger'
};

// ── Roles ──────────────────────────────────────────────────────────
const ROLES = {
  admin:             'المدير العام',
  production_mgr:    'مدير الإنتاج',
  prep:              'موظف التجهيز',
  workshop_worker:   'موظف المشغل',
  embroidery_worker: 'موظف التطريز',
  quality:           'موظف الجودة',
  packaging:         'موظف التغليف والشحن',
  shipping_emp:      'موظف الشحن',
  inventory_emp:     'موظف المخزون',
  accountant:        'المحاسب',
  // ── kept for backward compatibility ──
  production:        'موظف الإنتاج',
  receiving:         'موظف الاستلام والتسليم'
};

// ── Granular permissions per role ──────────────────────────────────
// view, add, edit, delete, changeStatus, reports, manageInventory, manageUsers, hideCustomer
const ROLE_PERMISSIONS = {
  admin: {
    view: true, add: true, edit: true, delete: true,
    changeStatus: true, reports: true, manageInventory: true, manageUsers: true,
    hideCustomer: false
  },
  production_mgr: {
    view: true, add: true, edit: true, delete: false,
    changeStatus: true, reports: true, manageInventory: true, manageUsers: false,
    hideCustomer: false
  },
  prep: {
    view: true, add: true, edit: false, delete: false,
    changeStatus: false, reports: false, manageInventory: false, manageUsers: false,
    hideCustomer: true
  },
  workshop_worker: {
    view: true, add: false, edit: false, delete: false,
    changeStatus: true, reports: false, manageInventory: false, manageUsers: false,
    hideCustomer: true
  },
  embroidery_worker: {
    view: true, add: false, edit: false, delete: false,
    changeStatus: true, reports: false, manageInventory: false, manageUsers: false,
    hideCustomer: true
  },
  quality: {
    view: true, add: true, edit: false, delete: false,
    changeStatus: true, reports: false, manageInventory: false, manageUsers: false,
    hideCustomer: true
  },
  packaging: {
    view: true, add: true, edit: true, delete: false,
    changeStatus: true, reports: false, manageInventory: false, manageUsers: false,
    hideCustomer: true
  },
  shipping_emp: {
    view: true, add: true, edit: true, delete: false,
    changeStatus: true, reports: false, manageInventory: false, manageUsers: false,
    hideCustomer: true
  },
  inventory_emp: {
    view: true, add: true, edit: true, delete: false,
    changeStatus: false, reports: false, manageInventory: true, manageUsers: false,
    hideCustomer: true
  },
  accountant: {
    view: true, add: true, edit: true, delete: false,
    changeStatus: false, reports: true, manageInventory: false, manageUsers: false,
    hideCustomer: false
  },
  // ── backward-compat roles ──
  production: {
    view: true, add: true, edit: false, delete: false,
    changeStatus: true, reports: false, manageInventory: false, manageUsers: false,
    hideCustomer: true
  },
  receiving: {
    view: true, add: false, edit: false, delete: false,
    changeStatus: true, reports: false, manageInventory: false, manageUsers: false,
    hideCustomer: true
  }
};

// Roles that should not see customer name/phone/city
const HIDE_CUSTOMER_ROLES = new Set(
  Object.entries(ROLE_PERMISSIONS)
    .filter(([, p]) => p.hideCustomer)
    .map(([role]) => role)
);

// ── Section-level access (coarse-grained) ─────────────────────────
const PERMISSIONS = {
  dashboard:    ['admin','production_mgr','prep','workshop_worker','embroidery_worker','quality','packaging','shipping_emp','inventory_emp','accountant','production','receiving'],
  orders:       ['admin','production_mgr','prep','quality','packaging','shipping_emp','receiving','production'],
  products:     ['admin','production_mgr','production'],
  workshops:    ['admin','production_mgr','accountant','production'],
  embroiderers: ['admin','production_mgr','accountant','production'],
  barcode:      ['admin','production_mgr','receiving','production'],
  scanner:      ['admin','production_mgr','prep','workshop_worker','embroidery_worker','quality','receiving','production','packaging','shipping_emp'],
  production:   ['admin','production_mgr','prep','workshop_worker','quality','production','receiving'],
  packaging:    ['admin','production_mgr','packaging','shipping_emp','receiving'],
  inventory:    ['admin','production_mgr','inventory_emp','receiving','production'],
  prep:         ['admin','production_mgr','prep','production'],
  accounts:     ['admin','accountant'],
  users:        ['admin'],
  settings:     ['admin']
};

const DELAY_DAYS_THRESHOLD = 4;

module.exports = {
  ORDER_STATUSES, STATUS_COLORS, ROLES, ROLE_PERMISSIONS, HIDE_CUSTOMER_ROLES,
  PERMISSIONS, DELAY_DAYS_THRESHOLD
};
