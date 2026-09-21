import type { TranscribeInput, TranscriptionProvider, TranscriptionResult } from './types';

/**
 * Proveedor de transcripción simulado.
 *
 * Existe para que la aplicación funcione de extremo a extremo **sin ninguna clave ni cuenta**:
 * se puede probar la subida, la sincronía del transcript, el renombrado de hablantes y las
 * citas del resumen sin gastar un céntimo.
 *
 * No transcribe nada: genera una conversación sintética estirada a la duración real del audio,
 * con turnos e interrupciones plausibles para que la interfaz reciba datos con la misma forma
 * que los reales. La interfaz deja claro en todo momento que el contenido es simulado.
 */

const SPEAKER_LABELS = ['Speaker A', 'Speaker B', 'Speaker C'] as const;

/**
 * Guion de referencia: turnos cortos y largos alternados, como una reunión de verdad.
 *
 * La primera línea avisa de que el contenido es simulado, y va dentro del propio transcript a
 * propósito: la interfaz también lo advierte, pero el texto se exporta y se copia fuera de la
 * aplicación, donde ese aviso ya no acompaña. Un contenido que parece real y no se identifica
 * como falso hace perder el tiempo a quien lo lee.
 */
const SCRIPT: Array<{ speaker: number; text: string }> = [
  {
    speaker: 0,
    text:
      '⚠ TRANSCRIPCIÓN SIMULADA — este texto NO proviene de tu audio. Es una conversación de ' +
      'ejemplo, generada porque no hay ninguna clave de transcripción configurada. Define ' +
      'ASSEMBLYAI_API_KEY para transcribir de verdad.',
  },
  {
    speaker: 0,
    text: 'Buenos días. Vamos a revisar cómo cerramos el trimestre y qué queda pendiente para el siguiente.',
  },
  {
    speaker: 1,
    text: 'Antes de entrar en números, ¿podemos confirmar el presupuesto de marketing? Sigue bloqueado.',
  },
  { speaker: 0, text: 'Sí, lo tengo anotado. Lo vemos en cuanto terminemos con los ingresos.' },
  {
    speaker: 2,
    text: 'Yo traigo los datos de retención. Han mejorado, pero no tanto como esperábamos.',
  },
  { speaker: 0, text: 'Empecemos por ahí entonces. ¿Qué cifra tenemos?' },
  {
    speaker: 2,
    text: 'Subimos del sesenta y dos al sesenta y ocho por ciento. La mayor parte viene del cambio en el onboarding.',
  },
  { speaker: 1, text: 'Eso son seis puntos. No está mal para un trimestre.' },
  {
    speaker: 2,
    text: 'El problema es que el efecto se concentra en las cuentas grandes. En las pequeñas casi no se mueve.',
  },
  {
    speaker: 0,
    text: 'Entonces la pregunta es si el onboarding actual sirve para el segmento pequeño o hay que rehacerlo.',
  },
  {
    speaker: 1,
    text: 'Rehacerlo entero me parece caro. Yo probaría primero con una versión reducida.',
  },
  { speaker: 2, text: 'Estoy de acuerdo. Podemos montar un experimento en dos semanas y medir.' },
  {
    speaker: 0,
    text: 'Vale, decidido: experimento reducido para cuentas pequeñas, con medición a las dos semanas.',
  },
  { speaker: 0, text: 'Ahora sí, el presupuesto de marketing. ¿En qué punto está?' },
  {
    speaker: 1,
    text: 'Pedimos un aumento del quince por ciento y sigue sin aprobarse. Lleva tres semanas parado.',
  },
  { speaker: 0, text: 'Eso es culpa mía, no lo he movido. Me encargo esta semana.' },
  { speaker: 2, text: 'Si no se aprueba antes de fin de mes, la campaña de lanzamiento no llega.' },
  {
    speaker: 1,
    text: 'Exacto. Y si no llega la campaña, el objetivo del trimestre siguiente no se sostiene.',
  },
  { speaker: 0, text: 'Entendido. Lo trato como bloqueante y os confirmo el viernes.' },
  {
    speaker: 2,
    text: 'Una cosa más: el contrato con el proveedor de datos vence en cuarenta días.',
  },
  { speaker: 0, text: '¿Renovamos o buscamos alternativa?' },
  {
    speaker: 2,
    text: 'Merece la pena mirar alternativas. El precio ha subido dos veces este año.',
  },
  { speaker: 1, text: 'Yo puedo preparar una comparativa para la semana que viene.' },
  {
    speaker: 0,
    text: 'Perfecto. Con eso cerramos. Resumo: experimento de onboarding, desbloquear presupuesto y comparativa de proveedores.',
  },
];

/** Palabras por segundo de habla natural. Sirve para repartir el guion por la duración real. */
const WORDS_PER_SECOND = 2.6;
const PAUSE_MS = 400;

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'mock';

  async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
    const segments: TranscriptionResult['segments'] = [];
    const speakingMs = new Map<string, number>();

    let cursorMs = 500;
    let scriptIndex = 0;

    // Se repite el guion las veces que haga falta para cubrir la duración del audio:
    // así un video de 5 minutos y otro de 2 horas producen transcripts igual de plausibles.
    while (cursorMs < input.durationMs && segments.length < 2000) {
      const line = SCRIPT[scriptIndex % SCRIPT.length];
      if (line === undefined) break;
      scriptIndex++;

      const wordCount = line.text.split(/\s+/).filter(Boolean).length;
      const spokenMs = Math.round((wordCount / WORDS_PER_SECOND) * 1000);
      const endMs = Math.min(cursorMs + spokenMs, input.durationMs);
      if (endMs <= cursorMs) break;

      const label = SPEAKER_LABELS[line.speaker] ?? SPEAKER_LABELS[0];
      segments.push({
        startMs: cursorMs,
        endMs,
        speakerLabel: label,
        text: line.text,
        confidence: 0.94,
      });

      speakingMs.set(label, (speakingMs.get(label) ?? 0) + (endMs - cursorMs));
      cursorMs = endMs + PAUSE_MS;

      input.onProgress?.(Math.min(cursorMs / input.durationMs, 0.99));
    }

    return {
      languageCode: 'es',
      languageConfidence: 0.99,
      modelVersion: 'mock-1',
      speakers: [...speakingMs.entries()].map(([label, totalSpeakingMs]) => ({
        label,
        totalSpeakingMs,
      })),
      segments,
    };
  }
}
