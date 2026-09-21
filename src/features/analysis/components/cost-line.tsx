'use client';

import type { UsageEntry } from '@/lib/domain';

const PHASE_LABEL: Record<string, string> = {
  identify: 'identificar participantes',
  analyze: 'analizar',
};

/**
 * Lo que costó este análisis, medido y no estimado.
 *
 * Los números salen de lo que el proveedor reportó haber consumido, no de contar palabras: los
 * tokenizadores cambian entre modelos y el razonamiento gasta sin aparecer en el texto. Tener
 * el coste real por video delante es lo que permite decidir si bajar de modelo compensa, en
 * lugar de adivinarlo.
 */
export function CostLine({ usage }: { usage: readonly UsageEntry[] }) {
  if (usage.length === 0) return null;

  const total = usage.reduce((sum, entry) => sum + entry.costMicros, 0);
  if (total === 0) return null;

  const cached = usage.reduce((sum, entry) => sum + entry.cachedTokens, 0);

  return (
    <details className="text-muted text-xs">
      <summary className="cursor-pointer">
        Coste del análisis: <span className="tabular">${(total / 1_000_000).toFixed(3)}</span>
      </summary>

      <table className="mt-2 w-full max-w-lg">
        <thead className="text-left">
          <tr>
            <th className="font-medium">Fase</th>
            <th className="font-medium">Modelo</th>
            <th className="text-right font-medium">Entrada</th>
            <th className="text-right font-medium">Salida</th>
            <th className="text-right font-medium">Coste</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {usage.map((entry, index) => (
            <tr key={index}>
              <td>{PHASE_LABEL[entry.phase] ?? entry.phase}</td>
              <td>{entry.model}</td>
              <td className="text-right">
                {entry.inputTokens.toLocaleString()}
                {entry.cachedTokens > 0 && (
                  <span className="text-success"> +{entry.cachedTokens.toLocaleString()} ⚡</span>
                )}
              </td>
              <td className="text-right">{entry.outputTokens.toLocaleString()}</td>
              <td className="text-right">${(entry.costMicros / 1_000_000).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {cached > 0 && (
        <p className="mt-1">
          ⚡ {cached.toLocaleString()} tokens servidos desde caché, al 10 % del precio de entrada.
        </p>
      )}
      <p className="mt-1">No incluye la transcripción, que se factura aparte por hora de audio.</p>
    </details>
  );
}
