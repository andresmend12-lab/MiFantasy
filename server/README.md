# Backend de actualización automática

Este servicio Express ejecuta el script `sniff_market_json_v3_debug.py` para regenerar `market.json` de forma programada y expone una API REST que el frontend puede consumir.

## Requisitos

- Node.js 18 o superior.
- Python 3.10+ con `pip` (en Windows puedes usar el lanzador `py`).
- Dependencias de Python: `playwright` y los navegadores (`python -m playwright install chromium`).

## Puesta en marcha

```bash
cd server
npm install
pip install playwright
python -m playwright install chromium
npm start
```

> 💡 En Windows, si `npm start` muestra el error `no se encontró Python`, instala Python 3 y asegúrate de que `py` o `python`
> estén disponibles en la variable PATH. También puedes crear un fichero `.env` en la carpeta `server` y definir `PYTHON_BIN`
> con la ruta completa del ejecutable, por ejemplo `PYTHON_BIN="C:\\Python312\\python.exe"`.

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
| `MARKET_REFRESH_MODE` | Modo del script (`full`, `ids`, etc.) | `full` |
| `MARKET_REFRESH_ON_BOOT` | Ejecuta un refresco al arrancar (`true`/`false`) | `true` |
| `MARKET_JSON_PATH` | Ruta absoluta o relativa para `market.json` | `../market.json` |
| `PYTHON_BIN` | Ejecutable de Python (se detecta automáticamente entre `py`, `python`, `python3`) | *(detección automática)* |
| `MARKET_SNIFFER_PATH` | Ruta al script de Playwright | `../sniff_market_json_v3_debug.py` |

## Despliegue

Puedes ejecutar el backend en cualquier servidor o plataforma (VPS, Railway, Render, etc.). Asegúrate de exponer HTTPS y asignar el valor completo (por ejemplo `https://tu-backend/api`) a `REACT_APP_MARKET_API_BASE` antes de construir el frontend.
