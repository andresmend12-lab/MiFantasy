import { render, screen } from "@testing-library/react";
import FantasyTeamDashboard from "./FantasyDashboard";

describe("FantasyTeamDashboard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
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
});
