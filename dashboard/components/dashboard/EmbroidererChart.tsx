'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Sparkles } from 'lucide-react'

interface Props {
  data: { name: string; done: number; errors: number }[]
}

const Tip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-xs min-w-[140px]">
      <p className="font-bold text-navy mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name === 'done' ? 'منجز' : 'أخطاء'}:</span>
          <span className="font-semibold text-navy">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function EmbroidererChart({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-gold" />
          <CardTitle className="text-base">أداء المطرزين</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-slate-400 text-sm">لا توجد بيانات تطريز</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569', fontFamily: 'Tajawal' }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <Tooltip content={<Tip />} cursor={{ fill: '#f8fafc' }} />
              <Legend formatter={(v) => v === 'done' ? 'منجز' : 'أخطاء'} wrapperStyle={{ fontSize: 11, fontFamily: 'Tajawal' }} />
              <Bar dataKey="done" name="done" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={44} />
              <Bar dataKey="errors" name="errors" fill="#fca5a5" radius={[4, 4, 0, 0]} maxBarSize={44}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.errors > 0 ? '#ef4444' : '#fca5a5'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
