# 08 — Seguridad

Los videos que sube un usuario son de lo más sensible que puede manejar una aplicación:
reuniones internas, datos médicos, entrevistas, conversaciones privadas. El transcript es
todavía peor, porque es **texto indexable y buscable**.

> Ventaja estructural de [ADR-001](./02-adr-backend-serverless.md): al no tener servidores,
> una clase entera de vulnerabilidades desaparece. No hay SO que parchear, ni puertos abiertos,
> ni un `ffmpeg` nuestro parseando archivos hostiles de desconocidos (un vector de RCE con
> historial largo y conocido).

---

## Modelo de amenazas

| # | Amenaza | Control |
|---|---|---|
| T1 | Un usuario accede al video o transcript de otro | RLS en toda tabla + ruta de Storage prefijada por `user_id`; **tests de RLS en CI** |
| T2 | Una signed URL filtrada da acceso permanente | TTL corto (15 min playback / 2 h para el ASR); paths con UUID no enumerables |
| T3 | Las claves de ASR o LLM se filtran al cliente | Solo en secretos de Edge Functions. **Ninguna clave de proveedor en `NEXT_PUBLIC_*`.** Lint que falla el build si aparece |
| T4 | Un atacante falsifica un webhook y envuena datos | Verificación de firma **+** `webhook_token` aleatorio por job en la URL **+** validación de esquema |
| T5 | Webhook reproducido (replay) | Idempotencia por `job_id`; ventana temporal en la firma |
| T6 | Archivo malicioso diseñado para explotar el decodificador | El decodificador es el del navegador (sandbox), no nuestro. Validación de magic bytes antes de nada |
| T7 | Prompt injection desde el contenido del video | Ver abajo |
| T8 | Abuso de recursos / bomba de coste | Cuotas en DB, rate limiting en Edge Functions, límites de tamaño y duración |
| T9 | XSS vía transcript o salida del LLM | Render siempre como texto. Nunca `dangerouslySetInnerHTML`. CSP estricta |
| T10 | Enumeración de recursos | UUIDv4 en todas partes; nada correlativo en URLs |
| T11 | Exfiltración por un `media_asset` compartido | Los enlaces de compartir son tokens revocables con caducidad, no signed URLs directas |

---

## Controles por capa

### Autenticación y autorización
- **Supabase Auth**; el JWT gobierna simultáneamente Postgres, Storage y Realtime.
- **RLS activo en todas las tablas.** Una tabla sin política es un bug de seguridad, no un
  descuido de configuración.
- **Tests de RLS en CI**: se crean dos usuarios y se verifica programáticamente que ninguno ve
  nada del otro en ninguna tabla. Ejecutados en cada PR. Es el control que no puede regresar
  silenciosamente.
- Principio de mínimo privilegio en las claves: la `service_role` **solo** existe dentro de
  Edge Functions, y solo en las que la necesitan de verdad.

### Storage
- Buckets **siempre privados**. Uno público anula el control de acceso entero.
- Signed URLs con el TTL más corto que permita la operación.
- La signed URL que se entrega al proveedor de ASR es el punto de exposición más delicado del
  sistema: TTL mínimo viable, path no adivinable, y registro de emisión en auditoría.
- Validación de tipo por **magic bytes**, no por extensión ni por `Content-Type` (ambos los
  controla el cliente).
- Límites de tamaño y duración aplicados también del lado del servidor. Los del cliente son UX,
  no seguridad.

### Edge Functions
- Solo reciben y emiten JSON validado con **Zod**. Nunca abren archivos de media.
- Secretos en el gestor de secretos de Supabase, nunca en el repositorio.
- Rate limiting por usuario y por IP.
- CORS restringido al dominio de la aplicación.
- Logs estructurados **sin contenido de transcript**. Un log con texto transcrito es una fuga
  de datos con otro nombre.

### Frontend
- **CSP estricta** con nonces; sin `unsafe-inline`.
- Cabeceras: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`.
- El transcript y la salida del LLM se renderizan **como texto**, siempre.
- Sin claves de terceros en el bundle; verificado en CI.
- Dependencias con `npm audit` + Dependabot en CI. El ecosistema de media arrastra mucho código.

### Prompt injection (T7)

El transcript contiene lo que dijo cualquier persona en el video, incluida gente que puede
haber hablado *sabiendo* que se iba a procesar con un LLM. Controles en profundidad:

1. **El transcript va delimitado y etiquetado explícitamente como datos**, no como instrucciones.
2. **Salida estructurada obligatoria** (esquema Zod): un modelo desviado no puede producir
   efectos secundarios, solo JSON que será rechazado si no cumple el contrato.
3. **El pipeline de resumen no tiene herramientas**: sin acceso a red, sin acceso a la base de
   datos, sin capacidad de llamar funciones. Solo transforma texto en texto.
4. **Validación posterior determinista**: cada cita se verifica contra segmentos reales
   ([ver 07](./07-modelo-de-datos.md#summaries-summary_claims-claim_citations)). Lo que no
   se verifica, se descarta.
5. La salida nunca se interpreta como HTML ni como comando.

### Privacidad y cumplimiento
- Cifrado en tránsito (TLS) y en reposo (lo proporciona Supabase).
- **Retención configurable** y borrado real, no solo lógico, tras la ventana de purga.
- Exportación de datos del usuario (GDPR, derecho de portabilidad): transcript + resumen en
  formatos abiertos.
- **Acuerdos de tratamiento de datos con los proveedores de ASR y LLM** — obligatorio revisarlos
  antes de producción: es donde de verdad viajan los datos del usuario. Verificar explícitamente
  la política de *no entrenamiento* sobre los datos enviados.
- Región de datos consistente entre Supabase y el proveedor de ASR (relevante para clientes UE).

---

## Controles por fase

No todo entra el primer día, pero el orden no es negociable:

| Fase | Controles que deben estar |
|---|---|
| **0 — Fundaciones** | RLS en todas las tablas + **tests de RLS en CI** + secretos fuera del repo |
| **1 — Ingesta** | Buckets privados, magic bytes, signed URLs de TTL corto, límites de tamaño |
| **2 — Transcripción** | Firma de webhook, `webhook_token`, idempotencia, rate limiting |
| **3 — Resumen** | Defensas de prompt injection, validación de citas, render como texto |
| **4 — Producción** | CSP, cabeceras de seguridad, DPAs firmados, política de retención activa, auditoría |

> Los tests de RLS en CI son el control que más valor aporta por esfuerzo invertido. Es el que
> impide que un `select` mal escrito seis meses después filtre datos entre usuarios sin que
> nadie se entere.
