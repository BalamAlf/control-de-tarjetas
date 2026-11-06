# Respaldos y restauración con vista previa

## Estado de esta entrega

**Instalación verificada en producción.** El propietario ejecutó 009 y publicó el frontend. La comprobación de catálogo confirmó las cinco funciones y la tabla interna; Netlify sirve la entrega de restauración publicada por el propietario. La exportación autenticada devuelve formato 2, propietario correcto y todas sus compras, sin credenciales.

La primera validación de los datos reales mostró que los originales incluían avances pagados null y marcas MSI/recurrente simultáneas. La validación inicial era demasiado estricta. Se aplicaron 010 y 011, que conservan esos valores originales sin convertir null a cero ni reclasificar compras; las compras nuevas siguen requiriendo datos consistentes. El respaldo actual ya pasa la validación del servidor y revisar ese mismo respaldo produce cero cambios en ambos modos. No se ejecutó una restauración ni se modificaron compras o pagos reales para comprobarlo.

El proyecto de ensayo no tiene instalada 009; las pruebas de restauración con datos ficticios fueron SQL/navegador aislados. Las confirmaciones iniciales del conector habían caducado; después el propietario instaló producción. No se presenta esa situación como un ensayo remoto completado.

Para instalaciones nuevas, ejecutar 001–011 en orden y publicar el frontend actualizado. El archivo local Activar respaldos.sql reúne 009–011 para quienes ya tienen 001–008. No hace falta volver a conectar Muse, cambiar tokens ni crear otro proyecto. La mejora de texto «Meses pagados sin dato» en la vista previa queda en el ZIP actualizado; requiere publicarlo en Netlify.

## Uso

1. Abrir **Organizar → Respaldos**. Si la cuenta está vacía, abrir **Mi cuenta → Respaldos · descargar o restaurar** después de iniciar sesión.
2. Descargar el respaldo actual o elegir un archivo JSON anterior.
3. Pulsar **Revisar respaldo**. La vista previa compara contra el estado actual del servidor y muestra Ahora/Después. En el iPhone se apilan para evitar tener que buscar la otra columna.
4. Revisar los cambios y marcar la confirmación. Solo **Confirmar restauración** aplica los datos.

Por defecto se recuperan personas, tarjetas y compras que faltan, junto con los ajustes de esos registros nuevos. **No se alteran importes, ajustes, papelera ni estados bancarios de registros ya existentes**, aunque el ajuste o estado no estuviera guardado y se estuviera usando su valor predeterminado. Si todo ya existe, se indica que no hay nada que recuperar y no se habilita la confirmación.

Para recuperar valores anteriores de registros existentes, desplegar **Recuperar también los valores anteriores** y marcar la opción. El modo vuelve a ser conservador al elegir otro archivo o cerrar el diálogo. Este modo puede recuperar importes/cuotas, nombres, archivo, papelera, finalizaciones, ajustes y estados bancarios del respaldo. Los ajustes ausentes vuelven al valor/programación original para los registros incluidos en el archivo. Se enumeran los estados bancarios afectados; no se infiere una transferencia ni se registra un importe/fecha de pago.

**Las compras y entidades actuales que no aparecen en el archivo se conservan siempre.** También sus controles/ajustes y los estados de tarjetas fuera del archivo. No es un reemplazo completo ni borrado de la cuenta a un punto del tiempo: una copia anterior permite recuperar valores, pero no elimina compras agregadas después. Para excluir una compra sigue disponible la papelera recuperable.

## Copia anterior

La revisión guarda en el servidor el estado anterior, antes de aplicar cambios. Puede descargarse desde la vista previa y después desde **Copias anteriores**. La copia es un respaldo normal, restaurable por el mismo flujo, sin sesiones o credenciales.

Hay hasta diez copias de restauraciones completadas y diez revisiones pendientes por cuenta. Al preparar otra revisión se eliminan registros de más de siete días y los que excedan esos límites; al completar una restauración también se limita el historial completado a diez. Revisar muchos archivos no consume el cupo de copias completadas. No existe una tarea periódica ni se garantiza retención perpetua: descargar aparte las copias necesarias. Cerrar una vista previa no elimina inmediatamente su copia interna.

## Formatos y límites

- Versión 2: `{version:2, ownerId, exportedAt, book}`. Exportación de nube desde una sola instantánea SQL; contiene configuración financiera y todas las compras del propietario. No contiene contraseña, JWT, tokens de Polilla, propuestas ni auditorías de conectores.
- Versión 1: `{version:1, exportedAt, base, added}`. Compatible con los archivos anteriores; une compras originales y nuevas sin recalcular importes ni avances. Como no identifica al propietario, requiere reconocer expresamente que el archivo es propio, además de confirmar los cambios.
- El identificador de propietario de v2 evita importar accidentalmente el archivo de otra cuenta. No es una firma digital ni prueba de autenticidad: un JSON puede editarse. La autorización real es la sesión autenticada y la revisión del propietario.
- Límite de 2 MB por archivo, 2000 compras, 1000 personas, 100 tarjetas y 5000 cambios por revisión. Se rechazan duplicados, referencias ausentes, importes inválidos, campos no compatibles y cuotas nuevas que no concilien con el total. Los importes y avances históricos se conservan sin recalcularlos.
- El periodo de origen de una cuenta existente no puede cambiar al recuperar un archivo incompatible. Las tarjetas que el propietario excluyó siguen excluidas. Las revisiones de personas/tarjetas se incrementan al cambiar un registro; no se rebobinan y las propuestas pendientes pueden requerir nueva revisión.
- La versión local sin sesión puede descargar el formato anterior. Si 009 aún no está instalada, la cuenta conectada conserva la descarga anterior de los datos visibles, identificada como tal; no se presenta como una instantánea nueva del servidor ni se habilita restauración por esa vía. La restauración requiere iniciar sesión y actúa en la nube; no fusiona automáticamente los datos privados de otros navegadores.

## Integridad y permisos

RPC autenticados: ct_backup_export, ct_prepare_restore, ct_apply_restore, ct_restore_before y ct_restore_history. Cada uno utiliza auth.uid() y limita el acceso al propietario. Helpers y tabla ct_restore_jobs no conceden acceso a anon, authenticated ni service_role. Los conectores de lectura/propuestas de Muse no pueden restaurar ni consultar estas copias.

La revisión enlaza contenido, modo y un identificador UUID. El servidor guarda el plan y sus huellas. Aplicar requiere el hash del plan y confirmación explícita, bloquea el libro y compara su huella con la de la vista previa. Si la cuenta cambió o la revisión venció (diez minutos), rechaza toda la operación. Si se corta la respuesta, reintentar la misma revisión devuelve el resultado ya completado sin repetir cambios. La escritura y el estado completado son una sola transacción. No se borran compras físicamente ni se modifican created_at existentes.

## Pruebas realizadas

70 pruebas Node aprobadas: 43 publicables y 27 regresiones privadas locales. SQL aislado: formato antiguo, separación de propietarios/roles, campos inválidos y duplicados, valores predeterminados preservados en recuperación, recuperación de faltantes, valores anteriores explícitos, preservación de compras posteriores, metadatos/revisiones, caducidad, reintento, copia anterior, cuenta vacía y rollback ante un fallo de escritura inducido. El test publicable `tests/backups-security.sql` contiene datos ficticios y termina en ROLLBACK; usarlo solo en ensayo después de las migraciones.

Navegador conectado a Postgres aislado: descarga, carga del archivo, vista previa sin escrituras financieras, confirmación, copia anterior, reconocimiento de formato viejo, conflicto y nueva revisión, recuperación de cuenta vacía y vista móvil. La regresión del diseño verde también verifica captura MSI/Atajo, compartir imagen, ajustes, pagos, menús, personas y Polilla con respuestas simuladas.

La verificación remota confirmó exportación, validación y planes sin cambios sobre la cuenta actual. Las comprobaciones efectivas de permisos dieron RLS activa, snapshots privados y restauración denegada a anon y service_role. Los asesores conservan los avisos anteriores y señalan los nuevos RPC autenticados e internos según su diseño. Referencia: [asesor de funciones autenticadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
