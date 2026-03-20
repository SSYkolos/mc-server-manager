// src/components/Profile.tsx
import type { ProfileProps } from "../types/types";
import React from "react";
import { User } from "firebase/auth";
import { auth } from "../firebase";



export default function Profile({ user }: ProfileProps) {
  return (
    <div className="max-w-md p-4 border rounded shadow-md">
      <h2 className="text-xl font-bold mb-4">Profile</h2>
      <p><strong>Email:</strong> {user.email}</p>
      <button
        className="mt-4 bg-red-500 text-white px-4 py-2 rounded"
        onClick={() => auth.signOut()}
      >
        Logout
      </button>
    </div>
  );
}
