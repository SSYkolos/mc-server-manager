// electron/addServiceAccount.ts
export async function addServiceAccountToFolder(
  folderId: string,
  serviceAccountEmail: string,
  accessToken: string
) {
  const url = `https://www.googleapis.com/drive/v3/files/${folderId}/permissions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "writer",
      type: "user",
      emailAddress: serviceAccountEmail,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to add permission: ${errText}`);
  }
}