import type { JobStatus } from '@/lib/domain';

/**
 * Bus de eventos de progreso.
 *
 * Es el adaptador local del puerto que en la nube ocupa Supabase Realtime: el job runner
 * publica cambios de estado y las rutas SSE los reenvían al navegador. El cliente nunca
 * hace polling, igual que con Realtime.
 *
 * Vive en `globalThis` porque Next.js recarga módulos en desarrollo y un bus nuevo por
 * recarga dejaría a los suscriptores existentes escuchando a un objeto huérfano.
 */

type Listener = (status: JobStatus) => void;

type Bus = {
  listeners: Map<string, Set<Listener>>;
};

function getBus(): Bus {
  const globalRef = globalThis as typeof globalThis & { __videoAiBus?: Bus };
  globalRef.__videoAiBus ??= { listeners: new Map() };
  return globalRef.__videoAiBus;
}

export function publishJobStatus(assetId: string, status: JobStatus): void {
  const listeners = getBus().listeners.get(assetId);
  if (listeners === undefined) return;

  for (const listener of listeners) {
    // Un suscriptor que falla (por ejemplo, una conexión SSE ya cerrada) no debe
    // impedir que los demás reciban el evento.
    try {
      listener(status);
    } catch {
      // Ignorado a propósito: el cierre de la conexión ya lo gestiona su propio handler.
    }
  }
}

export function subscribeJobStatus(assetId: string, listener: Listener): () => void {
  const bus = getBus();
  const listeners = bus.listeners.get(assetId) ?? new Set<Listener>();
  listeners.add(listener);
  bus.listeners.set(assetId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) bus.listeners.delete(assetId);
  };
}
