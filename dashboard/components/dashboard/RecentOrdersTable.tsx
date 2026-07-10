'use client'
import Image from 'next/image'
import { QrCode, ExternalLink } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { STATUS_BG, STATUS_COLORS, formatDate } from '@/lib/utils'
import type { RecentOrderRow } from '@/lib/types'

const ERP_BASE = process.env.NEXT_PUBLIC_ERP_URL ?? ''

const STAGE_PROGRESS: Record<string, number> = {
  'جديد': 5, 'مراجعة': 10, 'تجهيز': 20,
  'عند المشغل': 40, 'مستلم من المشغل': 60,
  'عند المطرز': 75, 'جاهز للتغليف': 90,
  'تم التنفيذ': 100, 'ملغي': 0,
}

function ProgressBar({ value, status }: { value: number; status: string }) {
  const color =
    status === 'تم التنفيذ' ? 'bg-[#1a2d4a]' :
    status === 'جاهز للتغليف' ? 'bg-emerald-500' :
    status === 'ملغي' ? 'bg-red-400' :
    'bg-[#c9a24b]'
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <Progress value={value} className="h-1.5 flex-1" indicatorClassName={color} />
      <span className="text-[10px] font-semibold text-slate-500 w-7 text-left">{value}%</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BG[status] || 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${cls}`}>
      {status}
    </span>
  )
}

export default function RecentOrdersTable({ orders }: { orders: RecentOrderRow[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            📦 آخر الطلبات
          </CardTitle>
          <a href="/orders" className="flex items-center gap-1 text-xs text-gold hover:text-gold-600 font-medium">
            عرض الكل <ExternalLink size={12} />
          </a>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">#</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">رقم الطلب</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">المنتج</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">SKU</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">المقاس</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">اللون</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">الكمية</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">القطع</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">مرحلة الإنتاج</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">الحالة</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap min-w-[140px]">التقدم</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">QR</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-12 text-center text-slate-400 text-sm">لا توجد طلبات بعد</td>
                </tr>
              )}
              {orders.map((o, idx) => {
                const firstItem = o.items[0]
                const firstStage = firstItem?.stage || o.status
                const rowProgress = o.progress
                const isLate = o.status !== 'تم التنفيذ' && o.status !== 'ملغي' &&
                  (Date.now() - new Date(o.created_at).getTime()) > 4 * 86_400_000
                return (
                  <tr
                    key={o.id}
                    className={`border-b border-slate-50 hover:bg-slate-50/80 transition-colors ${isLate ? 'bg-red-50/40' : ''}`}
                  >
                    {/* Row number */}
                    <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>

                    {/* Order number */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {isLate && <span className="text-red-500 text-xs" title="متأخر">⚠️</span>}
                        <a href={`/orders/${o.id}`} className="font-mono font-bold text-navy text-xs hover:text-gold transition-colors">
                          {o.order_number}
                        </a>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{formatDate(o.created_at)}</div>
                    </td>

                    {/* Product image + name */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-slate-100 border border-slate-200">
                          {o.image_url ? (
                            <Image
                              src={o.image_url}
                              alt={firstItem?.product_name || ''}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-base">👗</div>
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-navy text-xs leading-tight max-w-[120px] truncate">
                            {firstItem?.product_name || '—'}
                          </div>
                          {o.items.length > 1 && (
                            <div className="text-[10px] text-slate-400">+{o.items.length - 1} قطع أخرى</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* SKU / Barcode */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <code className="text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                        {firstItem?.barcode || '—'}
                      </code>
                    </td>

                    {/* Size */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {firstItem?.size ? (
                        <span className="text-xs bg-slate-100 text-slate-600 rounded px-2 py-0.5 font-medium">
                          {firstItem.size}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>

                    {/* Color */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                      {firstItem?.color || <span className="text-slate-300">—</span>}
                    </td>

                    {/* Qty */}
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className="text-xs font-bold text-navy">{firstItem?.qty ?? '—'}</span>
                    </td>

                    {/* Total pieces */}
                    <td className="px-4 py-3 whitespace-nowrap text-center">
                      <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-navy/10 text-[10px] font-bold text-navy px-1.5">
                        {o.total_pieces}
                      </span>
                    </td>

                    {/* Production stage */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: STATUS_COLORS[firstStage] || '#94a3b8' }}
                        />
                        <span className="text-xs text-slate-600">{firstStage}</span>
                      </div>
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={o.status} />
                    </td>

                    {/* Progress bar */}
                    <td className="px-4 py-3">
                      <ProgressBar value={rowProgress} status={o.status} />
                    </td>

                    {/* QR */}
                    <td className="px-4 py-3">
                      <a
                        href={`/barcode/item/${encodeURIComponent(firstItem?.barcode || '')}`}
                        className="flex items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-slate-400 hover:border-gold hover:text-gold transition-colors"
                        title="مسح QR / فتح تفاصيل"
                      >
                        <QrCode size={14} />
                      </a>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3">
                      <a
                        href={`/orders/${o.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:border-gold hover:text-gold transition-colors whitespace-nowrap"
                      >
                        فتح <ExternalLink size={10} />
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
