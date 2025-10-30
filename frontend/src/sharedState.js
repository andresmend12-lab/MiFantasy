import getFirebaseApp from "./firebaseApp";

let firestoreModulePromise = null;

const SHARED_COLLECTION = "shared";
const SHARED_DOCUMENT = "dashboard";
const DISABLE_ENV = "REACT_APP_DISABLE_SHARED_STATE";

const loadFirestoreModule = () => {
  if (!firestoreModulePromise) {
    firestoreModulePromise = import("firebase/firestore");
  }
  return firestoreModulePromise;
};

const isTestEnv = () =>
  typeof process !== "undefined" &&
  process?.env?.NODE_ENV &&
  process.env.NODE_ENV.toLowerCase() === "test";

const isDisabledByEnv = () =>
  typeof process !== "undefined" &&
  process?.env?.[DISABLE_ENV] &&
  ["1", "true", "yes", "on"].includes(
    String(process.env[DISABLE_ENV]).trim().toLowerCase()
  );

export const isSharedSyncSupported = () =>
  typeof window !== "undefined" && !isTestEnv() && !isDisabledByEnv();

const sanitizeForFirestore = (value) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const sanitized = sanitizeForFirestore(item);
      return sanitized === undefined ? null : sanitized;
    });
  }
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, entry]) => {
      if (!key) {
        return acc;
      }
      const sanitized = sanitizeForFirestore(entry);
      if (sanitized !== undefined) {
        acc[key] = sanitized;
      }
      return acc;
    }, {});
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      return null;
    }
  }
  return value;
};

const sanitizePartial = (partial) => {
  if (!partial || typeof partial !== "object") {
    return {};
  }
  return Object.entries(partial).reduce((acc, [key, value]) => {
    if (!key) {
      return acc;
    }
    const sanitized = sanitizeForFirestore(value);
    if (sanitized !== undefined) {
      acc[key] = sanitized;
    }
    return acc;
  }, {});
};

export const listenToSharedDashboardState = (onData, onError) => {
  if (!isSharedSyncSupported()) {
    return () => {};
  }

  let active = true;
  let unsubscribe = () => {};

  loadFirestoreModule()
    .then(({ getFirestore, doc, onSnapshot }) => {
      if (!active) {
        return;
      }
      const app = getFirebaseApp();
      const db = getFirestore(app);
      const ref = doc(db, SHARED_COLLECTION, SHARED_DOCUMENT);
      unsubscribe = onSnapshot(
        ref,
        (snapshot) => {
          if (!active) return;
          if (!snapshot.exists()) {
            onData?.(null);
            return;
          }
          onData?.(snapshot.data());
        },
        (error) => {
          if (!active) return;
          if (onError) {
            onError(error);
          } else if (typeof console !== "undefined" && console.error) {
            console.error("Error al escuchar el estado compartido", error);
          }
        }
      );
    })
    .catch((error) => {
      if (!active) return;
      if (onError) {
        onError(error);
      } else if (typeof console !== "undefined" && console.error) {
        console.error("No se pudo cargar Firestore", error);
      }
    });

  return () => {
    active = false;
    try {
      unsubscribe();
    } catch {
      /* noop */
    }
  };
};

let pendingWrite = Promise.resolve();

export const queueSharedDashboardUpdate = (partial) => {
  if (!isSharedSyncSupported()) {
    return Promise.resolve();
  }

  const sanitized = sanitizePartial(partial);
  if (!Object.keys(sanitized).length) {
    return Promise.resolve();
  }

  pendingWrite = pendingWrite
    .catch(() => undefined)
    .then(() =>
      loadFirestoreModule().then(
        ({ getFirestore, doc, setDoc, serverTimestamp }) => {
          const app = getFirebaseApp();
          const db = getFirestore(app);
          const ref = doc(db, SHARED_COLLECTION, SHARED_DOCUMENT);
          return setDoc(
            ref,
            {
              ...sanitized,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      )
    );

  return pendingWrite.catch((error) => {
    if (typeof console !== "undefined" && console.error) {
      console.error("Error al sincronizar estado compartido", error);
    }
    throw error;
  });
};

