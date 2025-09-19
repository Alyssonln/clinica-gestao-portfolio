// src/firebase.ts
import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  browserLocalPersistence,
  type Auth,
} from "firebase/auth";
import { initializeFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions } from "firebase/functions";

// 🔒 Configuração agora vem do .env (nunca hardcoded!)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY!,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN!,
  projectId: import.meta.env.VITE_PROJECT_ID!,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET!,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID!,
  appId: import.meta.env.VITE_APP_ID!,
};

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);

// 🔑 Persistência padrão = por aba
setPersistence(auth, browserSessionPersistence).catch(console.error);

// 🔧 Alternar persistência (para "Lembrar login")
export async function setRememberMe(remember: boolean): Promise<void> {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
}

// 🔧 Firestore com auto long-polling
export const db: Firestore = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

// 🔧 Storage (bucket explícito)
export const storage: FirebaseStorage = getStorage(app, `gs://${import.meta.env.VITE_STORAGE_BUCKET}`);

// 🔧 Functions (usa o mesmo app)
export const functions: Functions = getFunctions(app, "us-central1");

// (debug opcional)
// if (import.meta.env.DEV) Object.assign(window, { auth, db, storage, functions });
