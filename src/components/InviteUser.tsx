import type { ReadableUser } from "../types/types";
import React, { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { getAuth } from "firebase/auth";
import { serverTimestamp } from "firebase/firestore";
import _debounce from "lodash.debounce"; // Adding debounce for search optimization

export default function InviteUser({
  serverId,
  onUserInvited,
}: {
  serverId: string;
  onUserInvited?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ReadableUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const auth = getAuth();

  // 🔍 USER SEARCH – optimized with debounce
  const fetchUsers = async (searchQuery: string) => {
    setLoading(true);
    setMessage(null);

    try {
      const lowerSearch = searchQuery.toLowerCase();

      // 🔎 Query readableUsers collection
      const q = query(
        collection(db, "readableUsers"),
        where("searchIndex", "array-contains", lowerSearch)
      );

      const snapshot = await getDocs(q);
      const foundUsers: ReadableUser[] = snapshot.docs.map((d) => ({
        uid: d.id,
        mcUsername: d.data().mcUsername,
      }));

      // 🔎 Fetch current server users
      const serverSnap = await getDoc(doc(db, "servers", serverId));
      const serverUsers = serverSnap.exists() ? serverSnap.data()?.users || {} : {};

      // 🔎 Fetch current invites
      const invitesSnap = await getDocs(collection(db, `servers/${serverId}/invites`));
      const invitedUids = invitesSnap.docs.map(d => d.id);

      // 🔎 Filter out already existing users and invited users
      const filteredUsers = foundUsers.filter(
        (u) => !serverUsers[u.uid] && !invitedUids.includes(u.uid)
      );

      setResults(filteredUsers);
    } catch (err: any) {
      setMessage({
        type: "error",
        text: "Failed to fetch users: " + err.message,
      });
    }

    setLoading(false);
  };

  const debouncedFetchUsers = _debounce(fetchUsers, 300); // 300ms debounce for search

  // 📞 Fetch users when search query changes
  useEffect(() => {
    if (search.length < 2) {
      setResults([]);
      return;
    }
    debouncedFetchUsers(search);
  }, [search, serverId]);

  // 📩 INVITE LOGIC
  const handleInvite = async (userToInvite: ReadableUser) => {
    setInviteLoading(true);
    setMessage(null);

    try {
      if (!auth.currentUser) {
        throw new Error("Not authenticated");
      }

      const inviteRef = doc(db, `servers/${serverId}/invites/${userToInvite.uid}`);

      // Check if the invite already exists
      const existingInvite = await getDoc(inviteRef);
      if (existingInvite.exists()) {
        setMessage({
          type: "error",
          text: "User already invited.",
        });
        setInviteLoading(false);
        return;
      }

      // Check if the user is already a member of the server
      const serverSnap = await getDoc(doc(db, "servers", serverId));
      if (serverSnap.exists() && serverSnap.data()?.users?.[userToInvite.uid]) {
        setMessage({
          type: "error",
          text: "User is already a member of this server.",
        });
        setInviteLoading(false);
        return;
      }

      // Create the invite in the server's invites sub-collection
      await setDoc(inviteRef, {
        invitedAt: serverTimestamp(),
        invitedBy: auth.currentUser.uid,
      });

      // Create the invite in the user's document (userInvites sub-collection)
      const userInviteRef = doc(
        db,
        `users/${userToInvite.uid}/userInvites/${serverId}`
      );
      await setDoc(userInviteRef, {
        invitedAt: serverTimestamp(),
        invitedBy: auth.currentUser.uid,
      });

      setMessage({
        type: "success",
        text: `Invite sent to ${userToInvite.mcUsername}`,
      });

      // Call the onUserInvited callback to refresh the invite list
      onUserInvited?.();

    } catch (err: any) {
      console.error("❌ Invite error:", err);
      setMessage({
        type: "error",
        text: "Invite failed: " + err.message,
      });
    }

    setInviteLoading(false);
  };

  return (
    <div className="invite-overlay p-4 bg-white shadow rounded max-w-md mb-6">
      <input
        type="text"
        placeholder="Search by Minecraft username"
        className="w-full border rounded px-3 py-2 mb-2"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading && <div>Loading users...</div>}
      {inviteLoading && <div>Sending invite...</div>}
      {message && (
        <div
          className={`mb-2 ${
            message.type === "success"
              ? "text-green-600"
              : "text-red-600"
          }`}
        >
          {message.text}
        </div>
      )}

      {!loading && results.length === 0 && search.length >= 2 && (
        <div>No users found</div>
      )}

      <ul className="max-h-48 overflow-y-auto">
        {results.map((user) => (
          <li
            key={user.uid}
            className="flex justify-between items-center py-1 px-2 hover:bg-gray-100 cursor-pointer"
            onClick={() => handleInvite(user)}
          >
            <span>{user.mcUsername}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

