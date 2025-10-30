import { getApps, initializeApp } from "firebase/app";

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyACjpZsPaat0krxD7aSUqjQ6xmJI0-s93k",
  authDomain: "myfantasy-6eff2.firebaseapp.com",
  projectId: "myfantasy-6eff2",
  storageBucket: "myfantasy-6eff2.firebasestorage.app",
  messagingSenderId: "37411754593",
  appId: "1:37411754593:web:a42bf12868048deeac9020",
  measurementId: "G-QRZF9VY066",
};

const ENV_CONFIG_KEYS = {
  apiKey: "REACT_APP_FIREBASE_API_KEY",
  authDomain: "REACT_APP_FIREBASE_AUTH_DOMAIN",
  projectId: "REACT_APP_FIREBASE_PROJECT_ID",
  storageBucket: "REACT_APP_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "REACT_APP_FIREBASE_MESSAGING_SENDER_ID",
  appId: "REACT_APP_FIREBASE_APP_ID",
  measurementId: "REACT_APP_FIREBASE_MEASUREMENT_ID",
};

const ANALYTICS_TOGGLE_ENV = "REACT_APP_ENABLE_FIREBASE_ANALYTICS";

let appInstance = null;
let analyticsInstancePromise = null;
let analyticsModulePromise = null;
let cachedConfig = null;

const isObject = (value) => value !== null && typeof value === "object";

const readEnvOverrides = () => {
  if (typeof process === "undefined" || !process.env) {
    return {};
  }

  return Object.entries(ENV_CONFIG_KEYS).reduce((acc, [key, envName]) => {
    const envValue = process.env[envName];
    if (typeof envValue === "string" && envValue.trim()) {
      acc[key] = envValue.trim();
    }
    return acc;
  }, {});
};

const readWindowOverrides = () => {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.__FIREBASE_CONFIG__;
  if (!isObject(raw)) {
    return {};
  }
  return Object.entries(DEFAULT_FIREBASE_CONFIG).reduce((acc, [key]) => {
    if (raw[key] === undefined || raw[key] === null) {
      return acc;
    }
    const value = String(raw[key]).trim();
    if (value) {
      acc[key] = value;
    }
    return acc;
  }, {});
};

export const getFirebaseConfig = () => {
  if (cachedConfig) {
    return cachedConfig;
  }
  cachedConfig = {
    ...DEFAULT_FIREBASE_CONFIG,
    ...readEnvOverrides(),
    ...readWindowOverrides(),
  };
  return cachedConfig;
};

export const isAnalyticsEnabled = () => {
  const config = getFirebaseConfig();
  if (!config.measurementId) {
    return false;
  }

  const envToggle =
    typeof process !== "undefined" && process.env
      ? process.env[ANALYTICS_TOGGLE_ENV]
      : undefined;

  if (typeof envToggle === "string") {
    const normalized = envToggle.trim().toLowerCase();
    if (["0", "false", "off", "no"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "on", "yes"].includes(normalized)) {
      return true;
    }
  }

  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV &&
    process.env.NODE_ENV !== "production"
  ) {
    return false;
  }

  return true;
};

export function getFirebaseApp() {
  if (appInstance) {
    return appInstance;
  }
  const existing = getApps();
  if (existing.length) {
    appInstance = existing[0];
    return appInstance;
  }
  appInstance = initializeApp(getFirebaseConfig());
  return appInstance;
}

const loadAnalyticsModule = () => {
  if (!analyticsModulePromise) {
    analyticsModulePromise = import("firebase/analytics");
  }
  return analyticsModulePromise;
};

export async function ensureFirebaseAnalytics() {
  if (!isAnalyticsEnabled()) {
    return null;
  }

  if (!analyticsInstancePromise) {
    analyticsInstancePromise = (async () => {
      try {
        const { getAnalytics, isSupported } = await loadAnalyticsModule();
        if (typeof window === "undefined") {
          return null;
        }

        const supported = await isSupported();
        if (!supported) {
          return null;
        }

        const app = getFirebaseApp();
        return getAnalytics(app);
      } catch (error) {
        if (
          typeof console !== "undefined" &&
          console &&
          typeof console.warn === "function"
        ) {
          console.warn("No se pudo inicializar Firebase Analytics", error);
        }
        return null;
      }
    })();
  }

  return analyticsInstancePromise;
}

getFirebaseApp();

export default getFirebaseApp;
