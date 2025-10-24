import cors from "cors";
import express from "express";
import fs from "fs";
import { readFile, stat } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import { spawn, spawnSync } from "child_process";
import cron from "node-cron";
import pino from "pino";
import { ensureDir } from "fs-extra";

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

const SNIFFER_SCRIPT = path.resolve(
  PROJECT_ROOT,
  process.env.MARKET_SNIFFER_PATH || "sniff_market_json_v3_debug.py"
);

const MARKET_REFRESH_MODE = process.env.MARKET_REFRESH_MODE || "full";
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

let resolvedPythonBin = null;

const detectPythonBin = () => {
  if (resolvedPythonBin) {
    return resolvedPythonBin;
  }

  const explicit = process.env.PYTHON_BIN || process.env.PYTHON;
  const candidates = explicit
    ? [explicit]
    : process.platform === "win32"
    ? ["py", "python", "python3"]
    : ["python3", "python"];

  for (const candidate of candidates) {
    const check = spawnSync(candidate, ["--version"], {
      stdio: "pipe",
      windowsHide: true,
    });

    if (!check.error && check.status === 0) {
      resolvedPythonBin = candidate;
      logger.info({ python: candidate }, "Intérprete de Python detectado");
      return resolvedPythonBin;
    }

    if (check.error && check.error.code !== "ENOENT") {
      logger.warn(
        { python: candidate, err: check.error },
        "No se pudo comprobar la versión de Python"
      );
    }
  }

  throw new Error(
    "No se encontró un intérprete de Python. Instala Python 3 o configura la variable de entorno PYTHON_BIN con la ruta correcta."
  );
};

const ensureSnifferExists = () => {
  if (!fs.existsSync(SNIFFER_SCRIPT)) {
    throw new Error(`No se encontró el script de sniffing en ${SNIFFER_SCRIPT}`);
  }
};

const runSniffer = async () => {
  ensureSnifferExists();

  await ensureDir(path.dirname(MARKET_JSON_PATH));

  return new Promise((resolve, reject) => {
    const pythonBin = detectPythonBin();
    const args = [SNIFFER_SCRIPT];
    if (MARKET_REFRESH_MODE) {
      args.push("--mode", MARKET_REFRESH_MODE);
    }
    logger.info({ args }, "Ejecutando script de sniffing");
    const child = spawn(pythonBin, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      logger.info({ msg: text.trim() }, "sniffer:stdout");
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      logger.error({ msg: text.trim() }, "sniffer:stderr");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(
          `El proceso de sniffing finalizó con código ${code}. ${stderr}`
        );
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
};

const refreshMarket = async ({ force = false } = {}) => {
  if (refreshPromise && !force) {
    return refreshPromise;
  }

  const performRefresh = async () => {
    lastRefreshError = null;
    lastRefreshStartedAt = new Date().toISOString();
    try {
      await runSniffer();
      const payload = await readMarketPayload();
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
