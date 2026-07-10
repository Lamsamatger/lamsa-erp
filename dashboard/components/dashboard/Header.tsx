import { BarChart3, ExternalLink, Factory, RefreshCw } from 'lucide-react'

const ERP_BASE = process.env.NEXT_PUBLIC_ERP_URL || 'http://localhost:5001'

export default function Header() {
  const now = new Date().toLocaleDateString('ar-SA', {
    calendar: 'gregory', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <header className="sticky top-0 z-50 bg-[#1a2d4a] text-white shadow-lg">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <div className="flex h-14 items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/20 text-gold">
              <Factory size={18} />
            </div>
            <div className="hidden sm:block">
              <span className="font-black text-base leading-none">لمسة أزيائي</span>
              <span className="block text-[10px] text-white/50 leading-none mt-0.5">نظام إدارة الإنتاج</span>
            </div>
          </div>

          {/* Center: title */}
          <div className="flex items-center gap-2 text-white/80">
            <BarChart3 size={16} className="text-gold" />
            <span className="font-semibold text-sm hidden md:block">لوحة متابعة الإنتاج</span>
          </div>

          {/* Right */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden lg:block text-xs text-white/50">{now}</span>
            <a
              href="/"
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors"
            >
              <RefreshCw size={12} />
              <span>تحديث</span>
            </a>
            <a
              href={ERP_BASE}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-white hover:bg-gold-600 transition-colors"
            >
              <span>فتح النظام</span>
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </div>
    </header>
  )
}
