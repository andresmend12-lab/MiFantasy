# MiFantasy - Guía de uso y despliegue

Este proyecto es una aplicación creada con React que permite consultar información de fantasía. A continuación encontrarás los pasos necesarios para ejecutarla en tu entorno local y publicarla en GitHub Pages sin que aparezca una página en blanco.

## Requisitos previos

- [Node.js](https://nodejs.org/) 18 o superior.
- npm (se instala automáticamente con Node.js).
- Git configurado y con acceso al repositorio donde se alojará la página.

## Instalación

1. Clona este repositorio y accede a la carpeta `frontend`:
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd MiFantasy/frontend
   ```
2. Instala las dependencias:
   ```bash
   npm install
   ```

## Ejecución en desarrollo

Para iniciar el entorno de desarrollo y ver los cambios en tiempo real:
```bash
npm start
```
El servidor se abrirá en `http://localhost:3000`.

## Construir la aplicación

Genera la versión optimizada de producción con:
```bash
npm run build
```
Este comando crea la carpeta `build/` con todos los archivos listos para publicar.

## Despliegue en GitHub Pages

1. Asegúrate de que en `package.json` exista la propiedad:
   ```json
   "homepage": "."
   ```
   Esto obliga a que las rutas de los recursos sean relativas y evita la pantalla en blanco.
2. Ejecuta el script de despliegue:
   ```bash
   npm run deploy
   ```
   El script realiza lo siguiente automáticamente:
   - Crea (o reutiliza) un *worktree* en `.gh-pages`.
   - Limpia el contenido anterior de la rama `gh-pages`.
   - Copia cada archivo generado en `build/` directamente a la raíz del *worktree*.
   - Crea un commit y lo envía a la rama `gh-pages` si existe el remoto `origin`.
3. Ve a **Settings → Pages** en tu repositorio de GitHub y selecciona la rama `gh-pages` como fuente. Después de unos minutos, el sitio quedará disponible.

## Actualización automática del mercado

Para automatizar la descarga del `market.json` y evitar errores 405 durante el refresco desde GitHub Pages, el proyecto incluye un pequeño backend en Node.js que ejecuta el script `sniff_market_json_v3_debug.py` de forma programada.

### Requisitos adicionales

- Python 3.10 o superior.
- [Playwright](https://playwright.dev/python/) para Python (se instala con `pip install playwright`).
- Navegadores de Playwright instalados (`python -m playwright install chromium`).

### Puesta en marcha del backend

1. En otra terminal, instala las dependencias del servidor:
   ```bash
   cd ../server
   npm install
   ```
2. (Solo la primera vez) instala Playwright para Python y su navegador headless:
   ```bash
   pip install playwright
   python -m playwright install chromium
   ```
3. Inicia el servicio (por defecto expone la API en `http://localhost:8000/api`):
   ```bash
   npm start
   ```

El backend ejecuta automáticamente una actualización completa al arrancar y luego según la expresión CRON definida en `MARKET_REFRESH_CRON` (por defecto cada 6 horas). Puedes personalizarlo con variables de entorno:

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `PORT` | Puerto HTTP del backend | `8000` |
| `MARKET_REFRESH_CRON` | Cron en formato estándar para refrescar el mercado | `0 */6 * * *` |
| `MARKET_REFRESH_MODE` | Modo pasado al script de sniffing (`full`, `ids`, etc.) | `full` |
| `MARKET_REFRESH_ON_BOOT` | Ejecutar un refresco inicial (`true`/`false`) | `true` |
| `PYTHON_BIN` | Ruta al intérprete de Python | `python3` |
| `MARKET_JSON_PATH` | Ruta donde se escribirá `market.json` | `../market.json` |

### Conectar el frontend con el backend

1. Define la variable `REACT_APP_MARKET_API_BASE` para que los bundles de React conozcan la URL base del backend. Ejemplos:
   - Desarrollo local: crea un archivo `.env.local` dentro de `frontend/` con
     ```env
     REACT_APP_MARKET_API_BASE=http://localhost:8000/api
     ```
   - Producción (GitHub Pages): antes de construir ejecuta
     ```bash
     REACT_APP_MARKET_API_BASE=https://tu-dominio-backend/api npm run build
     ```
     y despliega el contenido generado.
2. Una vez configurado, la aplicación usará `GET <API_BASE>/market` para leer los datos y `POST <API_BASE>/market/refresh` para forzar una actualización manual. Si el backend no está disponible, seguirá utilizando el `market.json` publicado en GitHub Pages.

## Solución de problemas (pantalla en blanco)

Si la página sigue apareciendo en blanco tras el despliegue:

1. Confirma que el archivo `frontend/package.json` tiene `"homepage": "."` y vuelve a ejecutar `npm run build` seguido de `npm run deploy`.
2. Comprueba en la carpeta `frontend/.gh-pages` que existan `index.html` y los activos (`static/js`, `static/css`, etc.) en la raíz y no dentro de una subcarpeta `build/`.
3. Verifica en GitHub que la rama `gh-pages` contenga esos mismos archivos en la raíz.
4. Si el repositorio está en una organización, habilita GitHub Pages desde **Settings → Pages** y asegúrate de que la visibilidad sea pública.
5. Limpia la caché del navegador o abre una ventana en modo incógnito para descartar archivos antiguos.

## Scripts disponibles

- `npm start`: inicia el entorno de desarrollo.
- `npm test`: ejecuta las pruebas.
- `npm run build`: genera la compilación de producción.
- `npm run deploy`: publica la aplicación en `gh-pages`.

Para más detalles sobre Create React App, visita la [documentación oficial](https://create-react-app.dev/).
