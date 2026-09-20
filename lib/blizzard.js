const TOKEN_URL = "https://oauth.battle.net/token";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

export async function getClientCredentialsToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET are not set");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`Blizzard token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// Generic authenticated fetch against the Blizzard API. Takes the token as a
// parameter (rather than always resolving client-credentials itself) so a
// future user-login access token can be swapped in without changing callers.
export async function blizzardFetch(path, token, { region = "us" } = {}) {
  const url = path.startsWith("http") ? path : `https://${region}.api.blizzard.com${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res;
}
