export interface OrderItem {
  id: string
  product_id: string
  product_name: string
  size: string
  color: string
  embroidery_name: string
  notes: string
  qty: number
  barcode: string
  stage: string
  image_url?: string
}

export interface Order {
  id: string
  order_number: string
  customer_name: string
  customer_phone: string
  city: string
  status: string
  assigned_employee: string
  items: OrderItem[]
  notes: string
  shipment_number: string
  salla_order_id?: string
  created_at: string
  updated_at: string
}

export interface Workshop {
  id: string
  name: string
  phone: string
  price_per_piece: number
  status: string
}

export interface Embroiderer {
  id: string
  name: string
  price_per_piece: number
}

export interface WorkshopJob {
  id: string
  order_id: string
  workshop_id: string
  delivered_qty: number
  received_qty: number
  delivered_at: string | null
  received_at: string | null
  status: string
}

export interface EmbroideryJob {
  id: string
  order_id: string
  embroiderer_id: string
  received_qty: number
  done_qty: number
  errors: number
  notes: string
}

export interface Product {
  id: string
  name: string
  category: string
  image_url: string
  sizes: string[]
  colors: string[]
  embroidery: boolean
}

export interface DashboardStats {
  totalOrders: number
  newOrders: number
  inProduction: number
  delayedOrders: number
  readyToShip: number
  completedOrders: number
  overallProgress: number
  productionByStage: { stage: string; count: number; color: string }[]
  dailyProduction: { date: string; completed: number; new: number }[]
  workshopPerformance: { name: string; delivered: number; received: number; pending: number }[]
  embroidererPerformance: { name: string; done: number; errors: number }[]
  recentOrders: RecentOrderRow[]
  alerts: Alert[]
}

export interface RecentOrderRow {
  id: string
  order_number: string
  status: string
  city: string
  created_at: string
  items: OrderItem[]
  total_pieces: number
  progress: number
  image_url: string
}

export interface Alert {
  id: string
  type: 'delayed' | 'error' | 'stock' | 'quality'
  title: string
  description: string
  severity: 'high' | 'medium' | 'low'
}
