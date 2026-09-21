import { NextResponse } from 'next/server';
import { deleteMediaAsset, getMediaAssetDetail } from '@/server/repositories';
import { deleteAssetFiles } from '@/server/storage';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const asset = getMediaAssetDetail(id);

  if (asset === null) {
    return NextResponse.json({ error: 'No existe ese análisis.' }, { status: 404 });
  }
  return NextResponse.json(asset);
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;

  // Primero los archivos, después la fila: si falla el borrado en disco, el registro
  // sigue existiendo y se puede reintentar, en vez de dejar archivos huérfanos.
  await deleteAssetFiles(id);
  deleteMediaAsset(id);

  return new NextResponse(null, { status: 204 });
}
