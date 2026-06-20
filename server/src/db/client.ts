import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'
import * as schema from './schema.js'

// Neon serverless: pool nhỏ (tránh chạm giới hạn connection), TLS theo sslmode trong URL.
export const queryClient = postgres(env.DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 15,
})

export const db = drizzle(queryClient, { schema })
