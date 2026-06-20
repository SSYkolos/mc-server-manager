import React, { createContext, useContext, useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase'; 

interface ServerContextType {
  servers: any[];
  invites: any[];
  drives: any[];
  loading: boolean;
}

const ServerDataContext = createContext<ServerContextType>({ servers: [], invites: [], drives: [], loading: true });

export function ServerDataProvider({ children, userUid }: { children: React.ReactNode, userUid: string }) {
  const [servers, setServers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [drives, setDrives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userUid) return;

    console.log(`🔥 Starting secure Server & Invite cache for user: ${userUid}`);
    let serverUnsubs: (() => void)[] = [];

    // ==========================================
    // 1. LISTEN TO PRIVATE SERVERS (users doc)
    // ==========================================
    const unsubUser = onSnapshot(doc(db, 'users', userUid), (userSnap) => {
      const userData = userSnap.data();
      setDrives(userData?.drives || []);
      const serverIds: string[] = userData?.servers || [];

      serverUnsubs.forEach(unsub => unsub());
      serverUnsubs = [];

      if (serverIds.length === 0) {
        setServers([]);
        setLoading(false);
        return;
      }

      const serverDataMap = new Map<string, any>();
      let loadedCount = 0;

      serverIds.forEach(serverId => {
        const unsubServer = onSnapshot(doc(db, 'servers', serverId), (serverSnap) => {
          if (serverSnap.exists()) {
            serverDataMap.set(serverId, { id: serverSnap.id, ...serverSnap.data() });
          } else {
            serverDataMap.delete(serverId);
          }

          setServers(Array.from(serverDataMap.values()));
          loadedCount++;
          if (loadedCount >= serverIds.length) {
            setLoading(false);
          }
        });
        serverUnsubs.push(unsubServer);
      });
    });

    // ==========================================
    // 2. LISTEN TO PUBLIC INVITES (readableUsers doc)
    // ==========================================
    const unsubReadableUser = onSnapshot(doc(db, 'readableUsers', userUid), async (snap) => {
      if (!snap.exists()) {
        setInvites([]);
        return;
      }

      const data = snap.data();
      const inviteIds: string[] = data?.invites || []; // Grab the new array

      if (inviteIds.length === 0) {
        setInvites([]);
        return;
      }

      // If there are invites, quickly fetch the server name and creator name
      const fetchedInvites = [];
      for (const serverId of inviteIds) {
        const serverSnap = await getDoc(doc(db, "servers", serverId));
        if (!serverSnap.exists()) continue;

        const serverData = serverSnap.data();
        const creatorSnap = await getDoc(doc(db, "readableUsers", serverData.createdBy));
        
        fetchedInvites.push({
          id: serverId,
          name: serverData.name,
          createdByName: creatorSnap.exists() ? creatorSnap.data()?.mcUsername : "Unknown"
        });
      }
      
      setInvites(fetchedInvites);
    });

    // Cleanup both listeners when app closes
    return () => {
      unsubUser();
      unsubReadableUser();
      serverUnsubs.forEach(unsub => unsub());
    };
  }, [userUid]);

  return (
    <ServerDataContext.Provider value={{ servers, invites, drives, loading }}>
      {children}
    </ServerDataContext.Provider>
  );
}

export function useServerData() {
  return useContext(ServerDataContext);
}