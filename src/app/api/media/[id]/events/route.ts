import { getMediaAsset } from '@/server/repositories';
import { subscribeJobStatus } from '@/server/events';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Cada 25 s para que proxies e intermediarios no corten la conexión por inactividad. */
const HEARTBEAT_MS = 25_000;

/**
 * Progreso del job en vivo por Server-Sent Events.
 *
 * Es el adaptador local del puerto que en la nube ocupa Supabase Realtime: el cliente se
 * suscribe y recibe empujones, nunca hace polling. Se eligió SSE sobre WebSocket porque el
 * flujo es unidireccional y SSE reconecta solo.
 */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const asset = getMediaAsset(id);

  if (asset === null) {
    return new Response('No existe ese análisis.', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // El estado actual va primero: si el job terminó antes de que el cliente se
      // suscribiera, sin esto se quedaría esperando un evento que ya no llegará.
      send(asset.job);

      const unsubscribe = subscribeJobStatus(id, send);
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // La conexión ya estaba cerrada por el cliente.
        }
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
