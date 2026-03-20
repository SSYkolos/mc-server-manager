import type { Server as ServerType, Invite as InviteType, Props as PropsType } from "../types/types";
import React, { useEffect, useState, useRef } from "react";
import { onSnapshot } from "firebase/firestore";

import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  arrayUnion,
  collection,
  query,
  where,
} from "firebase/firestore";
import { db, functions, httpsCallable } from '../firebase'; 

export default function ServerList({ user, onSelect }: PropsType) {
  console.log("🔥 ServerList RENDERED", { user, onSelect });
  const [servers, setServers] = useState<ServerType[]>([]);
  const [invites, setInvites] = useState<InviteType[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [buttonLoading, setButtonLoading] = useState<{ [key: string]: boolean }>({});
  const inviteRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    setLoading(true);
    console.log("INFO: fetchData megkezdése. Betöltés állapot beállítva: true.");

    try {
      /* =========================
         FETCH USER SERVERS
         ========================= */
      console.log("INFO: User dokumentum lekérdezésének megkezdése a(z) UID: " + user.uid + " alapján.");
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      console.log("SIKER: User dokumentum lekérdezve.");

      if (!userSnap.exists()) {
        console.log("FIGYELEM: A felhasználói dokumentum nem létezik. Inicializálás, szerverek/meghívók törlése.");
        setServers([]);
        setInvites([]);
        setLoading(false);
        return; // Kilépés a függvényből idő előtt
      }

      const userData = userSnap.data();
      const serverIds: string[] = userData.servers || [];
      console.log(`INFO: A felhasználóhoz tartozó szerverazonosítók száma: ${serverIds.length}.`);
      const fetchedServers: ServerType[] = [];

      for (let i = 0; i < serverIds.length; i += 10) {
        const chunk = serverIds.slice(i, i + 10);
        console.log(`INFO: Szerver ID köteg feldolgozása elkezdődött (méret: ${chunk.length}).`);

        // Hozzáadott try-catch blokk a belső ciklushoz a specifikusabb hibakeresés érdekében
        try {
            const snaps = await Promise.all(
                chunk.map((id) => {
                    console.log(`INFO: Egyedi szerver dokumentum lekérése indul, ID: ${id}`);
                    return getDoc(doc(db, "servers", id));
                })
            );
            console.log("SIKER: Szerver dokumentumok kötegben (Promise.all) lekérdezve.");

            for (const snap of snaps) {
              if (!snap.exists()) {
                console.warn(`FIGYELEM: Egy szerver dokumentum nem létezik vagy törölve lett, ID: ${snap.id}. Átugorva.`);
                continue;
              }
              const data = snap.data();
              console.log(`INFO: Szerver adatfeldolgozás indul, Név: ${data.name}.`);

              try {
                console.log(`INFO: Létrehozó felhasználó nevének lekérdezése, UID: ${data.createdBy}`);
                const createdBySnap = await getDoc(doc(db, "readableUsers", data.createdBy));
                const createdByName = createdBySnap.exists()
                  ? createdBySnap.data().mcUsername
                  : "Unknown";
                console.log(`SIKER: Létrehozó neve meghatározva: ${createdByName}`);

                fetchedServers.push({
                  id: snap.id,
                  name: data.name,
                  createdBy: data.createdBy,
                  createdByName,
                  createdAt: data.createdAt,
                  lastJoined: data.users?.[user.uid]?.lastJoined,
                  role: data.users?.[user.uid]?.role,
                });
              } catch (innerErr) {
                console.error(`HIBA: Hiba történt a létrehozó felhasználó nevének lekérdezésekor a(z) UID: ${data.createdBy} esetén.`, innerErr);
                // Annak ellenére, hogy ez a belső hiba megtörtént, a külső ciklus folytatódhat Unknown névvel, ha a logika megengedi
              }
            }
        } catch (chunkError) {
            console.error(`HIBA: Hiba történt a szerverek egy kötegének lekérdezésekor. Érintett ID-k: ${chunk.join(', ')}`, chunkError);
            // Itt eldöntheted, hogy folytatod-e a külső ciklust a következő köteghez, vagy "throw chunkError" a teljes folyamat megszakításához.
        }
      }

      console.log(`INFO: Összesen ${fetchedServers.length} szerver került feldolgozásra. Rendezés megkezdése.`);

      fetchedServers.sort((a, b) => {
        const at = a.lastJoined?.toMillis?.() ?? a.createdAt.toMillis();
        const bt = b.lastJoined?.toMillis?.() ?? b.createdAt.toMillis();
        return bt - at;
      });
      console.log("SIKER: Szerverek rendezve időrendben.");

      setServers(fetchedServers);
      console.log("INFO: setServers hívás befejeződött. Folytatás a meghívásokkal.");
	
      /* =========================
         FETCH INVITES FROM USER'S DOCUMENT
         ========================= */
      console.log("INFO: UserInvites algyűjtemény lekérdezésének megkezdése.");
      const userInvitesRef = collection(db, "users", user.uid, "userInvites");
      const inviteSnaps = await getDocs(userInvitesRef);
      const fetchedInvites: InviteType[] = [];
      console.log(`SIKER: UserInvites lekérdezve. Talált meghívások száma: ${inviteSnaps.docs.length}.`);

      for (const snap of inviteSnaps.docs) {
        console.log(`INFO: Meghívóhoz tartozó szerver adatainak lekérése indul, ID: ${snap.id}`);
        const serverRef = doc(db, "servers", snap.id);
        const serverSnap = await getDoc(serverRef);

        if (!serverSnap.exists()) {
          console.warn(`FIGYELEM: A meghívóhoz tartozó szerver nem létezik (ID: ${snap.id}). Átugorva.`);
          continue;
        }

        const serverData = serverSnap.data();
        console.log(`INFO: Szerver adatfeldolgozás (meghívó), Név: ${serverData.name}. Létrehozó UID: ${serverData.createdBy}`);

        try {
          const createdBySnap = await getDoc(doc(db, "readableUsers", serverData.createdBy)); 
          const createdByName = createdBySnap.exists()
            ? createdBySnap.data().mcUsername
            : "Unknown";
          console.log(`SIKER: Létrehozó neve (meghívóhoz) meghatározva: ${createdByName}`);


          fetchedInvites.push({
            id: serverRef.id,
            name: serverData.name,
            createdByName,
          });
        } catch (innerErr) {
            console.error(`HIBA: Hiba a létrehozó felhasználó nevének lekérdezésekor a meghívó feldolgozása során (UID: ${serverData.createdBy}).`, innerErr);
        }
      }
      console.log(`INFO: Összesen ${fetchedInvites.length} meghívó került feldolgozásra.`);


      setInvites(fetchedInvites);
      console.log("INFO: setInvites hívás befejeződött.");

    } catch (err) {
      console.error("Kritikus HIBA: A fetchData fő try-catch blokkjában hiba történt. Ez a teljes műveletet érinti.", err);
      alert("Failed to load servers or invites. Kérjük, ellenőrizze a konzolt a részletekért.");
    } finally {
      setLoading(false);
      console.log("INFO: fetchData befejeződött. Betöltés állapot beállítva: false.");
    }
  };

const fetchInvites = async () => {
  const userInvitesRef = collection(db, "users", user.uid, "userInvites");
  const inviteSnaps = await getDocs(userInvitesRef);

  const fetchedInvites: InviteType[] = [];

  for (const snap of inviteSnaps.docs) {
    const serverRef = doc(db, "servers", snap.id);
    const serverSnap = await getDoc(serverRef);
    if (!serverSnap.exists()) continue;

    const serverData = serverSnap.data();

    const createdBySnap = await getDoc(
      doc(db, "readableUsers", serverData.createdBy)
    );

    fetchedInvites.push({
      id: serverRef.id,
      name: serverData.name,
      createdByName: createdBySnap.exists()
        ? createdBySnap.data().mcUsername
        : "Unknown",
    });
  }

  setInvites(fetchedInvites);
};

useEffect(() => {
  const userInvitesRef = collection(db, "users", user.uid, "userInvites");

  const unsub = onSnapshot(userInvitesRef, async (snapshot) => {
    const invites: InviteType[] = [];

    for (const docSnap of snapshot.docs) {
      const serverId = docSnap.id;
      const serverSnap = await getDoc(doc(db, "servers", serverId));
      if (!serverSnap.exists()) continue;

      const serverData = serverSnap.data();
      const creatorSnap = await getDoc(
        doc(db, "readableUsers", serverData.createdBy)
      );

      invites.push({
        id: serverId,
        name: serverData.name,
        createdByName: creatorSnap.exists()
          ? creatorSnap.data().mcUsername
          : "Unknown",
      });
    }

    setInvites(invites);
  });

  return () => unsub();
}, [user.uid]);

const didFetch = useRef(false);

useEffect(() => {
  if (didFetch.current) return;
  didFetch.current = true;

  fetchData();
}, [user.uid]);




  /* =========================
   ACCEPT INVITE (FRISSÍTETT VERZIÓ CLOUD FUNCTION HÍVÁSSAL)
   ========================= */
const handleAccept = async (serverId: string) => {
  setButtonLoading((p) => ({ ...p, [serverId]: true }));

  try {
    // Hivatkozás a Callable Cloud Functionre, amit 'acceptInvite' néven exportáltunk szerver oldalon
    const acceptInviteCallable = httpsCallable(functions, 'acceptInvite');

    console.log(`INFO: Meghívó elfogadása Cloud Function hívásával indul, Server ID: ${serverId}`);
    
    // Meghívjuk a függvényt, átadva neki a szükséges adatot (serverId) objektumként
    const result = await acceptInviteCallable({ serverId: serverId });

    console.log("SIKER: Cloud Function sikeresen lefutott, visszatérő adat:", result.data);
    
    // Mivel a Cloud Function végzi az összes adatbázis módosítást (update, delete),
    // itt már csak a lokális állapot frissítését kell kérnünk:
    await fetchData(); 

  } catch (err) {
    // Itt elkapjuk a hálózati hibákat vagy a Cloud Function által dobott HttpsError-okat
    console.error("Accept invite error during Cloud Function call:", err);
    alert("Failed to accept invite. Kérjük, ellenőrizze a konzolt.");
  } finally {
    // Bármi történik, a gomb állapotát visszaállítjuk
    setButtonLoading((p) => ({ ...p, [serverId]: false }));
  }
};

/* =========================
   DENY INVITE (MARAD A RÉGI, MERT A RULES ENGEDI)
   ========================= */
const handleDeny = async (serverId: string) => {
  setButtonLoading((p) => ({ ...p, [serverId]: true }));

  try {
    const inviteRef = doc(db, `servers/${serverId}/invites/${user.uid}`);
    const userInviteRef = doc(db, "users", user.uid, "userInvites", serverId);

    await deleteDoc(inviteRef);
    await deleteDoc(userInviteRef);

    // NINCS fetchData()
    // A listener intézi
  } catch (err) {
    console.error("Deny invite error:", err);
    alert("Failed to deny invite.");
  } finally {
    setButtonLoading((p) => ({ ...p, [serverId]: false }));
  }
};


  /* =========================
     UI
     ========================= */
  if (loading) return <p>Loading...</p>;

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

      {servers.length === 0 ? (
        <p>No servers found.</p>
      ) : (
        <ul>
          {servers.map((s) => (
            <li
              key={s.id}
              className="p-2 border rounded mb-2 cursor-pointer hover:bg-gray-100"
              onClick={() => onSelect?.(s.id)}
            >
              <div className="font-semibold">{s.name}</div>
              <div className="text-xs text-gray-600">
                Created by {s.createdByName}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
