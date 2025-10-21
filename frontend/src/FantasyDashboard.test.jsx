import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(within(row).getByText("2.000.000")).toBeInTheDocument();

    expect(await screen.findByTestId("total-value")).toHaveTextContent(
      "2.345.678"
    );
    expect(screen.getByTestId("total-buy")).toHaveTextContent("2.000.000");
    expect(screen.getByTestId("total-gain")).toHaveTextContent("+345.678");
    expect(screen.getByTestId("total-roi")).toHaveTextContent("+17,28%");
    expect(screen.getByTestId("team-budget")).toHaveTextContent(
      "-8.720.968 €"
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
    expect(within(row).getByText("1.500.000,5")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("team-budget")).toHaveTextContent(
        "-10.220.968,5 €"
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
      "-8.720.968 €"
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
    expect(within(salesTable).getByText("1.500.000")).toBeInTheDocument();
    expect(within(salesTable).getByText("2.000.000")).toBeInTheDocument();
    expect(within(salesTable).getByText("+500.000")).toBeInTheDocument();
    expect(within(salesTable).getByText("+33,33%"))
      .toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("team-budget")).toHaveTextContent(
        "-6.720.968 €"
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
      "-8.720.968 €"
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
    expect(screen.getByTestId("team-budget")).toHaveTextContent("-8.720.968 €");
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
