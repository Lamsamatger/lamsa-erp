'use client'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { TrendingUp } from 'lucide-react'

interface Props {
  data: { date: string; completed: number; new: number }[]
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-lg text-sm min-w-[140px]">
      <p className="font-semibold text-navy mb-1 text-xs">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-600">{p.name}:</span>
          <span className="font-bold text-navy">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function DailyProductionChart({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-gold" />
          <CardTitle className="text-base">الإنتاج اليومي — آخر 7 أيام</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.every(d => d.completed === 0 && d.new === 0) ? (
          <div className="flex h-48 items-center justify-center text-slate-400 text-sm">لا توجد بيانات كافية بعد</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1a2d4a" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#1a2d4a" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradNew" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c9a24b" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#c9a24b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8', fontFamily: 'Tajawal' }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(v) => v === 'completed' ? 'مكتمل' : 'جديد'}
                wrapperStyle={{ fontSize: 11, fontFamily: 'Tajawal' }}
              />
              <Area type="monotone" dataKey="completed" name="completed" stroke="#1a2d4a" strokeWidth={2} fill="url(#gradCompleted)" dot={{ r: 4, fill: '#1a2d4a' }} activeDot={{ r: 6 }} />
              <Area type="monotone" dataKey="new" name="new" stroke="#c9a24b" strokeWidth={2} fill="url(#gradNew)" dot={{ r: 4, fill: '#c9a24b' }} activeDot={{ r: 6 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
