# Mejoras preparadas y revisión del diseño

**Estado actualizado:** el propietario eligió B con paleta verde. Está integrado en el frontend; ver [detalle del rediseño](REDISENO.md). Requiere publicar el nuevo paquete en Netlify.

## Primera entrega preparada

Se corrigieron los hallazgos A1 y A2 de la auditoría: renovación de sesión que respeta cierres/cambios de cuenta y publicación desde un manifiesto explícito en un directorio nuevo. La sesión se elimina localmente al solicitar salir y una respuesta tardía de logout no borra un acceso posterior. Una escritura comprueba la identidad también después de obtener el token, antes de enviarse.

El build copia seis archivos de app más index y encabezados; no mezcla staging/dist antiguos. Valida que las rutas a eliminar están directamente dentro del proyecto y rechaza enlaces en la salida. Comprueba configuración publicable antes de sustituir dist. No modifica la lógica de cuotas, movimientos ni funciones backend. Requiere publicar el frontend actualizado para aplicarlo a la página.

Verificación: 63 pruebas locales aprobadas, de las que 36 son publicables. Las nuevas regresiones cubren renovación/cierre/cambio de cuenta, errores tardíos, escritura antes de cambio de identidad y exclusión de archivos antiguos/ajenos al manifiesto en build. Las pruebas del build trabajan en directorios temporales de ejemplo.

## Tres propuestas visuales por elegir

El propietario comparó las alternativas y eligió B con paleta verde. Las maquetas siguientes se conservan como referencia; el frontend real ya integra la opción elegida.

- **A — Resumen claro:** navegación superior (inferior en iPhone), total compacto y personas/pagos en dos listas. Administrar queda en Organizar; una sola acción principal Nueva compra.
- **B — Personas primero:** menú lateral, selector de persona y detalle visible al lado, con Compartir junto al nombre. En iPhone, personas seleccionables y navegación inferior.
- **C — Pagos por tarjeta:** primero cargos de tarjetas pendientes y su estado bancario, filtro Todas/Pendientes/Pagadas, Marcar pagada dentro de cada tarjeta y personas como lista secundaria.

Abrir [comparador](design/index.html). Los nombres e importes son ficticios. Las maquetas no consultan Supabase, no guardan movimientos, no muestran credenciales ni envían mensajes. Permiten explorar el detalle, la captura de ejemplo, Polilla y la administración; C permite cambiar estados solo en memoria. El cambio de mes conserva las cifras de ejemplo y lo indica expresamente.

Probadas a 375, 390, 768, 1024 y 1440 píxeles: sin desbordamiento horizontal ni errores JavaScript; sin solicitudes de red. La revisión visual incluyó escritorio y móvil. La futura implementación conservará el detalle por persona/tarjeta y todos los controles existentes; elegir una propuesta no autoriza inferir importes ni modificar datos históricos.

## Siguientes entregas

1. Publicar el diseño B verde ya integrado y revisar su uso cotidiano en la cuenta real. La comprobación de detalle, captura, pagos, recurrentes, propuestas, compartir y accesos con datos ficticios está completa.
2. Restauración activada en producción y verificada sin aplicar datos: 009 más compatibilidad histórica 010–011. El ensayo remoto separado sigue pendiente; ver [respaldos y límites](BACKUPS.md). No reconstruir desde el Excel ni mezclar propietarios automáticamente.
3. Llevar pruebas SQL y navegador a una ejecución reproducible; añadir comprobaciones de GitHub. Publicación automática de Netlify solo después de revisar la configuración/costos del plan.
4. Extender propuestas a ajustes mensuales de recurrentes, con revisión e idempotencia. Mantener el resto de meses y estados bancarios intactos.
5. Corrección conversacional de propuestas y aviso de duplicados por contenido, conservando repeticiones legítimas.

Las cuentas individuales y el módulo de finanzas personales siguen aplazados. La integración actual de Muse permanece igual.
