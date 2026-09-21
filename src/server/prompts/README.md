# Prompts

Los textos que se envían al modelo viven en `content/*.md`, no en TypeScript.

## Cómo se cambia un prompt

1. Edita el `.md`. En desarrollo el cambio se recoge en la siguiente llamada, sin reiniciar.
2. **Sube la versión** del prompt en `catalog.ts`. Es lo que permite comparar después: cada
   resumen guarda con qué redacción se produjo.
3. `pnpm test` — hay pruebas sobre los prompts.

## Reglas

- **Sin lógica en las plantillas.** Sólo `{{variable}}`: ni condicionales, ni bucles. Lo que
  requiera decidir algo se resuelve en `index.ts` y entra ya resuelto. Así el `.md` se lee tal
  cual lo recibe el modelo.
- **Declara las variables en `catalog.ts`.** El compilador comprueba las llamadas, y pasar una
  de más o una de menos falla al instante en vez de degradar la respuesta en silencio.
- **`system.md` es común a las dos fases y debe seguir siéndolo.** No es ahorro de líneas: la
  caché de prompt reutiliza el transcript entre llamadas sólo si el bloque anterior es
  idéntico. Partirlo en dos redacciones sube el coste sin que nada falle.
- **Los dos proveedores comparten prompt a propósito.** Si Claude y OpenAI recibieran
  instrucciones distintas, comparar cuál lo hace mejor mediría los prompts, no los modelos.
