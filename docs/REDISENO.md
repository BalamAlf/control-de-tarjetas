# Personas primero · Paleta verde

El propietario eligió la distribución B después de comparar tres maquetas y pidió conservar el verde. El frontend integra esa elección: fondo claro, verde profundo para la acción principal, selección verde suave y navegación separada de administración.

## Flujo del mes

- Mes y Mi cuenta en la cabecera. El selector nativo conserva mes y año explícitos.
- Total del mes, Compras y MSI y Recurrentes en una fila compacta.
- Lista de personas y panel con su total previsto, desglose por tarjeta y Compartir.
- Tocar una tarjeta abre el detalle existente, con conceptos, cuotas, importe mensual, No aplica y gestión del recurrente/papelera. Ver compras y ajustes abre todas las tarjetas de esa persona.
- Personas, Tarjetas, Compras, Por revisar y Polilla en el menú lateral; barra inferior en móvil. Un contador vacío no añade ruido cuando no hay registros por revisar.
- Editar junto a Personas abre la administración. Organizar reúne personas, tarjetas, conexión con Polilla, descargar respaldo y Atajo del iPhone.
- Las tablas completas y la explicación del cálculo siguen disponibles, desplegables, sin ocupar el primer plano.

El estado pagado/pendiente continúa por tarjeta y mes en Tarjetas. El pago al banco no cambia los cargos ni equivale a un abono de una persona. Los periodos sin historial se muestran sin determinar; los registros sin confirmar no se suman automáticamente y se señalan en el detalle.

## Alcance

Cambian HTML, estilos y presentación/selección del frontend. No cambia el motor financiero, contratos de API, migraciones, credenciales, datos ni funciones de Muse. Las correcciones anteriores de sesión y build siguen incluidas. La política de imágenes permite también blob: para mostrar el PNG generado localmente al compartir; no se habilitan scripts ni imágenes remotas adicionales. El paquete de Netlify incluye solo archivos públicos; no contiene estas maquetas ni datos privados.

La restauración guiada ya está instalada en producción mediante 009–011; ver [respaldos](BACKUPS.md). Los ajustes por voz siguen siendo una siguiente entrega.

## Validación

63 pruebas Node aprobadas (36 publicables y 27 regresiones privadas locales). Verificación de navegador con datos ficticios y respuestas de nube simuladas a 375, 390, 768, 1024 y 1440 px: selección de persona y tarjeta, imagen para compartir, ajuste/omisión/restauración mensual, estado bancario independiente del total, edición de persona, propuestas y accesos de Polilla, descarga sin credenciales, captura MSI con primer mes futuro, Atajo sin guardado automático y limpieza del detalle al cerrar/cambiar cuenta. No hay desbordamiento horizontal de página ni errores JavaScript en esas pruebas.

No se crearon movimientos reales ni se marcó ningún pago real durante la verificación. Para ver la actualización en la página pública hay que publicar el ZIP actualizado o el contenido de dist en Netlify. No requiere ejecutar SQL ni volver a conectar Polilla.
