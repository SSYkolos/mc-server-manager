export function getGoogleOAuthUrl(uid: string) {
  const params = new URLSearchParams({
    client_id: "896676041939-c3j9djfgajmcqh8ktb8pljijk4hoecqp.apps.googleusercontent.com",
    redirect_uri: "http://localhost:3000/oauth2callback",
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/userinfo.email"
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: uid
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
