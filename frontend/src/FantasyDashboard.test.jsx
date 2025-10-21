<<<<<<< HEAD
import { render, screen } from "@testing-library/react";
=======
import { fireEvent, render, screen, within } from "@testing-library/react";
>>>>>>> origin/codex/review-my-code-c4k5mh
import FantasyTeamDashboard from "./FantasyDashboard";

describe("FantasyTeamDashboard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
<<<<<<< HEAD
=======
    window.localStorage.clear();
>>>>>>> origin/codex/review-my-code-c4k5mh
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
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
<<<<<<< HEAD
=======
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
>>>>>>> origin/codex/review-my-code-c4k5mh
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
<<<<<<< HEAD
=======
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
>>>>>>> origin/codex/review-my-code-c4k5mh
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
<<<<<<< HEAD
=======
            points_avg: "3,4",
            points_last5: "3,9",
            points_history: [
              { matchday: 8, points: 2.5 },
              { matchday: 9, points: 3.1 },
              { matchday: 10, points: 4.0 },
            ],
>>>>>>> origin/codex/review-my-code-c4k5mh
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
<<<<<<< HEAD
=======
            points_avg: "5,9",
            points_last5: "6,8",
            points_history: [
              { matchday: 10, points: 6.1 },
              { matchday: 11, points: 5.4 },
              { matchday: 12, points: 7.2 },
              { matchday: 13, points: 6.8 },
            ],
>>>>>>> origin/codex/review-my-code-c4k5mh
          },
        ],
      }),
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
<<<<<<< HEAD
=======
    expect(screen.queryByText("Jugadores en mi equipo")).not.toBeInTheDocument();
  });

  it("calcula ganancias, rentabilidad y puntos en la tabla del equipo", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Nico Williams", buyPrice: 2000000 }])
    );

    render(<FantasyTeamDashboard />);

    const input = await screen.findByLabelText(
      "Precio de compra de Nico Williams"
    );
    expect(input).toHaveValue(2000000);

    fireEvent.change(input, { target: { value: "3000000" } });

    expect(await screen.findByTestId("total-value")).toHaveTextContent(
      "2.345.678"
    );
    expect(screen.getByTestId("total-buy")).toHaveTextContent("3.000.000");
    expect(screen.getByTestId("total-gain")).toHaveTextContent("-654.322");
    expect(screen.getByTestId("total-roi")).toHaveTextContent("-21,81%");
    expect(screen.queryByTestId("team-total-points")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-avg")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-avg5")).not.toBeInTheDocument();

    expect(
      screen.queryByRole("columnheader", { name: /historial/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Puntos" })
    ).toBeInTheDocument();

    const teamTable = screen.getByTestId("team-table");
    expect(within(teamTable).getByText("40,5")).toBeInTheDocument();
  });

  it("registra una venta y la muestra en la tabla de ventas", async () => {
    window.localStorage.setItem(
      "myTeam",
      JSON.stringify([{ name: "Pau Cubarsí", buyPrice: 1500000 }])
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
    expect(within(salesTable).getByText("1.500.000")).toBeInTheDocument();
    expect(within(salesTable).getByText("2.000.000")).toBeInTheDocument();
    expect(within(salesTable).getByText("+500.000")).toBeInTheDocument();
    expect(within(salesTable).getByText("+33,33%"))
      .toBeInTheDocument();
>>>>>>> origin/codex/review-my-code-c4k5mh
  });
});
