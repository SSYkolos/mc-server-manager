import type { Server as ServerType, Invite as InviteType, Props as PropsType } from "../types/types";
import React, { useState, useRef } from "react";
import { doc, deleteDoc, updateDoc, arrayRemove } from "firebase/firestore";
import { db, functions, httpsCallable } from '../firebase'; 
import { useServerData } from "../ServerDataContext";

export default function ServerList({ user, onSelect }: PropsType) {
  console.log("🔥 ServerList RENDERED");
  
  // 1. GRAB BOTH SERVERS AND INVITES FROM MEMORY (0 extra reads!)
  const { servers, invites, loading: serversLoading } = useServerData(); 
  
  const [inviteOpen, setInviteOpen] = useState(false);
  const [buttonLoading, setButtonLoading] = useState<{ [key: string]: boolean }>({});
  const inviteRef = useRef<HTMLDivElement>(null);

  /* =========================
     ACCEPT INVITE 
     ========================= */
  const handleAccept = async (serverId: string) => {
    setButtonLoading((p) => ({ ...p, [serverId]: true }));

    try {
      const acceptInviteCallable = httpsCallable(functions, 'acceptInvite');
      console.log(`INFO: Accepting via Cloud Function, Server ID: ${serverId}`);
      await acceptInviteCallable({ serverId: serverId });
      
      // Memory updates automatically when DB changes!
    } catch (err) {
      console.error("Accept invite error:", err);
      alert("Failed to accept invite. Check console.");
    } finally {
      setButtonLoading((p) => ({ ...p, [serverId]: false }));
    }
  };

  /* =========================
     DENY INVITE 
     ========================= */
  const handleDeny = async (serverId: string) => {
    setButtonLoading((p) => ({ ...p, [serverId]: true }));

    try {
      // 1. Remove from server's invite roster
      const serverInviteRef = doc(db, `servers/${serverId}/invites/${user.uid}`);
      await deleteDoc(serverInviteRef);

      // 2. NEW: Remove the serverId from the user's public 'invites' array!
      const readableUserRef = doc(db, "readableUsers", user.uid);
      await updateDoc(readableUserRef, {
        invites: arrayRemove(serverId)
      });

    } catch (err) {
      console.error("Deny invite error:", err);
      alert("Failed to deny invite.");
    } finally {
      setButtonLoading((p) => ({ ...p, [serverId]: false }));
    }
  };

  /* =========================
     UI PREPARATION
     ========================= */
  const sortedServers = [...servers].sort((a, b) => {
    const at = a.lastJoined?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
    const bt = b.lastJoined?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
    return bt - at;
  });

  if (serversLoading) return <p>Loading...</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Your Servers</h2>

        <div className="relative" ref={inviteRef}>
          <button
            onClick={() => setInviteOpen(!inviteOpen)}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
          >
            Invites ({invites.length})
          </button>

          {inviteOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white border rounded shadow-lg z-10">
              {invites.length === 0 ? (
                <div className="p-2 text-sm">No invites</div>
              ) : (
                invites.map((inv) => (
                  <div key={inv.id} className="p-2 border-b text-sm">
                    <div className="font-semibold">{inv.name}</div>
                    <div className="text-xs text-gray-600 mb-1">
                      From: {inv.createdByName}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAccept(inv.id)}
                        disabled={buttonLoading[inv.id]}
                        className="bg-green-500 text-white px-2 py-1 rounded text-xs"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleDeny(inv.id)}
                        disabled={buttonLoading[inv.id]}
                        className="bg-red-500 text-white px-2 py-1 rounded text-xs"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {sortedServers.length === 0 ? (
        <p>No servers found.</p>
      ) : (
        <ul>
          {sortedServers.map((s) => (
            <li
              key={s.id}
              className="p-2 border rounded mb-2 cursor-pointer hover:bg-gray-100"
              onClick={() => onSelect?.(s.id)}
            >
              <div className="font-semibold">{s.name}</div>
              <div className="text-xs text-gray-600">
                Created by {s.createdByName || "Unknown"}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}