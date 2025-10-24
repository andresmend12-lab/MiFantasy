import { chromium } from "playwright";
import { spawn } from "child_process";
import { fallbackName, sanitizeName, toFloat, toInt } from "../name-utils.js";

const MARKET_URL =
  process.env.MARKET_SOURCE_URL ||
  "https://www.futbolfantasy.com/analytics/laliga-fantasy/mercado";

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS === "false" ? false : true;

const PLAYWRIGHT_INSTALL_ERROR_SNIPPETS = [
  "looks like Playwright was just installed",
  "Please install playwright",
  "browser binaries are not installed",
  "run the following command to download new browsers",
  "npx playwright install",
];

let attemptedBrowserInstall = false;

const runPlaywrightInstall = (logger) =>
  new Promise((resolve, reject) => {
    const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(cmd, ["playwright", "install", "chromium"], {
      stdio: "inherit",
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `No se pudo instalar Chromium para Playwright (código ${code}).`
          )
        );
      }
    });
  });

const ensureBrowser = async (logger) => {
  try {
    return await chromium.launch({ headless: HEADLESS });
  } catch (error) {
    const message = String(error || "");
    const shouldInstall =
      !attemptedBrowserInstall &&
      PLAYWRIGHT_INSTALL_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
    if (shouldInstall) {
      attemptedBrowserInstall = true;
      logger?.info("Instalando Chromium para Playwright…");
      await runPlaywrightInstall(logger);
      return chromium.launch({ headless: HEADLESS });
    }
    throw error;
  }
};

const extractPlayers = async (page) => {
  await page.waitForSelector("div.lista_elementos div.elemento_jugador", { timeout: 90_000 });
  return page.$$eval("div.lista_elementos div.elemento_jugador", (cards) => {
    const firstValue = (...values) => {
      for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== "") {
          return value;
        }
      }
      return null;
    };

    const toInteger = (value) => {
      if (value === null || value === undefined) return 0;
      const text = String(value)
        .replace(/\xa0/g, " ")
        .replace(/\./g, "")
        .replace(/€/g, "")
        .replace(/ /g, "")
        .replace(/,/g, "");
      const parsed = Number.parseInt(text, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const toNumber = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      let text = String(value).trim();
      if (!text) return null;
      text = text.replace(/\s+/g, " ");
      if (text.includes(",")) {
        text = text.replace(/\./g, "").replace(/,/g, ".");
      }
      text = text.replace(/[^0-9.+-]/g, "");
      if (!text) return null;
      const parsed = Number.parseFloat(text);
      return Number.isNaN(parsed) ? null : parsed;
    };

    return cards.map((card) => {
      const attr = (name) => card.getAttribute(name);
      const dataset = card.dataset || {};
      const textContent = (selector) => {
        const el = card.querySelector(selector);
        return el ? el.textContent.trim() : "";
      };

      const onclick = attr("onclick") || "";
      const idMatch = onclick.match(/,\s*([0-9]+)\s*\)\s*;/);
      const id = idMatch ? Number.parseInt(idMatch[1], 10) : null;

      const avg = firstValue(
        attr("data-media"),
        attr("data-media-total"),
        attr("data-media_jornada"),
        attr("data-mediajornada"),
        attr("data-mediajornadas"),
        attr("data-media-puntos"),
        attr("data-promedio"),
        attr("data-puntos")
      );

      const recent = firstValue(
        attr("data-media5"),
        attr("data-media-5"),
        attr("data-media5partidos"),
        attr("data-media5p"),
        attr("data-media_reciente"),
        attr("data-media-reciente"),
        attr("data-mediaultimos5"),
        attr("data-media-ultimos5"),
        attr("data-ultimos5"),
        attr("data-ult5"),
        attr("data-puntos5")
      );

      const total = firstValue(
        attr("data-puntos-total"),
        attr("data-puntos_total"),
        attr("data-puntos-totales"),
        attr("data-puntos_totales"),
        attr("data-total-puntos"),
        attr("data-total_puntos"),
        attr("data-totalpuntos"),
        attr("data-puntos-temporada"),
        attr("data-puntos-season"),
        attr("data-puntos_temporada")
      );

      const result = {
        id,
        nameVisible: textContent(".datos-nombre"),
        nameAttr: attr("data-nombre") || attr("data-name") || dataset.nombre || dataset.name || "",
        team: textContent(".equipo span"),
        teamId: attr("data-equipo") || dataset.equipo || dataset.team || "",
        position: attr("data-posicion") || dataset.posicion || dataset.position || "",
        value: toInteger(attr("data-valor") || dataset.valor),
        points_avg: toNumber(avg),
        points_last5: toNumber(recent),
        points_total: toNumber(total),
        points_history: [],
      };

      const intervals = [1, 2, 3, 7, 14, 30];
      for (const key of intervals) {
        result[`value_${key}`] = toInteger(attr(`data-valor${key}`) || dataset[`valor${key}`]);
        result[`diff_${key}`] = toInteger(attr(`data-diferencia${key}`) || dataset[`diferencia${key}`]);
        const pctRaw = attr(`data-diferencia-pct${key}`) || dataset[`diferenciaPct${key}`];
        if (pctRaw === undefined || pctRaw === null || String(pctRaw).trim() === "") {
          result[`diff_pct_${key}`] = 0;
        } else {
          const normalized = String(pctRaw).replace(/,/g, ".").replace(/[^0-9.+-]/g, "");
          const parsed = Number.parseFloat(normalized);
          result[`diff_pct_${key}`] = Number.isNaN(parsed) ? 0 : parsed;
        }
      }

      return result;
    });
  });
};

export const sniffMarket = async ({ logger, mode } = {}) => {
  const browser = await ensureBrowser(logger);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(MARKET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    const acceptButtons = [
      "button:has-text('Aceptar')",
      "button:has-text('Acepto')",
      "button:has-text('Agree')",
      "div[role='dialog'] button:has-text('Aceptar')",
    ];
    for (const selector of acceptButtons) {
      try {
        const button = page.locator(selector).first;
        if (await button.isVisible({ timeout: 2000 })) {
          await button.click({ timeout: 1000 });
          await page.waitForTimeout(400);
          break;
        }
      } catch (error) {
        if (String(error).includes("Timeout")) {
          continue;
        }
      }
    }

    const rawPlayers = await extractPlayers(page);
    const players = rawPlayers.map((player) => {
      const name = fallbackName(player.nameAttr, player.nameVisible);
      return {
        id: player.id,
        name: sanitizeName(name),
        team_id: player.teamId ? String(player.teamId).trim() : "",
        team: player.team,
        position: player.position,
        value: toInt(player.value),
        points_avg: toFloat(player.points_avg),
        points_last5: toFloat(player.points_last5),
        points_total: toFloat(player.points_total),
        points_history: Array.isArray(player.points_history) ? player.points_history : [],
        value_1: toInt(player.value_1),
        diff_1: toInt(player.diff_1),
        diff_pct_1: toFloat(player.diff_pct_1) ?? 0,
        value_2: toInt(player.value_2),
        diff_2: toInt(player.diff_2),
        diff_pct_2: toFloat(player.diff_pct_2) ?? 0,
        value_3: toInt(player.value_3),
        diff_3: toInt(player.diff_3),
        diff_pct_3: toFloat(player.diff_pct_3) ?? 0,
        value_7: toInt(player.value_7),
        diff_7: toInt(player.diff_7),
        diff_pct_7: toFloat(player.diff_pct_7) ?? 0,
        value_14: toInt(player.value_14),
        diff_14: toInt(player.diff_14),
        diff_pct_14: toFloat(player.diff_pct_14) ?? 0,
        value_30: toInt(player.value_30),
        diff_30: toInt(player.diff_30),
        diff_pct_30: toFloat(player.diff_pct_30) ?? 0,
      };
    });

    return {
      updated_at: new Date().toISOString(),
      count: players.length,
      players,
      mode: mode || "market",
      source: MARKET_URL,
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
};
