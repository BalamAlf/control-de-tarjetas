# Propuestas de compras por voz

Polilla prepara; el propietario revisa y confirma en su página autenticada. Solo compras normales y MSI. No hay pagos al banco, abonos de personas, transferencias o recurrentes en esta entrega.

## Infraestructura

Supabase requiere las migraciones 001, 005, 006 y 007. La función proposals usa autenticación opaca propia (verify_jwt=false solo en esa función), con validación en cada llamada. El servidor conserva su clave administrativa exclusivamente en el entorno de Edge Functions. Nunca se entrega a Polilla.

POST https://<PROJECT_REF>.supabase.co/functions/v1/proposals/v1/proposals
GET https://<PROJECT_REF>.supabase.co/functions/v1/proposals/v1/proposals/<proposalId>
GET https://<PROJECT_REF>.supabase.co/functions/v1/proposals/v1/intents/<clientIntentId>

Authorization: Bearer <credencial de propuestas>. POST requiere Content-Type application/json e Idempotency-Key con UUID nuevo por intención, estable para todos sus reintentos. La misma intención y contenido devuelven el mismo resultado; contenido distinto devuelve 409. Dos compras legítimas iguales usan intenciones distintas.

Cuerpo de ejemplo, completamente ficticio:

```json
{"personId":"person-a","cardId":"card-a","description":"Compra ficticia","totalAmountCents":10000,"currency":"MXN","kind":"msi","terms":3,"firstPaymentMonth":"2099-12"}
```

No se aceptan otros campos (en especial owner, confirmed o paid). El importe es total en centavos. Para normal, terms=1. Para msi, terms entre 1 y 120. El servidor normaliza el concepto, verifica entidades activas y conserva los datos que se revisarán. El hash SHA-256 cubre el JSONB normalizado y las identidades/nombres/revisiones usados en la aprobación.

## Permisos y acceso

El conector de lectura actual conserva sus seis permisos y no puede proponer compras. Emitir una credencial DIFERENTE con proposals:read y proposals:write mediante ct_issue_reader. Usar un conector separado «Tarjetas Propuestas»; el conector lector sirve para resolver personas y tarjetas. Estos permisos no conceden confirmación, consulta directa de tablas o acceso a las funciones autenticadas del propietario.

La ruta POST crea solo una propuesta y devuelve 201; un reintento devuelve 200 y el mismo registro. Antes de afirmar que se registró una compra, consultar status=committed y purchaseId. Un timeout deja el resultado desconocido; consultar por intención antes de repetir con la misma clave. Nunca generar otra clave para resolver un timeout.

## Confirmación desde la página

Propuestas de Polilla → Actualizar → Revisar → Confirmar y registrar compra o Cancelar propuesta. Se muestran concepto, persona, tarjeta, importe total, tipo, cuotas, última cuota y primer mes. La aprobación usa el JWT del propietario, proposalId, hash exacto y versión. El rol de servicio del agente no tiene EXECUTE sobre ct_decide_proposal; el Bearer delegado no es un JWT.

La propuesta caduca a los diez minutos. No se aprueban propuestas expiradas, canceladas o que cambiaron de contexto por nombre/revisión/archivo de sus entidades. Si se necesita corregir algo, cancelar y crear una intención nueva. Una propuesta ya comprometida devuelve el resultado previo, sin repetir la compra.

La confirmación, ct_save_purchase, vínculo con el registro creado y evento de auditoría se realizan en una transacción. Se mantiene el orden de bloqueo libro → propuesta para decisiones; propuestas nuevas autentican la clave y luego bloquean libro → propuesta. La vigencia se comprueba después de adquirir los bloqueos. No se confirma en nombre del usuario desde el agente.

## Estados

pending_approval, committed, cancelled, expired (derivado de expiresAt), stale. No existe una tarea programada de expiración. La lista de la página muestra las 100 más recientes; por defecto oculta resueltas y expiradas y permite mostrarlas. Puede haber propuestas pendientes antiguas fuera de ese límite si se acumulan más de cien registros: consultar por ID desde el agente o reducir esa acumulación; no presentar la bandeja como historial contable completo.

Los RPC de agente solo pueden ejecutarlos servicios internos. ct_list_proposals y ct_decide_proposal solo authenticated, y auth.uid debe coincidir con el propietario. Las tablas tienen RLS y carecen de grants para clientes. Eventos registran actor de clase agent/user, operación y momento; no almacenan audios ni transcripciones. No se ha configurado purga automática del historial de propuestas; se debe acordar retención antes de un uso prolongado.

Revocar la credencial impide nuevas operaciones del agente. Una propuesta que ya existe puede ser revisada por su propietario mientras siga vigente; revocar no registra, cancela o borra compras. Cancelar las propuestas pendientes desde la página si también se desea invalidarlas.

## Despliegue y reversión

`node scripts/package-proposals.mjs` produce una función autocontenida para Supabase. Actualizar el frontend con el ZIP de Netlify para ver la bandeja. El build estático no despliega funciones. No publicar la raíz del proyecto ni archivos SQL, datos o claves en Netlify.

Para desactivar: revocar claves de propuestas y retirar la función proposals; la API de lectura y la página existente siguen funcionando. No borrar las compras ya aprobadas: se corrigen mediante controles existentes con intervención del propietario.

## Verificación

Pruebas aisladas: idempotencia, intención idéntica con otra clave, cambio de contenido, valores inválidos, aislamiento por propietario, imposibilidad de aprobar con el rol del agente, hash/version, cancelación, expiración, archivo y redondeo. Pruebas del navegador con respuestas simuladas: detalle, salida sin cambios, fallo de respuesta y reintento, historial y ancho móvil. Antes del despliegue real se ensaya el servicio HTTP y los RPC en el proyecto ficticio.
