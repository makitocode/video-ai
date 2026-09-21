import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTemplate } from './render';

/**
 * Catálogo de prompts: el único sitio donde se declara qué prompts existen.
 *
 * Los textos viven en `content/*.md`, fuera de TypeScript. No es cosmética:
 *
 * - **Se leen como se envían.** Un prompt entre comillas y concatenaciones se lee peor que el
 *   texto plano, y lo que se revisa en un cambio de prompt es exactamente su redacción.
 * - **El diff es del texto.** Cambiar una instrucción produce un diff de una línea de prosa,
 *   no de una plantilla escapada.
 * - **Se pueden editar sin tocar código**, y en desarrollo sin reiniciar el servidor.
 * - **Se versionan.** Cada prompt lleva su versión y esa versión se guarda junto al resultado
 *   que produjo, que es lo que permite comparar dos redacciones sobre la misma grabación en
 *   vez de opinar sobre cuál iba mejor.
 *
 * Lo que este catálogo aporta sobre «leer un archivo» es el contrato: qué variables admite
 * cada prompt, comprobado por el compilador, y un fallo inmediato si se pasa una de más o
 * falta una. Un prompt mal montado no falla, sólo responde peor.
 */

const CONTENT_DIR = join(process.cwd(), 'src', 'server', 'prompts', 'content');

/**
 * En producción se lee una vez; en desarrollo, en cada llamada.
 *
 * Es la ventaja concreta de tener los prompts en archivos: se ajusta la redacción, se relanza
 * el análisis y se ve el efecto, sin reiniciar nada. En producción esa lectura por llamada
 * sería E/S regalada, y además conviene que el texto quede congelado al arrancar.
 */
const cache = new Map<string, string>();

function loadTemplate(file: string): string {
  const cached = cache.get(file);
  if (cached !== undefined && process.env.NODE_ENV === 'production') return cached;

  const path = join(CONTENT_DIR, file);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    // Sin este mensaje, el síntoma sería un error de E/S sin contexto en mitad del pipeline.
    throw new Error(
      `No se pudo leer el prompt «${file}». Se esperaba encontrarlo en ${path}. ` +
        'Los prompts se resuelven desde la raíz del proyecto: comprueba desde dónde se ' +
        'arrancó el servidor.',
    );
  }

  // Se normaliza el final para que el prompt no dependa de si el editor dejó una línea en
  // blanco al guardar.
  const template = raw.trimEnd();
  cache.set(file, template);
  return template;
}

export type Prompt<Variable extends string> = {
  readonly id: string;
  readonly version: string;
  /** Identificador estable que se guarda junto al resultado: `id@version`. */
  readonly stamp: string;
  render: (values: Readonly<Record<Variable, string | number>>) => string;
};

/**
 * Declara un prompt.
 *
 * `variables` es una tupla de literales, así que la firma de `render` se deriva de ella: pasar
 * una variable que la plantilla no declara, u olvidar una que sí, es un error de compilación
 * antes de serlo de ejecución.
 */
function definePrompt<const Variables extends readonly string[]>(spec: {
  id: string;
  version: string;
  file: string;
  variables: Variables;
}): Prompt<Variables[number]> {
  return {
    id: spec.id,
    version: spec.version,
    stamp: `${spec.id}@${spec.version}`,
    render: (values) => renderTemplate(loadTemplate(spec.file), values, spec.id),
  };
}

/**
 * Prompts del análisis.
 *
 * La versión se sube **a mano** al cambiar la redacción de un prompt, igual que en un paquete:
 * lo que importa no es automatizarla sino que quede constancia de que el texto cambió, porque
 * es lo que separa dos resultados que no son comparables.
 */
export const analysisPrompts = {
  /**
   * Bloque de sistema, común a las dos fases.
   *
   * Que sea el mismo en identificación y análisis no es ahorro de líneas: es requisito para
   * que la caché de prompt reutilice el transcript entre llamadas. Si alguien lo parte en dos
   * redacciones, la caché deja de valer sin que nada falle.
   */
  system: definePrompt({
    id: 'analysis/system',
    version: '1.0.0',
    file: 'system.md',
    variables: [],
  }),

  identify: definePrompt({
    id: 'analysis/identify',
    version: '1.0.0',
    file: 'identify.md',
    variables: ['roster', 'languageCode'],
  }),

  analyze: definePrompt({
    id: 'analysis/analyze',
    version: '1.0.0',
    file: 'analyze.md',
    variables: ['durationMinutes', 'languageCode', 'paragraphs'],
  }),
} as const;
