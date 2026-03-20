
// electron/firebaseConfig.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// 1. Your existing config object
export const firebaseConfig = {
  apiKey: "AIzaSyCBCakPV_cd0ZNvdDnuDOY7MTEhn0AMU7A",
  authDomain: "mc-server-manager-6d2bc.firebaseapp.com",
  projectId: "mc-server-manager-6d2bc",
  storageBucket: "mc-server-manager-6d2bc.firebasestorage.app",
  messagingSenderId: "896676041939",
  appId: "1:896676041939:web:aa79a7c80195d99416b026"
};

// 2. Initialize the Firebase app instance
const app = initializeApp(firebaseConfig);

// 3. Initialize Firestore and EXPORT the 'db' variable
// This is the member that main.ts is looking for!
export const db = getFirestore(app);
