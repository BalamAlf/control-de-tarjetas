# API de lectura para Polilla

Desplegada en ensayo y en la aplicación real; el usuario confirmó consultas desde Polilla. No registra compras, no marca pagos y no administra personas. Las únicas escrituras internas son contadores de uso y auditoría mínima de acceso.

## Qué incluye

GET /connection, /people, /cards, /purchases, /installments y /monthly-summary. Formato de la base pública: `https://<PROJECT_REF>.supabase.co/functions/v1/reader/v1`.

Todos requieren `Authorization: Bearer <credencial exclusiva>`. No usar contraseña, sesión del navegador, clave publicable ni clave administrativa. El token opaco solo funciona en esta API, no como un JWT de Supabase. El servidor guarda su hash, propietario, permisos, caducidad opcional y revocación. Con la migración 008, los accesos de la página no caducan automáticamente; ver [Administrar accesos](CONNECTIONS.md). Los ensayos pueden seguir usando duración finita.

Permisos: connection:read, people:read, cards:read, purchases:read, installments:read y summary:read. Los valida la base en cada consulta. 30 solicitudes por minuto por credencial, incluida la comprobación de conexión; cada página cuenta. Una revocación bloquea solicitudes posteriores a su confirmación; una solicitud ya autorizada podría estar en curso.

## Instalación de prueba recomendada

1. Crear un proyecto Supabase de ensayo separado. No hace falta modificar Netlify ni la aplicación real. Confirmar que se está trabajando en el proyecto de ensayo.
2. En SQL Editor ejecutar la migración existente `supabase/001_setup.sql` del repositorio para crear las tablas base. Después ejecutar 01-Habilitar-API.sql del paquete (migración 006). Esta entrega no necesita las funciones de escritura 002–005 para ensayar lectura.
3. En Authentication crear un usuario de prueba con correo ficticio y copiar su UUID. No compartir la contraseña.
4. En 02-Datos-ficticios.sql sustituir el UUID de ceros por el del usuario de prueba y ejecutar. El archivo aborta si ese usuario ya tiene un libro, para no reemplazar compras existentes.
5. Edge Functions → crear función llamada `reader`. Pegar el archivo completo index.ts del paquete y desplegar. Desactivar la verificación JWT de plataforma SOLO para esta función, porque usa Bearer opaco propio. El código siempre autentica mediante la base; no es una API pública sin control. No cambiar la validación JWT del proyecto ni de otras funciones.
6. La función requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en su entorno de servidor. Supabase documenta variables predefinidas para Edge Functions. Comprobar su disponibilidad en el proyecto; no colocar la clave administrativa en la página, OpenAPI, chat o conector. Si no está disponible, configurarla exclusivamente mediante el gestor de secretos del servidor.
7. Emitir la credencial de prueba desde el SQL Editor administrativo, con el UUID real DE PRUEBA en esta consulta:

```sql
select public.ct_issue_reader(
 '00000000-0000-0000-0000-000000000000'::uuid,
 'Polilla ensayo',
 array['connection:read','people:read','cards:read','purchases:read','installments:read','summary:read'],
 1
);
```

El resultado contiene credentialId y token: este último se muestra una vez y debe ingresarse únicamente en el flujo seguro de Polilla. No pegarlo en el chat, capturas ni archivos. Si se pierde, revocarlo y generar otro. Una sustitución en Muse no revoca por sí misma el token anterior.

8. Solo después del despliegue y autorización, registrar en Polilla el host real `<PROJECT_REF>.supabase.co`, esquema api_key, placement bearer_header. La compatibilidad de ese flujo se basa en lo declarado por Polilla; la prueba será la primera solicitud real.
9. Probar GET /connection; debe responder authorized y read_only. Luego /cards y /monthly-summary?month=2099-12. El total ficticio de ese mes debe ser 5333 centavos MXN. No son datos ni importes del propietario.
10. Revocar la credencial y confirmar que vuelve a responder 401:

```sql
select public.ct_revoke_reader('00000000-0000-0000-0000-000000000000'::uuid);
```

Aquí se sustituye por credentialId devuelto al emitir, no por el UUID de usuario. Emitir otra credencial es una operación administrativa independiente.

## Uso desde el repositorio

El fuente está en supabase/functions/reader/index.ts, con módulos compartidos. `node scripts/package-reader.mjs` genera .reader-release/index.ts autocontenido a partir del MISMO app/finance.js usado por la página, para evitar dos copias mantenidas a mano. Si cambia el motor financiero, regenerar el paquete y actualizar también la función; el build de Netlify no lo despliega.

Alternativa CLI para un operador autorizado: `supabase functions deploy reader --project-ref <PROJECT_REF> --no-verify-jwt`. La configuración de esa función está en supabase/config.toml. No es necesario instalar CLI para el procedimiento con Dashboard.

## Contrato y significado

- Periodo obligatorio YYYY-MM para compras, cuotas y resumen; persona y tarjeta opcionales mediante identificadores existentes.
- Centavos enteros, MXN y total de cargos previstos. No representa deuda conciliada ni dinero pendiente de cobro.
- purchases devuelve importe original de compras pertinentes al mes y registros por revisar; no es un listado de mensualidades.
- installments incluye solo MSI, con status scheduled, excluded o needs_review. Una cuota excluida no se cobra en el total y no se reprograma.
- Las consultas a periodos anteriores al origen confirmado responden 409; no reconstruyen un historial inexistente.
- Desconocidos no se suman. warnings explica exclusiones o recurrentes de referencia.
- bankStatuses distingue user_recorded, baseline y unconfirmed. Un estado bancario no implica una transferencia con importe o fecha.
- Las entidades archivadas se omiten en los directorios por defecto; includeArchived=true las incluye. Sus cargos históricos permanecen en los cálculos.
- Paginación: limit 1–100, cursor opaco ligado a la instantánea y filtros. Reusar los mismos parámetros. Si cambia el origen, 409 snapshot_changed: reiniciar la lectura. El cursor no es credencial ni autoriza otro propietario.
- calculatedAt, calculationVersion y snapshotId identifican el cálculo; no son identificadores de una intención de escritura.

## Seguridad, auditoría y límites conocidos

ct_reader_snapshot solo puede ejecutarla el servicio del servidor, nunca anon ni authenticated. Obtiene el propietario del hash de credencial, no de una entrada owner_id. Las tablas de credenciales y auditoría no tienen lectura ni escritura directa para los clientes. Los RPC administrativos de emisión y revocación tampoco aceptan la credencial delegada.

La lectura de configuración y compras se realiza en una misma instantánea SQL. Las consultas no cambian los registros financieros. La auditoría registra autorización de lectura por permiso (200/403), no el contenido ni el éxito de toda la serialización HTTP posterior. Las solicitudes limitadas por tasa se reflejan en el contador, no generan un registro por intento. Tokens desconocidos o revocados no se registran como contenido. La eliminación de auditoría con más de 30 días se hace al volver a usar la misma credencial: no es un borrado programado. Para claves sin uso, el administrador debe gestionar retención o eliminarlas, lo que borra sus auditorías por cascada.

No hay CORS de navegador habilitado; el cliente inicial es servidor a servidor. No se aceptan SQL, URLs destino, cambios de propietario ni instrucciones ejecutables. La salida usa campos permitidos; no devuelve settings completo. Ante datos incompatibles, falla de forma cerrada con 503.

Falta validar el despliegue en Deno/Supabase real y la bóveda de Muse. Las pruebas locales no prueban red, permisos efectivos de una instancia instalada ni notas de voz reales. No se han instalado migraciones o emitido credenciales en tu proyecto real.

## Reversión

Revocar la credencial desactiva esa integración. Desactivar/eliminar la función reader desactiva la API y deja la página actual funcionando. No deshacer las tablas financieras existentes. Las capacidades de voz y escritura siguen fuera de esta entrega.

Documentación de plataforma consultada: https://supabase.com/docs/guides/functions/auth — https://supabase.com/docs/guides/functions/secrets — https://supabase.com/docs/guides/functions/deploy
