/**
 * Sustitución de variables en una plantilla de prompt.
 *
 * Deliberadamente **no** es un motor de plantillas. No hay condicionales, ni bucles, ni
 * expresiones: sólo `{{variable}}`. Esa limitación es el punto. Un prompt con lógica dentro
 * deja de poder leerse como lo que el modelo va a recibir, y para saber qué dice de verdad hay
 * que ejecutarlo mentalmente. Lo que necesite lógica —ordenar una lista de hablantes, decidir
 * cuántos párrafos— se resuelve en TypeScript y entra ya resuelto como texto.
 *
 * Las dos direcciones fallan ruidosamente, y por el mismo motivo: un prompt mal montado no
 * revienta, produce una respuesta peor. Eso es lo más caro de diagnosticar, así que se
 * convierte en un error inmediato.
 */

export class PromptRenderError extends Error {}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
  /** Identifica la plantilla en los mensajes de error. */
  promptId: string,
): string {
  const used = new Set<string>();

  const output = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];

    if (value === undefined) {
      throw new PromptRenderError(
        `El prompt «${promptId}» usa {{${name}}} pero no se le pasó ese valor.`,
      );
    }

    used.add(name);
    return String(value);
  });

  // Una variable de más casi siempre es una plantilla que cambió y una llamada que no se
  // enteró: el prompt se enviaría sin ese dato y nadie se daría cuenta.
  const unused = Object.keys(values).filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new PromptRenderError(
      `Al prompt «${promptId}» se le pasó ${unused.map((name) => `«${name}»`).join(', ')}, ` +
        'que no aparece en la plantilla.',
    );
  }

  return output;
}
