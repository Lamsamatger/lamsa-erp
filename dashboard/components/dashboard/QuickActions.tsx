import { Package, LayoutList, Printer, QrCode, BarChart3, PackagePlus, ArrowLeft } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const ERP = process.env.NEXT_PUBLIC_ERP_URL ?? ''

interface Action {
  icon: React.ReactNode
  label: string
  sublabel: string
  path: string
  color: string
  bg: string
  primary?: boolean
}

const ACTIONS: Action[] = [
  {
    icon: <Package size={20} />,
    label: 'الطلبات',
    sublabel: 'قائمة جميع الطلبات',
    path: '/orders',
    color: 'text-[#1a2d4a]',
    bg: 'bg-slate-100 hover:bg-slate-200',
  },
  {
    icon: <PackagePlus size={20} />,
    label: 'طلب جديد',
    sublabel: 'إدخال طلب يدوي',
    path: '/orders/new',
    color: 'text-sky-600',
    bg: 'bg-sky-50 hover:bg-sky-100',
    primary: true,
  },
  {
    icon: <LayoutList size={20} />,
    label: 'قائمة التجهيز',
    sublabel: 'طلبات قيد التحضير',
    path: '/prep',
    color: 'text-blue-600',
    bg: 'bg-blue-50 hover:bg-blue-100',
  },
  {
    icon: <Printer size={20} />,
    label: 'طباعة بطاقات',
    sublabel: 'بطاقات الإنتاج A4',
    path: '/prep/print-all',
    color: 'text-purple-600',
    bg: 'bg-purple-50 hover:bg-purple-100',
  },
  {
    icon: <QrCode size={20} />,
    label: 'مسح QR',
    sublabel: 'ماسح الباركود',
    path: '/barcode',
    color: 'text-[#c9a24b]',
    bg: 'bg-amber-50 hover:bg-amber-100',
  },
  {
    icon: <BarChart3 size={20} />,
    label: 'التقارير',
    sublabel: 'إحصائيات وتقارير',
    path: '/reports',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 hover:bg-emerald-100',
  },
]

export default function QuickActions() {
  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="text-base flex items-center gap-2">
          ⚡ إجراءات سريعة
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        {!ERP && (
          <p className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-700">
            اضبط <code className="font-mono">NEXT_PUBLIC_ERP_URL</code> لتفعيل الروابط
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map((a) => {
            const href = ERP ? `${ERP}${a.path}` : null
            const cls = `group flex items-center gap-3 rounded-xl p-3 transition-all ${a.bg} ${a.primary ? 'col-span-2' : ''}`
            const inner = (
              <>
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ${a.color} group-hover:scale-105 transition-transform`}>
                  {a.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-bold leading-tight ${a.color}`}>{a.label}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">{a.sublabel}</p>
                </div>
                {href && <ArrowLeft size={14} className="text-slate-300 shrink-0 group-hover:text-slate-500 transition-colors" />}
              </>
            )
            if (href) {
              return <a key={a.path} href={href} className={cls}>{inner}</a>
            }
            return <div key={a.path} className={`${cls} opacity-60 cursor-not-allowed`}>{inner}</div>
          })}
        </div>
      </CardContent>
    </Card>
  )
}
