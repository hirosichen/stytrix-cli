#!/usr/bin/env node
/**
 * StyTrix CLI — a thin OAuth client for the StyTrix MCP server.
 * Reuses StyTrix's existing OAuth 2.1 (Clerk) flow — no API key, no backend changes.
 *
 *   stytrix login
 *   stytrix whoami | projects | credits | tools
 *   stytrix generate --project <id> --prompt "..." [--mode photorealistic]
 *   stytrix call <tool> '<json-args>'
 *   stytrix logout
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MCP_URL = process.env.STYTRIX_MCP_URL || "https://www.stytrix.com/api/mcp";
const CALLBACK_PORT = Number(process.env.STYTRIX_CALLBACK_PORT || 41897);
const DIR = join(homedir(), ".stytrix");

// ── token / client storage ──────────────────────────────────────────────
function readJson(name) {
  try { return JSON.parse(readFileSync(join(DIR, name), "utf8")); } catch { return undefined; }
}
function writeJson(name, val) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, name), JSON.stringify(val, null, 2), { mode: 0o600 });
}
function readText(name) {
  try { return readFileSync(join(DIR, name), "utf8"); } catch { return undefined; }
}
function writeText(name, val) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, name), val, { mode: 0o600 });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch { /* ignore */ }
}

// ── OAuth client provider (CLI loopback) ─────────────────────────────────
class CliOAuthProvider {
  constructor(port) { this._redirectUrl = `http://localhost:${port}/callback`; this.authorizationUrl = null; }
  get redirectUrl() { return this._redirectUrl; }
  get clientMetadata() {
    return {
      client_name: "StyTrix CLI",
      redirect_uris: [this._redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "profile email",
    };
  }
  clientInformation() { return readJson("client.json"); }
  saveClientInformation(info) { writeJson("client.json", info); }
  tokens() { return readJson("tokens.json"); }
  saveTokens(t) { writeJson("tokens.json", t); }
  saveCodeVerifier(v) { writeText("verifier.txt", v); }
  codeVerifier() { return readText("verifier.txt"); }
  // Don't open the browser mid-connect; stash the URL and we'll open it after.
  redirectToAuthorization(url) { this.authorizationUrl = url.toString(); }
}

function waitForCallback(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${port}`);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      const ok = !!code;
      const title = ok ? "Signed in to StyTrix" : "Sign-in failed";
      const msg = ok
        ? "You're all set. Close this tab and head back to your terminal."
        : `Something went wrong (${err || "no authorization code"}). Please run \`stytrix login\` again.`;
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — StyTrix</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#1a1a1a">
  <div style="background:#fff;border:1px solid #ececec;border-radius:20px;padding:48px 40px;max-width:440px;text-align:center;box-shadow:0 12px 48px rgba(0,0,0,.07)">
    <div style="width:64px;height:64px;border-radius:50%;margin:0 auto 24px;display:flex;align-items:center;justify-content:center;background:${ok ? "#eaf6ec" : "#fdecec"};color:${ok ? "#1f9d4d" : "#d23b3b"};font-size:32px;font-weight:700">${ok ? "&#10003;" : "&#10005;"}</div>
    <h1 style="font-size:22px;margin:0 0 10px;font-weight:650;letter-spacing:-.01em">${title}</h1>
    <p style="font-size:15px;line-height:1.55;color:#5f5f5f;margin:0">${msg}</p>
    <div style="margin-top:30px;padding-top:20px;border-top:1px solid #f0f0f0;font-size:13px;color:#b0b0b0;letter-spacing:.06em;text-transform:uppercase">StyTrix &middot; AI Fashion Design</div>
  </div>
</body></html>`;
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      server.close();
      if (code) resolve(code); else reject(new Error(err || "no authorization code"));
    });
    server.on("error", reject);
    server.listen(port);
    setTimeout(() => { try { server.close(); } catch {} reject(new Error("OAuth timed out after 5 min")); }, 5 * 60 * 1000);
  });
}

async function connect({ interactive = true } = {}) {
  const provider = new CliOAuthProvider(CALLBACK_PORT);
  const newTransport = () => new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider });
  const client = new Client({ name: "stytrix-cli", version: "0.1.0" }, { capabilities: {} });
  try {
    await client.connect(newTransport());
    return client;
  } catch (e) {
    const needsAuth = e instanceof UnauthorizedError || /unauthor|401/i.test(String(e?.message || e));
    if (!needsAuth) throw e;
    if (!interactive) throw new Error("Not signed in. Run `stytrix login` first.");
    if (!provider.authorizationUrl) throw new Error("Could not start OAuth flow against " + MCP_URL);
    console.error("\nOpening your browser to sign in to StyTrix…");
    console.error("If it doesn't open, paste this URL:\n  " + provider.authorizationUrl + "\n");
    const codePromise = waitForCallback(CALLBACK_PORT);
    openBrowser(provider.authorizationUrl);
    const code = await codePromise;
    const t = newTransport();
    await t.finishAuth(code);
    await client.connect(t);
    return client;
  }
}

async function callTool(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  if (r.isError) { console.error(text || "(tool error)"); process.exitCode = 1; }
  else console.log(text || "(done)");
}

// ── arg parsing ──────────────────────────────────────────────────────────
function parseFlags(argv) {
  const flags = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = (argv[i + 1] && !argv[i + 1].startsWith("--")) ? argv[++i] : "true"; flags[k] = v; }
    else rest.push(a);
  }
  return { flags, rest };
}

const HELP = `StyTrix CLI — design fashion with AI from your terminal.

Usage:
  stytrix login                       Sign in (opens browser; OAuth via StyTrix)
  stytrix whoami                      Show the connected StyTrix account
  stytrix credits                     Show your credit balance
  stytrix projects                    List your canvas projects
  stytrix tools                       List available StyTrix tools
  stytrix generate --project <id> --prompt "..." [--mode photorealistic|true_to_sketch] [--ref <imageUrl>]
  stytrix call <tool> '<json-args>'   Call any StyTrix tool directly
  stytrix logout                      Remove saved credentials

Server: ${MCP_URL}   Docs: https://www.stytrix.com/mcp`;

async function main() {
  const [cmd, ...rest0] = process.argv.slice(2);
  const { flags, rest } = parseFlags(rest0);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(HELP); return; }
  if (cmd === "logout") { try { rmSync(DIR, { recursive: true, force: true }); } catch {} console.log("Signed out (cleared " + DIR + ")."); return; }

  if (cmd === "login") {
    const client = await connect();
    await callTool(client, "whoami");
    console.log("✅ Logged in.");
    return;
  }

  const client = await connect();
  switch (cmd) {
    case "whoami": await callTool(client, "whoami"); break;
    case "credits": await callTool(client, "get_credits"); break;
    case "projects": await callTool(client, "list_projects"); break;
    case "tools": {
      const t = await client.listTools();
      for (const tool of t.tools) console.log(`${tool.name}\t${tool.description?.slice(0, 80) || ""}`);
      break;
    }
    case "generate": {
      if (!flags.project || !flags.prompt) { console.error("Usage: stytrix generate --project <id> --prompt \"...\" [--mode ...] [--ref <url>]"); process.exit(1); }
      const args = { projectId: flags.project, mode: flags.mode || "photorealistic", prompt: flags.prompt };
      if (flags.ref) args.referenceImageUrl = flags.ref;
      if (flags.aspect) args.aspectRatio = flags.aspect;
      await callTool(client, "generate_concept", args);
      break;
    }
    case "call": {
      const tool = rest[0];
      if (!tool) { console.error("Usage: stytrix call <tool> '<json-args>'"); process.exit(1); }
      let args = {};
      if (rest[1]) { try { args = JSON.parse(rest[1]); } catch { console.error("args must be valid JSON"); process.exit(1); } }
      await callTool(client, tool, args);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}\n`); console.log(HELP); process.exit(1);
  }
}

main().catch((e) => { console.error("Error:", e?.message || e); process.exit(1); });
