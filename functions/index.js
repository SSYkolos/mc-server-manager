const refreshAccessTokenApp = require("./refreshAccessToken.js"); 
const { onInit } = require('firebase-functions/v2/core');
const { onRequest, onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const cors = require('cors')({ origin: true }); // Engedélyez minden origint, vagy írd be a localhostot
const { google } = require("googleapis");
const axios = require("axios");

let db;


onInit(() => {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
    db = admin.firestore();
});

const handleDriveOAuth = onRequest({ region: "europe-west1" }, (req, res) => {
  return cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    try {
      if (!db) db = admin.firestore();

      const { uid, serverId, tokens } = req.body || {};
      if (!uid || !tokens?.access_token) {
        return res.status(400).json({ error: "Missing uid or tokens.access_token" });
      }

      // ✅ Enrich: get email + stable Google user id
      // Uses OAuth2 userinfo endpoint (no Drive API needed)
      const oauth2 = google.oauth2("v2");
      const userinfoResp = await oauth2.userinfo.get({
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      const driveEmail = userinfoResp.data?.email || null;
      const driveId = userinfoResp.data?.id || null; // stable Google user id

      const driveData = {
        driveId,
        driveEmail,
        tokens,
        addedAt: new Date().toISOString(),
      };

      await db.collection("users").doc(uid).set(
        { drives: admin.firestore.FieldValue.arrayUnion(driveData) },
        { merge: true }
      );

      if (serverId) {
        await db.collection("servers").doc(serverId).set(
          { drive: driveData },
          { merge: true }
        );
      }

      return res.status(200).json({ ok: true, driveEmail, driveId });
    } catch (err) {
      console.error("handleDriveOAuth error:", err);
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });
});

const curseforgeProxy = onRequest({ region: "europe-west1", secrets: ["CURSEFORGE_API_KEY"] }, (req, res) => {
  return cors(req, res, async () => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    try {
      const { endpoint, params } = req.body;
      const url = `https://api.curseforge.com${endpoint}`;
      const response = await axios.get(url, {
        headers: {
          "x-api-key": process.env.CURSEFORGE_API_KEY,
          "Accept": "application/json"
        },
        params: params 
      });
      return res.status(200).json(response.data);
    } catch (error) {
      return res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
    }
  });
});



// ----------------------------------------------------------------------
// AZ ÚJ, JAVÍTOTT ACCEPT INVITE CALLABLE FUNCTION (onCall V2)
// ----------------------------------------------------------------------

const acceptInvite = onCall(
    {
        region: "europe-west1", 
    },
    async (request) => {
        // Itt is a globális `db` változót használjuk, ami az onInit-ben inicializálódott
        const authUid = request.auth?.uid;
        const serverId = request.data.serverId;
        
        if (!authUid) {
            throw new functions.https.HttpsError(
              "unauthenticated",
              "The user is not authenticated."
            );
        }

        if (!serverId || typeof serverId !== "string") {
            throw new functions.https.HttpsError(
              "invalid-argument",
              "Invalid server ID provided."
            );
        }

        const userInviteRef = db.doc(`users/${authUid}/userInvites/${serverId}`);
        const userInviteSnap = await userInviteRef.get();

        if (!userInviteSnap.exists) {
            throw new functions.https.HttpsError(
              "not-found",
              "Invite does not exist or has been removed."
            );
        }

        try {
            await db.runTransaction(async (transaction) => {
                const serverRef = db.doc(`servers/${serverId}`);
                const inviteRef = db.doc(`servers/${serverId}/invites/${authUid}`);
                const userRef = db.doc(`users/${authUid}`);

                const serverDoc = await transaction.get(serverRef);
                if (!serverDoc.exists) {
                    throw new functions.https.HttpsError(
                        "not-found",
                        "Server does not exist."
                    );
                }

                transaction.update(serverRef, {
                    [`users.${authUid}`]: {
                        role: "member",
                        lastJoined: admin.firestore.FieldValue.serverTimestamp(), 
                    },
                });

                transaction.update(userRef, {
                    servers: admin.firestore.FieldValue.arrayUnion(serverId),
                });

                transaction.delete(inviteRef);
                transaction.delete(userInviteRef);
            });

            return { status: "success", message: "Invite accepted successfully." };

        } catch (error) {
            console.error("Transaction failed:", error);
            if (error.code) { // Ha HttpsError, dobjuk tovább
                throw error;
            }
            throw new functions.https.HttpsError("internal", "Failed to accept invite during transaction.", error);
        }
    }
);

// ----------------------------------------------------------------------
// EXPORTÁLÁSOK FRISSÍTÉSE
// ----------------------------------------------------------------------
exports.handleDriveOAuth = handleDriveOAuth;
exports.acceptInvite = acceptInvite;
exports.refreshAccessToken = refreshAccessTokenApp.refreshAccessToken; 
exports.curseforgeProxy = curseforgeProxy;