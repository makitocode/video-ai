# 14. Arquitectura de prompts

> Qué hacemos con los prompts para que no acaben siendo cadenas sueltas dentro del código, y
> qué de lo que recomienda la industria aplica aquí y qué no.

---

## 1. El problema

Un prompt es código que se ejecuta en otra máquina y decide el comportamiento del producto.
Escrito como template literal dentro del adaptador, hereda todos los defectos de un texto
largo dentro de comillas: se lee peor de lo que se envía, su diff es ilegible, nadie sabe si
cambió, y no se puede comparar una redacción con otra.

La consecuencia práctica no es estética. Cuando alguien dice «antes el resumen salía mejor»,
sin registro de qué redacción produjo cada resultado esa frase no se puede confirmar ni
desmentir.

---

## 2. Qué recomienda la industria

Coinciden en cuatro cosas, con independencia de la herramienta que vendan:

| Práctica | Qué resuelve |
|---|---|
| **Prompts como artefactos, no como strings** | Se revisan, se versionan y se localizan |
| **Versión inmutable por prompt** | Cada salida se puede rastrear hasta la redacción que la produjo |
| **Registro central** | Saber qué prompts existen sin buscar por el código |
| **Evaluación continua** | Un cambio de prompt se mide, no se opina |

Sobre *dónde* guardarlos hay dos escuelas: **en git** junto al código, o **fuera de git** en un
CMS de prompts (PromptLayer, Langfuse, LangSmith, Humanloop…) para que quien redacta no
necesite tocar el repositorio.

---

## 3. Qué aplicamos aquí, y qué no

**En git.** El CMS resuelve un problema que no tenemos: que perfiles no técnicos editen
prompts sin pasar por un despliegue. Aquí el prompt y el código que lo consume cambian juntos
—un campo nuevo en el esquema de salida es un cambio simultáneo en los dos—, y separarlos
crearía la posibilidad de que la redacción y el esquema se desincronicen. Además añade una
dependencia externa, y el proyecto entero está construido sobre no tener ninguna que no haga
falta.

**Archivos `.md`, no TypeScript.** Es la parte que sí adoptamos entera:

```
src/server/prompts/
  README.md      ← cómo se edita un prompt
  catalog.ts     ← qué prompts existen, su versión y sus variables
  render.ts      ← sustitución de {{variable}}, sin motor de plantillas
  index.ts       ← la lógica que las plantillas no deben contener
  content/
    system.md    ← bloque común a las dos fases
    identify.md  ← tarea A
    analyze.md   ← tarea B
```

**Sin motor de plantillas.** Sólo `{{variable}}`. Un prompt con condicionales dentro deja de
poder leerse como lo que el modelo va a recibir. Ordenar la lista de hablantes o decidir
cuántos párrafos pide la reunión son decisiones de producto: se resuelven en TypeScript, se
prueban como código y entran en el prompt ya resueltas.

**Variables tipadas.** El catálogo declara qué admite cada prompt y el compilador comprueba las
llamadas. En ejecución, pasar una variable de más o de menos lanza un error. Es deliberado: un
prompt mal montado no falla, sólo responde peor, y ése es el fallo más caro de encontrar.

**Versión por prompt, guardada con el resultado.** Cada resumen almacena la huella de las
redacciones que lo produjeron (`analysis/system@1.0.0 analysis/identify@1.0.0 …`). Dos
resúmenes de la misma grabación con huellas distintas no son comparables; con la misma huella,
la diferencia está en otro sitio. La versión se sube a mano, como en un paquete: lo que importa
no es automatizarla, sino que conste que el texto cambió.

**Pruebas sobre los prompts.** Se verifica que todas las plantillas renderizan sin huecos, que
la lista de hablantes aparece completa, que el número de párrafos corresponde a la duración y
—la que más pesa— que el bloque de sistema es idéntico en las dos fases.

---

## 4. Por qué el system compartido es una restricción y no una comodidad

Las dos fases envían el mismo transcript con minutos de diferencia. La caché de prompt lo
reutiliza a un décimo de su precio **sólo si todo lo anterior al punto de corte coincide byte a
byte**. Si alguien divide `system.md` en dos redacciones «porque cada fase hace cosas
distintas», el coste sube alrededor de un 22 % y no falla nada: no hay error, no hay aviso, sólo
una factura mayor. Por eso hay una prueba que lo fija y un aviso en el README.

---

## 5. Agentes: por qué este sistema no lo es, y no debería serlo

La recomendación de Anthropic distingue **workflows** —el LLM y las herramientas se orquestan
por un camino de código predefinido— de **agentes** —el modelo dirige su propio proceso— y es
explícita en preferir patrones simples y componibles antes que frameworks.

Esto es un workflow, y de los más nítidos: extraer audio → transcribir → identificar hablantes
→ analizar. El camino se conoce de antemano y no depende de lo que el modelo decida. Dos de los
cinco patrones componibles del catálogo describen exactamente lo que hacemos:

- **Prompt chaining**: la salida de la transcripción alimenta las dos fases siguientes.
- **Parallelization**: identificar y analizar son independientes y corren a la vez.

Darle autonomía al modelo aquí sólo añadiría formas de fallar: no hay ninguna decisión que
tomar sobre la marcha, y sí una garantía que sostener —que cada cita apunte a un segmento real
del transcript—, que se verifica en código al guardar y no delegando en el criterio del modelo.

La regla que sí conviene retener por si el alcance crece: **escalar por composición, no por
complejidad**. Si mañana hace falta traducir el transcript o clasificar la reunión por tipo,
son etapas nuevas del mismo workflow con su prompt en el catálogo — no un agente que decida
qué hacer.

---

## 6. Qué haría falta si esto creciera

En orden, y ninguna hace falta hoy:

1. **Un set de evaluación**: tres o cuatro grabaciones con su resultado revisado a mano, para
   que cambiar un prompt se mida en vez de opinarse. Es el siguiente paso natural ahora que la
   huella se guarda.
2. **Variantes A/B por prompt**, una vez exista con qué medirlas.
3. **Un CMS de prompts**, sólo el día que alguien que no toca el repositorio necesite editarlos.

---

## Fuentes

- [Building Effective AI Agents — Anthropic](https://www.anthropic.com/engineering/building-effective-agents)
- [Structuring LLM Application Code — APXML](https://apxml.com/courses/prompt-engineering-llm-application-development/chapter-8-application-development-considerations/structuring-llm-application-code)
- [Prompt Versioning: The Complete Guide — Agenta](https://agenta.ai/blog/prompt-versioning-guide)
- [Prompt Management: Version & Deploy Prompts in Production — LangWatch](https://langwatch.ai/blog/what-is-prompt-management-and-how-to-version-control-deploy-prompts-in-productions)
- [Scalable Prompt Management and Collaboration — PromptLayer](https://medium.com/promptlayer/scalable-prompt-management-and-collaboration-fff28af39b9b)
- [Best Prompt Versioning Tools for Production Teams — Braintrust](https://www.braintrust.dev/articles/best-prompt-versioning-tools-2025)
