import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const normalizeText = (value) =>
  typeof value === "string" ? value : value ? String(value) : "";

const collapseWhitespace = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const dedupeDuplicateBlock = (value) => {
  if (!value) return "";
  const s = value;
  if (s.length % 2 === 0) {
    const half = s.length / 2;
    if (s.slice(0, half) === s.slice(half)) {
      return s.slice(0, half).trim();
    }
  }
  const match = s.match(/^(.*)\s+\1$/);
  if (match) {
    return match[1].trim();
  }
  return s;
};

const dedupeConsecutiveWords = (value) => {
  if (!value) return "";
  const parts = value.split(" ");
  return parts
    .filter((part, index) => index === 0 || part.toLowerCase() !== parts[index - 1].toLowerCase())
    .join(" ");
};

const isLowerLetter = (char) => /\p{Ll}/u.test(char);
const isUpperLetter = (char) => /\p{Lu}/u.test(char);

const splitCamelChunk = (chunk) => {
  if (!chunk) return [];
  const result = [];
  let current = "";
  for (let i = 0; i < chunk.length; i += 1) {
    const char = chunk[i];
    if (i > 0 && isUpperLetter(char) && isLowerLetter(chunk[i - 1]) && current.length >= 3) {
      result.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) {
    result.push(current);
  }
  return result;
};

const tokenizeName = (value) => {
  const base = collapseWhitespace(normalizeText(value));
  if (!base) return [];
  const tokens = [];
  const matcher = /[\p{L}0-9.'’-]+|[^\s]+/gu;
  for (const raw of base.split(/\s+/)) {
    for (const part of splitCamelChunk(raw)) {
      const matches = part.match(matcher);
      if (matches) {
        tokens.push(...matches);
      } else {
        tokens.push(part);
      }
    }
  }
  return tokens;
};

const dedupeTrailingTokens = (value) => {
  const tokens = tokenizeName(value);
  if (!tokens.length) return "";
  const normalizeToken = (token) =>
    token
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s.'’´`-]/g, "")
      .toLocaleLowerCase("es-ES");
  const deduped = [];
  let lastNorm = null;
  for (const token of tokens) {
    const norm = normalizeToken(token);
    if (norm && norm === lastNorm) {
      continue;
    }
    deduped.push(token);
    lastNorm = norm;
  }

  let end = deduped.length;
  while (end > 0) {
    const token = deduped[end - 1];
    const norm = normalizeToken(token);
    if (!norm) {
      end -= 1;
      continue;
    }
    const preceding = deduped.slice(0, end - 1).map(normalizeToken);
    if (preceding.includes(norm)) {
      end -= 1;
      continue;
    }
    if (norm.length <= 2 && preceding.some((item) => item.startsWith(norm))) {
      end -= 1;
      continue;
    }
    break;
  }

  return deduped.slice(0, end).join(" ");
};

const dedupeTrailingBlock = (value) => {
  const base = collapseWhitespace(normalizeText(value));
  if (!base) return "";

  const hasUpperOrSeparator = (chunk) =>
    /[A-ZÁÉÍÓÚÜÑ]/.test(chunk) || /[ \-'\u2019]/.test(chunk);

  let current = base;
  while (true) {
    const lower = current.toLocaleLowerCase("es-ES");
    let updated = false;
    for (let size = Math.floor(current.length / 2); size > 0; size -= 1) {
      const chunk = current.slice(-size);
      if (chunk.trim().length < 3 || !hasUpperOrSeparator(chunk)) {
        continue;
      }
      const suffix = lower.slice(-size);
      if (lower.endsWith(suffix + suffix)) {
        current = current.slice(0, -size).trimEnd();
        updated = true;
        break;
      }
    }
    if (!updated) break;
  }

  return current;
};

const sanitizeName = (value) => {
  const base = collapseWhitespace(
    normalizeText(value)
      .split(/\s*\n\s*/)[0]
  );
  const cleaned = dedupeTrailingBlock(
    dedupeConsecutiveWords(dedupeDuplicateBlock(base))
  );
  return dedupeTrailingTokens(cleaned);
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const toOptionalNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const base = collapseWhitespace(normalizeText(value));
  if (!base) return null;
  let cleaned = base.replace(/%/g, "");
  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(/,/g, ".");
  }
  cleaned = cleaned.replace(/[^0-9.+-]/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
};

const fmtEUR = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const MARKET_CACHE_STORAGE_KEY = "playerMarketCache";
const SCORE_CACHE_STORAGE_KEY = "playerScoresCache";
const MARKET_ENDPOINT = "/market.json";
const PLAYER_DETAIL_ENDPOINT = "https://www.laligafantasymarca.com/api/v3/player";
const PLAYER_DETAIL_COMPETITION = "laliga-fantasy";
const SCORE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SNIFFER_COMMAND_ENDPOINTS = {
  market: "/api/sniff/market",
  points: "/api/sniff/points",
};

const getSnifferFriendlyName = (type) =>
  type === "points"
    ? "puntos de jornada"
    : type === "market"
    ? "valor de mercado"
    : "actualización";

async function executeSnifferCommand(type) {
  const endpoint = SNIFFER_COMMAND_ENDPOINTS[type];
  if (!endpoint) {
    return null;
  }
  if (typeof fetch !== "function") {
    const error = new Error(
      `No se puede ejecutar la ${getSnifferFriendlyName(
        type
      )} desde este entorno.`
    );
    error.isSnifferCommandError = true;
    throw error;
  }

  let response;
  try {
    response = await fetch(endpoint, { method: "POST" });
  } catch (networkError) {
    const error = new Error(
      `No se pudo lanzar la ${getSnifferFriendlyName(type)} (${networkError?.message ?? "error de red"}).`
    );
    error.isSnifferCommandError = true;
    error.cause = networkError;
    throw error;
  }

  if (!response || !response.ok) {
    let details = "";
    try {
      details = await response.text();
    } catch {
      /* noop */
    }
    const message = details?.trim()
      ? details.trim()
      : `La ${getSnifferFriendlyName(type)} finalizó con errores (${response?.status ?? "desconocido"}).`;
    const error = new Error(message);
    error.isSnifferCommandError = true;
    error.status = response?.status;
    throw error;
  }

  try {
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }
  } catch {
    /* ignore parse errors */
  }

  try {
    await response.text();
  } catch {
    /* noop */
  }
  return null;
}

const sanitizeMarketCacheValue = (value) => {
  const parsed = toOptionalNumber(value);
  return parsed !== null ? parsed : null;
};

const sanitizeMarketCache = (value) => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce((acc, [key, entry]) => {
    if (!key) return acc;
    const num = sanitizeMarketCacheValue(entry);
    if (num !== null) {
      acc[key] = num;
    }
    return acc;
  }, {});
};

const sleep = (ms) =>
  new Promise((resolve) => {
    const timeout = Number.isFinite(ms) && ms > 0 ? ms : 0;
    setTimeout(resolve, timeout);
  });

const store = {
  jugadoresEquipo: [],
  cacheMercado: {},
  cachePuntuaciones: {},
};

const storeControl = {
  refreshMarketFor: null,
  refreshPointsFor: null,
  pushToast: null,
  getPlayerIds: () =>
    store.jugadoresEquipo
      .map((jugador) =>
        jugador?.id !== null && jugador?.id !== undefined
          ? Number(jugador.id)
          : null
      )
      .filter((value) => Number.isFinite(value)),
};

const toastStyles = {
  info: "border border-gray-200 bg-white text-gray-700",
  success: "border border-green-200 bg-green-50 text-green-700",
  warning: "border border-yellow-200 bg-yellow-50 text-yellow-700",
  error: "border border-red-200 bg-red-50 text-red-700",
};

const runWithConcurrency = async (items, concurrency, handler) => {
  const queue = Array.from(items);
  if (!queue.length) {
    return [];
  }
  const results = [];
  let nextIndex = 0;
  const takeNext = () => {
    if (nextIndex >= queue.length) {
      return null;
    }
    const value = queue[nextIndex];
    nextIndex += 1;
    return value;
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency ?? 1, queue.length)) },
    () =>
      (async () => {
        while (true) {
          const item = takeNext();
          if (item === null) {
            break;
          }
          try {
            const result = await handler(item);
            results.push({ status: "fulfilled", value: result, item });
          } catch (error) {
            results.push({ status: "rejected", reason: error, item });
          }
        }
      })()
  );
  await Promise.all(workers);
  return results;
};

async function runMarketSniffer(playerIds, { concurrency = 4, force = true } = {}) {
  const ids = Array.from(
    new Set(
      (playerIds || [])
        .map((id) =>
          id === null || id === undefined || id === "" ? null : Number(id)
        )
        .filter((value) => Number.isFinite(value))
    )
  );
  if (!ids.length || typeof storeControl.refreshMarketFor !== "function") {
    return [];
  }
  const results = await runWithConcurrency(ids, concurrency, (id) =>
    storeControl.refreshMarketFor(id, { force })
  );
  if (typeof window !== "undefined" && window?.dispatchEvent) {
    try {
      window.dispatchEvent(new CustomEvent("market:updated"));
    } catch (error) {
      console.warn("No se pudo emitir el evento market:updated", error);
    }
  }
  return results;
}

async function runPointsSniffer(playerIds, { concurrency = 3, force = false } = {}) {
  const ids = Array.from(
    new Set(
      (playerIds || [])
        .map((id) =>
          id === null || id === undefined || id === "" ? null : Number(id)
        )
        .filter((value) => Number.isFinite(value))
    )
  );
  if (!ids.length || typeof storeControl.refreshPointsFor !== "function") {
    return [];
  }
  return runWithConcurrency(ids, concurrency, (id) =>
    storeControl.refreshPointsFor(id, { force })
  );
}

export async function sniff_market_json_v3_debug_market(options = {}) {
  storeControl.pushToast?.("Actualizando valor de mercado…", { type: "info" });
  try {
    await executeSnifferCommand("market");
    const ids = storeControl.getPlayerIds();
    const results = ids.length ? await runMarketSniffer(ids, options) : [];
    storeControl.pushToast?.("Actualización completada", { type: "success" });
    return results;
  } catch (error) {
    storeControl.pushToast?.(
      error?.message ?? "No se pudo completar la actualización de mercado.",
      { type: "error" }
    );
    throw error;
  }
}

export async function sniff_market_json_v3_debug_points(options = {}) {
  storeControl.pushToast?.("Actualizando puntos de jornada…", { type: "info" });
  try {
    await executeSnifferCommand("points");
    const ids = storeControl.getPlayerIds();
    const results = ids.length ? await runPointsSniffer(ids, options) : [];
    storeControl.pushToast?.("Actualización completada", { type: "success" });
    return results;
  } catch (error) {
    storeControl.pushToast?.(
      error?.message ?? "No se pudo completar la actualización de puntos.",
      { type: "error" }
    );
    throw error;
  }
}

const normalizeScoreEntries = (value) =>
  normalizePointsHistory(value).map((item) => ({
    jornada: item.matchday,
    puntos: item.points,
  }));

const getResumenPuntos = (entries) => {
  const history = normalizeScoreEntries(entries);
  if (!history.length) {
    return {
      total: null,
      media: null,
      mediaUltimas5: null,
      ultimas5: [],
      history: [],
    };
  }

  const total = history.reduce((acc, item) => acc + item.puntos, 0);
  const media = total / history.length;
  const ultimas5 = history.slice(-5);
  const totalUltimas5 = ultimas5.reduce((acc, item) => acc + item.puntos, 0);
  const mediaUltimas5 = ultimas5.length ? totalUltimas5 / ultimas5.length : null;

  return {
    total,
    media,
    mediaUltimas5,
    ultimas5,
    history,
  };
};

const sanitizeScoreCacheEntry = (entry) => {
  if (!entry) {
    return { data: [], fetchedAt: null };
  }
  const base = Array.isArray(entry.data) || Array.isArray(entry)
    ? entry.data ?? entry
    : Array.isArray(entry.history)
    ? entry.history
    : [];
  const data = normalizeScoreEntries(base);
  const fetchedAt =
    typeof entry.fetchedAt === "string"
      ? entry.fetchedAt
      : typeof entry.cacheFechaPuntuacion === "string"
      ? entry.cacheFechaPuntuacion
      : null;
  return { data, fetchedAt };
};

const sanitizeScoreCache = (value) => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce((acc, [key, entry]) => {
    if (!key) return acc;
    acc[key] = sanitizeScoreCacheEntry(entry);
    return acc;
  }, {});
};

const buildPlayerDetailUrl = (playerId) => {
  if (playerId === null || playerId === undefined) return null;
  const id = String(playerId).trim();
  if (!id) return null;
  return `${PLAYER_DETAIL_ENDPOINT}/${encodeURIComponent(
    id
  )}?competition=${encodeURIComponent(PLAYER_DETAIL_COMPETITION)}`;
};

const parseScoreDataFromJson = (payload) => {
  if (!payload) return [];
  const candidates = [];
  const pushCandidate = (value) => {
    if (value) {
      candidates.push(value);
    }
  };

  if (Array.isArray(payload)) {
    pushCandidate(payload);
  }
  pushCandidate(payload.jornadas);
  pushCandidate(payload.jornada);
  pushCandidate(payload.data?.jornadas);
  pushCandidate(payload.data?.jornada);
  pushCandidate(payload.player?.jornadas);
  pushCandidate(payload.player?.points_history);
  pushCandidate(payload.player?.matchday_points);
  pushCandidate(payload.player?.matchdays);
  pushCandidate(payload.player?.statistics?.matchdays);
  pushCandidate(payload.matchdays);
  pushCandidate(payload.points_history);
  pushCandidate(payload.history);

  for (const candidate of candidates) {
    const normalized = normalizeScoreEntries(candidate);
    if (normalized.length) {
      return normalized;
    }
  }
  return [];
};

const parseScoreDataFromHtml = (html) => {
  if (typeof DOMParser === "undefined" || !html) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const rowCandidates = [];

    doc.querySelectorAll("table").forEach((table) => {
      table.querySelectorAll("tr").forEach((row) => {
        const cells = row.querySelectorAll("td,th");
        if (cells.length < 2) return;
        const jornadaText = collapseWhitespace(cells[0].textContent ?? "");
        const puntosText = collapseWhitespace(cells[1].textContent ?? "");
        rowCandidates.push({ jornada: jornadaText, puntos: puntosText });
      });
    });

    if (rowCandidates.length) {
      const normalized = normalizeScoreEntries(rowCandidates);
      if (normalized.length) {
        return normalized;
      }
    }

    const dataAttributes = [];
    doc
      .querySelectorAll("[data-matchday],[data-jornada]")
      .forEach((node) => {
        const jornadaAttr =
          node.getAttribute("data-matchday") ?? node.getAttribute("data-jornada");
        const puntosAttr =
          node.getAttribute("data-points") ??
          node.getAttribute("data-score") ??
          node.getAttribute("data-puntos") ??
          node.textContent;
        if (jornadaAttr != null) {
          dataAttributes.push({ jornada: jornadaAttr, puntos: puntosAttr });
        }
      });
    if (dataAttributes.length) {
      const normalized = normalizeScoreEntries(dataAttributes);
      if (normalized.length) {
        return normalized;
      }
    }

    const text = collapseWhitespace(doc.body?.textContent ?? "");
    if (text) {
      const lines = text.split(/\s*(?:\r?\n|\.|;)+\s*/).filter(Boolean);
      const normalized = normalizeScoreEntries(lines);
      if (normalized.length) {
        return normalized;
      }
    }
  } catch (error) {
    console.warn("No se pudo parsear el HTML de puntuaciones", error);
  }
  return [];
};

let marketPayloadCache = null;
let lastMarketPayload = null;

const loadMarketPayload = async () => {
  if (marketPayloadCache) {
    return marketPayloadCache;
  }
  const request = (async () => {
    if (typeof fetch !== "function") {
      throw new Error("fetch no está disponible en este entorno");
    }
    const response = await fetch(MARKET_ENDPOINT, { credentials: "include" });
    if (!response || !response.ok) {
      throw new Error(
        `Respuesta no válida al cargar el mercado (${response?.status ?? "desconocido"})`
      );
    }
    const data = await response.json();
    lastMarketPayload = data;
    return data;
  })();
  marketPayloadCache = request
    .catch((error) => {
      console.warn("No se pudo refrescar el mercado", error);
      if (lastMarketPayload) {
        return lastMarketPayload;
      }
      throw error;
    })
    .finally(() => {
      marketPayloadCache = null;
    });
  return marketPayloadCache;
};

export async function fetchValorMercadoJugador(playerId) {
  if (playerId === null || playerId === undefined || playerId === "") {
    throw new Error("ID de jugador no válido");
  }
  const normalizedId = String(playerId);
  const payload = await loadMarketPayload();
  const players = Array.isArray(payload?.players) ? payload.players : [];
  const normalizeNameKey = (value) =>
    sanitizeName(value ?? "")?.toLocaleLowerCase("es-ES") ?? null;
  const byId = players.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const rawId =
      entry.id ??
      entry.playerId ??
      entry.player_id ??
      entry.playerID ??
      entry.idJugador ??
      entry.jugadorId;
    if (rawId === null || rawId === undefined || rawId === "") {
      return false;
    }
    return String(rawId) === normalizedId;
  });

  let candidate = byId;
  if (!candidate) {
    const targetName = normalizeNameKey(
      store.jugadoresEquipo.find((jugador) => {
        const id =
          jugador?.id ??
          jugador?.playerId ??
          jugador?.player_id ??
          jugador?.playerID ??
          jugador?.idJugador;
        return id !== null && id !== undefined && String(id) === normalizedId;
      })?.name
    );
    if (targetName) {
      candidate = players.find((entry) => {
        const entryName = normalizeNameKey(entry?.name ?? entry?.nombre);
        return entryName && entryName === targetName;
      });
    }
  }

  if (!candidate) {
    throw new Error(`No se encontró el jugador ${normalizedId} en el mercado`);
  }

  const valueCandidates = [
    candidate.valorMercado,
    candidate.valor,
    candidate.valor_actual,
    candidate.market_value,
    candidate.marketValue,
    candidate.value,
    candidate.precio,
    candidate.price,
  ];

  let resolvedValue = null;
  for (const valueCandidate of valueCandidates) {
    const parsed = sanitizeMarketCacheValue(valueCandidate);
    if (parsed !== null) {
      resolvedValue = parsed;
      break;
    }
  }

  if (resolvedValue === null) {
    throw new Error(
      `No se pudo determinar el valor de mercado del jugador ${normalizedId}`
    );
  }

  const pickNumber = (candidates) => {
    for (const candidateValue of candidates) {
      const parsed = toOptionalNumber(candidateValue);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  };

  const changeDay = pickNumber([
    candidate.change_day,
    candidate.diff_1,
    candidate.diffDay,
    candidate.diff_day,
    candidate.changeDay,
    candidate.changeDia,
    candidate.variacion_dia,
    candidate.variacionDia,
    candidate.delta_day,
    candidate.day_delta,
    candidate.diferencia_dia,
    candidate.diferenciaDia,
  ]);

  const changeWeek = pickNumber([
    candidate.change_week,
    candidate.diff_7,
    candidate.diffWeek,
    candidate.diff_week,
    candidate.changeWeek,
    candidate.variacion_semana,
    candidate.variacionSemana,
    candidate.delta_week,
    candidate.week_delta,
    candidate.diferencia_semana,
    candidate.diferenciaSemana,
  ]);

  return {
    value: resolvedValue,
    changeDay,
    changeWeek,
  };
}

export async function fetchPuntuacionJugador(playerId) {
  const url = buildPlayerDetailUrl(playerId);
  if (!url || typeof fetch !== "function") {
    return [];
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response || !response.ok) {
        throw new Error(`Respuesta no válida al cargar puntuaciones (${response?.status})`);
      }

      const clone = response.clone?.();
      let parsed = [];
      let jsonError = null;
      try {
        const data = await response.json();
        parsed = parseScoreDataFromJson(data);
      } catch (error) {
        jsonError = error;
      }

      if (!parsed.length && clone && typeof clone.text === "function") {
        try {
          const html = await clone.text();
          parsed = parseScoreDataFromHtml(html);
        } catch (htmlError) {
          if (!jsonError) {
            jsonError = htmlError;
          }
        }
      }

      if (!parsed.length && jsonError) {
        throw jsonError;
      }

      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    console.warn("No se pudieron obtener las puntuaciones del jugador", lastError);
  }
  return [];
}

const normalizePointsHistory = (value) => {
  if (!value) return [];
  const source = Array.isArray(value) ? value : [value];
  const entries = new Map();

  source.forEach((item, index) => {
    if (item == null) return;
    if (typeof item === "object" && !Array.isArray(item)) {
      const rawMatchday =
        item.matchday ??
        item.jornada ??
        item.round ??
        item.day ??
        item.gw ??
        item.match ??
        item.index ??
        item.id ??
        index + 1;
      const matchday = Number(rawMatchday);
      if (!Number.isFinite(matchday) || matchday <= 0) return;
      const pointsValue = toOptionalNumber(
        item.points ??
          item.puntos ??
          item.score ??
          item.value ??
          item.valor ??
          item.total ??
          item.result
      );
      if (pointsValue === null) return;
      entries.set(matchday, { matchday, points: Number(pointsValue) });
      return;
    }

    if (Array.isArray(item) && item.length >= 2) {
      const matchday = Number(item[0]);
      const pointsValue = toOptionalNumber(item[1]);
      if (!Number.isFinite(matchday) || matchday <= 0) return;
      if (pointsValue === null) return;
      entries.set(matchday, { matchday, points: Number(pointsValue) });
      return;
    }

    if (typeof item === "number") {
      if (!Number.isFinite(item)) return;
      const matchday = index + 1;
      entries.set(matchday, { matchday, points: Number(item) });
      return;
    }

    if (typeof item === "string") {
      const match = item.match(
        /(?:j(?:or(?:nada)?)?|gw|md)?\s*(\d{1,3})[^0-9+\-]*([-+]?\d+(?:[.,]\d+)?)/i
      );
      if (!match) return;
      const matchday = Number(match[1]);
      const pointsValue = toOptionalNumber(match[2]);
      if (!Number.isFinite(matchday) || matchday <= 0) return;
      if (pointsValue === null) return;
      entries.set(matchday, { matchday, points: Number(pointsValue) });
    }
  });

  return Array.from(entries.values()).sort((a, b) => a.matchday - b.matchday);
};

const historyTotal = (history) => {
  if (!history.length) return null;
  const values = history
    .map((item) => toOptionalNumber(item.points))
    .filter((value) => value !== null);
  if (!values.length) return null;
  return values.reduce((acc, value) => acc + value, 0);
};

const historyAverage = (history, lastCount = null) => {
  if (!history.length) return null;
  const items =
    lastCount && lastCount > 0 ? history.slice(-lastCount) : history.slice();
  const values = items
    .map((item) => toOptionalNumber(item.points))
    .filter((value) => value !== null);
  if (!values.length) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
};

const normalizePlayer = (player) => {
  const history = normalizePointsHistory(
    player?.points_history ??
      player?.pointsHistory ??
      player?.matchday_points ??
      player?.pointsByMatchday ??
      player?.pointsByRound
  );

  const directAvg = toOptionalNumber(
    player?.points_avg ??
      player?.avg_points ??
      player?.average_points ??
      player?.media ??
      player?.media_jornada ??
      player?.avg_jornada ??
      player?.points_per_matchday
  );

  const directLast5 = toOptionalNumber(
    player?.points_last5 ??
      player?.avg_points_last5 ??
      player?.average_points_last5 ??
      player?.media_last5 ??
      player?.media5 ??
      player?.media_reciente ??
      player?.recent_average
  );

  const avgFromHistory = directAvg ?? historyAverage(history);
  const last5FromHistory = directLast5 ?? historyAverage(history, 5);
  const directTotal = toOptionalNumber(
    player?.points_total ??
      player?.total_points ??
      player?.totalPoints ??
      player?.puntos_totales ??
      player?.puntos ??
      player?.points
  );
  const totalFromHistory = historyTotal(history);

  return {
    ...player,
    name: sanitizeName(player?.name),
    team: normalizeText(player?.team),
    position: normalizeText(player?.position),
    value: toNumber(player?.value),
    change_day: toNumber(player?.change_day ?? player?.diff_1),
    change_week: toNumber(player?.change_week ?? player?.diff_7),
    points_history: history,
    points_avg: avgFromHistory,
    points_last5: last5FromHistory,
    points_total: directTotal ?? totalFromHistory,
  };
};

const FORMATIONS = ["5-3-2", "5-4-1", "4-3-3", "4-4-2", "4-5-1", "3-4-3", "3-5-2"];
const DEFAULT_FORMATION = "4-3-3";
const ZONE_CODES = ["POR", "DEF", "MED", "DEL"];
const ZONE_LABELS = {
  POR: "Portería",
  DEF: "Defensa",
  MED: "Mediocampo",
  DEL: "Delantera",
};
const ZONE_LABELS_SINGULAR = {
  POR: "portero",
  DEF: "defensa",
  MED: "centrocampista",
  DEL: "delantero",
};
const ZONE_LABELS_PLURAL = {
  POR: "porteros",
  DEF: "defensas",
  MED: "centrocampistas",
  DEL: "delanteros",
};
const ZONE_ORDER = {
  POR: 0,
  DEF: 1,
  MED: 2,
  DEL: 3,
};
const LINEUP_STORAGE_KEY = "teamLineupSaved";

const parseFormation = (formation) => {
  const fallback = { DEF: 4, MED: 3, DEL: 3 };
  if (typeof formation !== "string") return fallback;
  const parts = formation.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value) || value < 0)) {
    return fallback;
  }
  return { DEF: parts[0], MED: parts[1], DEL: parts[2] };
};

const sanitizeSlotValue = (value) => {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str ? str : null;
};

const createEmptyLineup = (formation = DEFAULT_FORMATION) => {
  const counts = parseFormation(formation);
  return {
    POR: [null],
    DEF: Array.from({ length: counts.DEF }, () => null),
    MED: Array.from({ length: counts.MED }, () => null),
    DEL: Array.from({ length: counts.DEL }, () => null),
  };
};

const ensureLineupShape = (slots, formation = DEFAULT_FORMATION) => {
  const counts = parseFormation(formation);
  const source = slots ?? {};
  const build = (zone, count) => {
    const list = Array.isArray(source[zone])
      ? source[zone].map(sanitizeSlotValue)
      : [];
    const trimmed = list.slice(0, count);
    while (trimmed.length < count) {
      trimmed.push(null);
    }
    return trimmed;
  };
  return {
    POR: build("POR", 1),
    DEF: build("DEF", counts.DEF),
    MED: build("MED", counts.MED),
    DEL: build("DEL", counts.DEL),
  };
};

const cloneLineup = (lineup) => {
  const safe = lineup ?? {};
  return {
    POR: Array.isArray(safe.POR) ? [...safe.POR] : [null],
    DEF: Array.isArray(safe.DEF) ? [...safe.DEF] : [],
    MED: Array.isArray(safe.MED) ? [...safe.MED] : [],
    DEL: Array.isArray(safe.DEL) ? [...safe.DEL] : [],
  };
};

const lineupEquals = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return ZONE_CODES.every((zone) => {
    const arrA = Array.isArray(a[zone]) ? a[zone] : [];
    const arrB = Array.isArray(b[zone]) ? b[zone] : [];
    if (arrA.length !== arrB.length) return false;
    return arrA.every((value, index) => arrB[index] === value);
  });
};

const flattenLineupKeys = (lineup) => {
  if (!lineup) return [];
  const values = [];
  ZONE_CODES.forEach((zone) => {
    if (!Array.isArray(lineup[zone])) return;
    lineup[zone].forEach((value) => {
      if (value !== null && value !== undefined) {
        values.push(value);
      }
    });
  });
  return values;
};

const pruneLineupSlots = (lineup, validKeys) => {
  if (!lineup) return lineup;
  const next = {};
  ZONE_CODES.forEach((zone) => {
    const arr = Array.isArray(lineup[zone]) ? lineup[zone] : [];
    next[zone] = arr.map((value) =>
      value !== null && value !== undefined && validKeys.has(value) ? value : null
    );
  });
  return next;
};

const findPlayerSlot = (lineup, playerKey) => {
  if (!lineup || !playerKey) return null;
  for (const zone of ZONE_CODES) {
    const arr = Array.isArray(lineup[zone]) ? lineup[zone] : [];
    const index = arr.findIndex((value) => value === playerKey);
    if (index !== -1) {
      return { zone, index };
    }
  }
  return null;
};

const removePlayerFromLineup = (lineup, playerKey) => {
  if (!lineup || !playerKey) return lineup;
  let changed = false;
  const next = {};
  ZONE_CODES.forEach((zone) => {
    const arr = Array.isArray(lineup[zone]) ? lineup[zone] : [];
    next[zone] = arr.map((value) => {
      if (value === playerKey) {
        changed = true;
        return null;
      }
      return value;
    });
  });
  return changed ? next : lineup;
};

const getZoneFromPosition = (position) => {
  const normalized = collapseWhitespace(normalizeText(position)).toLowerCase();
  if (!normalized) return "DEL";
  if (normalized.includes("por")) return "POR";
  if (normalized.includes("def")) return "DEF";
  if (
    normalized.includes("med") ||
    normalized.includes("cen") ||
    normalized.includes("mid") ||
    normalized.includes("vol") ||
    normalized.includes("cam")
  ) {
    return "MED";
  }
  if (
    normalized.includes("del") ||
    normalized.includes("ata") ||
    normalized.includes("for") ||
    normalized.includes("dav")
  ) {
    return "DEL";
  }
  return "DEL";
};

const getPlayerKey = (player) => {
  if (!player) return null;
  const rawId =
    player.id ??
    player.playerId ??
    player.player_id ??
    player.playerID ??
    player.idJugador;
  if (rawId !== null && rawId !== undefined && rawId !== "") {
    return `id:${rawId}`;
  }
  const name = sanitizeName(
    player.name ?? player.fullName ?? player.nombre ?? player.displayName
  );
  if (!name) return null;
  return `name:${name.toLowerCase()}`;
};

const RECOMMENDATION_TEMPORAL_WEIGHTS = [1, 1.1, 1.2, 1.3, 1.4];
const USE_WEIGHTED_RECENT_FORM = true;

const computePlayerRecommendationInfo = (player, { ponderado = false } = {}) => {
  const history = normalizeScoreEntries(
    player?.puntuacionPorJornada ??
      player?.points_history ??
      player?.scoreSummary?.history ??
      []
  );
  const recentEntries = history.slice(-5);
  const normalizedEntries = recentEntries.map((entry) => ({
    jornada: entry?.jornada ?? entry?.matchday ?? entry?.round ?? null,
    puntos: toOptionalNumber(entry?.puntos ?? entry?.points),
  }));
  const validEntries = normalizedEntries.filter((entry) => entry.puntos !== null);
  const weights = ponderado
    ? RECOMMENDATION_TEMPORAL_WEIGHTS.slice(-validEntries.length)
    : Array(validEntries.length).fill(1);
  let weightedSum = 0;
  let totalWeight = 0;
  validEntries.forEach((entry, index) => {
    const weight = Number.isFinite(weights[index]) ? weights[index] : 1;
    weightedSum += entry.puntos * weight;
    totalWeight += weight;
  });
  const simpleTotal = validEntries.reduce((acc, entry) => acc + entry.puntos, 0);
  const simpleAverage = validEntries.length ? simpleTotal / validEntries.length : 0;
  const weightedAverage = validEntries.length
    ? weightedSum / (totalWeight || validEntries.length)
    : 0;
  return {
    score: weightedAverage,
    simpleAverage,
    total: simpleTotal,
    entries: normalizedEntries,
    matchesConsidered: validEntries.length,
  };
};

const calcularScoreJugadorUlt5 = (jugador, { ponderado = false } = {}) =>
  computePlayerRecommendationInfo(jugador, { ponderado }).score;

const sortPlayersForRecommendation = (a, b) => {
  const scoreA = Number.isFinite(a?.scoreRecomendacion) ? a.scoreRecomendacion : -Infinity;
  const scoreB = Number.isFinite(b?.scoreRecomendacion) ? b.scoreRecomendacion : -Infinity;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  const matchesA = a?.recommendationInfo?.matchesConsidered ?? 0;
  const matchesB = b?.recommendationInfo?.matchesConsidered ?? 0;
  if (matchesA !== matchesB) {
    return matchesB - matchesA;
  }
  const seasonAvgA = Number.isFinite(a?.points_avg) ? a.points_avg : -Infinity;
  const seasonAvgB = Number.isFinite(b?.points_avg) ? b.points_avg : -Infinity;
  if (seasonAvgA !== seasonAvgB) {
    return seasonAvgB - seasonAvgA;
  }
  const valueA = Number.isFinite(a?.value) ? a.value : -Infinity;
  const valueB = Number.isFinite(b?.value) ? b.value : -Infinity;
  if (valueA !== valueB) {
    return valueB - valueA;
  }
  const nameA = a?.name ?? "";
  const nameB = b?.name ?? "";
  return nameA.localeCompare(nameB, "es");
};

const generarRecomendacionesTopN = (
  jugadores,
  N = 3,
  { ponderado = false } = {}
) => {
  if (!Array.isArray(jugadores) || !jugadores.length) {
    return { recomendaciones: [], incompletas: [], playerScores: new Map() };
  }

  const scoreMap = new Map();
  const playersByZone = {
    POR: [],
    DEF: [],
    MED: [],
    DEL: [],
  };

  jugadores.forEach((player) => {
    if (!player) return;
    const zone = ZONE_CODES.includes(player.zone)
      ? player.zone
      : getZoneFromPosition(player.position);
    if (!ZONE_CODES.includes(zone)) return;
    const info = computePlayerRecommendationInfo(player, { ponderado });
    const playerKey = getPlayerKey(player);
    const enriched = {
      ...player,
      zone,
      playerKey,
      scoreRecomendacion: info.score,
      recommendationInfo: info,
    };
    playersByZone[zone].push(enriched);
    if (playerKey) {
      scoreMap.set(playerKey, info);
    }
  });

  const sortedByZone = Object.fromEntries(
    Object.entries(playersByZone).map(([zone, list]) => [
      zone,
      list.slice().sort(sortPlayersForRecommendation),
    ])
  );

  const incompletas = [];
  const recomendaciones = [];

  FORMATIONS.forEach((formacion) => {
    const counts = parseFormation(formacion);
    const missing = [];
    if (sortedByZone.POR.length < 1) {
      missing.push({ zone: "POR", needed: 1 - sortedByZone.POR.length });
    }
    if (sortedByZone.DEF.length < counts.DEF) {
      missing.push({
        zone: "DEF",
        needed: counts.DEF - sortedByZone.DEF.length,
      });
    }
    if (sortedByZone.MED.length < counts.MED) {
      missing.push({
        zone: "MED",
        needed: counts.MED - sortedByZone.MED.length,
      });
    }
    if (sortedByZone.DEL.length < counts.DEL) {
      missing.push({
        zone: "DEL",
        needed: counts.DEL - sortedByZone.DEL.length,
      });
    }

    if (missing.length) {
      incompletas.push({ formacion, missing });
      return;
    }

    const selected = {
      POR: sortedByZone.POR.slice(0, 1),
      DEF: sortedByZone.DEF.slice(0, counts.DEF),
      MED: sortedByZone.MED.slice(0, counts.MED),
      DEL: sortedByZone.DEL.slice(0, counts.DEL),
    };

    const allPlayers = ZONE_CODES.flatMap((zone) => selected[zone]);
    if (allPlayers.length !== 1 + counts.DEF + counts.MED + counts.DEL) {
      incompletas.push({ formacion, missing: [{ zone: "VAR", needed: 1 }] });
      return;
    }

    const totalScore = allPlayers.reduce(
      (acc, player) =>
        acc + (Number.isFinite(player.scoreRecomendacion) ? player.scoreRecomendacion : 0),
      0
    );
    const scoreAlineacion = allPlayers.length ? totalScore / allPlayers.length : 0;

    const breakdown = {};
    ZONE_CODES.forEach((zone) => {
      const zonePlayers = selected[zone];
      const zoneTotal = zonePlayers.reduce(
        (acc, player) =>
          acc + (Number.isFinite(player.scoreRecomendacion) ? player.scoreRecomendacion : 0),
        0
      );
      breakdown[zone] = {
        total: zoneTotal,
        average: zonePlayers.length ? zoneTotal / zonePlayers.length : 0,
      };
    });

    const once = {
      POR: selected.POR.map((player) => ({ ...player })),
      DEF: selected.DEF.map((player) => ({ ...player })),
      MED: selected.MED.map((player) => ({ ...player })),
      DEL: selected.DEL.map((player) => ({ ...player })),
    };

    recomendaciones.push({
      formacion,
      scoreAlineacion,
      once,
      breakdown,
    });
  });

  recomendaciones.sort((a, b) => {
    const scoreA = Number.isFinite(a?.scoreAlineacion) ? a.scoreAlineacion : -Infinity;
    const scoreB = Number.isFinite(b?.scoreAlineacion) ? b.scoreAlineacion : -Infinity;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    return a.formacion.localeCompare(b.formacion);
  });

  return {
    recomendaciones: recomendaciones.slice(0, Math.max(0, N)),
    incompletas,
    playerScores: scoreMap,
  };
};

const loadSavedLineup = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LINEUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const formation = FORMATIONS.includes(parsed?.formation)
      ? parsed.formation
      : DEFAULT_FORMATION;
    return {
      formation,
      slots: ensureLineupShape(parsed?.slots ?? {}, formation),
    };
  } catch {
    return null;
  }
};

const saveLineupToStorage = (data) => {
  if (typeof window === "undefined" || !data) return;
  try {
    const formation = FORMATIONS.includes(data.formation)
      ? data.formation
      : DEFAULT_FORMATION;
    const payload = {
      formation,
      slots: ensureLineupShape(data.slots ?? {}, formation),
    };
    window.localStorage.setItem(LINEUP_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* noop */
  }
};

const sanitizeStoredTeam = (entries) => {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.reduce((acc, item) => {
    const name = sanitizeName(item?.name);
    if (!name) return acc;
    const key = name.toLowerCase();
    const rawId =
      item?.id ??
      item?.playerId ??
      item?.player_id ??
      item?.playerID ??
      item?.idJugador ??
      item?.jugadorId;
    const id =
      rawId !== null && rawId !== undefined && rawId !== ""
        ? String(rawId)
        : null;
    const dedupeKey = id ?? key;
    if (seen.has(dedupeKey)) return acc;
    seen.add(dedupeKey);
    const precioCompra = toOptionalNumber(
      item?.precioCompra ??
        item?.buyPrice ??
        item?.buy_price ??
        item?.purchasePrice ??
        item?.purchase_value ??
        item?.purchaseValue
    );
    const positionRaw = collapseWhitespace(
      normalizeText(
        item?.position ??
          item?.posicion ??
          item?.playerPosition ??
          item?.positionCode ??
          item?.role ??
          item?.demarcacion
      )
    );
    const storedScores = normalizeScoreEntries(
      item?.puntuacionPorJornada ??
        item?.points_history ??
        item?.matchday_points ??
        item?.scores ??
        item?.scoreHistory
    );
    const entry = { name, precioCompra };
    if (storedScores.length) {
      entry.puntuacionPorJornada = storedScores;
    }
    const storedScoreDate =
      typeof item?.cacheFechaPuntuacion === "string"
        ? item.cacheFechaPuntuacion
        : typeof item?.scoresFetchedAt === "string"
        ? item.scoresFetchedAt
        : null;
    if (storedScoreDate) {
      entry.cacheFechaPuntuacion = storedScoreDate;
    }
    if (id) {
      entry.id = id;
    }
    if (positionRaw) {
      entry.position = positionRaw;
    }
    acc.push(entry);
    return acc;
  }, []);
};

const sanitizeStoredSales = (entries) => {
  if (!Array.isArray(entries)) return [];
  return entries.reduce((acc, item) => {
    const name = sanitizeName(item?.name);
    if (!name) return acc;
    const buyPrice = toOptionalNumber(
      item?.precioCompra ?? item?.buyPrice ?? item?.buy_price
    );
    const sellPrice = toOptionalNumber(item?.sellPrice ?? item?.sell_price);
    const soldAtRaw = collapseWhitespace(
      normalizeText(item?.soldAt ?? item?.sold_at)
    );
    const rawId =
      item?.playerId ??
      item?.player_id ??
      item?.playerID ??
      item?.idJugador ??
      item?.id ??
      item?.jugadorId;
    const playerId =
      rawId !== null && rawId !== undefined && rawId !== ""
        ? String(rawId)
        : null;
    const positionRaw = collapseWhitespace(
      normalizeText(
        item?.position ??
          item?.posicion ??
          item?.playerPosition ??
          item?.role ??
          item?.demarcacion
      )
    );
    acc.push({
      name,
      buyPrice,
      sellPrice,
      soldAt: soldAtRaw || null,
      playerId,
      position: positionRaw || null,
    });
    return acc;
  }, []);
};

export default function FantasyTeamDashboard() {
  const [market, setMarket] = useState({ updated_at: null, players: [] });
  const [query, setQuery] = useState("");
  const [myTeam, setMyTeam] = useState(() => {
    try {
      const raw = localStorage.getItem("myTeam");
      return raw ? sanitizeStoredTeam(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  });
  const [sales, setSales] = useState(() => {
    try {
      const raw = localStorage.getItem("mySales");
      return raw ? sanitizeStoredSales(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  });
  const [cacheMercado, setCacheMercado] = useState(() => {
    try {
      const raw = localStorage.getItem(MARKET_CACHE_STORAGE_KEY);
      return raw ? sanitizeMarketCache(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  });
  const [cachePuntuaciones, setCachePuntuaciones] = useState(() => {
    try {
      const raw = localStorage.getItem(SCORE_CACHE_STORAGE_KEY);
      return raw ? sanitizeScoreCache(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  });
  const savedLineup = useMemo(() => loadSavedLineup(), []);
  const [presupuestoActual, setPresupuestoActual] = useState(() => {
    try {
      const raw = localStorage.getItem("teamBudget");
      const parsed = raw !== null ? Number(raw) : null;
      return Number.isFinite(parsed) ? parsed : -8720968;
    } catch {
      return -8720968;
    }
  });
  const [status, setStatus] = useState("cargando");
  const [playerToBuy, setPlayerToBuy] = useState(null);
  const [purchaseValue, setPurchaseValue] = useState("");
  const [alineacionGuardada, setAlineacionGuardada] = useState(savedLineup);
  const [formacionSeleccionada, setFormacionSeleccionada] = useState(
    savedLineup?.formation ?? DEFAULT_FORMATION
  );
  const [alineacion, setAlineacion] = useState(() =>
    ensureLineupShape(
      savedLineup?.slots ?? createEmptyLineup(savedLineup?.formation ?? DEFAULT_FORMATION),
      savedLineup?.formation ?? DEFAULT_FORMATION
    )
  );
  const [activeTab, setActiveTab] = useState("dashboard");
  const [feedback, setFeedback] = useState(null);
  const feedbackTimeoutRef = useRef(null);
  const [playerStates, setPlayerStates] = useState({});
  const pendingPointsRequests = useRef(new Map());
  const pendingMarketRequests = useRef(new Map());
  const [saleToRemove, setSaleToRemove] = useState(null);
  const [playerDetailTarget, setPlayerDetailTarget] = useState(null);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);
  const [playerDetailError, setPlayerDetailError] = useState(null);
  const [recomendaciones, setRecomendaciones] = useState([]);
  const [recomendacionesLoading, setRecomendacionesLoading] = useState(false);
  const [recomendacionesError, setRecomendacionesError] = useState(null);
  const [formacionesIncompletas, setFormacionesIncompletas] = useState([]);
  const [recomendacionSeleccionada, setRecomendacionSeleccionada] = useState(null);
  const recommendationScoresRef = useRef(new Map());
  const [editBudgetOpen, setEditBudgetOpen] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [marketSnifferRunning, setMarketSnifferRunning] = useState(false);
  const [pointsSnifferRunning, setPointsSnifferRunning] = useState(false);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const budgetParsed = useMemo(
    () => toOptionalNumber(budgetDraft),
    [budgetDraft]
  );
  const budgetIsValid = budgetParsed !== null;

  const MARKET_URL = MARKET_ENDPOINT;

  const removeToast = useCallback((id) => {
    setToasts((prev) => {
      const next = prev.filter((toast) => toast.id !== id);
      return next.length === prev.length ? prev : next;
    });
  }, []);

  const pushToast = useCallback(
    (message, { type = "info", duration = 3500 } = {}) => {
      if (!message) return;
      setToasts((prev) => {
        const id = toastIdRef.current + 1;
        toastIdRef.current = id;
        const toast = { id, message, type };
        if (duration && Number.isFinite(duration) && duration > 0) {
          setTimeout(() => {
            removeToast(id);
          }, duration);
        }
        return [...prev, toast];
      });
    },
    [removeToast]
  );

  const updatePlayerState = useCallback((playerId, updates) => {
    const id =
      playerId === null || playerId === undefined || playerId === ""
        ? null
        : String(playerId);
    if (!id || !updates) return;
    setPlayerStates((prev) => {
      const previous =
        prev[id] ?? {
          marketStatus: "idle",
          marketError: null,
          pointsStatus: "idle",
          pointsError: null,
        };
      const next = { ...previous, ...updates };
      if (
        previous.marketStatus === next.marketStatus &&
        previous.marketError === next.marketError &&
        previous.pointsStatus === next.pointsStatus &&
        previous.pointsError === next.pointsError
      ) {
        return prev;
      }
      return { ...prev, [id]: next };
    });
  }, []);

  const getPlayerIdKey = (item) => {
    if (!item) return null;
    const rawId =
      item.id ??
      item.playerId ??
      item.player_id ??
      item.playerID ??
      item.idJugador ??
      item.jugadorId;
    return rawId !== null && rawId !== undefined && rawId !== ""
      ? String(rawId)
      : null;
  };

  const getPlayerNameKey = (item) => {
    const base = sanitizeName(item?.name);
    return base ? base.toLowerCase() : null;
  };

  const entryMatchesPlayer = (entry, player) => {
    if (!entry || !player) return false;
    const entryId = getPlayerIdKey(entry);
    const playerId = getPlayerIdKey(player);
    if (entryId && playerId) {
      return entryId === playerId;
    }
    const entryName = getPlayerNameKey(entry);
    const playerName = getPlayerNameKey(player);
    return entryName && playerName ? entryName === playerName : false;
  };

  useEffect(() => {
    const load = async () => {
      try {
        setStatus("cargando");
        const res = await fetch(MARKET_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("No se pudo descargar market.json");
        const data = await res.json();
        const players = Array.isArray(data.players) ? data.players : [];
        const normalizedPlayers = players.map(normalizePlayer);

        setMarket({
          updated_at: data.updated_at || null,
          players: normalizedPlayers,
        });
        setStatus("ok");
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    };
    load();
  }, []);

  useEffect(() => {
    localStorage.setItem("myTeam", JSON.stringify(myTeam));
  }, [myTeam]);

  useEffect(() => {
    localStorage.setItem("mySales", JSON.stringify(sales));
  }, [sales]);

  useEffect(() => {
    localStorage.setItem("teamBudget", String(presupuestoActual));
  }, [presupuestoActual]);

  useEffect(() => {
    try {
      localStorage.setItem(
        MARKET_CACHE_STORAGE_KEY,
        JSON.stringify(cacheMercado)
      );
    } catch {
      /* noop */
    }
  }, [cacheMercado]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SCORE_CACHE_STORAGE_KEY,
        JSON.stringify(cachePuntuaciones)
      );
    } catch {
      /* noop */
    }
  }, [cachePuntuaciones]);

  useEffect(() => {
    setMyTeam((prev) => {
      let mutated = false;
      const next = prev.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        if (
          Array.isArray(entry.puntuacionPorJornada) &&
          entry.puntuacionPorJornada.length
        ) {
          return entry;
        }
        const id = getPlayerIdKey(entry);
        if (!id) return entry;
        const cached = cachePuntuaciones[id];
        if (!cached || !Array.isArray(cached.data) || !cached.data.length) {
          return entry;
        }
        const updated = {
          ...entry,
          puntuacionPorJornada: cached.data,
        };
        if (cached.fetchedAt) {
          updated.cacheFechaPuntuacion = cached.fetchedAt;
        }
        mutated = true;
        return updated;
      });
      return mutated ? next : prev;
    });
  }, [cachePuntuaciones]);

  useEffect(() => {
    if (!feedback) {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
      return;
    }
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    const timeout = window.setTimeout(() => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 3000);
    feedbackTimeoutRef.current = timeout;
    return () => clearTimeout(timeout);
  }, [feedback]);

  const playerIndex = useMemo(() => {
    const byName = new Map();
    const byId = new Map();
    market.players.forEach((player) => {
      if (!player) return;
      const nameKey = player.name ? player.name.toLowerCase() : null;
      if (nameKey) {
        byName.set(nameKey, player);
      }
      if (player.id !== null && player.id !== undefined) {
        byId.set(String(player.id), player);
      }
    });
    return { byName, byId };
  }, [market.players]);

  const isScoreCacheStale = (timestamp) => {
    if (!timestamp) return true;
    const value = new Date(timestamp).getTime();
    if (!Number.isFinite(value)) return true;
    return Date.now() - value > SCORE_CACHE_TTL_MS;
  };

  const getCachedScoreInfo = (playerId) => {
    const id =
      playerId === null || playerId === undefined ? null : String(playerId);
    if (!id) {
      return { data: [], fetchedAt: null };
    }
    const teamEntry = myTeam.find((entry) => {
      const entryId = getPlayerIdKey(entry);
      return entryId ? entryId === id : false;
    });
    if (
      teamEntry &&
      Array.isArray(teamEntry.puntuacionPorJornada) &&
      teamEntry.puntuacionPorJornada.length
    ) {
      const fetchedAt =
        typeof teamEntry.cacheFechaPuntuacion === "string"
          ? teamEntry.cacheFechaPuntuacion
          : null;
      return {
        data: normalizeScoreEntries(teamEntry.puntuacionPorJornada),
        fetchedAt,
      };
    }
    const cached = cachePuntuaciones[id];
    if (cached && Array.isArray(cached.data) && cached.data.length) {
      const fetchedAt =
        typeof cached.fetchedAt === "string" ? cached.fetchedAt : null;
      return {
        data: normalizeScoreEntries(cached.data),
        fetchedAt,
      };
    }
    return { data: [], fetchedAt: null };
  };

  const getPuntuacionJugador = (playerId) => getCachedScoreInfo(playerId).data;

  const refreshPointsFor = useCallback(
    async (playerId, { force = false } = {}) => {
      const id =
        playerId === null || playerId === undefined || playerId === ""
          ? null
          : String(playerId);
      if (!id) {
        return [];
      }
      const current = getCachedScoreInfo(id);
      const shouldFetch =
        force || !current.fetchedAt || isScoreCacheStale(current.fetchedAt);
      if (!shouldFetch && current.data.length) {
        updatePlayerState(id, { pointsStatus: "ready", pointsError: null });
        return current.data;
      }
      const pending = pendingPointsRequests.current.get(id);
      if (pending) {
        return pending;
      }
      const fetchPromise = (async () => {
        updatePlayerState(id, { pointsStatus: "loading", pointsError: null });
        try {
          const fetched = await fetchPuntuacionJugador(id);
          const normalized = normalizeScoreEntries(fetched);
          const nextData =
            normalized.length || !current.data.length ? normalized : current.data;
          if (!nextData.length) {
            throw new Error("No hay puntuaciones disponibles");
          }
          const fetchedAt = new Date().toISOString();
          setCachePuntuaciones((prev) => {
            const prevEntry = prev[id];
            if (
              prevEntry &&
              Array.isArray(prevEntry.data) &&
              prevEntry.data.length === nextData.length &&
              prevEntry.data.every(
                (item, index) =>
                  item.jornada === nextData[index]?.jornada &&
                  item.puntos === nextData[index]?.puntos
              ) &&
              prevEntry.fetchedAt === fetchedAt
            ) {
              return prev;
            }
            return {
              ...prev,
              [id]: { data: nextData, fetchedAt },
            };
          });
          setMyTeam((prev) => {
            let mutated = false;
            const candidate = playerIndex.byId.get(id);
            const next = prev.map((entry) => {
              if (!entry || typeof entry !== "object") return entry;
              const entryId = getPlayerIdKey(entry);
              const matches = entryId
                ? entryId === id
                : candidate
                ? entryMatchesPlayer(entry, candidate)
                : false;
              if (!matches) return entry;
              const updated = {
                ...entry,
                puntuacionPorJornada: nextData,
                cacheFechaPuntuacion: fetchedAt,
              };
              if (
                !entryId &&
                candidate?.id !== null &&
                candidate?.id !== undefined
              ) {
                updated.id = String(candidate.id);
              }
              mutated = true;
              return updated;
            });
            return mutated ? next : prev;
          });
          updatePlayerState(id, { pointsStatus: "ready", pointsError: null });
          return nextData;
        } catch (error) {
          const nameFromMarket =
            playerIndex.byId.get(id)?.name ??
            myTeam.find((entry) => getPlayerIdKey(entry) === id)?.name ??
            `Jugador ${id}`;
          const message =
            error?.message ?? "No se pudieron sincronizar las puntuaciones";
          console.warn(
            `No se pudieron sincronizar las puntuaciones del jugador ${id}`,
            error
          );
          updatePlayerState(id, {
            pointsStatus: "error",
            pointsError: message,
          });
          pushToast(
            `No se actualizaron los puntos de ${nameFromMarket}.`,
            { type: "warning" }
          );
          throw error;
        } finally {
          pendingPointsRequests.current.delete(id);
        }
      })();
      pendingPointsRequests.current.set(id, fetchPromise);
      return fetchPromise;
    },
    [
      getCachedScoreInfo,
      isScoreCacheStale,
      pendingPointsRequests,
      setCachePuntuaciones,
      myTeam,
      setMyTeam,
      playerIndex,
      updatePlayerState,
      pushToast,
    ]
  );

  const ensurePuntuacionesUltimos5 = useCallback(
    async ({ force = false } = {}) => {
      const seen = new Set();
      const tasks = [];
      myTeam.forEach((entry) => {
        const id = getPlayerIdKey(entry);
        if (!id || seen.has(id)) return;
        seen.add(id);
        const cached = getCachedScoreInfo(id);
        const shouldSync =
          force ||
          !Array.isArray(cached.data) ||
          !cached.data.length ||
          isScoreCacheStale(cached.fetchedAt);
        if (shouldSync) {
          tasks.push(refreshPointsFor(id, { force: true }));
        }
      });
      if (!tasks.length) {
        return;
      }
      await Promise.allSettled(tasks);
    },
    [myTeam, getCachedScoreInfo, isScoreCacheStale, refreshPointsFor]
  );

  const abrirDetalleJugador = (player) => {
    if (!player) return;
    setPlayerDetailTarget(player);
    setPlayerDetailError(null);
  };

  const cerrarDetalleJugador = () => {
    setPlayerDetailTarget(null);
    setPlayerDetailLoading(false);
    setPlayerDetailError(null);
  };

  const refrescarDetalleJugador = () => {
    if (!playerDetailTarget) return;
    const playerId = getPlayerIdKey(playerDetailTarget);
    if (!playerId) {
      setPlayerDetailError("No se pudo identificar al jugador.");
      return;
    }
    setPlayerDetailLoading(true);
    refreshPointsFor(playerId, { force: true })
      .then(() => {
        setPlayerDetailError(null);
      })
      .catch(() => {
        setPlayerDetailError(
          "No se pudieron actualizar las puntuaciones del jugador."
        );
      })
      .finally(() => {
        setPlayerDetailLoading(false);
      });
  };

  const refreshMarketFor = useCallback(
    async (playerId, { force = true } = {}) => {
      const id =
        playerId === null || playerId === undefined || playerId === ""
          ? null
          : String(playerId);
      if (!id) {
        return null;
      }
      const pending = pendingMarketRequests.current.get(id);
      if (pending) {
        return pending;
      }

      const state = playerStates[id];
      const marketEntry = playerIndex.byId.get(id);
      const cachedValue = cacheMercado[id];
      const fallbackValue = marketEntry
        ? toOptionalNumber(
            marketEntry.value ??
              marketEntry.valorMercado ??
              marketEntry.valor ??
              marketEntry.valor_actual ??
              marketEntry.market_value ??
              marketEntry.marketValue ??
              marketEntry.precio ??
              marketEntry.price
          )
        : null;
      const resolvedCachedValue = Number.isFinite(cachedValue)
        ? Number(cachedValue)
        : Number.isFinite(fallbackValue)
        ? Number(fallbackValue)
        : null;

      if (
        !force &&
        state?.marketStatus !== "error" &&
        resolvedCachedValue !== null
      ) {
        if (!Number.isFinite(cachedValue) && Number.isFinite(fallbackValue)) {
          setCacheMercado((prev) => {
            if (Number.isFinite(prev[id])) {
              return prev;
            }
            return { ...prev, [id]: Number(fallbackValue) };
          });
        }
        updatePlayerState(id, { marketStatus: "ready", marketError: null });
        return resolvedCachedValue;
      }

      const fetchPromise = (async () => {
        updatePlayerState(id, { marketStatus: "loading", marketError: null });
        const playerName =
          marketEntry?.name ??
          myTeam.find((entry) => getPlayerIdKey(entry) === id)?.name ??
          `Jugador ${id}`;
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const marketInfo = await fetchValorMercadoJugador(id);
            const fetchedValueRaw =
              marketInfo && typeof marketInfo === "object"
                ? marketInfo.value
                : marketInfo;
            const nextValue = toOptionalNumber(fetchedValueRaw);
            if (nextValue === null) {
              throw new Error("Valor de mercado no disponible");
            }
            const changeDayRaw =
              marketInfo && typeof marketInfo === "object"
                ? marketInfo.changeDay ?? marketInfo.change_day ?? null
                : null;
            const changeWeekRaw =
              marketInfo && typeof marketInfo === "object"
                ? marketInfo.changeWeek ?? marketInfo.change_week ?? null
                : null;
            const nextChangeDay =
              changeDayRaw !== null && changeDayRaw !== undefined
                ? toOptionalNumber(changeDayRaw)
                : null;
            const nextChangeWeek =
              changeWeekRaw !== null && changeWeekRaw !== undefined
                ? toOptionalNumber(changeWeekRaw)
                : null;

            setCacheMercado((prev) => {
              const prevValue = prev[id];
              if (prevValue === nextValue) {
                return prev;
              }
              return { ...prev, [id]: nextValue };
            });
            setMarket((prev) => {
              const players = Array.isArray(prev.players) ? prev.players : [];
              let mutated = false;
              const nextPlayers = players.map((player) => {
                if (!player || typeof player !== "object") return player;
                const candidateId = getPlayerIdKey(player);
                if (!candidateId || candidateId !== id) {
                  return player;
                }
                mutated = true;
                const updated = {
                  ...player,
                  value: nextValue,
                  valorMercado: nextValue,
                  valor: nextValue,
                  valor_actual: nextValue,
                  market_value: nextValue,
                  marketValue: nextValue,
                  precio: nextValue,
                  price: nextValue,
                };
                if (nextChangeDay !== null) {
                  updated.change_day = nextChangeDay;
                  updated.diff_1 = nextChangeDay;
                }
                if (nextChangeWeek !== null) {
                  updated.change_week = nextChangeWeek;
                  updated.diff_7 = nextChangeWeek;
                }
                return updated;
              });
              if (!mutated) {
                return prev;
              }
              return { ...prev, players: nextPlayers };
            });
            updatePlayerState(id, { marketStatus: "ready", marketError: null });
            return nextValue;
          } catch (error) {
            lastError = error;
            if (attempt < 2) {
              await sleep(attempt === 0 ? 300 : 1000);
            }
          }
        }
        const message =
          lastError?.message ?? "No se pudo actualizar el valor del jugador";
        updatePlayerState(id, {
          marketStatus: "error",
          marketError: message,
        });
        pushToast(`No se actualizó el valor de ${playerName}.`, {
          type: "warning",
        });
        throw lastError ?? new Error(message);
      })();
      pendingMarketRequests.current.set(id, fetchPromise);
      try {
        return await fetchPromise;
      } finally {
        pendingMarketRequests.current.delete(id);
      }
    },
    [
      pendingMarketRequests,
      playerStates,
      playerIndex,
      cacheMercado,
      myTeam,
      setCacheMercado,
      updatePlayerState,
      setMarket,
      pushToast,
    ]
  );

  useEffect(() => {
    if (!playerIndex.byName.size && !playerIndex.byId.size) {
      return;
    }
    setMyTeam((prev) => {
      let mutated = false;
      const next = prev.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const nameKey = entry.name ? entry.name.toLowerCase() : null;
        const storedId =
          entry.id ??
          entry.playerId ??
          entry.player_id ??
          entry.playerID ??
          entry.idJugador;
        const candidate =
          (storedId !== null && storedId !== undefined
            ? playerIndex.byId.get(String(storedId))
            : null) ?? (nameKey ? playerIndex.byName.get(nameKey) : null);
        if (!candidate) return entry;
        const desiredId =
          candidate.id !== null && candidate.id !== undefined
            ? String(candidate.id)
            : null;
        const desiredPosition = candidate.position ?? null;
        let updated = entry;
        if (desiredId) {
          const currentId =
            entry.id ??
            entry.playerId ??
            entry.player_id ??
            entry.playerID ??
            entry.idJugador;
          if (String(currentId ?? "") !== desiredId) {
            updated = updated === entry ? { ...entry } : { ...updated };
            updated.id = desiredId;
          }
        }
        if (desiredPosition) {
          const currentPosition = collapseWhitespace(normalizeText(entry.position));
          const desiredNormalized = collapseWhitespace(
            normalizeText(desiredPosition)
          );
          if (desiredNormalized && currentPosition !== desiredNormalized) {
            updated = updated === entry ? { ...entry } : { ...updated };
            updated.position = desiredPosition;
          }
        }
        if (updated !== entry) {
          mutated = true;
        }
        return updated;
      });
      return mutated ? next : prev;
    });
  }, [playerIndex]);

  const actualizarPresupuesto = (operacion, monto) => {
    const cantidad = toOptionalNumber(monto);
    if (cantidad === null || cantidad <= 0) {
      return;
    }
    setPresupuestoActual((prev) => {
      if (operacion === "compra") {
        return prev - cantidad;
      }
      if (operacion === "venta") {
        return prev + cantidad;
      }
      if (operacion === "anulacion") {
        return prev - cantidad;
      }
      return prev;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return market.players.slice(0, 100);
    return market.players.filter((p) =>
      [p.name, p.team, p.position].some((x) =>
        x.toLowerCase().includes(q)
      )
    );
  }, [query, market.players]);

  const teamPlayers = useMemo(() => {
    return myTeam
      .map((entry) => {
        if (!entry?.name) return null;
        const nameKey = entry.name.toLowerCase();
        const storedId = getPlayerIdKey(entry);
        const player =
          (storedId !== null && storedId !== undefined
            ? playerIndex.byId.get(String(storedId))
            : null) ?? playerIndex.byName.get(nameKey);
        if (!player) return null;
        const precioCompra = toOptionalNumber(entry.precioCompra);
        const playerId =
          storedId ?? (player.id !== null && player.id !== undefined
            ? String(player.id)
            : null);
        const overrideValue =
          playerId !== null && playerId !== undefined
            ? cacheMercado[playerId]
            : null;
        const rawValue = toOptionalNumber(player.value);
        const marketValue = Number.isFinite(overrideValue)
          ? Number(overrideValue)
          : rawValue;
        const gain =
          precioCompra !== null && marketValue !== null
            ? marketValue - precioCompra
            : null;
        const roi =
          precioCompra !== null && precioCompra > 0 && gain !== null
            ? (gain / precioCompra) * 100
            : null;
        const zone = getZoneFromPosition(player.position ?? entry.position);
        const playerKey = getPlayerKey(player) ?? `name:${nameKey}`;
        const scoreInfo = getCachedScoreInfo(playerId);
        const summary = getResumenPuntos(
          scoreInfo.data.length ? scoreInfo.data : player.points_history
        );
        const history =
          summary.history.length
            ? summary.history
            : normalizeScoreEntries(player.points_history);
        const pointsTotal =
          summary.total !== null ? summary.total : player.points_total;
        const pointsAvg =
          summary.media !== null ? summary.media : player.points_avg;
        const pointsLast5 =
          summary.mediaUltimas5 !== null
            ? summary.mediaUltimas5
            : player.points_last5;
        const state = playerId ? playerStates[playerId] ?? {} : {};
        const defaultMarketStatus = Number.isFinite(marketValue)
          ? "ready"
          : "idle";
        const defaultPointsStatus =
          scoreInfo.data.length && !isScoreCacheStale(scoreInfo.fetchedAt)
            ? "ready"
            : "idle";
        const marketStatus = state.marketStatus ?? defaultMarketStatus;
        const pointsStatus = state.pointsStatus ?? defaultPointsStatus;
        return {
          ...player,
          value: marketValue ?? rawValue ?? null,
          valorMercado: marketValue ?? rawValue ?? null,
          precioCompra,
          gain,
          roi,
          zone,
          playerKey,
          puntuacionPorJornada: history,
          points_total: pointsTotal,
          points_avg: pointsAvg,
          points_last5: pointsLast5,
          scoreSummary: summary,
          scoreFetchedAt: scoreInfo.fetchedAt ?? entry.cacheFechaPuntuacion ?? null,
          _marketStatus: marketStatus,
          _marketError: state.marketError ?? null,
          _pointsStatus: pointsStatus,
          _pointsError: state.pointsError ?? null,
        };
      })
      .filter(Boolean);
  }, [
    myTeam,
    playerIndex,
    cachePuntuaciones,
    cacheMercado,
    playerStates,
    isScoreCacheStale,
  ]);

  useEffect(() => {
    store.jugadoresEquipo = teamPlayers;
  }, [teamPlayers]);

  useEffect(() => {
    store.cacheMercado = cacheMercado;
  }, [cacheMercado]);

  useEffect(() => {
    store.cachePuntuaciones = cachePuntuaciones;
  }, [cachePuntuaciones]);

  useEffect(() => {
    storeControl.pushToast = pushToast;
    return () => {
      if (storeControl.pushToast === pushToast) {
        storeControl.pushToast = null;
      }
    };
  }, [pushToast]);

  useEffect(() => {
    storeControl.refreshMarketFor = refreshMarketFor;
    return () => {
      if (storeControl.refreshMarketFor === refreshMarketFor) {
        storeControl.refreshMarketFor = null;
      }
    };
  }, [refreshMarketFor]);

  useEffect(() => {
    storeControl.refreshPointsFor = refreshPointsFor;
    return () => {
      if (storeControl.refreshPointsFor === refreshPointsFor) {
        storeControl.refreshPointsFor = null;
      }
    };
  }, [refreshPointsFor]);

  const handleMarketSniffer = useCallback(async () => {
    if (marketSnifferRunning) return;
    setMarketSnifferRunning(true);
    try {
      await sniff_market_json_v3_debug_market({ concurrency: 4 });
    } catch (error) {
      console.warn("Error al actualizar los valores de mercado", error);
      if (!error?.isSnifferCommandError) {
        pushToast("Hubo errores al actualizar el valor de mercado.", {
          type: "warning",
        });
      }
    } finally {
      setMarketSnifferRunning(false);
    }
  }, [marketSnifferRunning, pushToast]);

  const handlePointsSniffer = useCallback(async () => {
    if (pointsSnifferRunning) return;
    setPointsSnifferRunning(true);
    try {
      await sniff_market_json_v3_debug_points({ concurrency: 3 });
    } catch (error) {
      console.warn("Error al actualizar las puntuaciones", error);
      if (!error?.isSnifferCommandError) {
        pushToast("Hubo errores al actualizar las puntuaciones.", {
          type: "warning",
        });
      }
    } finally {
      setPointsSnifferRunning(false);
    }
  }, [pointsSnifferRunning, pushToast]);

  const retryMarketForPlayer = useCallback(
    (player) => {
      const id = getPlayerIdKey(player);
      if (!id) return;
      refreshMarketFor(id, { force: true }).catch(() => {
        /* handled via status */
      });
    },
    [refreshMarketFor]
  );

  const retryPointsForPlayer = useCallback(
    (player) => {
      const id = getPlayerIdKey(player);
      if (!id) return;
      refreshPointsFor(id, { force: true }).catch(() => {
        /* handled via status */
      });
    },
    [refreshPointsFor]
  );

  useEffect(() => {
    if (activeTab !== "alineacion") return;
    ensurePuntuacionesUltimos5().catch((error) => {
      console.warn(
        "No se pudieron preparar las puntuaciones recientes antes de recomendar",
        error
      );
    });
  }, [activeTab, ensurePuntuacionesUltimos5]);

  useEffect(() => {
    if (!playerDetailTarget) return undefined;
    const playerId = getPlayerIdKey(playerDetailTarget);
    if (!playerId) {
      setPlayerDetailError("No se pudo identificar al jugador.");
      setPlayerDetailLoading(false);
      return undefined;
    }
    const cached = getCachedScoreInfo(playerId);
    if (cached.data.length && !isScoreCacheStale(cached.fetchedAt)) {
      setPlayerDetailError(null);
      setPlayerDetailLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPlayerDetailLoading(true);
    setPlayerDetailError(null);
    refreshPointsFor(playerId)
      .then(() => {
        if (cancelled) return;
        setPlayerDetailError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setPlayerDetailError(
          "No se pudieron cargar las puntuaciones del jugador."
        );
      })
      .finally(() => {
        if (cancelled) return;
        setPlayerDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerDetailTarget]);

  const totals = useMemo(() => {
    const sum = (arr, key) =>
      arr.reduce((acc, item) => {
        const value = item[key];
        return Number.isFinite(value) ? acc + value : acc;
      }, 0);
    const aggregate = (arr, key) =>
      arr.reduce(
        (acc, item) => {
          const value = item[key];
          if (Number.isFinite(value)) {
            acc.sum += value;
            acc.count += 1;
          }
          return acc;
        },
        { sum: 0, count: 0 }
      );
    const buy = aggregate(teamPlayers, "precioCompra");
    const gain = aggregate(teamPlayers, "gain");
    const avgAll = aggregate(teamPlayers, "points_avg");
    const avgRecent = aggregate(teamPlayers, "points_last5");
    const roi = buy.sum > 0 && gain.count > 0 ? (gain.sum / buy.sum) * 100 : null;
    const pointsTotal = teamPlayers.length > 0 ? sum(teamPlayers, "points_total") : null;
    return {
      value: sum(teamPlayers, "value"),
      change_day: sum(teamPlayers, "change_day"),
      change_week: sum(teamPlayers, "change_week"),
      buy_price: buy.sum,
      buy_count: buy.count,
      gain: gain.count > 0 ? gain.sum : null,
      roi,
      avg_points: avgAll.count > 0 ? avgAll.sum / avgAll.count : null,
      avg_points5: avgRecent.count > 0 ? avgRecent.sum / avgRecent.count : null,
      points_total: pointsTotal,
    };
  }, [teamPlayers]);

  const iniciarCompra = (player) => {
    const exists = myTeam.some((entry) => entryMatchesPlayer(entry, player));
    if (exists) {
      return;
    }
    setPlayerToBuy(player);
    const base = Number.isFinite(player?.value) ? player.value : "";
    setPurchaseValue(
      base === null || base === undefined ? "" : String(base)
    );
  };

  const cerrarCompra = () => {
    setPlayerToBuy(null);
    setPurchaseValue("");
  };

  const comprarJugador = (player, price) => {
    const exists = myTeam.some((entry) => entryMatchesPlayer(entry, player));
    if (exists) {
      return;
    }
    setMyTeam((prev) => {
      const newEntry = {
        name: player.name,
        precioCompra: price,
      };
      const id = getPlayerIdKey(player);
      if (id) {
        newEntry.id = id;
      }
      if (player.position) {
        newEntry.position = player.position;
      }
      return [...prev, newEntry];
    });
    actualizarPresupuesto("compra", price);
  };

  const eliminarJugadorSinVenta = (player) => {
    setMyTeam((prev) => prev.filter((entry) => !entryMatchesPlayer(entry, player)));
  };

  const venderJugador = (player, saleInput) => {
    const sellPrice = toOptionalNumber(saleInput);
    if (sellPrice === null || sellPrice <= 0) return;
    const buyPrice = toOptionalNumber(player.precioCompra);
    const soldAt = new Date().toISOString();
    let removed = false;
    setMyTeam((prev) => {
      const next = prev.filter((entry) => {
        const matches = entryMatchesPlayer(entry, player);
        if (matches) {
          removed = true;
        }
        return !matches;
      });
      return next;
    });
    if (!removed) return;
    setSales((prev) => [
      ...prev,
      {
        name: player.name,
        buyPrice,
        sellPrice,
        soldAt,
        playerId: getPlayerIdKey(player),
        position: player.position,
      },
    ]);
    actualizarPresupuesto("venta", sellPrice);
  };

  const purchaseParsed = toOptionalNumber(purchaseValue);
  const purchaseIsValid = purchaseParsed !== null && purchaseParsed > 0;

  const handleConfirmarCompra = () => {
    if (!playerToBuy || !purchaseIsValid) return;
    comprarJugador(playerToBuy, purchaseParsed);
    cerrarCompra();
  };

  const handleEliminarJugador = (player) => {
    const promptMessage = "¿Eliminar jugador sin vender?";
    const confirmed =
      typeof window !== "undefined" ? window.confirm(promptMessage) : true;
    if (!confirmed) return;
    eliminarJugadorSinVenta(player);
  };

  const saleRecords = useMemo(
    () =>
      sales.map((entry, index) => {
        const buyPrice = entry.buyPrice;
        const sellPrice = entry.sellPrice;
        const gain =
          sellPrice !== null && buyPrice !== null
            ? sellPrice - buyPrice
            : sellPrice;
        const roi =
          sellPrice !== null && buyPrice !== null && buyPrice > 0
            ? ((sellPrice - buyPrice) / buyPrice) * 100
            : null;
        return {
          ...entry,
          key: `${getPlayerIdKey(entry) ?? entry.name}-${entry.soldAt ?? index}`,
          gain,
          roi,
          index,
          isConfirmed: Boolean(entry.soldAt),
          playerId: getPlayerIdKey(entry),
        };
      }),
    [sales]
  );

  const playerLookup = useMemo(() => {
    const map = new Map();
    teamPlayers.forEach((player) => {
      if (player.playerKey) {
        map.set(player.playerKey, player);
      }
    });
    return map;
  }, [teamPlayers]);

  const validPlayerKeys = useMemo(() => {
    const set = new Set();
    teamPlayers.forEach((player) => {
      if (player.playerKey) {
        set.add(player.playerKey);
      }
    });
    return set;
  }, [teamPlayers]);

  const generarRecomendacionesDesdeEquipo = async ({ forceSync = false } = {}) => {
    if (!teamPlayers.length) {
      setRecomendaciones([]);
      setFormacionesIncompletas([]);
      setRecomendacionesError(
        "Añade jugadores a tu plantilla para generar recomendaciones."
      );
      return;
    }
    setRecomendacionesLoading(true);
    setRecomendacionesError(null);
    try {
      await ensurePuntuacionesUltimos5({ force: forceSync });
      const result = generarRecomendacionesTopN(teamPlayers, 3, {
        ponderado: USE_WEIGHTED_RECENT_FORM,
      });
      recommendationScoresRef.current = result.playerScores ?? new Map();
      setFormacionesIncompletas(result.incompletas ?? []);
      setRecomendaciones(result.recomendaciones ?? []);
      if (!result.recomendaciones?.length && !result.incompletas?.length) {
        setRecomendacionesError(
          "No se pudieron generar alineaciones completas con los datos disponibles."
        );
      }
    } catch (error) {
      console.error("Error al generar recomendaciones", error);
      recommendationScoresRef.current = new Map();
      setRecomendaciones([]);
      setFormacionesIncompletas([]);
      setRecomendacionesError(
        "No se pudieron generar las recomendaciones. Inténtalo de nuevo."
      );
    } finally {
      setRecomendacionesLoading(false);
    }
  };

  const handleAplicarRecomendacion = (recomendacion) => {
    if (!recomendacion) return;
    const jugadores = ZONE_CODES.flatMap(
      (zone) => recomendacion.once?.[zone] ?? []
    );
    const faltantes = jugadores.filter((player) => {
      if (!player?.playerKey) return true;
      return !playerLookup.has(player.playerKey);
    });
    if (faltantes.length) {
      setFeedback({
        message:
          "Algunos jugadores ya no están disponibles. Regenera las recomendaciones.",
        type: "error",
      });
      return;
    }
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Aplicar la alineación ${recomendacion.formacion}? Se reemplazará la alineación actual.`
          );
    if (!confirmed) return;
    setFormacionSeleccionada(recomendacion.formacion);
    setAlineacion(() => {
      const base = createEmptyLineup(recomendacion.formacion);
      ZONE_CODES.forEach((zone) => {
        const players = recomendacion.once?.[zone] ?? [];
        base[zone] = players.map((player) => player.playerKey ?? null);
      });
      return base;
    });
    setFeedback({
      message: `Alineación ${recomendacion.formacion} aplicada.`,
      type: "success",
    });
  };

  const abrirDetalleRecomendacion = (recomendacion) => {
    if (!recomendacion) return;
    setRecomendacionSeleccionada(recomendacion);
  };

  const cerrarDetalleRecomendacion = () => {
    setRecomendacionSeleccionada(null);
  };

  const formatMissingForFormation = (entry) => {
    if (!entry?.missing?.length) return "";
    return entry.missing
      .map(({ zone, needed }) => {
        const qty = Math.max(needed ?? 0, 0);
        const plural = ZONE_LABELS_PLURAL[zone] ?? zone;
        const singular = ZONE_LABELS_SINGULAR[zone] ?? zone;
        if (qty === 1) {
          return `1 ${singular}`;
        }
        return `${qty} ${plural}`;
      })
      .join(", ");
  };

  useEffect(() => {
    setAlineacion((prev) => {
      const cleaned = pruneLineupSlots(prev, validPlayerKeys);
      const normalized = ensureLineupShape(cleaned, formacionSeleccionada);
      return lineupEquals(prev, normalized) ? prev : normalized;
    });
  }, [validPlayerKeys, formacionSeleccionada]);

  useEffect(() => {
    setAlineacionGuardada((prev) => {
      if (!prev) return prev;
      const cleaned = pruneLineupSlots(prev.slots, validPlayerKeys);
      const normalized = ensureLineupShape(
        cleaned,
        prev.formation ?? DEFAULT_FORMATION
      );
      if (lineupEquals(prev.slots, normalized)) {
        return prev;
      }
      const updated = { ...prev, slots: normalized };
      saveLineupToStorage(updated);
      return updated;
    });
  }, [validPlayerKeys]);

  const assignedPlayerKeys = useMemo(
    () => new Set(flattenLineupKeys(alineacion)),
    [alineacion]
  );

  const playersForLineupList = useMemo(() => {
    return teamPlayers
      .map((player) => ({
        ...player,
        assigned: assignedPlayerKeys.has(player.playerKey),
      }))
      .sort((a, b) => {
        if (ZONE_ORDER[a.zone] !== ZONE_ORDER[b.zone]) {
          return ZONE_ORDER[a.zone] - ZONE_ORDER[b.zone];
        }
        if (a.assigned !== b.assigned) {
          return a.assigned ? 1 : -1;
        }
        return a.name.localeCompare(b.name, "es");
      });
  }, [teamPlayers, assignedPlayerKeys]);

  const guardarAlineacion = () => {
    const payload = {
      formation: formacionSeleccionada,
      slots: ensureLineupShape(alineacion, formacionSeleccionada),
    };
    setAlineacionGuardada(payload);
    saveLineupToStorage(payload);
    setFeedback({ message: "Alineación guardada.", type: "success" });
  };

  const limpiarAlineacion = () => {
    setAlineacion(createEmptyLineup(formacionSeleccionada));
    setFeedback({ message: "Alineación limpia.", type: "info" });
  };

  const restaurarAlineacion = () => {
    if (!alineacionGuardada) {
      setFeedback({ message: "No hay una alineación guardada.", type: "info" });
      return;
    }
    setFormacionSeleccionada(alineacionGuardada.formation);
    setAlineacion(
      ensureLineupShape(
        alineacionGuardada.slots,
        alineacionGuardada.formation ?? formacionSeleccionada
      )
    );
    setFeedback({ message: "Alineación restaurada.", type: "success" });
  };

  const retirarJugadorDeSlot = (zone, index) => {
    setAlineacion((prev) => {
      if (!prev?.[zone] || prev[zone][index] == null) return prev;
      const next = cloneLineup(prev);
      next[zone][index] = null;
      return next;
    });
  };

  const setDragPayload = (event, payload) => {
    const data = JSON.stringify(payload);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", data);
    event.dataTransfer.setData("text/plain", data);
  };

  const parseDragPayload = (event) => {
    const raw =
      event.dataTransfer.getData("application/json") ||
      event.dataTransfer.getData("text/plain");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const handlePlayerDragStart = (event, player) => {
    if (!player?.playerKey) return;
    setDragPayload(event, {
      type: "player",
      source: "pool",
      playerKey: player.playerKey,
      zone: player.zone,
    });
  };

  const handleSlotDragStart = (event, zone, index, playerKey) => {
    if (!playerKey) return;
    setDragPayload(event, {
      type: "player",
      source: "slot",
      playerKey,
      zone,
      index,
    });
  };

  const handleSlotDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handlePlayerPoolDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleSlotDrop = (zone, index) => (event) => {
    event.preventDefault();
    const payload = parseDragPayload(event);
    if (!payload || payload.type !== "player" || !payload.playerKey) return;
    const player = playerLookup.get(payload.playerKey);
    if (!player) {
      setFeedback({ message: "Jugador no disponible en tu equipo.", type: "error" });
      return;
    }
    const allowedZone = player.zone ?? payload.zone;
    if (allowedZone !== zone) {
      setFeedback({
        message: `Solo puedes colocar ${allowedZone} en ${ZONE_LABELS[zone]}.`,
        type: "error",
      });
      return;
    }
    let rejected = false;
    let rejectionMessage = "";
    setAlineacion((prev) => {
      const normalized = ensureLineupShape(prev, formacionSeleccionada);
      const next = cloneLineup(normalized);
      if (!Array.isArray(next[zone])) {
        rejected = true;
        rejectionMessage = "Zona no disponible.";
        return prev;
      }
      if (payload.source === "pool") {
        const occupied = next[zone][index];
        if (occupied && occupied !== payload.playerKey) {
          rejected = true;
          rejectionMessage = `No hay huecos disponibles en ${ZONE_LABELS[zone]}.`;
          return prev;
        }
        const existing = findPlayerSlot(next, payload.playerKey);
        if (existing) {
          next[existing.zone][existing.index] = null;
        }
        next[zone][index] = payload.playerKey;
        return next;
      }
      if (payload.source === "slot") {
        if (payload.zone !== zone) {
          rejected = true;
          rejectionMessage = "No puedes mover al jugador a otra línea.";
          return prev;
        }
        if (payload.index === index) {
          return prev;
        }
        const fromValue = next[zone][payload.index];
        if (fromValue !== payload.playerKey) {
          return prev;
        }
        const targetValue = next[zone][index] ?? null;
        next[zone][index] = payload.playerKey;
        next[zone][payload.index] = targetValue;
        return next;
      }
      return prev;
    });
    if (rejected && rejectionMessage) {
      setFeedback({ message: rejectionMessage, type: "error" });
    }
  };

  const handlePlayerPoolDrop = (event) => {
    event.preventDefault();
    const payload = parseDragPayload(event);
    if (!payload || payload.type !== "player" || payload.source !== "slot") return;
    let removed = false;
    setAlineacion((prev) => {
      const normalized = ensureLineupShape(prev, formacionSeleccionada);
      const next = cloneLineup(normalized);
      if (!Array.isArray(next[payload.zone])) return prev;
      if (next[payload.zone][payload.index] !== payload.playerKey) return prev;
      next[payload.zone][payload.index] = null;
      removed = true;
      return next;
    });
    if (removed) {
      setFeedback({ message: "Jugador retirado de la alineación.", type: "info" });
    }
  };

  const abrirEliminarVenta = (sale) => {
    setSaleToRemove(sale);
  };

  const cancelarEliminarVenta = () => {
    setSaleToRemove(null);
  };

  const confirmarEliminarVenta = () => {
    if (!saleToRemove) return;
    const sale = saleToRemove;
    setSales((prev) => prev.filter((_, idx) => idx !== sale.index));
    if (sale.isConfirmed && sale.sellPrice !== null && sale.sellPrice !== undefined) {
      actualizarPresupuesto("anulacion", sale.sellPrice);
    }
    if (sale.isConfirmed) {
      const restored = {
        name: sale.name,
        precioCompra: sale.buyPrice ?? null,
      };
      if (sale.playerId) {
        restored.id = sale.playerId;
      }
      if (sale.position) {
        restored.position = sale.position;
      }
      setMyTeam((prev) => {
        const exists = prev.some((entry) => entryMatchesPlayer(entry, restored));
        if (exists) return prev;
        return [...prev, restored];
      });
    }
    setSaleToRemove(null);
  };

  const percentFormatter = new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  const pointsFormatter = new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
  const pointsSummaryFormatter = new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  });

  const detailScoreInfo = playerDetailTarget
    ? getCachedScoreInfo(getPlayerIdKey(playerDetailTarget))
    : { data: [], fetchedAt: null };
  const detailScores = detailScoreInfo.data ?? [];

  const formatSoldAt = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("es-ES");
  };

  const feedbackStyles = {
    success: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    error: "border border-red-200 bg-red-50 text-red-700",
    info: "border border-blue-200 bg-blue-50 text-blue-700",
  };

  const tabButtonClass = (tab) =>
    `rounded-full px-4 py-1.5 text-sm font-semibold transition ${
      activeTab === tab
        ? "bg-indigo-600 text-white shadow"
        : "text-gray-600 hover:text-gray-900"
    }`;

  const openBudgetEditor = useCallback(() => {
    setBudgetDraft(
      Number.isFinite(presupuestoActual) ? String(presupuestoActual) : ""
    );
    setEditBudgetOpen(true);
  }, [presupuestoActual]);

  const closeBudgetEditor = useCallback(() => {
    setEditBudgetOpen(false);
    setBudgetDraft("");
  }, []);

  const confirmBudgetEdit = useCallback(() => {
    if (budgetParsed === null) return;
    setPresupuestoActual(budgetParsed);
    closeBudgetEditor();
  }, [budgetParsed, closeBudgetEditor]);

  const dashboardView = (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Valor actual del equipo" className="xl:col-span-2">
          <BigNumber>
            <span data-testid="total-value">
              {fmtEUR.format(totals.value)}
            </span>
          </BigNumber>
          <SummaryRow
            label="Presupuesto actual del equipo"
            value={fmtEUR.format(presupuestoActual)}
            valueClassName={
              presupuestoActual >= 0 ? "text-green-600" : "text-red-600"
            }
            testId="team-budget"
            actions={
              <button
                type="button"
                className="rounded-full border border-indigo-200 px-2 py-0.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 focus:outline-none focus-visible:ring focus-visible:ring-indigo-200"
                onClick={openBudgetEditor}
                aria-label="Modificar presupuesto del equipo"
                aria-haspopup="dialog"
              >
                Modificar
              </button>
            }
          />
          <DeltaBar
            day={totals.change_day}
            week={totals.change_week}
            formatter={fmtEUR}
          />
          <div className="mt-3 space-y-1 border-t border-gray-100 pt-2">
            <SummaryRow
              label="Invertido"
              value={
                totals.buy_count > 0 ? fmtEUR.format(totals.buy_price) : "—"
              }
              testId="total-buy"
            />
            <SummaryRow
              label="Ganancia"
              value={
                totals.gain !== null
                  ? `${totals.gain >= 0 ? "+" : "-"}${fmtEUR.format(
                      Math.abs(totals.gain)
                    )}`
                  : "—"
              }
              valueClassName={
                totals.gain !== null
                  ? totals.gain >= 0
                    ? "text-green-600"
                    : "text-red-600"
                  : ""
              }
              testId="total-gain"
            />
            <SummaryRow
              label="Rentabilidad"
              value={
                totals.roi !== null
                  ? `${totals.roi >= 0 ? "+" : "-"}${percentFormatter.format(
                      Math.abs(totals.roi)
                    )}%`
                  : "—"
              }
              valueClassName={
                totals.roi !== null
                  ? totals.roi >= 0
                    ? "text-green-600"
                    : "text-red-600"
                  : ""
              }
              testId="total-roi"
            />
          </div>
        </Card>
        <Card title="Comprar un jugador" className="md:col-span-2 xl:col-span-2">
          <input
            type="text"
            className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring"
            placeholder="Busca por nombre, equipo o posición…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mt-3 max-h-60 overflow-auto rounded-xl border bg-white divide-y">
            {filtered.slice(0, 50).map((p) => (
              <button
                key={p.name + p.team}
                onClick={() => iniciarCompra(p)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50"
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-gray-500">
                  {p.team} · {p.position}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </section>

      <section className="bg-white border rounded-2xl shadow p-4">
        <h2 className="mb-3 text-xl font-semibold">Detalle del equipo</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="team-table">
            <thead className="bg-gray-100 text-gray-700">
              <tr>
                <Th>Jugador</Th>
                <Th>Equipo</Th>
                <Th>Pos.</Th>
                <Th className="text-right">Valor</Th>
                <Th className="text-right">Comprado</Th>
                <Th className="text-right">Venta</Th>
                <Th className="text-right">Ganancia</Th>
                <Th className="text-right">Rentabilidad</Th>
                <Th className="text-right">Δ día</Th>
                <Th className="text-right">Δ semana</Th>
                <Th className="text-right">Puntos</Th>
                <Th className="text-right">Media</Th>
                <Th className="text-right">Media (5)</Th>
              </tr>
            </thead>
            <tbody>
              {teamPlayers.map((p) => (
                <tr key={p.name} className="border-b last:border-none">
                  <Td>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs font-semibold text-gray-400 transition hover:text-red-600"
                          onClick={() => handleEliminarJugador(p)}
                          aria-label={`Eliminar ${p.name} sin vender`}
                        >
                          ×
                        </button>
                        <button
                          type="button"
                          className="text-sm font-semibold text-indigo-600 transition hover:text-indigo-800 focus:outline-none focus-visible:ring"
                          onClick={() => abrirDetalleJugador(p)}
                          aria-label={`Ver detalle de ${p.name}`}
                        >
                          {p.name}
                        </button>
                      </div>
                      {p.scoreSummary?.ultimas5?.length ? (
                        <details className="group text-xs text-gray-600">
                          <summary className="cursor-pointer list-none text-indigo-600 hover:underline focus:outline-none focus-visible:ring">
                            Últimas jornadas
                          </summary>
                          <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50 p-2 shadow-sm">
                            <ul className="space-y-1">
                              {p.scoreSummary.ultimas5.map((item) => (
                                <li
                                  key={`${p.playerKey ?? p.name}-score-${item.jornada}`}
                                  className="flex justify-between"
                                >
                                  <span>{`J${item.jornada}`}</span>
                                  <span>
                                    {pointsSummaryFormatter.format(item.puntos)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-2 flex justify-between border-t border-indigo-200 pt-1 font-medium text-indigo-700">
                              <span>Media últimas 5</span>
                              <span>
                                {p.scoreSummary.mediaUltimas5 !== null
                                  ? pointsSummaryFormatter.format(
                                      p.scoreSummary.mediaUltimas5
                                    )
                                  : "—"}
                              </span>
                            </div>
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </Td>
                  <Td>{p.team}</Td>
                  <Td>{p.position}</Td>
                  <Td className="text-right">
                    <MarketValueCell
                      value={p.valorMercado ?? p.value}
                      status={p._marketStatus}
                      error={p._marketError}
                      onRetry={() => retryMarketForPlayer(p)}
                    />
                  </Td>
                  <Td className="text-right">
                    {Number.isFinite(p.precioCompra)
                      ? fmtEUR.format(p.precioCompra)
                      : "—"}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end">
                      <SaleControl
                        player={p}
                        onSell={(value) => venderJugador(p, value)}
                      />
                    </div>
                  </Td>
                  <Td
                    className={`text-right ${
                      p.gain !== null
                        ? p.gain >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : "text-gray-500"
                    }`}
                  >
                    {p.gain !== null
                      ? `${p.gain >= 0 ? "+" : "-"}${fmtEUR.format(
                          Math.abs(p.gain)
                        )}`
                      : "—"}
                  </Td>
                  <Td
                    className={`text-right ${
                      p.roi !== null
                        ? p.roi >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : "text-gray-500"
                    }`}
                  >
                    {p.roi !== null
                      ? `${p.roi >= 0 ? "+" : "-"}${percentFormatter.format(
                          Math.abs(p.roi)
                        )}%`
                      : "—"}
                  </Td>
                  <Td
                    className={`text-right ${
                      p.change_day >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {p.change_day >= 0 ? "+" : ""}
                    {fmtEUR.format(p.change_day)}
                  </Td>
                  <Td
                    className={`text-right ${
                      p.change_week >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {p.change_week >= 0 ? "+" : ""}
                    {fmtEUR.format(p.change_week)}
                  </Td>
                  <Td className="text-right text-gray-700">
                    <PointsCell
                      value={p.points_total}
                      status={p._pointsStatus}
                      error={p._pointsError}
                      formatter={pointsFormatter}
                      onRetry={() => retryPointsForPlayer(p)}
                      showRetry
                    />
                  </Td>
                  <Td className="text-right text-gray-700">
                    <PointsCell
                      value={p.points_avg}
                      status={p._pointsStatus}
                      error={p._pointsError}
                      formatter={pointsFormatter}
                      onRetry={() => retryPointsForPlayer(p)}
                    />
                  </Td>
                  <Td className="text-right text-gray-700">
                    <PointsCell
                      value={p.points_last5}
                      status={p._pointsStatus}
                      error={p._pointsError}
                      formatter={pointsFormatter}
                      onRetry={() => retryPointsForPlayer(p)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border rounded-2xl shadow p-4">
        <h2 className="mb-3 text-xl font-semibold">Ventas realizadas</h2>
        {saleRecords.length === 0 ? (
          <p className="text-sm text-gray-500">
            Aún no has registrado ventas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" data-testid="sales-table">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <Th>Jugador</Th>
                  <Th className="text-right">Comprado</Th>
                  <Th className="text-right">Vendido</Th>
                  <Th className="text-right">Ganancia</Th>
                  <Th className="text-right">Rentabilidad</Th>
                  <Th className="text-right">Fecha</Th>
                  <Th className="text-right">Acción</Th>
                </tr>
              </thead>
              <tbody>
                {saleRecords.map((sale, index) => (
                  <tr
                    key={sale.key || `${sale.name}-${index}`}
                    className="border-b last:border-none"
                  >
                    <Td>{sale.name}</Td>
                    <Td className="text-right">
                      {sale.buyPrice !== null
                        ? fmtEUR.format(sale.buyPrice)
                        : "—"}
                    </Td>
                    <Td className="text-right">
                      {sale.sellPrice !== null
                        ? fmtEUR.format(sale.sellPrice)
                        : "—"}
                    </Td>
                    <Td
                      className={`text-right ${
                        sale.gain !== null
                          ? sale.gain >= 0
                            ? "text-green-600"
                            : "text-red-600"
                          : "text-gray-500"
                      }`}
                    >
                      {sale.gain !== null
                        ? `${sale.gain >= 0 ? "+" : "-"}${fmtEUR.format(
                            Math.abs(sale.gain)
                          )}`
                        : "—"}
                    </Td>
                    <Td
                      className={`text-right ${
                        sale.roi !== null
                          ? sale.roi >= 0
                            ? "text-green-600"
                            : "text-red-600"
                          : "text-gray-500"
                      }`}
                    >
                      {sale.roi !== null
                        ? `${sale.roi >= 0 ? "+" : "-"}${percentFormatter.format(
                            Math.abs(sale.roi)
                          )}%`
                        : "—"}
                    </Td>
                    <Td className="text-right text-gray-600">
                      {formatSoldAt(sale.soldAt)}
                    </Td>
                    <Td className="text-right">
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-600 hover:text-red-800"
                        onClick={() => abrirEliminarVenta(sale)}
                      >
                        Eliminar/Anular venta
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );

  const alignmentView = (
    <div className="space-y-6">
      {feedback?.message && (
        <div
          className={`rounded-xl px-3 py-2 text-sm ${
            feedbackStyles[feedback.type || "info"] ?? feedbackStyles.info
          }`}
        >
          {feedback.message}
        </div>
      )}
      <section className="bg-white border rounded-2xl shadow p-4 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <label
              className="text-sm font-medium text-gray-600"
              htmlFor="formation-select"
            >
              Formación
            </label>
            <select
              id="formation-select"
              className="rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring"
              value={formacionSeleccionada}
              onChange={(event) => setFormacionSeleccionada(event.target.value)}
            >
              {FORMATIONS.map((formation) => (
                <option key={formation} value={formation}>
                  {formation}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow hover:bg-indigo-700"
              onClick={guardarAlineacion}
            >
              Guardar alineación
            </button>
            <button
              type="button"
              className="rounded-full border border-gray-300 px-4 py-1.5 text-sm font-semibold text-gray-600 hover:border-gray-400 hover:text-gray-800"
              onClick={limpiarAlineacion}
            >
              Limpiar
            </button>
            <button
              type="button"
              className="rounded-full border border-gray-300 px-4 py-1.5 text-sm font-semibold text-gray-600 hover:border-gray-400 hover:text-gray-800"
              onClick={restaurarAlineacion}
            >
              Restaurar última guardada
            </button>
          </div>
        </div>
        <div className="border-t border-gray-100" />
        <div className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Recomendadas</h3>
              <p className="text-xs text-gray-500">
                Basadas en los últimos 5 partidos de tus jugadores.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                onClick={() => generarRecomendacionesDesdeEquipo({ forceSync: false })}
                disabled={recomendacionesLoading}
              >
                {recomendacionesLoading ? "Calculando…" : "Generar recomendaciones"}
              </button>
              <button
                type="button"
                className="rounded-full border border-indigo-200 px-4 py-1.5 text-sm font-semibold text-indigo-600 transition hover:border-indigo-400 hover:text-indigo-800 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                onClick={() => generarRecomendacionesDesdeEquipo({ forceSync: true })}
                disabled={recomendacionesLoading || !teamPlayers.length}
              >
                Regenerar
              </button>
            </div>
          </div>
          {recomendacionesError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {recomendacionesError}
            </div>
          )}
          {formacionesIncompletas.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <p className="font-semibold">Formaciones incompletas:</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {formacionesIncompletas.map((item) => (
                  <li key={`incompleta-${item.formacion}`}>
                    {item.formacion}
                    {item.missing?.length ? ` · ${formatMissingForFormation(item)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {recomendacionesLoading ? (
            <p className="text-sm text-gray-500">Calculando recomendaciones…</p>
          ) : recomendaciones.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {recomendaciones.map((rec) => (
                <article
                  key={`recomendacion-${rec.formacion}`}
                  className="flex h-full flex-col rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                        Formación recomendada
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {rec.formacion}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        Media global: {pointsSummaryFormatter.format(
                          Number.isFinite(rec.scoreAlineacion)
                            ? rec.scoreAlineacion
                            : 0
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
                        onClick={() => handleAplicarRecomendacion(rec)}
                        disabled={recomendacionesLoading}
                      >
                        Aplicar alineación
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-600 transition hover:border-indigo-400 hover:text-indigo-800"
                        onClick={() => abrirDetalleRecomendacion(rec)}
                      >
                        Ver detalles
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    {ZONE_CODES.map((zone) => {
                      const zonePlayers = rec.once?.[zone] ?? [];
                      const zoneBreakdown = rec.breakdown?.[zone];
                      return (
                        <div
                          key={`${rec.formacion}-${zone}`}
                          className="rounded-xl bg-white/70 p-3 shadow-inner"
                        >
                          <div className="text-xs font-semibold uppercase text-indigo-700">
                            {zone}
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {pointsSummaryFormatter.format(
                              Number.isFinite(zoneBreakdown?.average)
                                ? zoneBreakdown.average
                                : 0
                            )}
                          </div>
                          <ul className="mt-2 space-y-1 text-[11px] text-gray-600">
                            {zonePlayers.map((player) => (
                              <li
                                key={player.playerKey ?? player.name}
                                className="flex justify-between gap-2"
                              >
                                <span className="truncate">{player.name}</span>
                                <span className="font-semibold text-gray-900">
                                  {pointsSummaryFormatter.format(
                                    Number.isFinite(player.scoreRecomendacion)
                                      ? player.scoreRecomendacion
                                      : 0
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            !recomendacionesError && (
              <p className="text-sm text-gray-500">
                Genera recomendaciones para ver alineaciones sugeridas.
              </p>
            )
          )}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <section
          className="bg-white border rounded-2xl shadow p-4"
          onDragOver={handlePlayerPoolDragOver}
          onDrop={handlePlayerPoolDrop}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Mis jugadores</h2>
            {playersForLineupList.length > 0 && (
              <span className="text-xs text-gray-500">
                {playersForLineupList.length} jugadores
              </span>
            )}
          </div>
          {playersForLineupList.length === 0 ? (
            <p className="text-sm text-gray-500">
              Aún no tienes jugadores en tu equipo.
            </p>
          ) : (
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {playersForLineupList.map((player) => (
                <li
                  key={player.playerKey}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${
                    player.assigned
                      ? "border-indigo-200 bg-indigo-50"
                      : "border-gray-200 bg-white"
                  }`}
                  draggable
                  onDragStart={(event) => handlePlayerDragStart(event, player)}
                >
                  <div>
                    <div className="font-medium text-gray-900">{player.name}</div>
                    <div className="text-xs text-gray-500">
                      {player.team} · {player.position}
                    </div>
                  </div>
                  <div
                    className={`text-xs font-semibold ${
                      player.assigned ? "text-indigo-600" : "text-gray-500"
                    }`}
                  >
                    {player.zone}
                    {player.assigned ? " · Alineado" : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="bg-white border rounded-2xl shadow p-4">
          <h2 className="mb-4 text-xl font-semibold">Campo</h2>
          <div className="rounded-3xl bg-gradient-to-b from-green-600 to-green-700 p-4 text-white sm:p-6">
            <div className="space-y-6">
              {ZONE_CODES.map((zone) => {
                const slots = alineacion?.[zone] ?? [];
                return (
                  <div key={zone} className="space-y-2">
                    <div className="text-center text-xs font-semibold uppercase tracking-wide text-white/80">
                      {ZONE_LABELS[zone]}
                    </div>
                    <div
                      className="grid gap-3 justify-items-center"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(
                          slots.length,
                          1
                        )}, minmax(0, 1fr))`,
                      }}
                    >
                      {slots.map((slotKey, slotIndex) => {
                        const assignedPlayer = slotKey
                          ? playerLookup.get(slotKey)
                          : null;
                        return (
                          <div
                            key={`${zone}-${slotIndex}`}
                            data-zone={zone}
                            data-slot-index={slotIndex}
                            className={`flex min-h-[80px] w-full max-w-[140px] flex-col items-center justify-center rounded-xl border-2 border-white/70 bg-white/10 p-3 text-center transition ${
                              assignedPlayer
                                ? "shadow-lg shadow-black/10"
                                : "border-dashed"
                            }`}
                            draggable={Boolean(assignedPlayer)}
                            onDragStart={(event) =>
                              assignedPlayer &&
                              handleSlotDragStart(event, zone, slotIndex, slotKey)
                            }
                            onDragOver={handleSlotDragOver}
                            onDrop={handleSlotDrop(zone, slotIndex)}
                          >
                            {assignedPlayer ? (
                              <>
                                <span className="text-sm font-semibold leading-tight">
                                  {assignedPlayer.name}
                                </span>
                                <button
                                  type="button"
                                  className="text-xs font-medium text-white/80 hover:text-white"
                                  onClick={() => retirarJugadorDeSlot(zone, slotIndex)}
                                  aria-label={`Quitar ${assignedPlayer.name} de ${ZONE_LABELS[zone]}`}
                                >
                                  Quitar
                                </button>
                              </>
                            ) : (
                              <span className="text-xs uppercase tracking-wide text-white/70">
                                {zone} #{slotIndex + 1}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">
            Mi equipo – LaLiga Fantasy
          </h1>
          <div className="text-sm text-gray-600">
            {status === "ok" && (
              <span>
                Última actualización: {" "}
                {market.updated_at
                  ? new Date(market.updated_at).toLocaleString("es-ES")
                  : "desconocida"}
              </span>
            )}
            {status === "cargando" && <span>Cargando mercado…</span>}
            {status === "error" && (
              <span className="text-red-600">Error al cargar market.json</span>
            )}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            onClick={handleMarketSniffer}
            disabled={marketSnifferRunning}
          >
            {marketSnifferRunning
              ? "Actualizando mercado…"
              : "Actualizar valor de mercado"}
          </button>
          <button
            type="button"
            className="rounded-full border border-indigo-200 px-4 py-1.5 text-sm font-semibold text-indigo-600 transition hover:border-indigo-400 hover:text-indigo-800 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
            onClick={handlePointsSniffer}
            disabled={pointsSnifferRunning}
          >
            {pointsSnifferRunning
              ? "Actualizando puntuaciones…"
              : "Actualizar puntos de jornada"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
          <button
            type="button"
            className={tabButtonClass("dashboard")}
            onClick={() => setActiveTab("dashboard")}
          >
            Detalle del equipo
          </button>
          <button
            type="button"
            className={tabButtonClass("alineacion")}
            onClick={() => setActiveTab("alineacion")}
          >
            Alineación
          </button>
        </div>

        {activeTab === "dashboard" ? dashboardView : alignmentView}

        <footer className="text-xs text-gray-500">
          Los datos provienen de un archivo JSON generado a partir del HTML
          público del mercado.
        </footer>
      </div>
      {recomendacionSeleccionada && (
        <RecommendationDetailModal
          recomendacion={recomendacionSeleccionada}
          onClose={cerrarDetalleRecomendacion}
          pointsFormatter={pointsFormatter}
          pointsSummaryFormatter={pointsSummaryFormatter}
          useWeighted={USE_WEIGHTED_RECENT_FORM}
        />
      )}
      {playerDetailTarget && (
        <PlayerDetailModal
          player={playerDetailTarget}
          scores={detailScores}
          loading={playerDetailLoading}
          error={playerDetailError}
          onClose={cerrarDetalleJugador}
          onRefresh={refrescarDetalleJugador}
          pointsFormatter={pointsFormatter}
          fetchedAt={detailScoreInfo.fetchedAt}
        />
      )}
      {editBudgetOpen && (
        <EditBudgetModal
          value={budgetDraft}
          onChange={setBudgetDraft}
          onCancel={closeBudgetEditor}
          onConfirm={confirmBudgetEdit}
          isValid={budgetIsValid}
        />
      )}
      {playerToBuy && (
        <PurchaseModal
          player={playerToBuy}
          value={purchaseValue}
          onChange={setPurchaseValue}
          onCancel={cerrarCompra}
          onConfirm={handleConfirmarCompra}
          isValid={purchaseIsValid}
        />
      )}
      {saleToRemove && (
        <DeleteSaleModal
          sale={saleToRemove}
          onCancel={cancelarEliminarVenta}
          onConfirm={confirmarEliminarVenta}
        />
      )}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed right-4 top-4 z-50 space-y-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex max-w-xs items-start gap-3 rounded-xl px-4 py-2 text-sm shadow-lg ${
                toastStyles[toast.type ?? "info"] ?? toastStyles.info
              }`}
            >
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button
                type="button"
                className="text-lg font-semibold leading-none text-gray-400 transition hover:text-gray-600"
                onClick={() => removeToast(toast.id)}
                aria-label="Cerrar aviso"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function Card({ title, children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border shadow p-4 ${className}`}>
      <div className="text-sm text-gray-500 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function BigNumber({ children }) {
  return <div className="text-3xl font-bold">{children}</div>;
}

function DeltaBar({ day, week, formatter }) {
  const Item = ({ label, value }) => (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span
        className={`text-sm ${
          value >= 0 ? "text-green-600" : "text-red-600"
        }`}
      >
        {value >= 0 ? "+" : ""}
        {formatter.format(value)}
      </span>
    </div>
  );
  return (
    <div className="space-y-1">
      <Item label="Variación día" value={day} />
      <Item label="Variación semana" value={week} />
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th className={`px-3 py-2 font-semibold text-left ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function SummaryRow({ label, value, valueClassName = "", testId, actions = null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-medium ${valueClassName}`} data-testid={testId}>
          {value}
        </span>
        {actions}
      </div>
    </div>
  );
}

function SaleControl({ player, onSell, align = "right" }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        const base = Number.isFinite(player?.value)
          ? Math.round(player.value)
          : player?.precioCompra ?? "";
        setValue(base === null || base === undefined ? "" : String(base));
      }
      return next;
    });
  };

  const parsed = toOptionalNumber(value);

  const handleConfirm = () => {
    if (parsed === null) return;
    onSell(parsed);
    setOpen(false);
  };

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Vender a ${player.name}`}
      >
        Vender
      </button>
      {open && (
        <div
          className={`absolute z-20 mt-2 w-56 rounded-xl border bg-white p-3 shadow-lg ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">
              Precio de venta de {player.name}
              <input
                type="number"
                min="0"
                step="1000"
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border px-2 py-1 text-right focus:outline-none focus:ring"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="rounded-full px-3 py-1 text-gray-500 hover:text-gray-700"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={`rounded-full px-3 py-1 font-semibold ${
                  parsed === null
                    ? "bg-gray-200 text-gray-400"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
                onClick={handleConfirm}
                disabled={parsed === null}
              >
                Confirmar venta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MarketValueCell({ value, status = "idle", error = null, onRetry }) {
  const formatted = Number.isFinite(value) ? fmtEUR.format(value) : "—";
  if (status === "loading") {
    return (
      <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
        <span
          className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600"
          aria-label="Actualizando valor de mercado"
        />
        <span>Actualizando…</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center justify-end gap-2 text-xs text-red-600">
        <span
          role="img"
          aria-label="Error al actualizar valor"
          title={error || "No se pudo actualizar el valor de mercado"}
        >
          ⚠️
        </span>
        <button
          type="button"
          className="rounded-full border border-red-200 px-2 py-0.5 font-semibold text-red-600 transition hover:border-red-300 hover:text-red-800"
          onClick={() => onRetry?.()}
        >
          Reintentar
        </button>
      </div>
    );
  }
  return <span>{formatted}</span>;
}

function PointsCell({
  value,
  status = "idle",
  error = null,
  formatter,
  onRetry,
  showRetry = false,
}) {
  const fmt = formatter ??
    new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const display = Number.isFinite(value) ? fmt.format(value) : "—";
  if (status === "loading") {
    return (
      <div className="flex items-center justify-end">
        <span
          className="inline-flex h-3 w-3 animate-spin rounded-full border border-indigo-200 border-t-indigo-600"
          aria-label="Actualizando puntos"
        />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center justify-end gap-2 text-xs text-red-600">
        <span
          role="img"
          aria-label="Error al actualizar puntos"
          title={error || "No se pudieron actualizar las puntuaciones"}
        >
          ⚠️
        </span>
        {showRetry && (
          <button
            type="button"
            className="rounded-full border border-red-200 px-2 py-0.5 font-semibold text-red-600 transition hover:border-red-300 hover:text-red-800"
            onClick={() => onRetry?.()}
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }
  return <span>{display}</span>;
}

function EditBudgetModal({ value, onChange, onCancel, onConfirm, isValid }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-budget-modal-title"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <h3
            id="edit-budget-modal-title"
            className="text-lg font-semibold text-gray-900"
          >
            Modificar presupuesto del equipo
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-xl leading-none text-gray-400 transition hover:text-gray-600"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              className="block text-sm font-medium text-gray-600"
              htmlFor="budget-input"
            >
              Nuevo presupuesto
            </label>
            <input
              id="budget-input"
              type="number"
              step="0.01"
              inputMode="decimal"
              autoFocus
              className="mt-1 w-full rounded-lg border px-3 py-2 text-right focus:outline-none focus:ring"
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">
              Introduce la cantidad exacta que quieras guardar, con o sin decimales.
            </p>
          </div>
          <div className="flex justify-end gap-2 text-sm">
            <button
              type="button"
              className="rounded-full px-3 py-1 text-gray-500 hover:text-gray-700"
              onClick={onCancel}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`rounded-full px-3 py-1 font-semibold ${
                isValid
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "bg-gray-200 text-gray-400"
              }`}
              disabled={!isValid}
            >
              Guardar presupuesto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PurchaseModal({ player, value, onChange, onConfirm, onCancel, isValid }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-modal-title"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <h3 id="purchase-modal-title" className="text-lg font-semibold text-gray-900">
            Comprar a {player.name}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-xl leading-none text-gray-400 transition hover:text-gray-600"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-600" htmlFor="purchase-price">
              Precio de compra
            </label>
            <input
              id="purchase-price"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-right text-base focus:outline-none focus:ring"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              autoFocus
            />
            {!isValid && (
              <p className="mt-1 text-xs text-red-600">
                Introduce un precio válido mayor que 0.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 text-sm">
            <button
              type="button"
              className="rounded-full px-4 py-1.5 text-gray-500 hover:text-gray-700"
              onClick={onCancel}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`rounded-full px-4 py-1.5 font-semibold ${
                isValid
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : "bg-gray-200 text-gray-400"
              }`}
              disabled={!isValid}
            >
              Confirmar compra
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteSaleModal({ sale, onConfirm, onCancel }) {
  if (!sale) return null;
  const message = sale.isConfirmed
    ? "Se anulará la venta, se revertirá el presupuesto y se restaurará el jugador al equipo."
    : "Se eliminará el registro de la lista de ventas.";
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-sale-modal-title"
        className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h3 id="delete-sale-modal-title" className="text-lg font-semibold text-gray-900">
          ¿Eliminar esta venta?
        </h3>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <div className="mt-6 flex justify-end gap-2 text-sm">
          <button
            type="button"
            className="rounded-full px-4 py-1.5 text-gray-500 hover:text-gray-700"
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-full bg-red-600 px-4 py-1.5 font-semibold text-white shadow hover:bg-red-700"
            onClick={onConfirm}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function RecommendationDetailModal({
  recomendacion,
  onClose,
  pointsFormatter,
  pointsSummaryFormatter,
  useWeighted,
}) {
  if (!recomendacion) return null;
  const avgFormatter =
    pointsSummaryFormatter ??
    new Intl.NumberFormat("es-ES", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    });
  const totalFormatter =
    pointsFormatter ??
    new Intl.NumberFormat("es-ES", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    });
  const mediaGlobal = Number.isFinite(recomendacion.scoreAlineacion)
    ? recomendacion.scoreAlineacion
    : 0;
  const jugadores = ZONE_CODES.flatMap((zone) =>
    (recomendacion.once?.[zone] ?? []).map((player) => ({
      ...player,
      zone,
    }))
  ).sort((a, b) => {
    if (ZONE_ORDER[a.zone] !== ZONE_ORDER[b.zone]) {
      return ZONE_ORDER[a.zone] - ZONE_ORDER[b.zone];
    }
    return (a.name ?? "").localeCompare(b.name ?? "", "es");
  });
  const explanation = useWeighted
    ? "Basado en la media ponderada de los últimos 5 partidos."
    : "Basado en la media de los últimos 5 partidos.";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-detail-title"
        className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h3
              id="recommendation-detail-title"
              className="text-xl font-semibold text-gray-900"
            >
              Alineación {recomendacion.formacion}
            </h3>
            <p className="text-sm text-gray-500">
              Media global: {avgFormatter.format(mediaGlobal)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 transition hover:text-gray-600"
            aria-label="Cerrar detalles de la recomendación"
          >
            ×
          </button>
        </header>
        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-6 py-5">
          <section>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Detalle por jugador
            </h4>
            <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
              <table
                className="min-w-full text-sm"
                aria-label="Detalle de la alineación recomendada"
              >
                <thead className="bg-indigo-50 text-indigo-700">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Jugador</th>
                    <th className="px-3 py-2 text-left font-semibold">Posición</th>
                    <th className="px-3 py-2 text-right font-semibold">Score recomendación</th>
                    <th className="px-3 py-2 text-left font-semibold">Últimas 5</th>
                    <th className="px-3 py-2 text-left font-semibold">Media / Total</th>
                  </tr>
                </thead>
                <tbody>
                  {jugadores.map((player) => {
                    const entries = Array.isArray(player.recommendationInfo?.entries)
                      ? player.recommendationInfo.entries
                      : [];
                    const entriesText = entries.length
                      ? entries
                          .map((entry, index) => {
                            const jornada =
                              entry?.jornada !== null && entry?.jornada !== undefined && entry?.jornada !== ""
                                ? `J${entry.jornada}`
                                : `P${index + 1}`;
                            const puntos =
                              entry?.puntos !== null && entry?.puntos !== undefined
                                ? avgFormatter.format(entry.puntos)
                                : "—";
                            return `${jornada}: ${puntos}`;
                          })
                          .join(" · ")
                      : "—";
                    const simpleAverage = Number.isFinite(
                      player.recommendationInfo?.simpleAverage
                    )
                      ? player.recommendationInfo.simpleAverage
                      : null;
                    const total = Number.isFinite(player.recommendationInfo?.total)
                      ? player.recommendationInfo.total
                      : null;
                    const matches = player.recommendationInfo?.matchesConsidered ?? 0;
                    const mediaText = matches
                      ? `Media: ${avgFormatter.format(simpleAverage ?? 0)} · Total: ${totalFormatter.format(
                          total ?? 0
                        )} (${matches} ${matches === 1 ? "partido" : "partidos"})`
                      : "Sin datos recientes";
                    return (
                      <tr
                        key={player.playerKey ?? `${player.name}-${player.zone}`}
                        className="odd:bg-white even:bg-indigo-50/40"
                      >
                        <td className="px-3 py-2 text-left font-medium text-gray-900">
                          <div>{player.name}</div>
                          {player.team && (
                            <div className="text-xs font-normal text-gray-500">
                              {player.team}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-left text-gray-700">
                          {ZONE_LABELS[player.zone] ?? player.zone}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900">
                          {avgFormatter.format(
                            Number.isFinite(player.scoreRecomendacion)
                              ? player.scoreRecomendacion
                              : 0
                          )}
                        </td>
                        <td className="px-3 py-2 text-left text-gray-700">{entriesText}</td>
                        <td className="px-3 py-2 text-left text-gray-700">{mediaText}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <p className="text-xs text-gray-500">{explanation}</p>
        </div>
      </div>
    </div>
  );
}

function PlayerDetailModal({
  player,
  scores,
  loading,
  error,
  onClose,
  onRefresh,
  pointsFormatter,
  fetchedAt,
}) {
  if (!player) return null;
  const pointFmt =
    pointsFormatter ??
    new Intl.NumberFormat("es-ES", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    });
  const summary = getResumenPuntos(
    scores && scores.length ? scores : player.points_history
  );
  const displayScores = summary.history;
  const totalPoints = summary.total;
  const averagePoints = summary.media;
  const averageLast5 = summary.mediaUltimas5;
  const infoLine = [player.team, player.position]
    .filter(Boolean)
    .join(" · ");
  let fetchedLabel = null;
  const fetchedTimestamp = fetchedAt ?? player.scoreFetchedAt;
  if (fetchedTimestamp) {
    const fetchedDate = new Date(fetchedTimestamp);
    if (!Number.isNaN(fetchedDate.getTime())) {
      fetchedLabel = fetchedDate.toLocaleString("es-ES");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-detail-title"
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h3
              id="player-detail-title"
              className="text-xl font-semibold text-gray-900"
            >
              {player.name}
            </h3>
            {infoLine && <p className="text-sm text-gray-500">{infoLine}</p>}
            {fetchedLabel && (
              <p className="text-xs text-gray-400">
                Puntuaciones sincronizadas: {fetchedLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 transition hover:text-gray-600"
            aria-label="Cerrar detalle del jugador"
          >
            ×
          </button>
        </header>
        <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Información general
            </h4>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Valor de mercado</span>
                <span className="font-medium text-gray-900">
                  {fmtEUR.format(player.value)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Precio de compra</span>
                <span className="font-medium text-gray-900">
                  {Number.isFinite(player.precioCompra)
                    ? fmtEUR.format(player.precioCompra)
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Puntos totales</span>
                <span className="font-medium text-gray-900">
                  {totalPoints !== null ? pointFmt.format(totalPoints) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Media</span>
                <span className="font-medium text-gray-900">
                  {averagePoints !== null ? pointFmt.format(averagePoints) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Media últimas 5</span>
                <span className="font-medium text-gray-900">
                  {averageLast5 !== null ? pointFmt.format(averageLast5) : "—"}
                </span>
              </div>
            </div>
          </section>
          <section>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Puntuación por jornada
              </h4>
              <div className="flex items-center gap-2">
                {loading && (
                  <span className="text-xs font-medium text-indigo-600">
                    Cargando…
                  </span>
                )}
                <button
                  type="button"
                  className="rounded-full border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-600 transition hover:border-indigo-400 hover:text-indigo-800 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                  onClick={onRefresh}
                  disabled={loading}
                >
                  Actualizar
                </button>
              </div>
            </div>
            {error && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            {!error && !loading && !displayScores.length ? (
              <p className="mt-2 text-sm text-gray-500">
                No hay puntuaciones disponibles para este jugador.
              </p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
                <table
                  className="min-w-full text-sm"
                  aria-label="Tabla de puntuación por jornada"
                >
                  <thead className="bg-indigo-50 text-indigo-700">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Jornada</th>
                      <th className="px-3 py-2 text-right font-semibold">Puntos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayScores.map((entry) => (
                      <tr
                        key={`player-score-${entry.jornada}`}
                        className="odd:bg-white even:bg-indigo-50/40"
                      >
                        <td className="px-3 py-1.5 text-left text-gray-700">
                          J{entry.jornada}
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-900">
                          {pointFmt.format(entry.puntos)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

