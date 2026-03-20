// electron/getValidAccessToken.ts
import fetch from "node-fetch";

export async function getValidAccessToken(userId: string, driveId: string): Promise<string> {
  // Cloud Function endpoint that returns a valid access token
  const cloudFunctionUrl = "https://europe-west1-mc-server-manager-6d2bc.cloudfunctions.net/refreshAccessToken";

  const response = await fetch(cloudFunctionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uid: userId, driveId }),
  });

  const responseData = await response.json();

  if (!response.ok) {
    if (responseData.error && responseData.error.includes("Refresh token expired")) {
      throw new Error("REFRESH_TOKEN_EXPIRED");
    }
    throw new Error(`Failed to get valid token: ${responseData.error || response.statusText}`);
  }

  if (!responseData.access_token) {
    throw new Error("No access token returned by cloud function");
  }

  return responseData.access_token;
}


