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

const normalizePlayer = (player) => ({
  ...player,
  name: sanitizeName(player?.name),
  team: normalizeText(player?.team),
  position: normalizeText(player?.position),
  value: toNumber(player?.value),
  change_day: toNumber(player?.change_day ?? player?.diff_1),
  change_week: toNumber(player?.change_week ?? player?.diff_7),
});

const sanitizeStoredTeam = (entries) => {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.reduce((acc, item) => {
    const name = sanitizeName(item?.name);
    if (!name) return acc;
    const key = name.toLowerCase();
    if (seen.has(key)) return acc;
    seen.add(key);
    acc.push({ name });
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
    const names = new Set(myTeam.map((t) => t.name.toLowerCase()));
    return market.players.filter((p) => names.has(p.name.toLowerCase()));
  }, [myTeam, market.players]);

  const totals = useMemo(() => {
    const sum = (arr, key) =>
      arr.reduce((acc, x) => acc + (Number(x[key]) || 0), 0);
    return {
      value: sum(teamPlayers, "value"),
      change_day: sum(teamPlayers, "change_day"),
      change_week: sum(teamPlayers, "change_week"),
    };
  }, [teamPlayers]);

  const addToTeam = (p) => {
    setMyTeam((prev) => {
      const exists = prev.some(
        (x) => x.name.toLowerCase() === p.name.toLowerCase()
      );
      if (exists) return prev;
      return [...prev, { name: p.name }];
    });
  };

  const removeFromTeam = (name) => {
    setMyTeam((prev) =>
      prev.filter((x) => x.name.toLowerCase() !== name.toLowerCase())
    );
  };

  const formatter = new Intl.NumberFormat("es-ES");

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
        <section className="grid md:grid-cols-3 gap-4">
          <Card title="Valor total">
            <BigNumber>{formatter.format(totals.value)}</BigNumber>
            <DeltaBar
              day={totals.change_day}
              week={totals.change_week}
              formatter={formatter}
            />
          </Card>

          <Card title="Jugadores en mi equipo">
            <div className="flex flex-wrap gap-2">
              {myTeam.length === 0 && (
                <span className="text-gray-500">
                  Añade jugadores desde el buscador
                </span>
              )}
              {teamPlayers.map((p) => (
                <span
                  key={p.name}
                  className="px-3 py-1 rounded-full bg-white border shadow-sm text-sm flex items-center gap-2"
                >
                  {p.name}
                  <button
                    className="text-gray-500 hover:text-red-600"
                    onClick={() => removeFromTeam(p.name)}
                    aria-label={`Quitar ${p.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </Card>

          <Card title="Añadir jugador">
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
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <Th>Jugador</Th>
                  <Th>Equipo</Th>
                  <Th>Pos.</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="text-right">Δ día</Th>
                  <Th className="text-right">Δ semana</Th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="text-xs text-gray-500">
          Los datos provienen de un archivo JSON generado a partir del HTML
          público del mercado.
        </footer>
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white rounded-2xl border shadow p-4">
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
