# EnQuéGasté

Controlá tus gastos. Organizá tu dinero. Ahorrá más.

App para registrar gastos, ingresos y transferencias, con cuentas y tarjetas, presupuestos, objetivos de ahorro y vencimientos. Cada persona que la usa se crea su propia cuenta y ve solo sus números. Es una plataforma propia e independiente: tiene su propio repositorio, su propio servidor y su propia base de datos.

## Usarla todos los días desde el celular

La app se instala como cualquier otra y abre a pantalla completa, con su ícono.

- **Android (Chrome):** abrí la dirección de la app → menú **⋮** → **Instalar app** (o **Agregar a la pantalla principal**).
- **iPhone (Safari):** abrí la dirección → botón **Compartir** → **Agregar a inicio**.

Si mantenés apretado el ícono en Android aparecen los atajos **Agregar gasto** y **Agregar ingreso**, que abren directo el formulario.

La sesión se renueva cada vez que abrís la app, así que no tenés que volver a ingresar mientras la uses seguido (se cierra sola después de 14 días sin abrirla). Si no hay internet, la app abre igual y avisa que no hay conexión.

## Cuentas: cada persona tiene la suya

Para entrar hay que tener una cuenta. En la pantalla de ingreso, quien no tiene cuenta toca **Crear una cuenta**, pone su nombre, correo y contraseña, y entra. Pueden usarla todas las personas que quieran: cada una ve solo sus propios movimientos, cuentas, presupuestos y ahorros.

La cuenta de administrador es la del correo definido en `ADMIN_EMAIL` (si no está definido, la primera que se crea). El administrador ve la lista de usuarios, puede desactivarlos o generarles una contraseña temporal si se la olvidan, y puede cerrar el registro desde **Administración → Ajustes** si en algún momento no quiere más cuentas nuevas. No ve los movimientos ni los saldos de nadie.

## Cargar capturas

En la pestaña **Capturas** (abajo, en el celular) tocás **Elegir fotos o capturas**, elegís una o varias imágenes y la app:

1. Lee cada imagen con Claude, la inteligencia artificial de Anthropic, y encuentra los gastos e ingresos: importe, fecha, comercio, categoría y medio de pago.
2. Te muestra lo que encontró para que lo revises y corrijas. Si ya tenías un movimiento igual ese día, lo marca como **posible repetido** y no lo tilda.
3. Con **Guardar**, quedan cargados en tu resumen, tus estadísticas y tus presupuestos, como cualquier otro movimiento.

Las imágenes no se guardan: solo los datos que confirmás.

**Activarla (una sola vez, el administrador):**

1. Entrá a https://console.anthropic.com, creá una cuenta y cargá crédito (**Billing**).
2. En **API Keys**, creá una clave (empieza con `sk-ant-`).
3. En EnQuéGasté: **Administración → Ajustes → Lectura de capturas**, pegá la clave y tocá **Guardar clave**. La app comprueba que funcione antes de guardarla.

Cada captura cuesta alrededor de 3 centavos de dólar y se cobra en la cuenta de Anthropic. Cada persona puede leer hasta 40 capturas por hora. También se puede configurar la clave en el servidor con la variable `ANTHROPIC_API_KEY`.

## Qué incluye

- Carga rápida de gastos e ingresos (importe, categoría, medio de pago, guardar) y transferencias entre cuentas.
- **Cargar capturas:** subís fotos o capturas de pantalla de tickets, transferencias, Mercado Pago, home banking o resúmenes de tarjeta, y la app lee los gastos e ingresos y los deja listos para guardar en tu resumen.
- Cuentas: efectivo, banco, billetera virtual, tarjeta de crédito e inversión, en distintas monedas, con saldo calculado.
- Inicio con saldo disponible, ingresos y gastos del mes, gastos por categoría, presupuestos y próximos vencimientos.
- Movimientos con búsqueda y filtros (mes, tipo, categoría, cuenta) y descarga en CSV (abre en Excel).
- Estadísticas: últimos 6 meses, gasto diario promedio, porcentaje ahorrado.
- Presupuestos mensuales por categoría y objetivos de ahorro.
- Vencimientos fijos (alquiler, internet, sueldo): un toque los registra como movimiento.
- Categorías propias, además de las generales.
- Administración: usuarios, categorías generales, medios de pago, monedas, ajustes y registro de acciones. El administrador **no** ve movimientos ni saldos de otras personas.

**Seguridad:** contraseñas con scrypt, sesiones firmadas en cookie HttpOnly, cada consulta filtra por el dueño de los datos, límite de intentos de ingreso, protección CSRF y encabezados de seguridad (CSP, HSTS).

## Publicarla en Render

`render.yaml` describe todo: la web (`enquegaste`) y su base PostgreSQL (`enquegaste-db`), separadas de cualquier otro proyecto.

1. En Render: **New → Blueprint**, elegí este repositorio.
2. Cuando te pida `ADMIN_EMAIL`, poné tu correo: cuando te crees la cuenta con ese correo, vas a ser el administrador.
3. Esperá el primer despliegue, entrá a la dirección que te da Render y creá tu cuenta.

Los planes (`starter` para la web y `basic-256mb` para la base) son pagos: la app está siempre lista y la base no vence. Con el plan gratis la web se “duerme” y tarda cerca de un minuto en abrir, y la base gratuita se borra a los 30 días, así que no conviene para el uso diario.

**Copias de seguridad:** las bases pagas de Render guardan copias automáticas. Además, desde **Movimientos** podés descargar todo en CSV.

Cada vez que se sube un cambio a la rama `main`, Render publica la versión nueva sola, y el celular la toma la próxima vez que abrís la app.

## Correrla en tu computadora

Necesitás Node.js 18 o superior y una base PostgreSQL.

```bash
npm install
DATABASE_URL=postgres://usuario:clave@localhost:5432/enquegaste npm start
```

Abrí http://localhost:3000 y creá tu cuenta. También se puede crear la cuenta principal al arrancar, con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

## Pruebas

Con el servidor corriendo (arrancado con `ADMIN_EMAIL` y `ADMIN_PASSWORD`):

```bash
BASE=http://localhost:3000 ADMIN_EMAIL=vos@correo.com ADMIN_PASSWORD=unaClaveSegura npm test
```

Para probar también el primer uso, arrancá un segundo servidor con una base vacía y sumá `BASE_VACIA=http://localhost:3001` (y `ADMIN_EMAIL_VACIA` si ese servidor tiene `ADMIN_EMAIL`).

Para probar la lectura de capturas sin gastar crédito, arrancá el servidor con `ANTHROPIC_BASE_URL=http://localhost:4010` y sumá `CLAUDE_FALSO_PUERTO=4010` al comando de pruebas: la prueba levanta un servicio de Claude falso en ese puerto.

## Estructura

```
server.js                servidor HTTP
lib/api.js               rutas de la API (usuarios, movimientos, admin…)
lib/db.js                conexión, creación de tablas y datos iniciales
lib/schema.sql           tablas de PostgreSQL
lib/auth.js              contraseñas y sesiones
lib/capturas.js          lectura de fotos y capturas con Claude
lib/minipg.js            cliente PostgreSQL de respaldo (solo si falta el paquete pg)
public/                  interfaz (HTML, CSS, JavaScript, íconos y service worker)
test/                    pruebas
render.yaml              configuración para publicar en Render
```

## Próximos pasos sugeridos

- Recuperación de contraseña por correo (requiere un servicio de envío, como Resend).
- Leer resúmenes de tarjeta en PDF, además de imágenes.
- Resumen de tarjeta por período de cierre.
- Cargar gastos sin conexión y sincronizarlos al volver internet.
