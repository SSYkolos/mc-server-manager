// functions/refreshAccessToken.js
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const cors = require('cors')({ origin: true }); // Használjuk a biztonságosabb cors csomagot

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.refreshAccessToken = onRequest(
  {
    region: "europe-west1",
    secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  async (req, res) => {
    // CORS wrapper használata, hogy ne legyen preflight hiba
    return cors(req, res, async () => {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      try {
        // A .env fájlból olvassa ki az értékeket, nincs ütközés
        const clientIdValue = process.env.GOOGLE_CLIENT_ID;
        const clientSecretValue = process.env.GOOGLE_CLIENT_SECRET;

        if (!clientIdValue || !clientSecretValue) {
            throw new Error("Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET secrets.");
        }

        const db = admin.firestore();
        const { uid, userId, driveId } = req.body || {};
        const finalUid = uid || userId;

        if (!finalUid || !driveId) {
          return res.status(400).json({ error: "Missing uid or driveId" });
        }
        
        const userRef = db.collection("users").doc(finalUid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) throw new Error("User not found");

        const userData = userSnap.data();
        const drive = (userData.drives || []).find((d) => d.driveId === driveId);
        if (!drive || !drive.tokens?.refresh_token) {
          throw new Error("Drive or refresh token missing");
        }

        const oauth2Client = new google.auth.OAuth2(clientIdValue, clientSecretValue);
        oauth2Client.setCredentials({ refresh_token: drive.tokens.refresh_token });

        const tokenResponse = await oauth2Client.getAccessToken();
        const updatedAccessToken = tokenResponse?.token;
        const updatedExpiryDate = oauth2Client.credentials?.expiry_date;

        if (!updatedAccessToken) throw new Error("Failed to get new access token");

        const updatedDrives = userData.drives.map((d) =>
          d.driveId === driveId
            ? {
                ...d,
                tokens: {
                  ...d.tokens,
                  access_token: updatedAccessToken,
                  expiry_date: updatedExpiryDate,
                },
              }
            : d
        );

        await userRef.update({ drives: updatedDrives });

        return res.status(200).json({ access_token: updatedAccessToken });

      } catch (err) {
  const googleData = err?.response?.data || null;
  console.error("Refresh token error:", err?.message, googleData);

  const code = googleData?.error;
  const status = code === "invalid_grant" ? 401 : 500;

  return res.status(status).json({
    error: err?.message || String(err),
    google: googleData,
  });
}
    });
  }
);
