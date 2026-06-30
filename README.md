# StyTrix CLI

Design fashion with AI from your terminal — or let your coding agent do it. `stytrix` is a thin **OAuth client for the [StyTrix MCP server](https://www.stytrix.com/mcp)**: it reuses StyTrix's existing OAuth 2.1 sign-in (no API key, nothing to configure) and exposes the StyTrix tools as simple commands.

## Quick start

```bash
npx stytrix login          # opens your browser to sign in to StyTrix
npx stytrix credits        # check your balance
npx stytrix projects       # list your canvas projects
npx stytrix generate --project <id> --prompt "an oversized camel wool trench coat, studio shot"
```

That's it — the generated design lands live on your StyTrix canvas.

## Commands

| Command | What it does |
|---------|--------------|
| `stytrix login` | Sign in (browser OAuth via StyTrix; token saved to `~/.stytrix`) |
| `stytrix whoami` | Show the connected StyTrix account |
| `stytrix credits` | Show your credit balance |
| `stytrix projects` | List your canvas projects (id, title, URL) |
| `stytrix tools` | List all available StyTrix tools |
| `stytrix generate --project <id> --prompt "..."` | Generate a concept onto a canvas (`--mode photorealistic\|true_to_sketch`, `--ref <imageUrl>`, `--aspect 2:3`) |
| `stytrix call <tool> '<json-args>'` | Call any StyTrix tool directly, e.g. `stytrix call generate_fabric '{"projectId":"...","materialType":"linen"}'` |
| `stytrix logout` | Remove saved credentials |

Read-only commands (`whoami`, `credits`, `projects`, `tools`) are free; generation commands use StyTrix credits.

## How it works

`stytrix` is a [Model Context Protocol](https://modelcontextprotocol.io) client. On first use it discovers StyTrix's OAuth server, registers itself (Dynamic Client Registration), opens your browser for sign-in (PKCE), and stores the token in `~/.stytrix`. Subsequent commands call the StyTrix MCP tools over Streamable HTTP. There is **no API key** and nothing to copy.

Server URL (override with `STYTRIX_MCP_URL`): `https://www.stytrix.com/api/mcp`

## Use it from an agent

Install the [StyTrix skill](https://github.com/hirosichen/stytrix-skills) and your agent can drive this CLI:

```bash
npx skills add https://github.com/hirosichen/stytrix-skills --skill stytrix
```

## Links

- Website: https://www.stytrix.com
- MCP docs: https://www.stytrix.com/mcp
- Skill: https://github.com/hirosichen/stytrix-skills
- Support: hello@stytrix.com
