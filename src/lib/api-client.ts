import axios from 'axios'

/**
 * Axios dùng chung cho backend DERP. Dev: Vite proxy `/api` -> :8787.
 * Prod: same-origin (Caddy/backend cùng host). `withCredentials` để gửi cookie session.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  withCredentials: true,
  timeout: 15000,
})

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api') as string
