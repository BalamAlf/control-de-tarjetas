# Control de tarjetas

Aplicación en español para elegir un mes y ver cuánto corresponde pagar a cada persona, con desglose por tarjeta y compra. Incluye compras normales, MSI y recurrentes. Los totales son cargos previstos; no acreditan transferencias ni abonos de personas.

## Diseño actual

**Personas primero, en verde.** Selecciona una persona para ver su total y el desglose por tarjeta al lado; Compartir prepara su resumen. La navegación lateral se convierte en barra inferior en el iPhone. Personas, tarjetas, accesos de Polilla, respaldo y Atajo se administran desde Organizar. [Detalle y validación](docs/REDISENO.md).

## Qué funciona

- Resumen mensual, detalle por persona/tarjeta y ajuste de centavos en la última cuota MSI.
- Ajustar el importe de un cargo solo en un mes, marcar «No aplica este mes» y restaurarlo.
- Finalizar/reactivar recurrentes y eliminar/restaurar compras mediante papelera.
- Agregar, editar y archivar personas y tarjetas conservando el historial.
- Marcar una tarjeta pagada al banco o pendiente, de forma independiente por mes.
- Resumen en imagen PNG para descargar o compartir desde el dispositivo.
- Acceso privado y sincronización con Supabase.
- Acceso rápido desde iPhone con `?nuevo=1`: abre Nueva compra después de iniciar sesión; no guarda automáticamente.

## Conexión con Muse / Polilla y WhatsApp

**La aplicación puede conectarse con Muse, mediante Polilla.** El propietario confirmó que las consultas y el registro de una compra, tras su revisión, funcionan desde WhatsApp a través de Polilla. No es un bot de WhatsApp alojado en este repositorio: el canal de voz/mensajería y la interpretación los aporta Muse.

Hay dos conectores independientes:

| Conector | Permite | No permite |
| --- | --- | --- |
| Tarjetas Reader | Consultar personas, tarjetas, compras, cuotas y resumen por mes/persona/tarjeta | Modificar compras o pagos |
| Tarjetas Propuestas | Preparar compras normales o MSI y consultar su estado | Confirmarlas, cambiar recurrentes o registrar pagos al banco |

El propietario revisa y confirma las propuestas en la página. Cada intención conserva un identificador para que repetir una petición no duplique la compra. Las propuestas vencen a los diez minutos. Los accesos de Polilla no caducan automáticamente y se pueden revocar desde **Accesos de Polilla**; sus tokens se muestran solo al generarlos.

Guía de conexión y ejemplos: [Muse / Polilla](docs/MUSE.md). Contratos técnicos: [lectura](docs/READER.md), [propuestas](docs/PROPOSALS.md), [accesos](docs/CONNECTIONS.md).

## Ejecutar y publicar

Requiere Node.js moderno (Netlify está configurado con Node 22). `npm run dev` abre la vista local en `http://127.0.0.1:4173`. `npm test` ejecuta los tests disponibles en el checkout. En una copia pública se usan datos ficticios; algunas regresiones privadas permanecen solo en la computadora del propietario.

`npm run build` genera `dist`. Netlify publica esa carpeta, según `netlify.toml`; también puede cargarse el ZIP de publicación preparado localmente. Los datos se consultan con la sesión autenticada. `app/config.js` contiene únicamente configuración publicable; las claves administrativas pertenecen al servidor.

La copia pública no incluye Excel, compras privadas, tokens ni respaldos. La vista local del propietario usa `data/base.json`, excluido de Git. Una instalación nueva necesita configurar su propio proyecto y su propia primera importación.

## Respaldos y recuperación

**Organizar → Respaldos** reúne descarga y restauración con vista previa. Recupera faltantes sin cambiar los valores actuales; permite recuperar valores anteriores con confirmación explícita. Conserva compras posteriores y guarda una copia anterior. Compatible con respaldos antiguos. [Guía y límites](docs/BACKUPS.md).

**Instalación verificada en producción.** 010 y 011 conservan avances originales sin dato y marcas históricas simultáneas, sin cambiar los registros. La exportación y la validación del respaldo actual funcionan. No se restauraron registros reales para probarlo. El estado del entorno de ensayo y los límites se detallan en la guía.

## Supabase

Para una instalación nueva, aplicar las migraciones en orden:

1. `001_setup.sql`: cuenta y compras.
2. `002_month_adjustments.sql`: ajustes por mes.
3. `003_purchase_controls.sql`: recurrentes y papelera.
4. `004_bank_payments.sql`: estado pagado/pendiente por tarjeta y mes.
5. `005_entities.sql`: personas y tarjetas.
6. `006_reader.sql`: API de lectura para asistentes.
7. `007_proposals.sql`: propuestas con confirmación del propietario.
8. `008_connections.sql`: accesos revocables sin caducidad automática.
9. `009_backups.sql`: respaldos, revisión y recuperación autenticada.
10. `010_backup_legacy_paid.sql`: conserva avances históricos pagados sin dato.
11. `011_backup_legacy_flags.sql`: conserva las marcas originales de tipo de compra.

En una cuenta existente aplicar solo lo que falte. No reimportar ni sustituir compras para actualizar funciones. Desplegar también las funciones `reader` y `proposals` siguiendo sus guías; el build de Netlify no las despliega. Las tablas financieras tienen políticas por propietario; las tablas internas de conectores/propuestas no conceden acceso directo al navegador.

## Cómo interpretar un mes

El selector corresponde al mes del pago previsto. El corte aproximado o pagar entre dos meses no mueve automáticamente una compra a otro periodo. Las compras nuevas requieren primer mes de pago explícito. Omitir una mensualidad MSI no la reprograma ni modifica el avance original.

Marcar «Pagada al banco» conserva los cargos en el desglose y no inventa importe ni fecha de transferencia. Eliminar una compra la excluye de todos los meses hasta restaurarla; finalizar un recurrente conserva los meses anteriores.

## Auditoría y siguientes mejoras

[Auditoría del 6 de noviembre de 2026](docs/AUDIT-2026-11-06.md): alcance, pruebas, límites y prioridades. La revisión detectó dos defectos reproducibles: renovación de sesión frente a cierre en otra pestaña y conservación de archivos antiguos dentro del directorio publicado. Ambos están corregidos en el fuente; requieren publicar el frontend actualizado. Ver [mejoras preparadas y tres propuestas de diseño](docs/MEJORAS.md). La auditoría original se conserva como registro de lo observado.

Prioridad: publicar el diseño B en verde con las correcciones, mantener la restauración verificada y automatizar pruebas/publicación. Después, proponer ajustes de recurrentes por voz con revisión. Las cuentas individuales para consultar una deuda y las finanzas personales quedan para una etapa posterior.
