import {
  Package, PackagePlus, Cog, AlertTriangle, Truck, CheckCircle2, TrendingUp,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { DashboardStats } from '@/lib/types'

interface StatCardProps {
  title: string
  value: number | string
  subtitle?: string
  icon: React.ReactNode
  color: string
  bg: string
  border: string
  trend?: string
  trendUp?: boolean
}

function StatCard({ title, value, subtitle, icon, color, bg, border, trend, trendUp }: StatCardProps) {
  return (
    <Card className={`border-r-4 ${border} hover:shadow-md transition-shadow`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-500 mb-1 truncate">{title}</p>
            <p className={`text-3xl font-black leading-none ${color}`}>{value}</p>
            {subtitle && <p className="text-xs text-slate-400 mt-1.5">{subtitle}</p>}
            {trend && (
              <p className={`text-xs mt-1.5 font-medium ${trendUp ? 'text-emerald-600' : 'text-red-500'}`}>
                {trendUp ? '↑' : '↓'} {trend}
              </p>
            )}
          </div>
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${bg}`}>
            <div className={color}>{icon}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function StatsGrid({ stats }: { stats: DashboardStats }) {
  const cards: StatCardProps[] = [
    {
      title: 'إجمالي الطلبات',
      value: stats.totalOrders,
      subtitle: 'جميع الطلبات في النظام',
      icon: <Package size={22} />,
      color: 'text-[#1a2d4a]',
      bg: 'bg-slate-100',
      border: 'border-r-[#1a2d4a]',
    },
    {
      title: 'طلبات جديدة',
      value: stats.newOrders,
      subtitle: 'بانتظار البدء في الإنتاج',
      icon: <PackagePlus size={22} />,
      color: 'text-sky-600',
      bg: 'bg-sky-50',
      border: 'border-r-sky-500',
    },
    {
      title: 'قيد الإنتاج',
      value: stats.inProduction,
      subtitle: 'تجهيز · مشغل · تطريز',
      icon: <Cog size={22} />,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      border: 'border-r-blue-500',
    },
    {
      title: 'طلبات متأخرة',
      value: stats.delayedOrders,
      subtitle: `أكثر من 4 أيام دون إنجاز`,
      icon: <AlertTriangle size={22} />,
      color: stats.delayedOrders > 0 ? 'text-red-600' : 'text-slate-400',
      bg: stats.delayedOrders > 0 ? 'bg-red-50' : 'bg-slate-50',
      border: stats.delayedOrders > 0 ? 'border-r-red-500' : 'border-r-slate-300',
    },
    {
      title: 'جاهزة للشحن',
      value: stats.readyToShip,
      subtitle: 'تم تجهيزها وبانتظار الشحن',
      icon: <Truck size={22} />,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-r-emerald-500',
    },
    {
      title: 'نسبة الإنجاز الكلية',
      value: `${stats.overallProgress}%`,
      subtitle: `${stats.completedOrders} طلب مكتمل من ${stats.totalOrders}`,
      icon: <TrendingUp size={22} />,
      color: 'text-[#c9a24b]',
      bg: 'bg-amber-50',
      border: 'border-r-[#c9a24b]',
    },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((c, i) => <StatCard key={i} {...c} />)}
      </div>
      {/* Overall progress bar */}
      <Card className="border-0 bg-gradient-to-r from-[#1a2d4a] to-[#2d4d7a] text-white">
        <CardContent className="py-3 px-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white/90">التقدم الكلي للإنتاج</span>
            <span className="text-lg font-black text-gold">{stats.overallProgress}%</span>
          </div>
          <Progress
            value={stats.overallProgress}
            className="h-3 bg-white/20"
            indicatorClassName="bg-gold rounded-full"
          />
          <div className="mt-2 flex gap-4 text-[11px] text-white/60 flex-wrap">
            <span>✅ مكتملة: <strong className="text-white">{stats.completedOrders}</strong></span>
            <span>🔄 قيد الإنتاج: <strong className="text-white">{stats.inProduction}</strong></span>
            <span>🆕 جديدة: <strong className="text-white">{stats.newOrders}</strong></span>
            {stats.delayedOrders > 0 && (
              <span>⚠️ متأخرة: <strong className="text-red-300">{stats.delayedOrders}</strong></span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
