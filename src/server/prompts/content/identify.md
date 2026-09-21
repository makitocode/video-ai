TRABAJO A: identifica a los participantes.

Etiquetas detectadas:
{{roster}}

Idioma: {{languageCode}}.

Dónde suelen estar las pistas:
- Alguien se presenta: "soy María", "les habla Carlos de finanzas".
- Alguien llama a otro por su nombre, y esa persona responde a continuación.
- Alguien describe su papel: "yo llevo el presupuesto", "desde mi equipo lo vemos así".
- Quien abre la reunión, reparte turnos y la cierra suele estar moderando.

Reglas de esta fase:
1. No inventes nombres. Sin pista suficiente, devuelve name en null con confidence "low".
   Un "Speaker C" honesto es mucho mejor que un nombre equivocado.
2. Cada nombre propuesto va con la marca de tiempo y la frase exacta que lo justifican.
3. Calibra la confianza: "high" sólo cuando alguien se identifica o le llaman por su nombre de
   forma inequívoca; "medium" cuando la deducción es razonable pero indirecta; "low" el resto.
4. La separación de voces suele partir a una misma persona en varias etiquetas cuando hay
   interrupciones o cambios de micrófono. Si dos etiquetas son claramente la misma persona
   —mismo papel, misma forma de hablar, nunca se solapan, una habla muy poco— indícalo en
   sameAsLabel. Ante la duda, no las unas.
5. Devuelve una entrada por cada etiqueta de la lista, sin excepción.
