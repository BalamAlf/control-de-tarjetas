# Control de tarjetas

Control de tarjetas de crédito con más de una persona. Aplicación en español para consultar un mes de pago y ver cuánto corresponde a cada persona, con desglose por tarjeta y concepto.

## Funciones

- Compras, MSI y recurrentes con primer mes de pago explícito.
- Importes variables por mes; omitir e incluir un cargo sin alterar otros meses.
- Finalizar y reactivar recurrentes conservando el historial.
- Papelera recuperable de compras, con confirmación.
- Resumen por persona y tarjeta en imagen PNG, con subtotales y detalle. Desde el detalle elegir «Resumen para compartir», después Descargar imagen o Compartir. La imagen incluye solo la selección actual, no los datos de otras personas.
- Acceso privado y sincronización con Supabase. Los cargos previstos no acreditan pagos recibidos.

## Ejecutar y publicar

Requiere Node.js moderno. `npm run dev` abre la vista local en http://127.0.0.1:4173. Los datos privados de `data/base.json` no se incluyen en Git; se mantienen en la computadora del propietario. Una instalación nueva debe configurar sus propios datos y su propio proyecto Supabase.

`npm test` ejecuta las pruebas publicables con datos ficticios. Las pruebas locales sobre el archivo privado no se suben a GitHub.

`npm run build` genera `dist`. Netlify publica únicamente esa carpeta, como indica `netlify.toml`. Las compras se obtienen desde la cuenta autenticada, no desde los archivos públicos. La configuración publicable está en `app/config.js`; nunca usar claves administrativas en el navegador.

## Supabase

Para una instalación nueva ejecutar `supabase/001_setup.sql` y después `002_month_adjustments.sql` y `003_purchase_controls.sql`. Para una cuenta existente ejecutar solo las migraciones que falten. No se necesita volver a importar las compras.

Las tablas tienen políticas por propietario. Las escrituras usan funciones autenticadas; los ajustes no alteran el registro original. La exportación de respaldo y los archivos de Excel permanecen fuera del repositorio.

## Periodos

El selector indica el mes del pago previsto. Una fecha aproximada de corte o el día habitual en que se realiza un pago no asigna automáticamente una compra a otro mes. Las nuevas compras requieren elegir su primer mes de pago. Omitir un MSI no mueve la cuota ni modifica los contadores originales.

## Pendientes

Configurar el Atajo del iPhone, recuperación de contraseña y una cola de cambios sin conexión.

## Acceso desde Atajos del iPhone

Añadir `?nuevo=1` a la URL publicada abre Nueva compra tras iniciar sesión. En Atajos, crear una acción URL con ese enlace y Abrir URL. El primer mes sugerido usa el mes actual en México; se puede cambiar antes de guardar. El enlace nunca guarda por sí solo ni contiene contraseñas. Si la sesión expiró pide acceso y después continúa al formulario.

Las compras originales con un mes de pago confirmado se incluyen solo ese mes aunque el plan original excluya otras compras normales sin periodo confirmado. No se modifican sus contadores originales.

## Marcar una tarjeta pagada al banco

En cada tarjeta del mes seleccionado, pulsar «Marcar pagada al banco» y confirmar. «Dejar pendiente» revierte ese estado solo para esa tarjeta y ese mes. Se guarda en la cuenta después de una respuesta exitosa; no registra importe o fecha de transferencia, ni abonos de personas, ni cambia cuotas. Los cargos permanecen en el desglose.

Ejecutar `supabase/004_bank_payments.sql` en la cuenta existente y actualizar Netlify. El archivo exportado local `Habilitar pagos de tarjetas.sql` contiene la misma migración.

## Personas y tarjetas

Los botones visibles Personas · agregar y editar y Tarjetas y pagos al banco abren la administración de la cuenta. Agregar y Editar permiten cambiar nombres y alias; archivar impide nuevas compras sin borrar el historial. Restaurar se hace desmarcando Archivar. Los estados bancarios se confirman por tarjeta y mes. No se lleva un registro de abonos de personas.

Ejecutar `supabase/005_entities.sql` después de las migraciones anteriores. El archivo local Habilitar personas y tarjetas.sql reúne las capacidades bancarias y de administración para esta entrega. El servidor conserva identificadores, valida propietario y revisión para evitar reemplazar una edición de otro dispositivo, y bloquea nuevas compras sobre personas o tarjetas archivadas.

## Propuestas de Polilla

La integración puede preparar compras normales y MSI con permisos específicos, sin aprobarlas. El propietario revisa y decide desde Propuestas de Polilla en la página. Cada propuesta tiene hash, versión, intención idempotente y vigencia de diez minutos. Ver `docs/PROPOSALS.md` y `supabase/007_proposals.sql`. Los permisos del lector existente no cambian; el conector de propuestas usa otra credencial.

## Accesos de Polilla

La sección **Accesos de Polilla** permite generar y revocar los accesos de lectura o propuestas desde la cuenta autenticada. Los nuevos tokens no caducan automáticamente. Las propuestas siguen requiriendo confirmación y vencen a los diez minutos. Instalar `supabase/008_connections.sql` después de las migraciones anteriores. Guía: [docs/CONNECTIONS.md](docs/CONNECTIONS.md).
