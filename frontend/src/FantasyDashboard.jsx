import React, { useEffect, useMemo, useState } from "react";

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

const sanitizeStoredTeam = (entries) => {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.reduce((acc, item) => {
    const name = sanitizeName(item?.name);
    if (!name) return acc;
    const key = name.toLowerCase();
    if (seen.has(key)) return acc;
    seen.add(key);
    const buyPrice = toOptionalNumber(
      item?.buyPrice ??
        item?.buy_price ??
        item?.purchasePrice ??
        item?.purchase_value ??
        item?.purchaseValue
    );
    acc.push({ name, buyPrice });
    return acc;
  }, []);
};

const sanitizeStoredSales = (entries) => {
  if (!Array.isArray(entries)) return [];
  return entries.reduce((acc, item) => {
    const name = sanitizeName(item?.name);
    if (!name) return acc;
    const buyPrice = toOptionalNumber(item?.buyPrice ?? item?.buy_price);
    const sellPrice = toOptionalNumber(item?.sellPrice ?? item?.sell_price);
    const soldAtRaw = collapseWhitespace(
      normalizeText(item?.soldAt ?? item?.sold_at)
    );
    acc.push({
      name,
      buyPrice,
      sellPrice,
      soldAt: soldAtRaw || null,
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
  const [status, setStatus] = useState("cargando");

  const MARKET_URL = "/market.json";

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
    const playerByName = new Map(
      market.players.map((p) => [p.name.toLowerCase(), p])
    );
    return myTeam
      .map((entry) => {
        const key = entry.name.toLowerCase();
        const player = playerByName.get(key);
        if (!player) return null;
        const buyPrice = toOptionalNumber(entry.buyPrice);
        const gain =
          buyPrice !== null && Number.isFinite(player.value)
            ? player.value - buyPrice
            : null;
        const roi =
          buyPrice !== null && buyPrice > 0 && gain !== null
            ? (gain / buyPrice) * 100
            : null;
        return {
          ...player,
          buyPrice,
          gain,
          roi,
        };
      })
      .filter(Boolean);
  }, [myTeam, market.players]);

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
    const buy = aggregate(teamPlayers, "buyPrice");
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

  const addToTeam = (p) => {
    setMyTeam((prev) => {
      const exists = prev.some(
        (x) => x.name.toLowerCase() === p.name.toLowerCase()
      );
      if (exists) return prev;
      return [...prev, { name: p.name, buyPrice: toOptionalNumber(p.value) }];
    });
  };

  const removeFromTeam = (name) => {
    setMyTeam((prev) =>
      prev.filter((x) => x.name.toLowerCase() !== name.toLowerCase())
    );
  };

  const updateBuyPrice = (name, value) => {
    setMyTeam((prev) => {
      const key = name.toLowerCase();
      let changed = false;
      const next = prev.map((item) => {
        if (item.name.toLowerCase() !== key) {
          return item;
        }
        const parsed = toOptionalNumber(value);
        const current = toOptionalNumber(item.buyPrice);
        if (parsed === null && current === null) {
          return item;
        }
        if (parsed !== null && current !== null && parsed === current) {
          return item;
        }
        changed = true;
        return { ...item, buyPrice: parsed };
      });
      return changed ? next : prev;
    });
  };

  const sellPlayer = (player, saleInput) => {
    const sellPrice = toOptionalNumber(saleInput);
    if (sellPrice === null) return;
    const buyPrice = toOptionalNumber(player.buyPrice);
    const soldAt = new Date().toISOString();
    setSales((prev) => [
      ...prev,
      {
        name: player.name,
        buyPrice,
        sellPrice,
        soldAt,
      },
    ]);
    setMyTeam((prev) =>
      prev.filter((x) => x.name.toLowerCase() !== player.name.toLowerCase())
    );
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
          key: `${entry.name}-${entry.soldAt ?? index}`,
          gain,
          roi,
        };
      }),
    [sales]
  );

  const formatter = new Intl.NumberFormat("es-ES");
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

  const formatSoldAt = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("es-ES");
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">
            Mi equipo – LaLiga Fantasy
          </h1>
          <div className="text-sm text-gray-600">
            {status === "ok" && (
              <span>
                Última actualización:{" "}
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

        {/* Resumen de mi equipo */}
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Valor actual del equipo" className="xl:col-span-2">
            <BigNumber>
              <span data-testid="total-value">
                {formatter.format(totals.value)}
              </span>
            </BigNumber>
            <DeltaBar
              day={totals.change_day}
              week={totals.change_week}
              formatter={formatter}
            />
            <div className="border-t border-gray-100 pt-2 mt-3 space-y-1">
              <SummaryRow
                label="Invertido"
                value={
                  totals.buy_count > 0
                    ? formatter.format(totals.buy_price)
                    : "—"
                }
                testId="total-buy"
              />
              <SummaryRow
                label="Ganancia"
                value={
                  totals.gain !== null
                    ? `${totals.gain >= 0 ? "+" : "-"}${formatter.format(
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

          <Card title="Puntos del equipo" className="xl:col-span-2">
            <SummaryRow
              label="Puntos totales"
              value={
                totals.points_total !== null
                  ? pointsSummaryFormatter.format(totals.points_total)
                  : "—"
              }
              testId="team-total-points"
            />
            <SummaryRow
              label="Media por jornada"
              value={
                totals.avg_points !== null
                  ? pointsFormatter.format(totals.avg_points)
                  : "—"
              }
              testId="team-avg"
            />
            <SummaryRow
              label="Media últimos 5 partidos"
              value={
                totals.avg_points5 !== null
                  ? pointsFormatter.format(totals.avg_points5)
                  : "—"
              }
              testId="team-avg5"
            />
          </Card>

          <Card title="Añadir jugador" className="md:col-span-2 xl:col-span-2">
            <input
              type="text"
              className="w-full border rounded-xl px-3 py-2 focus:outline-none focus:ring"
              placeholder="Busca por nombre, equipo o posición…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="mt-3 max-h-60 overflow-auto bg-white border rounded-xl divide-y">
              {filtered.slice(0, 50).map((p) => (
                <button
                  key={p.name + p.team}
                  onClick={() => addToTeam(p)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between"
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

        {/* Tabla detallada */}
        <section className="bg-white border rounded-2xl shadow p-4">
          <h2 className="text-xl font-semibold mb-3">Detalle del equipo</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" data-testid="team-table">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <Th>Jugador</Th>
                  <Th>Equipo</Th>
                  <Th>Pos.</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="text-right">Comprado</Th>
                  <Th className="text-right">Acciones</Th>
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
                    <Td>{p.name}</Td>
                    <Td>{p.team}</Td>
                    <Td>{p.position}</Td>
                    <Td className="text-right">
                      {formatter.format(p.value)}
                    </Td>
                    <Td className="text-right">
                      <PriceInput
                        value={p.buyPrice}
                        onChange={(val) => updateBuyPrice(p.name, val)}
                        label={`Precio de compra de ${p.name}`}
                      />
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        <SaleControl
                          player={p}
                          onSell={(value) => sellPlayer(p, value)}
                        />
                        <button
                          className="rounded-full border border-gray-200 px-2 text-xs text-gray-500 hover:border-red-500 hover:text-red-600"
                          onClick={() => removeFromTeam(p.name)}
                          aria-label={`Quitar ${p.name}`}
                          type="button"
                        >
                          Quitar
                        </button>
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
                        ? `${p.gain >= 0 ? "+" : "-"}${formatter.format(
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
                      {formatter.format(p.change_day)}
                    </Td>
                    <Td
                      className={`text-right ${
                        p.change_week >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {p.change_week >= 0 ? "+" : ""}
                      {formatter.format(p.change_week)}
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
          <h2 className="text-xl font-semibold mb-3">Ventas realizadas</h2>
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
                          ? formatter.format(sale.buyPrice)
                          : "—"}
                      </Td>
                      <Td className="text-right">
                        {sale.sellPrice !== null
                          ? formatter.format(sale.sellPrice)
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
                          ? `${sale.gain >= 0 ? "+" : "-"}${formatter.format(
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="text-xs text-gray-500">
          Los datos provienen de un archivo JSON generado a partir del HTML
          público del mercado.
        </footer>
      </div>
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
          : player?.buyPrice ?? "";
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

function PriceInput({ value, onChange, label }) {
  return (
    <input
      type="number"
      min="0"
      step="1000"
      inputMode="numeric"
      className="w-28 border rounded-lg px-2 py-1 text-right focus:outline-none focus:ring"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder="—"
      aria-label={label}
    />
  );
}
