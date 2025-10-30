import { getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyACjpZsPaat0krxD7aSUqjQ6xmJI0-s93k",
  authDomain: "myfantasy-6eff2.firebaseapp.com",
  projectId: "myfantasy-6eff2",
  storageBucket: "myfantasy-6eff2.firebasestorage.app",
  messagingSenderId: "37411754593",
  appId: "1:37411754593:web:a42bf12868048deeac9020",
  measurementId: "G-QRZF9VY066",
};

let appInstance = null;
let analyticsPromise = null;

export function getFirebaseApp() {
  if (appInstance) {
    return appInstance;
  }
  const existing = getApps();
  if (existing.length) {
    appInstance = existing[0];
    return appInstance;
  }
  appInstance = initializeApp(firebaseConfig);
  return appInstance;
}

export async function ensureFirebaseAnalytics() {
  if (analyticsPromise) {
    return analyticsPromise;
  }
  analyticsPromise = (async () => {
    if (typeof window === "undefined") {
      return null;
    }
    try {
      const supported = await isSupported();
      if (!supported) {
        return null;
      }
      const app = getFirebaseApp();
      return getAnalytics(app);
    } catch (error) {
      console.warn("No se pudo inicializar Firebase Analytics", error);
      return null;
    }
  })();
  return analyticsPromise;
}

getFirebaseApp();

export default getFirebaseApp;
