import React, { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { User } from "firebase/auth"; // Csak a User típusa kell, nem a figyelő!

/**
 * Custom hook to parse URL query parameters
 */
function useQuery() {
  return new URLSearchParams(useLocation().search);
}

/**
 * React component that handles the OAuth2 redirect callback
 */
export default function OAuth2Callback() {
  const query = useQuery();
  const navigate = useNavigate();
  const state = query.get("state"); 
  const code = query.get("code");
  const error = query.get("error");
  
  // A useRef segít megakadályozni a többszörös futtatást
  const isProcessing = useRef(false);

  useEffect(() => {
    // 🛑 IDEIGLENES TESZTELÉS: Ha ez lefut, a browsernek is működnie kell!
    console.log("TSX FÁJL LEFUTOTT! Code: ", code);
    alert("Kód: " + code + ". Most megnézem a hálózatot!");
    // 🛑 TESZTELÉS VÉGE
    // 1. Hiba ellenőrzése
    if (error) {
      alert("OAuth error: " + error);
      navigate("/");
      return;
    }

    // 2. Kód és UID ellenőrzése (feltételezve, hogy a state tartalmazza az UID-t)
    if (!code || !state || isProcessing.current) {
        if (code && !state) {
            alert("Hiányzik a felhasználói azonosító (state). Kérjük, jelentkezzen be újra.");
            navigate("/login");
        }
        return;
    }
    
    // 3. Függvény, ami elindítja a tokencserét AZONNAL!
    const initiateTokenExchange = async () => {
      isProcessing.current = true; // Jelölés, hogy fut a feldolgozás
      
      const uid = state; // A state-et használjuk UID-ként

      try {
        const res = await fetch(
          "https://europe-west1-mc-server-manager-6d2bc.cloudfunctions.net/handleDriveOAuth",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code,
              uid, // Elküldjük a state-et (amit UID-nek feltételezünk)
            }),
          }
        );

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || "Failed to exchange token on server.");
        }

        alert(`Linked Drive: ${data.driveEmail}. Az összekapcsolás sikeres.`);
        
        // Sikeres befejezés, navigálás a profil oldalra
        navigate("/profile", { replace: true });

      } catch (e) {
        console.error("Token Exchange Error:", e);
        alert("Server Error: " + (e instanceof Error ? e.message : String(e)));
        navigate("/", { replace: true });
      } finally {
        isProcessing.current = false;
      }
    };
    
    // 4. AZONNALI INDÍTÁS
    initiateTokenExchange();

  }, [code, error, navigate, state]);

  return <div>Linking your Drive... Please wait.</div>;
}