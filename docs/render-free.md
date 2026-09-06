# Despliegue personal en Render Free

`render.yaml` define exactamente un recurso:

- un Web Service llamado `mediadrop-api`;
- runtime Docker usando `backend/Dockerfile`;
- plan `free`, una instancia y región Ohio;
- health check público en `/health`;
- despliegues automáticos desactivados;
- sin base de datos, disco persistente, worker ni servicio auxiliar.

Render proporciona `PORT`; `app.serve` lo respeta y escucha en `0.0.0.0`. El
token no tiene valor en el Blueprint: `sync: false` obliga a introducirlo en el
Dashboard durante la creación inicial y evita guardarlo en Git.

## Paso manual, después de publicar el repositorio

1. Crea una cuenta gratuita en Render sin añadir método de pago.
2. Conecta únicamente el repositorio de MediaDrop desde el proveedor Git.
3. En Render, elige **New > Blueprint** y selecciona el repositorio.
4. Comprueba antes de confirmar que la vista previa contiene solamente
   `mediadrop-api`, de tipo **Web Service**, con plan **Free**. Cancela si aparece
   cualquier recurso o importe adicional.
5. Genera el token fuera del repositorio, por ejemplo en Terminal con
   `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`.
6. Introduce ese valor únicamente en el campo `MEDIADROP_API_TOKEN` del
   Dashboard. No lo pegues en Git, en variables `EXPO_PUBLIC_*` ni en chats.
7. Crea el Blueprint y espera a que `/health` esté sano.

El primer despliegue proporciona una URL `https://<nombre>.onrender.com`. Antes
de compilar para el iPhone hay que verificar `/health`, autenticar `/analyze`,
probar un job completo y colocar esa URL real en un `.env.production` local e
ignorado por Git.

## Límites operativos

El filesystem y los jobs son efímeros. Un reinicio, redeploy o suspensión por
inactividad invalida jobs en memoria y elimina archivos temporales. La app debe
tolerar el arranque en frío de Free; por eso el ejemplo móvil de producción usa
90 segundos para llamadas API.

Los despliegues automáticos están desactivados para no consumir minutos de build
por cada push. Los siguientes despliegues deben iniciarse manualmente desde el
Dashboard y siempre se debe conservar el plan Free.

Para detener el backend, selecciona el servicio y usa **Suspend**. Para retirarlo
definitivamente, elimina primero cualquier referencia al Blueprint y después
borra el Web Service desde su configuración. Confirma en **Billing** que no haya
otros recursos; este Blueprint no define ninguno.
