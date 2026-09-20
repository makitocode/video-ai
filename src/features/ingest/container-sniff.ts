/**
 * Identificación de contenedor por firma binaria (*magic bytes*).
 *
 * Se ejecuta antes de tocar la red o gastar CPU, por dos motivos:
 *
 * 1. **Seguridad**: la extensión del archivo y el `Content-Type` los controla el cliente,
 *    así que no son evidencia de nada. Los primeros bytes sí.
 * 2. **Coste**: descartar un archivo que no es video cuesta microsegundos aquí, frente a
 *    minutos de decodificación o una llamada de pago al proveedor de ASR.
 *
 * Es deliberadamente una función pura sobre bytes, sin dependencias del navegador, para
 * poder testearla en Node. La identificación *autoritativa* la hace Mediabunny después
 * (ver `probe.ts`); esto es sólo el filtro barato de entrada.
 */

export const CONTAINER_KINDS = [
  'mp4', // también MOV, M4V, 3GP — todos comparten la caja `ftyp`
  'matroska', // MKV y WebM comparten cabecera EBML
  'avi',
  'mpeg-ts',
  'flv',
  'ogg',
  'wav',
  'mp3',
  'unknown',
] as const;

export type ContainerKind = (typeof CONTAINER_KINDS)[number];

/** Byte en `offset`, o `-1` si está fuera del buffer. Evita `undefined` con `noUncheckedIndexedAccess`. */
function byteAt(bytes: Uint8Array, offset: number): number {
  return offset >= 0 && offset < bytes.length ? (bytes[offset] ?? -1) : -1;
}

/** Lee `length` bytes desde `offset` como ASCII. Devuelve `''` si no caben. */
function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return '';

  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(bytes[offset + i] ?? 0);
  }
  return out;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((expected, i) => byteAt(bytes, i) === expected);
}

/** Cabecera EBML: MKV y WebM. */
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3] as const;

/**
 * MPEG-TS no tiene una firma en el offset 0: se reconoce porque el byte de sincronía
 * `0x47` se repite cada 188 bytes. Comprobamos tres paquetes para no dar falsos positivos
 * con cualquier archivo que empiece por `0x47`.
 */
const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;
const TS_PACKETS_TO_VERIFY = 3;

function looksLikeMpegTs(bytes: Uint8Array): boolean {
  for (let i = 0; i < TS_PACKETS_TO_VERIFY; i++) {
    if (byteAt(bytes, i * TS_PACKET_SIZE) !== TS_SYNC_BYTE) return false;
  }
  return true;
}

/**
 * MP3 sin etiqueta ID3 empieza directamente por una cabecera de trama: 11 bits a 1.
 * Es la firma más débil de todas (once bits coinciden por casualidad con facilidad),
 * por eso se comprueba la última.
 */
function looksLikeMp3Frame(bytes: Uint8Array): boolean {
  return byteAt(bytes, 0) === 0xff && (byteAt(bytes, 1) & 0xe0) === 0xe0;
}

/**
 * Identifica el contenedor a partir de la cabecera del archivo.
 *
 * @param header Los primeros bytes del archivo (ver `CONTAINER_SNIFF_BYTES`). Con menos de
 *   377 bytes no se puede confirmar MPEG-TS, que necesita tres paquetes.
 */
export function sniffContainer(header: Uint8Array): ContainerKind {
  // La caja `ftyp` aparece en el offset 4: primero va su tamaño (4 bytes).
  if (asciiAt(header, 4, 4) === 'ftyp') return 'mp4';

  if (startsWith(header, EBML_SIGNATURE)) return 'matroska';

  // RIFF es un contenedor genérico; el subtipo del offset 8 dice de cuál se trata.
  if (asciiAt(header, 0, 4) === 'RIFF') {
    const subtype = asciiAt(header, 8, 4);
    if (subtype === 'AVI ') return 'avi';
    if (subtype === 'WAVE') return 'wav';
    return 'unknown';
  }

  if (asciiAt(header, 0, 4) === 'OggS') return 'ogg';
  if (asciiAt(header, 0, 3) === 'FLV' && byteAt(header, 3) === 0x01) return 'flv';
  if (looksLikeMpegTs(header)) return 'mpeg-ts';
  if (asciiAt(header, 0, 3) === 'ID3') return 'mp3';
  if (looksLikeMp3Frame(header)) return 'mp3';

  return 'unknown';
}

/** Contenedores que pueden transportar video. El resto son audio puro. */
const VIDEO_CAPABLE: ReadonlySet<ContainerKind> = new Set<ContainerKind>([
  'mp4',
  'matroska',
  'avi',
  'mpeg-ts',
  'flv',
]);

export function isVideoCapableContainer(kind: ContainerKind): boolean {
  return VIDEO_CAPABLE.has(kind);
}

/**
 * Un contenedor de audio puro también sirve: el pipeline necesita audio, no imagen.
 * Sólo `unknown` se rechaza de entrada.
 */
export function isAcceptedContainer(kind: ContainerKind): boolean {
  return kind !== 'unknown';
}
