import { NextResponse } from 'next/server';
import { describeProviders } from '@/server/config';

/** Estado de configuración, para que la interfaz pueda avisar si hay proveedores simulados. */
export function GET() {
  return NextResponse.json(describeProviders());
}
