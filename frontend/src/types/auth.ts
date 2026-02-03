export interface MaityUser {
  id: string
  auth_id: string
  name: string
  email: string | null
  status: string
  created_at: string | null
  updated_at: string
}
