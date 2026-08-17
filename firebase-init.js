import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, onValue, runTransaction
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export { signInAnonymously, onAuthStateChanged, ref, get, set, update, onValue, runTransaction };
