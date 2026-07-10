import { AlertTriangle, Clock, PackageX, CheckSquare, Info } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { Alert } from '@/lib/types'

const ICON_MAP = {
  delayed: Clock,
  error: AlertTriangle,
  stock: PackageX,
  quality: CheckSquare,
}

const SEVERITY_STYLES = {
  high: {
    card: 'border-r-red-500 bg-red-50/60',
    icon: 'bg-red-100 text-red-600',
    title: 'text-red-700',
    desc: 'text-red-600/80',
    dot: 'bg-red-500',
  },
  medium: {
    card: 'border-r-amber-500 bg-amber-50/60',
    icon: 'bg-amber-100 text-amber-600',
    title: 'text-amber-700',
    desc: 'text-amber-600/80',
    dot: 'bg-amber-500',
  },
  low: {
    card: 'border-r-slate-400 bg-slate-50',
    icon: 'bg-slate-100 text-slate-500',
    title: 'text-slate-600',
    desc: 'text-slate-500',
    dot: 'bg-slate-400',
  },
}

export default function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            التنبيهات والتحذيرات
          </CardTitle>
          {alerts.length > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {alerts.length}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-2">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-400">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
              <Info size={22} className="text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-emerald-600">كل شيء على ما يرام! 🎉</p>
            <p className="text-xs text-slate-400">لا توجد تنبيهات حالياً</p>
          </div>
        ) : (
          alerts.map(alert => {
            const styles = SEVERITY_STYLES[alert.severity]
            const Icon = ICON_MAP[alert.type] || AlertTriangle
            return (
              <div
                key={alert.id}
                className={`flex gap-3 rounded-xl border-r-4 p-3 ${styles.card}`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${styles.icon}`}>
                  <Icon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${styles.dot}`} />
                    <p className={`text-xs font-bold ${styles.title}`}>{alert.title}</p>
                  </div>
                  <p className={`mt-0.5 text-[11px] leading-relaxed ${styles.desc}`}>{alert.description}</p>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
