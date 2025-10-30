import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

function FullscreenMessage({ title, message }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-6 text-center text-slate-700">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="text-sm leading-relaxed text-slate-600">{message}</p>
      </div>
    </div>
  );
}

export default function ProtectedRoute({ children }) {
  const { user, loading, error, configError } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-sm font-medium text-slate-600">Preparando tu sesión…</p>
        </div>
      </div>
    );
  }

  if (configError) {
    return (
      <FullscreenMessage
        title="Configuración de Firebase incompleta"
        message="Añade el archivo firebase-config.js en la carpeta public o define las variables REACT_APP_FIREBASE_* para habilitar el inicio de sesión."
      />
    );
  }

  if (error) {
    return (
      <FullscreenMessage
        title="No se pudo iniciar sesión"
        message="Vuelve a intentarlo más tarde o contacta con el administrador."
      />
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
