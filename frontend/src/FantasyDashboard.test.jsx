import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import FantasyTeamDashboard, {
  sniff_market_json_v3_debug_market,
} from "./FantasyDashboard";

describe("FantasyTeamDashboard", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    window.localStorage.clear();
    const createJsonResponse = (body) => {
      const text = JSON.stringify(body);
      return {
        ok: true,
        json: async () => body,
        text: async () => text,
        clone() {
          return {
            ok: true,
            text: async () => text,
            headers: { get: () => "application/json" },
          };
        },
        headers: { get: () => "application/json" },
      };
    };
    global.fetch = jest.fn((url) => {
      if (typeof url === "string" && url.includes("/api/sniff/market")) {
        return Promise.resolve(createJsonResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/sniff/points")) {
        return Promise.resolve(createJsonResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/v3/player/")) {
        return Promise.resolve(
          createJsonResponse({
            data: {
              jornadas: [
                { jornada: 1, puntos: 6.2 },
                { jornada: 2, puntos: 5.1 },
                { jornada: 3, puntos: 7.4 },
                { jornada: 4, puntos: 4.8 },
                { jornada: 5, puntos: 6.9 },
              ],
            },
          })
        );
      }
      return Promise.resolve(
        createJsonResponse({
          updated_at: "2025-01-01T00:00:00Z",
          players: [
            {
              id: 1,
              name: "Pau CubarsíCubarsí",
              team: "Barcelona",
              team_id: "3",
              position: "Defensa",
              value: "1234567",
              diff_1: 0,
              diff_7: 0,
              points_avg: "4,5",
              points_last5: "4,8",
              points_history: [
                { matchday: 1, points: 3.2 },
                { matchday: 2, points: 4.1 },
                { matchday: 3, points: 4.6 },
                { matchday: 4, points: 5.2 },
                { matchday: 5, points: 4.9 },
                { matchday: 6, points: 4.3 },
              ],
            },
            {
              id: 2,
              name: "Nico WilliamsN. Williams",
              team: "Athletic",
              team_id: "5",
              position: "Delantero",
              value: "2345678",
              diff_1: 0,
              diff_7: 0,
              points_avg: null,
              points_last5: null,
              points_history: [
                { matchday: 10, points: 6.5 },
                { matchday: 11, points: 7.0 },
                { matchday: 12, points: 8.5 },
                { matchday: 13, points: 3.5 },
                { matchday: 14, points: 9.0 },
                { matchday: 15, points: 6.0 },
              ],
            },
            {
              id: 3,
              name: "Aarón EscandellAarón",
              team: "Las Palmas",
              team_id: "10",
              position: "Portero",
              value: "3456789",
              diff_1: 0,
              diff_7: 0,
              points_avg: "3,4",
              points_last5: "3,9",
              points_history: [
                { matchday: 8, points: 2.5 },
                { matchday: 9, points: 3.1 },
                { matchday: 10, points: 4.0 },
              ],
            },
            {
              id: 5,
              name: "Pedri GonzálezPedri",
              team: "Barcelona",
              team_id: "3",
              position: "Centrocampista",
              value: "3123456",
              diff_1: 0,
              diff_7: 0,
              points_avg: "6,1",
              points_last5: "6,4",
              points_history: [
                { matchday: 3, points: 6.2 },
                { matchday: 4, points: 6.8 },
                { matchday: 5, points: 5.9 },
                { matchday: 6, points: 6.5 },
              ],
            },
            {
              id: 4,
              name: "Iñaki WilliamsI. Williams",
              team: "Athletic",
              team_id: "5",
              position: "Delantero",
              value: "4567890",
              diff_1: 0,
              diff_7: 0,
              points_avg: "5,9",
              points_last5: "6,8",
              points_history: [
                { matchday: 10, points: 6.1 },
                { matchday: 11, points: 5.4 },
                { matchday: 12, points: 7.2 },
                { matchday: 13, points: 6.8 },
              ],
            },
          ],
        })
      );
    });
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
  });

  it("normaliza los nombres repetidos al cargar el mercado", async () => {
    render(<FantasyTeamDashboard />);

    expect(await screen.findByText("Pau Cubarsí")).toBeInTheDocument();
    expect(screen.queryByText("Pau CubarsíCubarsí")).not.toBeInTheDocument();
    expect(await screen.findByText("Nico Williams")).toBeInTheDocument();
    expect(screen.queryByText("Nico WilliamsN. Williams")).not.toBeInTheDocument();
    expect(await screen.findByText("Aarón Escandell")).toBeInTheDocument();
    expect(screen.queryByText("Aarón EscandellAarón")).not.toBeInTheDocument();
    expect(await screen.findByText("Iñaki Williams")).toBeInTheDocument();
    expect(screen.queryByText("Iñaki WilliamsI. Williams")).not.toBeInTheDocument();
    expect(screen.queryByText("Jugadores en mi equipo")).not.toBeInTheDocument();
  });

  it("calcula ganancias, rentabilidad y puntos en la tabla del equipo", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Nico Williams", precioCompra: 2000000 }])
    );

    render(<FantasyTeamDashboard />);

    const teamTable = await screen.findByTestId("team-table");
    const playerCell = await within(teamTable).findByText("Nico Williams");
    const row = playerCell.closest("tr");
    expect(row).not.toBeNull();
    if (!row) throw new Error("Fila de Nico Williams no encontrada");

    expect(
      screen.queryByLabelText("Precio de compra de Nico Williams")
    ).not.toBeInTheDocument();
    expect(within(row).getByText(/2\.000\.000\s?€/)).toBeInTheDocument();

    expect(await screen.findByTestId("total-value")).toHaveTextContent(
      /2\.345\.678\s?€/
    );
    expect(screen.getByTestId("total-buy")).toHaveTextContent(
      /2\.000\.000\s?€/
    );
    expect(screen.getByTestId("total-gain")).toHaveTextContent(
      /\+345\.678\s?€/
    );
    expect(screen.getByTestId("total-roi")).toHaveTextContent("+17,28%");
    expect(screen.getByTestId("team-budget")).toHaveTextContent(
      /-8\.720\.968\s?€/
    );

    expect(screen.queryByTestId("team-total-points")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-avg")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-avg5")).not.toBeInTheDocument();

    expect(
      screen.queryByRole("columnheader", { name: /historial/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Puntos" })
    ).toBeInTheDocument();

    const teamTableAgain = screen.getByTestId("team-table");
    expect(within(teamTableAgain).getByText("40,5")).toBeInTheDocument();
  });

  it("actualiza las puntuaciones de un jugador desde su detalle", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Nico Williams" }])
    );

    const makeResponse = (body) => {
      const text = JSON.stringify(body);
      return {
        ok: true,
        json: async () => body,
        text: async () => text,
        clone() {
          return {
            ok: true,
            text: async () => text,
            headers: { get: () => "application/json" },
          };
        },
        headers: { get: () => "application/json" },
      };
    };

    const marketPayloads = [
      {
        updated_at: "2025-01-01T00:00:00Z",
        players: [
          {
            id: 2,
            name: "Nico WilliamsN. Williams",
            team: "Athletic",
            team_id: "5",
            position: "Delantero",
            value: "2345678",
            diff_1: 0,
            diff_7: 0,
            points_avg: null,
            points_last5: null,
            points_history: [
              { matchday: 10, points: 6.5 },
              { matchday: 11, points: 7.0 },
            ],
          },
        ],
      },
      {
        updated_at: "2025-01-02T00:00:00Z",
        players: [
          {
            id: 2,
            name: "Nico WilliamsN. Williams",
            team: "Athletic",
            team_id: "5",
            position: "Delantero",
            value: "2345678",
            diff_1: 0,
            diff_7: 0,
            points_avg: 11,
            points_last5: 11,
            points_total: 22,
            points_history: [
              { matchday: 10, points: 10 },
              { matchday: 11, points: 12 },
            ],
          },
        ],
      },
    ];

    let marketCall = 0;
    global.fetch.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/sniff/market")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/sniff/points")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("market.json")) {
        const payload =
          marketPayloads[Math.min(marketCall, marketPayloads.length - 1)];
        marketCall += 1;
        return Promise.resolve(makeResponse(payload));
      }
      return Promise.resolve(makeResponse({ success: true }));
    });

    render(<FantasyTeamDashboard />);

    expect(
      await screen.findByRole("button", { name: "Actualizar valor de mercado" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Actualizar puntos de jornada/i })
    ).not.toBeInTheDocument();

    const teamTable = await screen.findByTestId("team-table");
    const locateRow = () => {
      const cell = within(teamTable).getByText("Nico Williams");
      const row = cell.closest("tr");
      if (!row) {
        throw new Error("Fila del jugador no encontrada");
      }
      return row;
    };

    const playerRow = locateRow();
    const getPointsText = (row) => {
      const cells = within(row).getAllByRole("cell");
      return cells[10]?.textContent ?? "";
    };
    const getAverageText = (row) => {
      const cells = within(row).getAllByRole("cell");
      return cells[11]?.textContent ?? "";
    };
    const getRecentAverageText = (row) => {
      const cells = within(row).getAllByRole("cell");
      return cells[12]?.textContent ?? "";
    };

    const initialPoints = getPointsText(playerRow);
    const initialAverage = getAverageText(playerRow);
    const initialRecent = getRecentAverageText(playerRow);

    const detailButton = within(playerRow).getByLabelText(
      "Ver detalle de Nico Williams"
    );
    fireEvent.click(detailButton);

    const updateButton = await screen.findByRole("button", {
      name: "Actualizar puntos",
    });

    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/sniff/points/2"),
        expect.objectContaining({ method: "POST" })
      );
    });

    await waitFor(() => {
      const updatedRow = locateRow();
      expect(getPointsText(updatedRow)).toBe("22,0");
      expect(getAverageText(updatedRow)).toBe("11,0");
      expect(getRecentAverageText(updatedRow)).toBe("11,0");
    });

    expect(initialPoints).not.toBe("22,0");
    expect(initialAverage).not.toBe("11,0");
    expect(initialRecent).not.toBe("11,0");
  });

  it("actualiza el valor y las variaciones de mercado tras ejecutar el sniffer", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Nico Williams" }])
    );

    const makeResponse = (body) => {
      const text = JSON.stringify(body);
      return {
        ok: true,
        json: async () => body,
        text: async () => text,
        clone() {
          return {
            ok: true,
            text: async () => text,
            headers: { get: () => "application/json" },
          };
        },
        headers: { get: () => "application/json" },
      };
    };

    const marketPayloads = [
      {
        updated_at: "2025-01-01T00:00:00Z",
        players: [
          {
            id: 2,
            name: "Nico WilliamsN. Williams",
            team: "Athletic",
            team_id: "5",
            position: "Delantero",
            value: "2000000",
            diff_1: "-100000",
            diff_7: "500000",
          },
        ],
      },
      {
        updated_at: "2025-01-02T00:00:00Z",
        players: [
          {
            id: 2,
            name: "Nico WilliamsN. Williams",
            team: "Athletic",
            team_id: "5",
            position: "Delantero",
            value: "2450000",
            diff_1: "75000",
            diff_7: "620000",
          },
        ],
      },
    ];

    let marketCall = 0;
    global.fetch.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/sniff/market")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/sniff/points")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/v3/player/")) {
        return Promise.resolve(makeResponse({ data: { jornadas: [] } }));
      }
      const payload =
        marketPayloads[Math.min(marketCall, marketPayloads.length - 1)];
      marketCall += 1;
      return Promise.resolve(makeResponse(payload));
    });

    render(<FantasyTeamDashboard />);

    const teamTable = await screen.findByTestId("team-table");
    const getRow = () => {
      const cell = within(teamTable).getByText("Nico Williams");
      const row = cell.closest("tr");
      if (!row) {
        throw new Error("Fila del jugador no encontrada");
      }
      return row;
    };

    const initialRow = await waitFor(() => getRow());
    const initialCells = within(initialRow).getAllByRole("cell");
    expect(initialCells[3].textContent).toContain("2.000.000");
    expect(initialCells[8].textContent).toContain("-100.000");
    expect(initialCells[9].textContent).toContain("+500.000");

    const marketButton = await screen.findByRole("button", {
      name: "Actualizar valor de mercado",
    });
    fireEvent.click(marketButton);

    await waitFor(() => {
      const updatedRow = getRow();
      const updatedCells = within(updatedRow).getAllByRole("cell");
      expect(updatedCells[3].textContent).toContain("2.450.000");
      expect(updatedCells[8].textContent).toContain("+75.000");
      expect(updatedCells[9].textContent).toContain("+620.000");
    });

    expect(marketCall).toBeGreaterThanOrEqual(2);
  });

  it("recarga el mercado aunque el sniffer devuelva 405 en producción", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Nico Williams" }])
    );

    const makeResponse = (body) => {
      const text = JSON.stringify(body);
      return {
        ok: true,
        json: async () => body,
        text: async () => text,
        clone() {
          return {
            ok: true,
            text: async () => text,
            headers: { get: () => "application/json" },
          };
        },
        headers: { get: () => "application/json" },
      };
    };

    const previousFetch = global.fetch;
    const marketPayloads = [
      {
        updated_at: "2025-02-01T00:00:00Z",
        players: [
          {
            id: 2,
            name: "Nico WilliamsN. Williams",
            team: "Athletic",
            team_id: "5",
            position: "Delantero",
            value: "2000000",
            diff_1: "-100000",
            diff_7: "500000",
          },
        ],
      },
      {
        updated_at: "2025-02-02T00:00:00Z",
        players: [
          {
            id: 2,
            name: "Nico WilliamsN. Williams",
            team: "Athletic",
            team_id: "5",
            position: "Delantero",
            value: "2450000",
            diff_1: "75000",
            diff_7: "620000",
          },
        ],
      },
    ];

    let marketCall = 0;
    try {
      global.fetch = jest.fn((url) => {
        if (typeof url === "string" && url.includes("/api/sniff/market")) {
          return Promise.resolve({
            ok: false,
            status: 405,
            text: async () =>
              "<html><body><h1>405 Not Allowed</h1></body></html>",
            headers: { get: () => "text/html" },
          });
        }
        if (typeof url === "string" && url.includes("/api/sniff/points")) {
          return Promise.resolve(makeResponse({ success: true }));
        }
        if (typeof url === "string" && url.includes("/api/v3/player/")) {
          return Promise.resolve(makeResponse({ data: { jornadas: [] } }));
        }
        if (typeof url === "string" && url.includes("market.json")) {
          const payload =
            marketPayloads[Math.min(marketCall, marketPayloads.length - 1)];
          marketCall += 1;
          return Promise.resolve(makeResponse(payload));
        }
        return Promise.resolve(makeResponse({ success: true }));
      });

      render(<FantasyTeamDashboard />);

      const teamTable = await screen.findByTestId("team-table");
      const getRow = () => {
        const cell = within(teamTable).getByText("Nico Williams");
        const row = cell.closest("tr");
        if (!row) {
          throw new Error("Fila del jugador no encontrada");
        }
        return row;
      };

      const initialRow = await waitFor(() => getRow());
      const initialCells = within(initialRow).getAllByRole("cell");
      expect(initialCells[3].textContent).toContain("2.000.000");

      const marketButton = await screen.findByRole("button", {
        name: "Actualizar valor de mercado",
      });
      fireEvent.click(marketButton);

      await waitFor(() => {
        const updatedRow = getRow();
        const updatedCells = within(updatedRow).getAllByRole("cell");
        expect(updatedCells[3].textContent).toContain("2.450.000");
        expect(updatedCells[8].textContent).toContain("+75.000");
        expect(updatedCells[9].textContent).toContain("+620.000");
      });

      expect(marketCall).toBeGreaterThanOrEqual(2);
      const triggeredAutomation = global.fetch.mock.calls.some(([url]) =>
        typeof url === "string" && url.includes("/api/sniff/market")
      );
      expect(triggeredAutomation).toBe(true);
    } finally {
      global.fetch = previousFetch;
    }
  });

  it("muestra totales y medias en el detalle aunque falte el historial de puntos", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ id: 8405, name: "Jorge de Frutos" }])
    );

    const makeResponse = (body) => {
      const text = JSON.stringify(body);
      return {
        ok: true,
        json: async () => body,
        text: async () => text,
        clone() {
          return {
            ok: true,
            text: async () => text,
            headers: { get: () => "application/json" },
          };
        },
        headers: { get: () => "application/json" },
      };
    };

    const payload = {
      updated_at: "2025-10-21T22:41:57Z",
      players: [
        {
          id: 8405,
          name: "Jorge de Frutos",
          team: "Rayo",
          team_id: "18",
          position: "Delantero",
          value: "41320071",
          diff_1: 0,
          diff_7: 0,
          points_total: 87,
          points_avg: 5.8,
          points_last5: 6.4,
          points_history: [],
        },
      ],
    };

    const previousFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      if (typeof url === "string" && url.includes("market.json")) {
        return Promise.resolve(makeResponse(payload));
      }
      if (typeof url === "string" && url.includes("/api/sniff/")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/v3/player/")) {
        return Promise.resolve(makeResponse({ data: { jornadas: [] } }));
      }
      return Promise.resolve(makeResponse({ success: true }));
    });

    render(<FantasyTeamDashboard />);

    const detailButton = await screen.findByRole("button", {
      name: "Ver detalle de Jorge de Frutos",
    });
    fireEvent.click(detailButton);

    const modal = await screen.findByRole("dialog", {
      name: /Jorge de Frutos/i,
    });

    const totalsRow = within(modal).getByText("Puntos totales").closest("div");
    expect(totalsRow).not.toBeNull();
    if (!totalsRow) throw new Error("Fila de puntos totales no encontrada");
    expect(within(totalsRow).getByText("87,0")).toBeInTheDocument();

    const averageRow = within(modal).getByText("Media").closest("div");
    expect(averageRow).not.toBeNull();
    if (!averageRow) throw new Error("Fila de media no encontrada");
    expect(within(averageRow).getByText("5,8")).toBeInTheDocument();

    const recentRow = within(modal).getByText("Media últimas 5").closest("div");
    expect(recentRow).not.toBeNull();
    if (!recentRow) throw new Error("Fila de media recientes no encontrada");
    expect(within(recentRow).getByText("6,4")).toBeInTheDocument();

    global.fetch = previousFetch;
  });

  it("usa el último valor de mercado al mostrar mi equipo aunque la caché esté desactualizada", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Nico Williams" }])
    );
    window.localStorage.setItem(
      "playerMarketCache",
      JSON.stringify({ 2: 1000000 })
    );

    const makeResponse = (body) => {
      const text = JSON.stringify(body);
      return {
        ok: true,
        json: async () => body,
        text: async () => text,
        clone() {
          return {
            ok: true,
            text: async () => text,
            headers: { get: () => "application/json" },
          };
        },
        headers: { get: () => "application/json" },
      };
    };

    const payload = {
      updated_at: "2025-01-03T00:00:00Z",
      players: [
        {
          id: 2,
          name: "Nico WilliamsN. Williams",
          team: "Athletic",
          team_id: "5",
          position: "Delantero",
          value: "2450000",
          diff_1: "50000",
          diff_7: "620000",
        },
      ],
    };

    global.fetch.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/sniff/market")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/sniff/points")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/v3/player/")) {
        return Promise.resolve(makeResponse({ data: { jornadas: [] } }));
      }
      return Promise.resolve(makeResponse(payload));
    });

    render(<FantasyTeamDashboard />);

    const teamTable = await screen.findByTestId("team-table");
    const getRow = () => {
      const cell = within(teamTable).getByText("Nico Williams");
      const row = cell.closest("tr");
      if (!row) {
        throw new Error("Fila del jugador no encontrada");
      }
      return row;
    };

    await waitFor(() => {
      const row = getRow();
      const cells = within(row).getAllByRole("cell");
      expect(cells[3].textContent).toContain("2.450.000");
    });

    const storedCache = window.localStorage.getItem("playerMarketCache");
    expect(storedCache).not.toBeNull();
    if (storedCache) {
      const parsed = JSON.parse(storedCache);
      expect(parsed[2]).toBe(2450000);
    }
  });

  it("omite peticiones de mercado cuando force es false y la cache está poblada", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Nico Williams" }])
    );

    const makeResponse = (body) => {
      const text = JSON.stringify(body);
      return {
        ok: true,
        json: async () => body,
        text: async () => text,
        clone() {
          return {
            ok: true,
            text: async () => text,
            headers: { get: () => "application/json" },
          };
        },
        headers: { get: () => "application/json" },
      };
    };

    let marketCall = 0;
    global.fetch.mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/sniff/market")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/sniff/points")) {
        return Promise.resolve(makeResponse({ success: true }));
      }
      if (typeof url === "string" && url.includes("/api/v3/player/")) {
        return Promise.resolve(makeResponse({ data: { jornadas: [] } }));
      }
      marketCall += 1;
      return Promise.resolve(
        makeResponse({
          updated_at: "2025-01-01T00:00:00Z",
          players: [
            {
              id: 2,
              name: "Nico WilliamsN. Williams",
              team: "Athletic",
              team_id: "5",
              position: "Delantero",
              value: "2000000",
              diff_1: "0",
              diff_7: "0",
            },
          ],
        })
      );
    });

    render(<FantasyTeamDashboard />);

    await screen.findByRole("button", {
      name: "Ver detalle de Nico Williams",
    });

    await act(async () => {
      await sniff_market_json_v3_debug_market();
    });

    expect(marketCall).toBeGreaterThanOrEqual(2);

    const callsBefore = marketCall;

    await act(async () => {
      await sniff_market_json_v3_debug_market({ force: false });
    });

    expect(marketCall).toBe(callsBefore);
  });

  it("permite comprar un jugador ingresando el precio en el modal", async () => {
    render(<FantasyTeamDashboard />);

    const buyButton = await screen.findByRole("button", {
      name: /^Pau Cubarsí/,
    });
    fireEvent.click(buyButton);

    const purchaseInput = await screen.findByLabelText("Precio de compra");
    expect(purchaseInput).toHaveValue(1234567);

    fireEvent.change(purchaseInput, { target: { value: "1500000.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar compra" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );

    const teamTable = await screen.findByTestId("team-table");
    const row = within(teamTable)
      .getByText("Pau Cubarsí")
      .closest("tr");
    expect(row).not.toBeNull();
    if (!row) throw new Error("Fila de Pau Cubarsí no encontrada");
    expect(
      within(row).getByText(/1\.500\.000,5\s?€/)
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("team-budget")).toHaveTextContent(
        /-10\.220\.968,5\s?€/
      )
    );
  });

  it("permite modificar manualmente el presupuesto del equipo", async () => {
    render(<FantasyTeamDashboard />);

    const editButton = await screen.findByRole("button", {
      name: "Modificar presupuesto del equipo",
    });
    fireEvent.click(editButton);

    const budgetInput = await screen.findByLabelText("Nuevo presupuesto");
    expect(budgetInput).toHaveValue(-8720968);

    fireEvent.change(budgetInput, { target: { value: "1000000" } });

    const saveButton = screen.getByRole("button", { name: "Guardar presupuesto" });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );

    await waitFor(() =>
      expect(screen.getByTestId("team-budget")).toHaveTextContent(
        /1\.000\.000\s?€/
      )
    );
  });

  it("elimina un jugador con la X sin registrar venta ni cambiar el presupuesto", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Nico Williams", precioCompra: 2000000 }])
    );

    render(<FantasyTeamDashboard />);

    const confirmSpy = jest
      .spyOn(window, "confirm")
      .mockReturnValue(true);

    const removeButton = await screen.findByRole("button", {
      name: "Eliminar Nico Williams sin vender",
    });
    fireEvent.click(removeButton);

    await waitFor(() =>
      expect(
        within(screen.getByTestId("team-table")).queryByText("Nico Williams")
      ).not.toBeInTheDocument()
    );

    expect(screen.getByTestId("team-budget")).toHaveTextContent(
      /-8\.720\.968\s?€/
    );
    expect(
      screen.getByText("Aún no has registrado ventas.")
    ).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("registra una venta y la muestra en la tabla de ventas", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Pau Cubarsí", precioCompra: 1500000 }])
    );

    render(<FantasyTeamDashboard />);

    const sellButtons = await screen.findAllByRole("button", {
      name: "Vender a Pau Cubarsí",
    });
    const sellButton = sellButtons[sellButtons.length - 1];
    fireEvent.click(sellButton);

    const sellInput = await screen.findByLabelText(
      "Precio de venta de Pau Cubarsí"
    );
    fireEvent.change(sellInput, { target: { value: "2000000" } });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar venta" }));

    const updatedTeamTable = await screen.findByTestId("team-table");
    expect(within(updatedTeamTable).queryByText("Pau Cubarsí")).not.toBeInTheDocument();

    const salesTable = screen.getByTestId("sales-table");
    expect(within(salesTable).getByText("Pau Cubarsí")).toBeInTheDocument();
    expect(
      within(salesTable).getByText(/1\.500\.000\s?€/)
    ).toBeInTheDocument();
    expect(
      within(salesTable).getByText(/2\.000\.000\s?€/)
    ).toBeInTheDocument();
    expect(
      within(salesTable).getByText(/\+500\.000\s?€/)
    ).toBeInTheDocument();
    expect(within(salesTable).getByText("+33,33%"))
      .toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("team-budget")).toHaveTextContent(
        /-6\.720\.968\s?€/
      )
    );
  });

  it("permite anular una venta confirmada restaurando jugador y presupuesto", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Pau Cubarsí", precioCompra: 1500000 }])
    );

    render(<FantasyTeamDashboard />);

    const sellButtons = await screen.findAllByRole("button", {
      name: "Vender a Pau Cubarsí",
    });
    fireEvent.click(sellButtons[sellButtons.length - 1]);

    const sellInput = await screen.findByLabelText(
      "Precio de venta de Pau Cubarsí"
    );
    fireEvent.change(sellInput, { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar venta" }));

    await screen.findByTestId("sales-table");

    fireEvent.click(
      await screen.findByRole("button", { name: "Eliminar/Anular venta" })
    );

    expect(
      await screen.findByText(
        "Se anulará la venta, se revertirá el presupuesto y se restaurará el jugador al equipo."
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(screen.getByText("Aún no has registrado ventas.")).toBeInTheDocument()
    );

    const restoredTable = screen.getByTestId("team-table");
    expect(within(restoredTable).getByText("Pau Cubarsí")).toBeInTheDocument();
    expect(screen.getByTestId("team-budget")).toHaveTextContent(
      /-8\.720\.968\s?€/
    );
  });

  it("elimina una venta no confirmada sin tocar presupuesto ni plantilla", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Pau Cubarsí", precioCompra: 1500000 }])
    );
    window.localStorage.setItem(
      "mySales",
      JSON.stringify([
        {
          name: "Pau Cubarsí",
          buyPrice: 1500000,
          sellPrice: 2000000,
          playerId: 1,
        },
      ])
    );

    render(<FantasyTeamDashboard />);

    const salesTable = await screen.findByTestId("sales-table");
    expect(
      within(salesTable).getByRole("button", { name: "Eliminar/Anular venta" })
    ).toBeInTheDocument();

    fireEvent.click(
      within(salesTable).getByRole("button", { name: "Eliminar/Anular venta" })
    );

    expect(
      await screen.findByText("Se eliminará el registro de la lista de ventas.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(screen.getByText("Aún no has registrado ventas.")).toBeInTheDocument()
    );

    const teamTable = screen.getByTestId("team-table");
    expect(within(teamTable).getByText("Pau Cubarsí")).toBeInTheDocument();
    expect(screen.getByTestId("team-budget")).toHaveTextContent(
      /-8\.720\.968\s?€/
    );
  });

  it("muestra las últimas jornadas y el detalle con los datos del mercado", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Pau Cubarsí", precioCompra: 1500000 }])
    );

    render(<FantasyTeamDashboard />);

    const detailButton = await screen.findByRole("button", {
      name: "Ver detalle de Pau Cubarsí",
    });
    const row = detailButton.closest("tr");
    expect(row).not.toBeNull();
    if (!row) {
      throw new Error("No se encontró la fila de Pau Cubarsí");
    }

    const summaryToggle = within(row).getByText("Últimas jornadas");
    fireEvent.click(summaryToggle);
    expect(within(row).getByText(/J6/i)).toBeInTheDocument();

    fireEvent.click(detailButton);

    const detailDialog = await screen.findByRole("dialog");

    expect(
      within(detailDialog).getByRole("heading", { name: "Información general" })
    ).toBeInTheDocument();

    expect(
      within(detailDialog).getByRole("button", { name: "Actualizar puntos" })
    ).toBeInTheDocument();

    const scoresTable = within(detailDialog).getByRole("table", {
      name: "Tabla de puntuación por jornada",
    });
    expect(await within(scoresTable).findByText("3,2")).toBeInTheDocument();
    expect(within(scoresTable).getByText("5,2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cerrar detalle/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("gestiona la alineación con drag and drop, guardado y restauración", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([
        { name: "Pau Cubarsí", precioCompra: 1500000 },
        { name: "Aarón Escandell", precioCompra: 1000000 },
        { name: "Pedri González", precioCompra: 3000000 },
        { name: "Nico Williams", precioCompra: 2000000 },
      ])
    );

    render(<FantasyTeamDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "Alineación" }));

    const playerListSection = screen
      .getByRole("heading", { name: "Mis jugadores" })
      .closest("section");
    if (!playerListSection) {
      throw new Error("No se encontró la sección de jugadores");
    }

    const defenderItem = await within(playerListSection).findByText("Pau Cubarsí");
    const defenderRow = defenderItem.closest("li");
    if (!defenderRow) {
      throw new Error("No se encontró el elemento arrastrable del defensor");
    }

    const defenderSlot = document.querySelector(
      '[data-zone="DEF"][data-slot-index="0"]'
    );
    if (!defenderSlot) {
      throw new Error("No se encontró el slot DEF #1");
    }

    const createDataTransfer = () => {
      const data = {};
      return {
        data,
        setData: jest.fn((type, value) => {
          data[type] = value;
        }),
        getData: jest.fn((type) => data[type]),
        effectAllowed: "all",
        dropEffect: "move",
      };
    };

    const dragTransfer = createDataTransfer();
    fireEvent.dragStart(defenderRow, { dataTransfer: dragTransfer });

    const dropTransfer = createDataTransfer();
    dropTransfer.getData = (type) => dragTransfer.data[type];
    fireEvent.dragOver(defenderSlot, { dataTransfer: dropTransfer });
    fireEvent.drop(defenderSlot, { dataTransfer: dropTransfer });

    await waitFor(() =>
      expect(defenderSlot).toHaveTextContent("Pau Cubarsí")
    );

    fireEvent.click(screen.getByRole("button", { name: "Guardar alineación" }));

    await waitFor(() =>
      expect(window.localStorage.getItem("teamLineupSaved")).not.toBeNull()
    );

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    await waitFor(() => expect(defenderSlot).toHaveTextContent("DEF #1"));

    fireEvent.click(
      screen.getByRole("button", { name: "Restaurar última guardada" })
    );

    await waitFor(() =>
      expect(defenderSlot).toHaveTextContent("Pau Cubarsí")
    );

    const saved = JSON.parse(
      window.localStorage.getItem("teamLineupSaved") || "{}"
    );
    expect(saved.formation).toBe("4-3-3");
    expect(Array.isArray(saved.slots?.DEF)).toBe(true);
    expect(saved.slots.DEF.some(Boolean)).toBe(true);
  });
});
