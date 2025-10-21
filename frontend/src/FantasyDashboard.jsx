import React, { useEffect, useMemo, useRef, useState } from "react";

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

const fmtEUR = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const SCORE_CACHE_STORAGE_KEY = "playerScoresCache";
const PLAYER_DETAIL_ENDPOINT = "https://www.laligafantasymarca.com/api/v3/player";
const PLAYER_DETAIL_COMPETITION = "laliga-fantasy";
const SCORE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  const pendingScoreRequests = useRef(new Map());
  const [saleToRemove, setSaleToRemove] = useState(null);
  const [playerDetailTarget, setPlayerDetailTarget] = useState(null);
  const [playerDetailLoading, setPlayerDetailLoading] = useState(false);
  const [playerDetailError, setPlayerDetailError] = useState(null);

  const MARKET_URL = "/market.json";

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

  const syncPuntuacionJugador = async (playerId, { force = false } = {}) => {
    const id =
      playerId === null || playerId === undefined ? null : String(playerId);
    if (!id) return [];
    const current = getCachedScoreInfo(id);
    const shouldFetch =
      force || !current.fetchedAt || isScoreCacheStale(current.fetchedAt);
    if (!shouldFetch && current.data.length) {
      return current.data;
    }
    const pending = pendingScoreRequests.current.get(id);
    if (pending) {
      return pending;
    }
    const fetchPromise = (async () => {
      try {
        const fetched = await fetchPuntuacionJugador(id);
        const normalized = normalizeScoreEntries(fetched);
        const nextData =
          normalized.length || !current.data.length ? normalized : current.data;
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
        return nextData;
      } catch (error) {
        console.warn(
          `No se pudieron sincronizar las puntuaciones del jugador ${id}`,
          error
        );
        return current.data;
      } finally {
        pendingScoreRequests.current.delete(id);
      }
    })();
    pendingScoreRequests.current.set(id, fetchPromise);
    return fetchPromise;
  };

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
    syncPuntuacionJugador(playerId, { force: true })
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
        const gain =
          precioCompra !== null && Number.isFinite(player.value)
            ? player.value - precioCompra
            : null;
        const roi =
          precioCompra !== null && precioCompra > 0 && gain !== null
            ? (gain / precioCompra) * 100
            : null;
        const zone = getZoneFromPosition(player.position ?? entry.position);
        const playerKey = getPlayerKey(player) ?? `name:${nameKey}`;
        const playerId =
          storedId ?? (player.id !== null && player.id !== undefined
            ? String(player.id)
            : null);
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
        return {
          ...player,
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
        };
      })
      .filter(Boolean);
  }, [myTeam, playerIndex, cachePuntuaciones]);

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
    syncPuntuacionJugador(playerId)
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
                  <Td className="text-right">{fmtEUR.format(p.value)}</Td>
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
                    {p.points_total !== null
                      ? pointsFormatter.format(p.points_total)
                      : "—"}
                  </Td>
                  <Td className="text-right text-gray-700">
                    {p.points_avg !== null
                      ? pointsFormatter.format(p.points_avg)
                      : "—"}
                  </Td>
                  <Td className="text-right text-gray-700">
                    {p.points_last5 !== null
                      ? pointsFormatter.format(p.points_last5)
                      : "—"}
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
      <section className="bg-white border rounded-2xl shadow p-4 space-y-4">
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

function SummaryRow({ label, value, valueClassName = "", testId }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${valueClassName}`} data-testid={testId}>
        {value}
      </span>
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

