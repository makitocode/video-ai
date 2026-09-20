import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/lib/env';

/**
 * Cliente de Supabase para el navegador.
 *
 * La clave anónima es pública por diseño: la autorización la aplica RLS dentro de
 * Postgres y de Storage, no el cliente. Ver doc/08-seguridad.md.
 */
export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
