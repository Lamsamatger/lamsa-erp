import fs from 'fs'
import path from 'path'
import type { Order, Workshop, Embroiderer, WorkshopJob, EmbroideryJob, Product, DashboardStats, RecentOrderRow, Alert } from './types'
import { STAGE_PROGRESS, daysBetween } from './utils'

const DELAY_DAYS = 4

interface DbData {
  orders: Order[]
  workshops: Workshop[]
  embroiderers: Embroiderer[]
  workshop_jobs: WorkshopJob[]
  embroidery_jobs: EmbroideryJob[]
  products: Product[]
  materials: { id: string; cost: number }[]
}

function loadDb(): DbData {
  const dbPath = path.join(process.cwd(), '..', 'data', 'db.json')
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
  } catch {
    // Return empty data if file not found
    return { orders: [], workshops: [], embroiderers: [], workshop_jobs: [], embroidery_jobs: [], products: [], materials: [] }
  }
}

const STAGE_CHART_COLORS: Record<string, string> = {
  'جديد': '#94a3b8',
  'مراجعة': '#38bdf8',
  'تجهيز': '#60a5fa',
  'عند المشغل': '#fbbf24',
  'مستلم من المشغل': '#fb923c',
  'عند المطرز': '#a78bfa',
  'جاهز للتغليف': '#34d399',
  'تم التنفيذ': '#1a2d4a',
  'ملغي': '#f87171',
}

export function getDashboardStats(): DashboardStats {
  const db = loadDb()
  const { orders, workshops, embroiderers, workshop_jobs, embroidery_jobs, products } = db

  // ── KPI counts ──────────────────────────────────────────────
  const totalOrders = orders.length
  const newOrders = orders.filter(o => o.status === 'جديد').length
  const inProduction = orders.filter(o =>
    ['تجهيز','عند المشغل','مستلم من المشغل','عند المطرز'].includes(o.status)
  ).length
  const delayedOrders = orders.filter(o =>
    !['تم التنفيذ','ملغي'].includes(o.status) && daysBetween(o.created_at) > DELAY_DAYS
  ).length
  const readyToShip = orders.filter(o => o.status === 'جاهز للتغليف').length
  const completedOrders = orders.filter(o => o.status === 'تم التنفيذ').length
  const overallProgress = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0

  // ── Production by stage ──────────────────────────────────────
  const stageMap: Record<string, number> = {}
  orders.forEach(o => { stageMap[o.status] = (stageMap[o.status] || 0) + 1 })
  const allStages = ['جديد','مراجعة','تجهيز','عند المشغل','مستلم من المشغل','عند المطرز','جاهز للتغليف','تم التنفيذ','ملغي']
  const productionByStage = allStages
    .filter(s => stageMap[s])
    .map(s => ({ stage: s, count: stageMap[s] || 0, color: STAGE_CHART_COLORS[s] || '#94a3b8' }))

  // ── Daily production (last 7 days) ──────────────────────────
  const dailyProduction = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const day = d.toISOString().slice(0, 10)
    const label = d.toLocaleDateString('ar-SA', { weekday: 'short', month: 'short', day: 'numeric' })
    const completed = orders.filter(o => o.status === 'تم التنفيذ' && (o.updated_at || '').slice(0, 10) === day).length
    const newOrd = orders.filter(o => (o.created_at || '').slice(0, 10) === day).length
    return { date: label, completed, new: newOrd }
  })

  // ── Workshop performance ─────────────────────────────────────
  const workshopPerformance = workshops.map(w => {
    const jobs = workshop_jobs.filter(j => j.workshop_id === w.id)
    const delivered = jobs.reduce((s, j) => s + (j.delivered_qty || 0), 0)
    const received = jobs.reduce((s, j) => s + (j.received_qty || 0), 0)
    const pending = jobs.filter(j => j.status === 'عند المشغل').length
    return { name: w.name, delivered, received, pending }
  })

  // ── Embroiderer performance ──────────────────────────────────
  const embroidererPerformance = embroiderers.map(e => {
    const jobs = embroidery_jobs.filter(j => j.embroiderer_id === e.id)
    const done = jobs.reduce((s, j) => s + (j.done_qty || 0), 0)
    const errors = jobs.reduce((s, j) => s + (j.errors || 0), 0)
    return { name: e.name, done, errors }
  })

  // ── Recent orders (enriched) ─────────────────────────────────
  const productMap: Record<string, Product> = {}
  products.forEach(p => { productMap[p.id] = p })

  const recentOrders: RecentOrderRow[] = orders
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 12)
    .map(o => {
      const enrichedItems = o.items.map(it => ({
        ...it,
        image_url: productMap[it.product_id]?.image_url || '',
      }))
      const firstImg = enrichedItems.find(it => it.image_url)?.image_url || ''
      const totalPieces = o.items.reduce((s, it) => s + it.qty, 0)
      const avgProgress = o.items.length > 0
        ? Math.round(o.items.reduce((s, it) => s + (STAGE_PROGRESS[it.stage] ?? 0), 0) / o.items.length)
        : STAGE_PROGRESS[o.status] ?? 0
      return {
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        city: o.city,
        created_at: o.created_at,
        items: enrichedItems,
        total_pieces: totalPieces,
        progress: avgProgress,
        image_url: firstImg,
      }
    })

  // ── Alerts ───────────────────────────────────────────────────
  const alerts: Alert[] = []

  orders
    .filter(o => !['تم التنفيذ','ملغي'].includes(o.status) && daysBetween(o.created_at) > DELAY_DAYS)
    .slice(0, 3)
    .forEach(o => {
      alerts.push({
        id: 'delay-' + o.id,
        type: 'delayed',
        title: 'طلب متأخر',
        description: `${o.order_number} — ${daysBetween(o.created_at)} يوم في مرحلة ${o.status}`,
        severity: daysBetween(o.created_at) > 7 ? 'high' : 'medium',
      })
    })

  const errJobs = embroidery_jobs.filter(j => j.errors > 0)
  if (errJobs.length > 0) {
    const totalErr = errJobs.reduce((s, j) => s + j.errors, 0)
    alerts.push({
      id: 'emb-errors',
      type: 'error',
      title: 'أخطاء في التطريز',
      description: `${totalErr} قطعة بها أخطاء تحتاج مراجعة`,
      severity: 'high',
    })
  }

  orders.filter(o => o.status === 'مراجعة').forEach(o => {
    alerts.push({
      id: 'review-' + o.id,
      type: 'quality',
      title: 'مراجعة جودة مطلوبة',
      description: `${o.order_number} — ${o.notes || 'يحتاج مراجعة قبل التنفيذ'}`,
      severity: 'medium',
    })
  })

  if (db.materials.length === 0) {
    alerts.push({ id: 'no-materials', type: 'stock', title: 'لا يوجد سجل مواد خام', description: 'أضف المواد الخام في قسم الحسابات', severity: 'low' })
  }

  return {
    totalOrders, newOrders, inProduction, delayedOrders, readyToShip, completedOrders,
    overallProgress, productionByStage, dailyProduction, workshopPerformance,
    embroidererPerformance, recentOrders, alerts,
  }
}
