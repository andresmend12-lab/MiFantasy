import { render, screen } from "@testing-library/react";
import App from "./App";

test("informa si falta la configuración pública de Firebase", () => {
  render(<App />);
  expect(
    screen.getByText(/configuración de firebase incompleta/i)
  ).toBeInTheDocument();
});
