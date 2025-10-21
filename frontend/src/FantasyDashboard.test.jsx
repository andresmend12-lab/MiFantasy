import { fireEvent, render, screen } from "@testing-library/react";
import FantasyTeamDashboard from "./FantasyDashboard";

describe("FantasyTeamDashboard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
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
            points_avg: "4,5",
            points_last5: "4,8",
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
            points_avg: "6,3",
            points_last5: "7,1",
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
  });

  it("calcula ganancias, rentabilidad y medias de puntos", async () => {
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
    expect(screen.getByTestId("team-avg")).toHaveTextContent("6,3");
    expect(screen.getByTestId("team-avg5")).toHaveTextContent("7,1");
  });
});
