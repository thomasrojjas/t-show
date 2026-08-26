# Plantillas de correo T-Show

Las plantillas usan el mismo logotipo tipográfico, jerarquía y paleta del producto. No requieren imágenes externas, por lo que se ven correctamente en Gmail y en clientes que bloquean recursos remotos.

En Supabase, abre **Authentication → Email Templates** y configura:

| Plantilla | Asunto | Archivo |
| --- | --- | --- |
| Confirm signup | Confirma tu correo de T-Show | confirm-signup.html |
| Reset password | Restablece tu contraseña de T-Show | recover-password.html |

Pega el contenido completo del archivo correspondiente en el campo de cuerpo HTML y guarda. Conserva exactamente {{ .ConfirmationURL }}: Supabase lo reemplaza por el enlace seguro y temporal para confirmar la cuenta o restablecer la contraseña.
