import { getDashboardStats } from '@/lib/db'
import Header from '@/components/dashboard/Header'
import StatsGrid from '@/components/dashboard/StatsGrid'
import ProductionStagesChart from '@/components/dashboard/ProductionStagesChart'
import DailyProductionChart from '@/components/dashboard/DailyProductionChart'
import WorkshopChart from '@/components/dashboard/WorkshopChart'
import EmbroidererChart from '@/components/dashboard/EmbroidererChart'
import RecentOrdersTable from '@/components/dashboard/RecentOrdersTable'
import AlertsPanel from '@/components/dashboard/AlertsPanel'
import QuickActions from '@/components/dashboard/QuickActions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function DashboardPage() {
  const stats = getDashboardStats()

  return (
    <div className="min-h-screen bg-slate-100">
      <Header />

      <main className="mx-auto max-w-[1600px] px-4 sm:px-6 py-6 space-y-6">

        {/* ── KPI Stats ── */}
        <StatsGrid stats={stats} />

        {/* ── Charts row 1 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ProductionStagesChart data={stats.productionByStage} />
          <DailyProductionChart data={stats.dailyProduction} />
        </div>

        {/* ── Charts row 2 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <WorkshopChart data={stats.workshopPerformance} />
          <EmbroidererChart data={stats.embroidererPerformance} />
        </div>

        {/* ── Recent Orders Table ── */}
        <RecentOrdersTable orders={stats.recentOrders} />

        {/* ── Alerts + Quick Actions ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
          <AlertsPanel alerts={stats.alerts} />
          <QuickActions />
        </div>

      </main>
    </div>
  )
}
