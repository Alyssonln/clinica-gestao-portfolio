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
import { getFunctions, type Functions } from "firebase/functions"; // ⬅️ novo

const firebaseConfig = {
  apiKey: "AIzaSyD75Rbs_myhY-qJc_2uwZYI3t2mrLMUuTI",
  authDomain: "mind-15e12.firebaseapp.com",
  projectId: "mind-15e12",
  storageBucket: "mind-15e12.firebasestorage.app", // correto
  messagingSenderId: "843116734440",
  appId: "1:843116734440:web:64d1eab1e7d8c67f7aa65d",
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
export const storage: FirebaseStorage = getStorage(app, "gs://mind-15e12.firebasestorage.app");

// 🔧 Functions (usa o mesmo app)
export const functions: Functions = getFunctions(app, "us-central1");

// (debug opcional)
// if (import.meta.env.DEV) Object.assign(window, { auth, db, storage, functions });
