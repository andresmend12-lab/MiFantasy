import cors from "cors";
import express from "express";
import { readFile, stat, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import cron from "node-cron";
import pino from "pino";
import { ensureDir } from "fs-extra";
import { sniffMarket } from "./sniffer/playwright.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const MARKET_JSON_PATH = path.resolve(
  PROJECT_ROOT,
  process.env.MARKET_JSON_PATH || "market.json"
);

const MARKET_REFRESH_MODE = process.env.MARKET_REFRESH_MODE || "market";
const REFRESH_CRON = process.env.MARKET_REFRESH_CRON || "0 */6 * * *"; // every 6 hours
const PORT = Number(process.env.PORT) || 8000;

let lastRefreshStartedAt = null;
let lastRefreshFinishedAt = null;
let lastRefreshError = null;
let refreshPromise = null;

const readMarketPayload = async () => {
  try {
    const contents = await readFile(MARKET_JSON_PATH, "utf-8");
    const parsed = JSON.parse(contents);
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const runSniffer = async () => {
  await ensureDir(path.dirname(MARKET_JSON_PATH));
  const normalizedMode =
    MARKET_REFRESH_MODE && MARKET_REFRESH_MODE.toLowerCase() === "full"
      ? "market"
      : MARKET_REFRESH_MODE;
  logger.info({ mode: normalizedMode }, "Ejecutando actualización de mercado");
  const payload = await sniffMarket({
    logger,
    mode: normalizedMode,
  });
  await writeFile(MARKET_JSON_PATH, JSON.stringify(payload, null, 2), "utf-8");
  return payload;
};

const refreshMarket = async ({ force = false } = {}) => {
  if (refreshPromise && !force) {
    return refreshPromise;
  }

  const performRefresh = async () => {
    lastRefreshError = null;
    lastRefreshStartedAt = new Date().toISOString();
    try {
      const payload = await runSniffer();
      lastRefreshFinishedAt = new Date().toISOString();
      return payload;
    } catch (error) {
      lastRefreshError = error;
      lastRefreshFinishedAt = new Date().toISOString();
      logger.error({ err: error }, "Fallo al actualizar el mercado");
      throw error;
    }
  };

  refreshPromise = performRefresh().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", async (req, res) => {
  const payload = await readMarketPayload().catch(() => null);
  let lastModified = null;
  try {
    const stats = await stat(MARKET_JSON_PATH);
    lastModified = stats.mtime.toISOString();
  } catch {
    /* ignore */
  }
  res.json({
    status: "ok",
    lastRefreshStartedAt,
    lastRefreshFinishedAt,
    lastRefreshError: lastRefreshError ? String(lastRefreshError.message || lastRefreshError) : null,
    lastModified,
    hasMarket: Boolean(payload),
  });
});

app.get("/api/market", async (req, res) => {
  try {
    const payload = await readMarketPayload();
    if (!payload) {
      return res.status(404).json({ error: "market.json no disponible" });
    }
    res.json(payload);
  } catch (error) {
    logger.error({ err: error }, "Error al leer market.json");
    res.status(500).json({ error: "No se pudo leer market.json" });
  }
});

const handleRefreshRequest = async (req, res) => {
  try {
    const payload = await refreshMarket({ force: true });
    res.json({
      status: "ok",
      updatedAt: lastRefreshFinishedAt,
      count: Array.isArray(payload?.players) ? payload.players.length : null,
    });
  } catch (error) {
    res.status(500).json({
      error: "No se pudo actualizar el mercado",
      details: error?.message || String(error),
    });
  }
};

app.post("/api/market/refresh", handleRefreshRequest);
app.post("/api/sniff/market", handleRefreshRequest);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

const startServer = () => {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "Servidor iniciado");
  });
};

if (REFRESH_CRON) {
  cron.schedule(
    REFRESH_CRON,
    () => {
      logger.info({ cron: REFRESH_CRON }, "Ejecutando actualización programada");
      refreshMarket({ force: true }).catch((error) => {
        logger.error({ err: error }, "Actualización programada fallida");
      });
    },
    { timezone: process.env.MARKET_REFRESH_TZ || "Europe/Madrid" }
  );
}

const AUTO_REFRESH_ON_BOOT = process.env.MARKET_REFRESH_ON_BOOT !== "false";
if (AUTO_REFRESH_ON_BOOT) {
  refreshMarket({ force: true }).catch((error) => {
    logger.warn({ err: error }, "Actualización inicial fallida; se usará el market.json existente");
  });
}

startServer();
