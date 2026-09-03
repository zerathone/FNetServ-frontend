import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export function AdminRoute() {
  const isAdmin = useAuthStore((state) => state.isAdmin)
  return isAdmin ? <Outlet /> : <Navigate to="/workstations" replace />
}
