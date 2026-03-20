import { google } from "googleapis";

/**
 * Build a Drive client from a USER access token (OAuth2).
 * No service account. No credentials.json. Safe for desktop apps.
 */
export function createDriveClient(accessToken: string) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });

  return google.drive({ version: "v3", auth: oauth2 });
}