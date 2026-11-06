# Accesos de Polilla

Los accesos de lectura y propuestas son independientes, sin caducidad automática y revocables. No conceden permiso para confirmar compras, modificar pagos ni administrar otras credenciales.

En la página, inicia sesión y abre **Accesos de Polilla**. La lista muestra el tipo, estado e identificador de cada acceso, nunca su token. No necesitas generar otro si el que tiene Polilla funciona.

Para conectar de nuevo, elige **Lectura** o **Propuestas** y genera un token. Copia solamente el valor en la página segura del conector correspondiente. Solo se muestra en ese momento, se oculta al cerrar y no se guarda en el navegador. El servidor conserva únicamente su huella. Si lo pierdes, revoca ese acceso y genera otro; no se puede recuperar el anterior. No lo pegues en chats, documentos ni GitHub.

**Revocar acceso** lo desactiva en las siguientes peticiones; no borra compras ni cancela propuestas ya creadas. Las propuestas conservan su vigencia de 10 minutos y requieren confirmación en la página. Como máximo se permiten diez accesos activos por cuenta. La creación se serializa por cuenta para evitar superar ese límite con solicitudes simultáneas.

La migración `008_connections.sql` habilita esta administración. La emisión administrativa permite mantener duraciones finitas para ensayos; el perfil de la página emite sin caducidad. La migración no convierte ni reactiva credenciales anteriores por sí sola. Para conservar los accesos reales ya conectados, se elimina únicamente la caducidad de los dos accesos activos y vigentes, con sus perfiles exactos. No cambia tokens, huellas ni permisos y no reactiva accesos revocados o vencidos.

Las cuentas para que cada persona consulte su deuda quedan para una etapa posterior.

## Verificación de esta entrega

57 pruebas Node aprobadas; SQL aislado con migración repetible, perfiles fijos, aislamiento de propietario, denegación anónima, revocación, caducidades finitas y límite de diez accesos; pantalla de 375 px probada con respuestas ficticias, sin desbordamiento ni errores JavaScript. La clave desaparece al cerrar y no se guarda en localStorage. Emisión de ambos perfiles y autorización comprobadas en el proyecto de ensayo con rollback.

En producción se conservan las huellas, permisos y revocaciones anteriores. La comparación de configuración y compras antes/después confirmó que no cambiaron. Los dos accesos vigentes de Polilla quedaron sin caducidad; el ensayo revocado sigue desactivado.

Los avisos del asesor sobre funciones autenticadas SECURITY DEFINER son esperados en estos RPC, que comprueban auth.uid() y propietario; las cuatro tablas internas sin políticas mantienen RLS y no conceden acceso directo al cliente. Subsisten avisos anteriores sobre la función de evento rls_auto_enable y la protección de contraseñas filtradas. Consultar [asesor de funciones](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) y [seguridad de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Esta entrega no cambia esas opciones del proyecto.
