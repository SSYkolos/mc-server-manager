import React, { useState } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  collection,
  updateDoc,
} from "firebase/firestore";

function createSearchIndex(username: string): string[] {
  const index: string[] = [];
  const lowerUsername = username.toLowerCase();
  for (let i = 1; i <= lowerUsername.length; i++) {
    index.push(lowerUsername.substring(0, i));
  }
  return index;
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mcUsername, setMcUsername] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    try {
      let userCredential;

      if (isRegistering) {
        // Registration
        const trimmedUsername = mcUsername.trim().toLowerCase();

        if (!trimmedUsername) {
          setError("Minecraft username cannot be empty");
          return;
        }

        if (!/^[a-z0-9_]+$/.test(trimmedUsername)) {
          setError("Username must be letters, numbers, or underscores only");
          return;
        }

        // Check for duplicate username in readableUsers
        const q = query(
          collection(db, "readableUsers"),
          where("mcUsername", "==", trimmedUsername)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          setError("That Minecraft username is already taken.");
          return;
        }

        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;

        await updateProfile(userCredential.user, {
          displayName: trimmedUsername,
        });

        const searchIndex = createSearchIndex(trimmedUsername);

        // Save internal user info WITH empty drives object
        await setDoc(doc(db, "users", uid), {
          email,
          mcUsername: trimmedUsername,
          servers: [],
        });

        const readableUserRef = doc(db, "readableUsers", uid);
        const readableUserDoc = await getDoc(readableUserRef);

        if (!readableUserDoc.exists()) {
          // Create readableUsers document if doesn't exist
          await setDoc(readableUserRef, {
            mcUsername: trimmedUsername,
            searchIndex,
            invites: [],
          });
        } else {
          // Update existing readableUsers document (if needed)
          await updateDoc(readableUserRef, {
            mcUsername: trimmedUsername,
            searchIndex,
            // Do NOT overwrite invites here to keep existing invites intact
          });
        }

        setSuccess("Registration successful! You can now log in.");
        setIsRegistering(false);
      } else {
        // Login
        userCredential = await signInWithEmailAndPassword(auth, email, password);

        const docSnap = await getDoc(doc(db, "users", userCredential.user.uid));
        if (!docSnap.exists()) {
          setError("No profile found. Please register again.");
          await signOut(auth);
          return;
        }

        setSuccess(
          `Welcome back, ${userCredential.user.displayName || mcUsername || "user"}!`
        );
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Unexpected error occurred");
    }
  };

  return (
    <div className="bg-gray-100 p-4 rounded shadow-md max-w-md mx-auto">
      <h2 className="text-xl font-bold mb-4">{isRegistering ? "Register" : "Login"}</h2>

      {error && <div className="text-red-600 mb-2">{error}</div>}
      {success && <div className="text-green-600 mb-2">{success}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          placeholder="Email"
          className="w-full px-3 py-2 border rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="Password"
          className="w-full px-3 py-2 border rounded"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {isRegistering && (
          <input
            type="text"
            placeholder="Minecraft Username"
            className="w-full px-3 py-2 border rounded"
            value={mcUsername}
            onChange={(e) => setMcUsername(e.target.value)}
            required
          />
        )}

        <button type="submit" className="w-full bg-blue-600 text-white px-3 py-2 rounded">
          {isRegistering ? "Register" : "Login"}
        </button>

        <button
          type="button"
          className="w-full text-sm text-blue-700 underline"
          onClick={() => {
            setIsRegistering(!isRegistering);
            setError("");
            setSuccess("");
          }}
        >
          {isRegistering ? "Already have an account? Login" : "Don't have an account? Register"}
        </button>
      </form>
    </div>
  );
}
