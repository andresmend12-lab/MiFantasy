# MiFantasy (frontend)

Aplicación web creada con Create React App que permite gestionar tu equipo de LaLiga Fantasy desde cualquier dispositivo. Esta versión incorpora autenticación con Firebase y está preparada para desplegarse automáticamente en GitHub Pages en la URL `https://andresmend12-lab.github.io/MiFantasy/`.

## Requisitos previos

- Node.js 18 o superior.
- Una cuenta de Firebase con un proyecto configurado para usar **Email/Password Authentication**.
- Acceso al repositorio de GitHub `andresmend12-lab/MiFantasy` con GitHub Pages habilitado.

## Configuración inicial

1. Instala las dependencias:
   ```bash
   cd frontend
   npm install
   ```
2. Duplica el archivo [`public/firebase-config.template.js`](public/firebase-config.template.js) como `public/firebase-config.js` y rellena los datos del proyecto de Firebase (pueden copiarse desde la consola de Firebase > Configuración del proyecto > Tus apps > SDK de Firebase para la Web).
3. Activa el proveedor de autenticación Email/Password desde la consola de Firebase (`Build > Authentication > Sign-in method`).

> ⚠️ Los valores del archivo `firebase-config.js` son públicos. No incluyas claves secretas ni credenciales privadas.

## Desarrollo local

```bash
cd frontend
npm start
```

El proyecto se abrirá en [http://localhost:3000](http://localhost:3000). Al no existir un backend público, la acción “Actualizar valor de mercado” permanecerá deshabilitada; puedes seguir usando las herramientas de edición manual para mantener tus datos al día.

## Ejecutar tests

```bash
cd frontend
npm test
```

## Despliegue manual en GitHub Pages

1. Asegúrate de tener el archivo `firebase-config.js` con los valores correctos.
2. Ejecuta el build y publica el contenido:
   ```bash
   cd frontend
   npm run deploy
   ```
3. GitHub Pages actualizará automáticamente el contenido en la URL indicada.

## Despliegue automático (GitHub Actions)

Este repositorio incluye un workflow (`.github/workflows/deploy.yml`) que construye y publica la aplicación cada vez que se fusiona código en la rama `main`. El workflow utiliza los scripts de npm definidos en `package.json` y despliega el contenido generado en la rama `gh-pages`.

## Variables de entorno útiles

- `REACT_APP_FIREBASE_API_KEY`, `REACT_APP_FIREBASE_AUTH_DOMAIN`, etc.: Alternativa al archivo `firebase-config.js` para inyectar la configuración desde variables de entorno durante el build.
- `REACT_APP_ENABLE_MARKET_SNIFFER`: Establécela en `true` únicamente si cuentas con un backend accesible que implemente los endpoints `/api/sniff/*`.
- `REACT_APP_MARKET_SNIFFER_ENDPOINT`: URL completa del endpoint que ejecuta la actualización del mercado.

## Nota sobre el backend

La recopilación automática de mercado depende de los scripts Python existentes y de un endpoint (`/api/sniff/market`). En entornos serverless (como GitHub Pages) necesitarás desplegar estos scripts como función en la nube (Firebase Functions, Cloud Run, etc.) y actualizar la variable `REACT_APP_MARKET_SNIFFER_ENDPOINT`. Mientras no exista dicho backend, el botón de actualización mostrará un mensaje informativo y permanecerá deshabilitado.
