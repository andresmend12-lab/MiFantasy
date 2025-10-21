import { render, screen } from "@testing-library/react";
import App from "./App";

test("muestra el título principal", () => {
  render(<App />);
  expect(
    screen.getByRole("heading", { name: /mi equipo – laliga fantasy/i })
  ).toBeInTheDocument();
});
