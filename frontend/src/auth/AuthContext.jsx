import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

const AuthContext = createContext(null);

const REQUIRED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "appId"];

const sanitizeConfigValue = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const resolveFirebaseConfig = () => {
  if (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) {
    const config = window.__FIREBASE_CONFIG__;
    const hasRequired = REQUIRED_CONFIG_KEYS.every(
      (key) => sanitizeConfigValue(config?.[key])
    );
    if (hasRequired) {
      return { config };
    }
  }

  const envConfig = {
    apiKey: sanitizeConfigValue(process.env.REACT_APP_FIREBASE_API_KEY),
    authDomain: sanitizeConfigValue(process.env.REACT_APP_FIREBASE_AUTH_DOMAIN),
    projectId: sanitizeConfigValue(process.env.REACT_APP_FIREBASE_PROJECT_ID),
    appId: sanitizeConfigValue(process.env.REACT_APP_FIREBASE_APP_ID),
    messagingSenderId: sanitizeConfigValue(
      process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID
    ),
    storageBucket: sanitizeConfigValue(
      process.env.REACT_APP_FIREBASE_STORAGE_BUCKET
    ),
    measurementId: sanitizeConfigValue(
      process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
    ),
  };

  const hasRequired = REQUIRED_CONFIG_KEYS.every((key) => envConfig[key]);
  if (hasRequired) {
    return { config: envConfig };
  }

  const error = new Error(
    "Faltan las claves de configuración de Firebase. Revisa el archivo firebase-config.js o las variables de entorno."
  );
  error.code = "firebase-config-missing";
  return { error };
};

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState({
    user: null,
    loading: true,
    error: null,
  });
  const [configError, setConfigError] = useState(null);
  const authRef = useRef(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    const { config, error } = resolveFirebaseConfig();
    if (!config) {
      setConfigError(error ?? null);
      setAuthState({ user: null, loading: false, error: null });
      return;
    }

    let app;
    try {
      app = getApps().length ? getApps()[0] : initializeApp(config);
    } catch (initializationError) {
      console.error("No se pudo inicializar Firebase", initializationError);
      setConfigError(initializationError);
      setAuthState({
        user: null,
        loading: false,
        error: initializationError,
      });
      return;
    }

    const auth = getAuth(app);
    authRef.current = auth;

    setPersistence(auth, browserLocalPersistence).catch((persistenceError) => {
      console.warn(
        "No se pudo aplicar la persistencia local de sesión",
        persistenceError
      );
    });

    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        setAuthState({ user: firebaseUser, loading: false, error: null });
      },
      (subscriptionError) => {
        console.error("Error al escuchar cambios de autenticación", subscriptionError);
        setAuthState({ user: null, loading: false, error: subscriptionError });
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const auth = authRef.current;
    if (!auth) {
      throw configError ?? new Error("Firebase no está configurado.");
    }
    return signInWithEmailAndPassword(auth, email, password);
  }, [configError]);

  const register = useCallback(async (email, password) => {
    const auth = authRef.current;
    if (!auth) {
      throw configError ?? new Error("Firebase no está configurado.");
    }
    return createUserWithEmailAndPassword(auth, email, password);
  }, [configError]);

  const logOut = useCallback(async () => {
    const auth = authRef.current;
    if (!auth) {
      return;
    }
    await signOut(auth);
  }, []);

  const value = useMemo(
    () => ({
      user: authState.user,
      loading: authState.loading,
      error: authState.error,
      configError,
      signIn,
      register,
      signOut: logOut,
      isConfigReady: !configError,
    }),
    [authState, configError, signIn, register, logOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe utilizarse dentro de un AuthProvider");
  }
  return context;
};
