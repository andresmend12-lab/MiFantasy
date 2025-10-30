import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import FantasyTeamDashboard from "./FantasyDashboard";
import { AuthProvider } from "./auth/AuthContext";
import LoginPage from "./auth/LoginPage";
import ProtectedRoute from "./auth/ProtectedRoute";

const computeBaseName = () => {
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    return "/";
  }
  try {
    const url = new URL(publicUrl);
    const pathname = url.pathname.replace(/\/*$/, "");
    return pathname || "/";
  } catch {
    const normalized = publicUrl.replace(/^[^/]/, (match) => `/${match}`);
    return normalized || "/";
  }
};

export default function App() {
  const basename = computeBaseName();

  return (
    <AuthProvider>
      <BrowserRouter basename={basename}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <FantasyTeamDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
