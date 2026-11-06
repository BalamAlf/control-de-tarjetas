# Conectar Control de tarjetas con Muse / Polilla

## Estado real

Las funciones `reader` y `proposals` están activas en Supabase. El propietario confirmó consultas de resumen y una compra registrada desde el flujo WhatsApp → Polilla → propuesta → confirmación en la página. La revisión del 6 de noviembre confirmó las funciones desplegadas y sus permisos; no volvió a enviar mensajes, crear compras ni entrar en la cuenta de Muse.

Este repositorio aporta la API y la página de revisión. Muse aporta el canal de WhatsApp, la transcripción y la interpretación. No contiene un bot propio de WhatsApp, un webhook receptor de mensajes, un conector MCP de Muse ni tareas periódicas de recordatorio.

## Capacidades

| Acción | Página | Polilla mediante la API actual |
| --- | --- | --- |
| Consultar resumen mensual/persona/tarjeta | Sí | Sí |
| Consultar compras y cuotas MSI | Sí | Sí |
| Preparar compra normal o MSI | Sí, captura directa | Sí, propuesta |
| Confirmar y registrar propuesta | Sí, propietario autenticado | No |
| Ajustar recurrente de un mes / «No aplica» | Sí | No implementado |
| Editar una propuesta existente | No: cancelar y preparar otra | Sin endpoint de edición ni cancelación |
| Marcar pago al banco | Sí | No implementado |
| Administrar personas/tarjetas | Sí | Solo consulta |
| Descargar/compartir imagen del detalle | Sí | Puede consultar el detalle; la API no genera PNG |
| Enviar avisos automáticamente | No | No hay cron/sondeo configurado por este repositorio |

El resumen de texto por WhatsApp ya fue confirmado por el propietario; no confundirlo con envío automático de imágenes a terceros.

## Preparación de los dos conectores

1. Instalar las migraciones 001–008 y desplegar las dos funciones según [lectura](READER.md) y [propuestas](PROPOSALS.md). En la instalación existente ya están activas.
2. Abrir **Accesos de Polilla** con la sesión del propietario. No generar otro token si el conector ya funciona.
3. Si se necesita conectar por primera vez, generar un acceso **Consultar tarjetas y cargos** para Tarjetas Reader y otro **Preparar propuestas (sin aprobar)** para Tarjetas Propuestas.
4. Registrar el host `<PROJECT_REF>.supabase.co` en el flujo seguro de conectores personalizados de Muse. Usar API key en encabezado Bearer (`Authorization: Bearer <token>`), con cada token únicamente en su conector. Los nombres y pantallas de Muse pueden cambiar; seguir su flujo seguro disponible.
5. Bases de API: `https://<PROJECT_REF>.supabase.co/functions/v1/reader/v1` y `https://<PROJECT_REF>.supabase.co/functions/v1/proposals/v1`.
6. Comprobar lectura con GET `/connection`. Para verificar permisos de propuestas sin crear una, consultar GET `/intents/<UUID-nuevo>`: un 404 `not_found` indica que ese identificador no existe después de autorizar la consulta; un 401/403 significa problema de acceso.

Los tokens no son la clave publicable, contraseña, sesión del navegador ni clave administrativa de Supabase. No pegarlos en el chat, ejemplos, GitHub o capturas. Se muestran una sola vez. Revocarlos en la página si se pierden; no se recuperan. No hace falta renovarlos cada semana. Las propuestas, por separado, sí vencen a los diez minutos.

## Consulta por voz

Ejemplos ficticios: «¿Cuánto le toca a Persona A en noviembre?» o «Dame el detalle de Persona A en Tarjeta A». Polilla resuelve nombres contra los directorios, convierte el mes a YYYY-MM y consulta el resumen/detalle. Si falta el año y hay ambigüedad, debe aclararlo; no elegir un año solo porque sea el único con datos.

La API devuelve centavos enteros MXN, periodo y advertencias. Los importes son **cargos previstos**, no transferencias confirmadas ni deuda conciliada. Responder con periodo y total; incluir advertencias que afecten el total sin repetir datos técnicos en cada respuesta.

## Compra por voz

1. Resolver persona y tarjeta; recoger concepto, importe total, tipo normal/MSI, número de cuotas y primer mes.
2. Crear un UUID por intención. POST `/proposals` con `Idempotency-Key` estable durante todos los reintentos de esa intención.
3. Mostrar «Propuesta lista para revisar», no «Compra registrada».
4. El propietario abre Propuestas de Polilla en la página y confirma los datos. Solo esa confirmación registra la compra.
5. Consultar GET `/proposals/<id>` o `/intents/<UUID>`. Solo `status=committed` y `purchaseId` acreditan el registro. Si hay timeout, consultar antes de repetir; no crear otro UUID para resolverlo.

Si se desea corregir una propuesta, el flujo actual requiere cancelarla desde la página y preparar otra. Una corrección conversacional automática sería una mejora futura, no una capacidad ya implementada. Dos intenciones diferentes pueden producir dos compras iguales: la idempotencia no detecta todos los duplicados semánticos.

## Límites y próximas ampliaciones

La API no modifica recurrentes, no aprueba compras, no registra pagos al banco ni ofrece acceso individual por persona. Los recordatorios necesitarían configuración explícita y reglas de fecha verificadas; no inferir vencimientos a partir del día habitual de pago. Cualquier futura escritura por voz debe conservar revisión, permisos específicos e idempotencia.
