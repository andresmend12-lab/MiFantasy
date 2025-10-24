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
