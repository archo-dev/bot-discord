/**
 * Configures the staging Discord application to deliver interactions to the
 * staging Worker. The application id and endpoint are public constants; the
 * bot token is read from the environment and is never printed.
 *
 * Dry-run by default. Pass --apply for the external staging-only mutation.
 */

const STAGING_APPLICATION_ID = "1529353871619522600";
const STAGING_INTERACTIONS_ENDPOINT = "https://botdiscord-staging.archodev.workers.dev/interactions";
const apply = process.argv.includes("--apply");
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("DISCORD_TOKEN staging est requis dans l'environnement.");
  process.exit(1);
}

const headers = {
  authorization: `Bot ${token}`,
  "content-type": "application/json",
};
const currentApplicationUrl = "https://discord.com/api/v10/oauth2/applications/@me";
const updateApplicationUrl = "https://discord.com/api/v10/applications/@me";

const currentResponse = await fetch(currentApplicationUrl, { headers });
if (!currentResponse.ok) {
  throw new Error(`Verification de l'application Discord impossible (${currentResponse.status}).`);
}
const current = await currentResponse.json() as { id?: unknown; interactions_endpoint_url?: unknown };
if (current.id !== STAGING_APPLICATION_ID) {
  throw new Error("Le token ne correspond pas a l'application staging attendue; aucune action effectuee.");
}

if (current.interactions_endpoint_url === STAGING_INTERACTIONS_ENDPOINT) {
  console.log(`Endpoint d'interactions staging deja configure : ${STAGING_INTERACTIONS_ENDPOINT}`);
  process.exit(0);
}

if (!apply) {
  console.log(`Dry-run : endpoint staging a configurer : ${STAGING_INTERACTIONS_ENDPOINT}`);
  console.log("Relancer avec --apply pour confirmer.");
  process.exit(0);
}

const updateResponse = await fetch(updateApplicationUrl, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ interactions_endpoint_url: STAGING_INTERACTIONS_ENDPOINT }),
});
if (!updateResponse.ok) {
  throw new Error(`Configuration de l'endpoint staging echouee (${updateResponse.status}).`);
}
const updated = await updateResponse.json() as { id?: unknown; interactions_endpoint_url?: unknown };
if (updated.id !== STAGING_APPLICATION_ID || updated.interactions_endpoint_url !== STAGING_INTERACTIONS_ENDPOINT) {
  throw new Error("Discord n'a pas confirme l'endpoint staging attendu.");
}

console.log(`Endpoint d'interactions staging configure : ${STAGING_INTERACTIONS_ENDPOINT}`);
