'use client';

import { useEffect, useRef, useState } from 'react';
import type { JobStatus } from '@/lib/domain';

/**
 * Sigue el estado del job en vivo por Server-Sent Events.
 *
 * Es el adaptador local del puerto que en la nube ocupa Supabase Realtime. El cliente no hace
 * polling: se suscribe y recibe empujones. `EventSource` reconecta solo si la conexión se
 * cae, así que no hay lógica de reintento que escribir.
 *
 * `onStageChange` se dispara cuando el job cambia de etapa. Existe para que quien lo use
 * recargue los datos **desde el propio evento** en lugar de desde un efecto que observe el
 * estado derivado: reaccionar a un sistema externo en su callback es el patrón correcto, y
 * evita la cascada de renders de un `useEffect` que llama a `setState`.
 */
export function useJobStream(
  assetId: string,
  initial: JobStatus,
  onStageChange?: (state: JobStatus) => void,
): JobStatus {
  const [status, setStatus] = useState<JobStatus>(initial);

  // El callback se guarda en un ref para que cambiar su identidad entre renders no
  // reabra la conexión SSE. La escritura va en un efecto, nunca durante el render.
  const callbackRef = useRef(onStageChange);
  useEffect(() => {
    callbackRef.current = onStageChange;
  }, [onStageChange]);

  useEffect(() => {
    // La conexión se abre siempre, también con el job en reposo. Antes se omitía cuando ya
    // estaba «listo», porque el trabajo se encadenaba entero y no quedaba nada por emitir;
    // ahora las fases se piden a mano en cualquier momento, y sin conexión abierta la primera
    // que se lanzara no daría señal de vida hasta recargar la página.
    const source = new EventSource(`/api/media/${assetId}/events`);
    let lastState: JobStatus['state'] | null = null;

    source.onmessage = (event) => {
      let next: JobStatus;
      try {
        next = JSON.parse(event.data as string) as JobStatus;
      } catch {
        return; // Un mensaje mal formado no debe tumbar la suscripción.
      }

      setStatus(next);

      if (next.state !== lastState) {
        lastState = next.state;
        callbackRef.current?.(next);
      }
    };

    return () => source.close();
  }, [assetId]);

  return status;
}
