import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createMediaAsset, listMediaAssets } from '@/server/repositories';

export const dynamic = 'force-dynamic';

const CreateAssetSchema = z.object({
  originalFilename: z.string().min(1).max(500),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive().nullable(),
  container: z.string().max(50).nullable(),
  ingestRoute: z.enum(['fast', 'escape']),
});

export function GET() {
  return NextResponse.json({ assets: listMediaAssets() });
}

export async function POST(request: Request) {
  const parsed = CreateAssetSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos de creación inválidos.', detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const assetId = createMediaAsset(parsed.data);
  return NextResponse.json({ id: assetId }, { status: 201 });
}
