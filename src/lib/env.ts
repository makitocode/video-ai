import { z } from 'zod';

/**
 * Validación de variables de entorno en el arranque.
 *
 * Falla ruidosamente y temprano si falta configuración, en vez de producir un `undefined`
 * que reviente tres capas más abajo con un mensaje incomprensible.
 *
 * Sólo las variables `NEXT_PUBLIC_*` llegan al navegador. Las claves de proveedores (ASR, LLM)
 * viven exclusivamente en Edge Functions y **nunca** aparecen en este archivo.
 * Ver doc/08-seguridad.md § T3.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: 'NEXT_PUBLIC_SUPABASE_URL debe ser una URL válida' }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, { error: 'Falta NEXT_PUBLIC_SUPABASE_ANON_KEY' }),
});

/**
 * Next.js sustituye `process.env.NEXT_PUBLIC_*` en tiempo de compilación sólo cuando se
 * accede de forma literal, así que hay que enumerarlas — un `process.env` dinámico queda
 * vacío en el bundle del cliente.
 */
export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
