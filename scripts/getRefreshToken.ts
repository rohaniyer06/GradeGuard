import http from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is missing. Add it to .env before running this script.`);
  }
  return value.trim();
}

async function openBrowser(url: string): Promise<void> {
  await new Promise<void>((resolve) => {
    exec(`open "${url}"`, (error) => {
      if (error) {
        console.log("Could not auto-open browser. Open this URL manually:");
        console.log(url);
      }
      resolve();
    });
  });
}

async function run(): Promise<void> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const scope = "https://www.googleapis.com/auth/calendar";

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [scope]
  });

  const redirect = new URL(redirectUri);
  const port = Number(redirect.port || "80");
  const callbackPath = redirect.pathname;

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Missing request URL.");
      return;
    }

    const requestUrl = new URL(req.url, `${redirect.protocol}//${redirect.host}`);
    if (requestUrl.pathname !== callbackPath) {
      res.statusCode = 404;
      res.end("Not found.");
      return;
    }

    const code = requestUrl.searchParams.get("code");
    if (!code) {
      res.statusCode = 400;
      res.end("Missing OAuth code in callback.");
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      const refreshToken = tokens.refresh_token;
      if (!refreshToken) {
        throw new Error("No refresh token returned. Ensure prompt=consent and access_type=offline.");
      }

      res.statusCode = 200;
      res.end("OAuth complete. You can close this tab and return to the terminal.");

      console.log("\nGOOGLE_REFRESH_TOKEN:");
      console.log(refreshToken);
      console.log("\nPaste this value into .env as GOOGLE_REFRESH_TOKEN=<token>");
    } catch (error) {
      res.statusCode = 500;
      res.end("OAuth exchange failed. Check terminal for details.");
      console.error("Token exchange error:", error);
    } finally {
      server.close();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, redirect.hostname, () => resolve());
  });

  console.log(`Listening for OAuth callback on ${redirect.origin}${callbackPath}`);
  console.log("Opening Google consent page...");
  await openBrowser(authUrl);
  console.log("If the browser did not open, paste this URL manually:");
  console.log(authUrl);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
