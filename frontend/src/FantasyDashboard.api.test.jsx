const createJsonResponse = (body) => {
  const text = JSON.stringify(body);
  return {
    ok: true,
    json: async () => body,
    text: async () => text,
    headers: { get: () => "application/json" },
  };
};

describe("Configuración de backend de mercado", () => {
  const originalEnv = {
    REACT_APP_MARKET_API_BASE: process.env.REACT_APP_MARKET_API_BASE,
  };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.REACT_APP_MARKET_API_BASE = originalEnv.REACT_APP_MARKET_API_BASE;
    global.fetch = originalFetch;
    window.localStorage.clear();
    jest.resetModules();
  });

  it("usa la URL configurada para cargar y refrescar el mercado", async () => {
    process.env.REACT_APP_MARKET_API_BASE = "https://backend.example/api";
    jest.resetModules();

    const requests = [];

    global.fetch = jest.fn((url, init) => {
      requests.push({ url: String(url), method: init?.method || "GET" });
      if (typeof url === "string" && url.startsWith("https://backend.example/api/market")) {
        return Promise.resolve(
          createJsonResponse({
            updated_at: "2025-01-01T00:00:00Z",
            players: [
              {
                id: 99,
                name: "Jugador Test",
                team: "Demo",
                team_id: "1",
                position: "Delantero",
                value: 1000000,
              },
            ],
          })
        );
      }
      if (url === "https://backend.example/api/market/refresh") {
        return Promise.resolve(createJsonResponse({ status: "ok" }));
      }
      return Promise.resolve(createJsonResponse({ success: true }));
    });

    const module = require("./FantasyDashboard");
    const { fetchValorMercadoJugador, sniff_market_json_v3_debug_market } = module;

    const valor = await fetchValorMercadoJugador(99, { forceReload: true });
    expect(valor).not.toBeNull();

    await sniff_market_json_v3_debug_market({ force: true });

    const calledUrls = requests.map((entry) => entry.url);
    expect(calledUrls.some((url) => url.startsWith("https://backend.example/api/market"))).toBe(true);
    expect(calledUrls).toContain("https://backend.example/api/market/refresh");
  });
});
