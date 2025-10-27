# Backend de actualización automática

Este servicio Express utiliza Playwright (Chromium) para regenerar `market.json` de forma programada y expone una API REST que el frontend puede consumir.

## Requisitos

- Node.js 18 o superior.
- Dependencias de npm instaladas (`npm install`).
- Playwright con Chromium (se descarga automáticamente al hacer `npm install`, pero puedes forzarlo con `npx playwright install chromium`).
- En Linux necesitarás las dependencias del sistema para Chromium; puedes instalarlas con `npx playwright install-deps` (o el comando equivalente de tu distribución).

## Puesta en marcha

```bash
cd server
npm install
npx playwright install chromium
npm start
```

> 💡 El backend intentará descargar Chromium automáticamente si detecta que no está instalado. Si prefieres instalarlo manualmente
> (por ejemplo, en entornos corporativos con proxies), ejecuta `npx playwright install chromium` antes de iniciar el servidor.

Puedes usar el fichero [`server/.env.example`](./.env.example) como plantilla para tu configuración local.

Por defecto el servidor escucha en `http://localhost:8000` y expone las siguientes rutas:

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/healthz` | Estado del servicio y marca de tiempo del último refresco. |
| `GET` | `/api/market` | Devuelve el último `market.json` generado. |
| `POST` | `/api/market/refresh` | Lanza una actualización inmediata ejecutando el script de sniffing. |
| `POST` | `/api/sniff/market` | Alias de la ruta anterior para compatibilidad. |

## Variables de entorno

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `PORT` | Puerto HTTP | `8000` |
| `MARKET_REFRESH_CRON` | Cron para refrescos programados | `0 */6 * * *` |
| `MARKET_REFRESH_MODE` | Modo de captura (`market` o `points`) | `market` |
| `MARKET_REFRESH_ON_BOOT` | Ejecuta un refresco al arrancar (`true`/`false`) | `true` |
| `MARKET_JSON_PATH` | Ruta absoluta o relativa para `market.json` | `../market.json` |
| `MARKET_SOURCE_URL` | URL desde la que se extraen los datos | `https://www.futbolfantasy.com/analytics/laliga-fantasy/mercado` |
| `PLAYWRIGHT_HEADLESS` | Ejecuta Chromium en modo headless (`true`/`false`) | `true` |

## Despliegue

Puedes ejecutar el backend en cualquier servidor o plataforma (VPS, Railway, Render, etc.). Asegúrate de exponer HTTPS y asignar el valor completo (por ejemplo `https://tu-backend/api`) a `REACT_APP_MARKET_API_BASE` antes de construir el frontend.
