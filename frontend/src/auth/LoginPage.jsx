import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

const mapFirebaseError = (error) => {
  const code = error?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Revisa tu correo y contraseña e inténtalo de nuevo.";
    case "auth/weak-password":
      return "La contraseña debe tener al menos 6 caracteres.";
    case "auth/email-already-in-use":
      return "Ya existe una cuenta con este correo. Usa Iniciar sesión.";
    case "auth/invalid-email":
      return "Introduce un correo electrónico válido.";
    default:
      return error?.message ?? "No se pudo completar la operación.";
  }
};

export default function LoginPage() {
  const { user, signIn, register, configError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const redirectPath = useMemo(
    () => location.state?.from?.pathname ?? "/",
    [location.state]
  );

  useEffect(() => {
    if (user) {
      navigate(redirectPath, { replace: true });
    }
  }, [user, navigate, redirectPath]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting || configError) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      if (mode === "register") {
        await register(form.email, form.password);
      } else {
        await signIn(form.email, form.password);
      }
    } catch (error) {
      console.error("Error de autenticación", error);
      setFeedback(mapFirebaseError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-800 px-4 py-10 text-slate-50">
      <div className="w-full max-w-md space-y-8 rounded-3xl bg-slate-950/70 p-8 shadow-2xl backdrop-blur">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">MiFantasy</h1>
          <p className="text-sm text-slate-300">
            {mode === "login"
              ? "Accede a tu panel de MiFantasy"
              : "Crea una cuenta para usar MiFantasy"}
          </p>
        </header>

        {configError ? (
          <div className="rounded-2xl border border-amber-400/60 bg-amber-100/10 p-4 text-left text-sm text-amber-200">
            <p className="font-medium text-amber-100">
              Falta la configuración de Firebase.
            </p>
            <p className="mt-2 leading-relaxed">
              Copia el archivo <code className="text-amber-50">firebase-config.template.js</code> de la carpeta <code>public</code>
              {" "}a <code>firebase-config.js</code> e introduce las claves de tu
              proyecto de Firebase.
            </p>
          </div>
        ) : null}

        {feedback ? (
          <div className="rounded-2xl border border-rose-400/70 bg-rose-100/10 p-4 text-sm text-rose-100">
            {feedback}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-slate-200">
              Correo electrónico
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-600/70 bg-slate-900/60 px-4 py-3 text-base text-slate-100 shadow-inner outline-none transition focus:border-indigo-400 focus:ring focus:ring-indigo-500/40"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-slate-200">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              value={form.password}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-600/70 bg-slate-900/60 px-4 py-3 text-base text-slate-100 shadow-inner outline-none transition focus:border-indigo-400 focus:ring focus:ring-indigo-500/40"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || Boolean(configError)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-4 py-3 text-base font-semibold text-white shadow-lg transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-600"
          >
            {submitting ? "Procesando…" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>

        <div className="flex items-center justify-center gap-2 text-sm text-slate-300">
          <span>{mode === "login" ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}</span>
          <button
            type="button"
            className="font-semibold text-indigo-300 underline-offset-4 transition hover:text-indigo-200 hover:underline"
            onClick={() => {
              setFeedback(null);
              setMode((prev) => (prev === "login" ? "register" : "login"));
            }}
          >
            {mode === "login" ? "Crear cuenta" : "Iniciar sesión"}
          </button>
        </div>

        <p className="text-center text-xs text-slate-500">
          ¿Necesitas ayuda? Revisa la guía de despliegue o contacta con el administrador.
        </p>

        <div className="text-center text-xs text-slate-600">
          <a
            href="https://andresmend12-lab.github.io/MiFantasy/"
            className="text-indigo-300 hover:text-indigo-200"
            target="_blank"
            rel="noreferrer"
          >
            Ir a la web pública
          </a>
        </div>
      </div>
    </div>
  );
}
