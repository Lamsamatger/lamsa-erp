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
  'جديد': 'secondary',
  'مراجعة': 'info',
  'تجهيز': 'primary',
  'عند المشغل': 'warning',
  'مستلم من المشغل': 'warning',
  'عند المطرز': 'purple',
  'جاهز للتغليف': 'success',
  'في التغليف': 'info',
  'تم التغليف': 'teal',
  'تم الشحن': 'primary',
  'تم التنفيذ': 'dark',
  'ملغي': 'danger'
};

const ROLES = {
  admin: 'المدير العام',
  production: 'موظف الإنتاج',
  receiving: 'موظف الاستلام والتسليم',
  packaging: 'موظف التغليف والشحن',
  accountant: 'المحاسب'
};

// which roles can access which top-level sections
const PERMISSIONS = {
  dashboard: ['admin', 'production', 'receiving', 'packaging', 'accountant'],
  orders: ['admin', 'production', 'receiving', 'packaging'],
  products: ['admin', 'production'],
  workshops: ['admin', 'production', 'accountant'],
  embroiderers: ['admin', 'production', 'accountant'],
  barcode: ['admin', 'receiving', 'production'],
  scanner: ['admin', 'production', 'receiving', 'packaging'],
  production: ['admin', 'production', 'receiving'],
  packaging: ['admin', 'packaging', 'receiving'],
  inventory: ['admin', 'production', 'receiving'],
  prep: ['admin', 'production'],
  accounts: ['admin', 'accountant'],
  users: ['admin']
};

const DELAY_DAYS_THRESHOLD = 4;

module.exports = { ORDER_STATUSES, STATUS_COLORS, ROLES, PERMISSIONS, DELAY_DAYS_THRESHOLD };
