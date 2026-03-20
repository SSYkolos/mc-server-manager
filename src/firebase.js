import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// Importáljuk a getFunctions-t ÉS a httpsCallable-t
import { getFunctions, httpsCallable } from "firebase/functions"; 


const firebaseConfig = {
  apiKey: "AIzaSyCBCakPV_cd0ZNvdDnuDOY7MTEhn0AMU7A",
  authDomain: "mc-server-manager-6d2bc.firebaseapp.com",
  projectId: "mc-server-manager-6d2bc",
  storageBucket: "mc-server-manager-6d2bc.firebasestorage.app",
  messagingSenderId: "896676041939",
  appId: "1:896676041939:web:aa79a7c80195d99416b026"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);



// Itt inicializáljuk a functions szolgáltatást.
// Fontos: Add meg azt a régiót ("europe-west1"), 
// ahová a Cloud Functionst telepítetted a functions/index.js alapján!
export const functions = getFunctions(app, "europe-west1"); 

// Exportáljuk a httpsCallable-t is, hogy a többi komponens importálni tudja:
export { httpsCallable };

