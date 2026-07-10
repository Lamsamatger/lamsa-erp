'use client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Factory } from 'lucide-react'

interface Props {
  data: { name: string; delivered: number; received: number; pending: number }[]
}

const Tip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  const labels: Record<string, string> = { delivered: 'مُسلَّم', received: 'مُستلَم', pending: 'قيد التنفيذ' }
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-xs min-w-[150px]">
      <p className="font-bold text-navy mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-slate-500">{labels[p.name] || p.name}:</span>
          <span className="font-semibold text-navy">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function WorkshopChart({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Factory size={18} className="text-gold" />
          <CardTitle className="text-base">أداء المشاغل</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-slate-400 text-sm">لا توجد مشاغل مسجلة</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569', fontFamily: 'Tajawal' }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip content={<Tip />} cursor={{ fill: '#f8fafc' }} />
              <Legend formatter={(v: string) => ({ delivered: 'مُسلَّم', received: 'مُستلَم', pending: 'معلق' } as Record<string,string>)[v] ?? v} wrapperStyle={{ fontSize: 11, fontFamily: 'Tajawal' }} />
              <Bar dataKey="delivered" name="delivered" fill="#1a2d4a" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="received" name="received" fill="#c9a24b" radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="pending" name="pending" fill="#93c5fd" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
