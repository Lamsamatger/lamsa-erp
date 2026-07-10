'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { BarChart2 } from 'lucide-react'

interface Props {
  data: { stage: string; count: number; color: string }[]
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { value: number; payload: { stage: string } }[] }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-lg text-sm">
      <p className="font-semibold text-navy mb-0.5">{payload[0].payload.stage}</p>
      <p className="text-slate-600">{payload[0].value} <span className="text-slate-400">طلب</span></p>
    </div>
  )
}

export default function ProductionStagesChart({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart2 size={18} className="text-gold" />
          <CardTitle className="text-base">توزيع الطلبات حسب المرحلة</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-slate-400 text-sm">لا توجد بيانات بعد</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis
                dataKey="stage"
                type="category"
                width={148}
                tick={{ fontSize: 11, fill: '#475569', fontFamily: 'Tajawal, sans-serif' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={28}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
                <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
