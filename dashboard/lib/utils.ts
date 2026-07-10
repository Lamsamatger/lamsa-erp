import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const STAGE_PROGRESS: Record<string, number> = {
  'جديد': 5,
  'مراجعة': 10,
  'تجهيز': 20,
  'عند المشغل': 40,
  'مستلم من المشغل': 60,
  'عند المطرز': 75,
  'جاهز للتغليف': 90,
  'تم التنفيذ': 100,
  'ملغي': 0,
}

export const STATUS_COLORS: Record<string, string> = {
  'جديد': '#64748b',
  'مراجعة': '#0ea5e9',
  'تجهيز': '#3b82f6',
  'عند المشغل': '#f59e0b',
  'مستلم من المشغل': '#f97316',
  'عند المطرز': '#8b5cf6',
  'جاهز للتغليف': '#10b981',
  'تم التنفيذ': '#1a2d4a',
  'ملغي': '#ef4444',
}

export const STATUS_BG: Record<string, string> = {
  'جديد': 'bg-slate-100 text-slate-700',
  'مراجعة': 'bg-sky-100 text-sky-700',
  'تجهيز': 'bg-blue-100 text-blue-700',
  'عند المشغل': 'bg-amber-100 text-amber-700',
  'مستلم من المشغل': 'bg-orange-100 text-orange-700',
  'عند المطرز': 'bg-purple-100 text-purple-700',
  'جاهز للتغليف': 'bg-emerald-100 text-emerald-700',
  'تم التنفيذ': 'bg-slate-800 text-white',
  'ملغي': 'bg-red-100 text-red-700',
}

export function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('ar-SA', { calendar: 'gregory', ...opts })
}

export function daysBetween(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}
