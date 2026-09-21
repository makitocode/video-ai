import { NextResponse } from 'next/server';
import { z } from 'zod';
import { renameSpeaker } from '@/server/repositories';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const RenameSchema = z.object({
  // Cadena vacía significa "quitar el nombre" y volver a la etiqueta del proveedor.
  displayName: z.string().max(120).nullable(),
});

/**
 * Renombra un hablante.
 *
 * Actualiza UNA fila; el transcript, el resumen y la línea de tiempo resuelven el nombre por
 * join. Por eso renombrar a alguien en una grabación de dos horas es instantáneo y no toca
 * los miles de segmentos.
 */
export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const parsed = RenameSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: 'Nombre inválido.' }, { status: 400 });
  }

  const trimmed = parsed.data.displayName?.trim() ?? null;
  const updated = renameSpeaker(id, trimmed === null || trimmed === '' ? null : trimmed);

  if (!updated) {
    return NextResponse.json({ error: 'No existe ese hablante.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
