/** Formateo de valores para la interfaz. Funciones puras, sin dependencias. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Formatea un número de bytes de forma legible: `1536` → `"1.5 KB"`. */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const unit = BYTE_UNITS[exponent] ?? 'B';
  const value = bytes / 1024 ** exponent;

  // Los bytes enteros no necesitan decimales.
  return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${unit}`;
}

/**
 * Formatea una duración como marca de tiempo de reproducción: `92.5` → `"01:32"`.
 * Incluye la hora sólo cuando existe, para no ensuciar contenido corto.
 */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/** Formatea una duración en lenguaje compacto: `3725` → `"1 h 2 min"`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}

/**
 * Cuántas veces más rápido que el tiempo real se procesó un medio.
 * Es la métrica que decide si la extracción en cliente es viable (ver doc/10, Fase 1).
 */
export function formatRealtimeFactor(mediaSeconds: number, elapsedSeconds: number): string {
  if (elapsedSeconds <= 0 || mediaSeconds <= 0) return '—';
  return `${(mediaSeconds / elapsedSeconds).toFixed(1)}× tiempo real`;
}
