# Deployment

This repo is hostname-agnostic. Any HTTPS reverse proxy that can route to
the `api` container (by default `api:3000` on the `toolkit-net` network)
works. This doc describes three common patterns.

## 1. Localhost / LAN

Simplest case: run on a workstation, hit `http://localhost:3000`.

```bash
cp .env.example .env       # optional: fill LLM_* if you want extract_structured
docker compose up -d
```

- Swagger UI: <http://localhost:3000/>
- OpenAPI spec: <http://localhost:3000/openapi.json>
- MCP: `http://localhost:3000/mcp`

No HTTPS, no auth. Fine for personal use on a trusted network.

## 2. Cloudflare Tunnel

Zero-config public HTTPS without opening ports. On the host running the
stack:

```bash
docker compose up -d
cloudflared tunnel login
cloudflared tunnel create toolkit
cloudflared tunnel route dns toolkit toolkit.<your-domain>
cloudflared tunnel --config ~/.cloudflared/config.yml run toolkit
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: toolkit
credentials-file: ~/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: toolkit.<your-domain>
    service: http://localhost:3000
  - service: http_status:404
```

Cloudflare terminates TLS. The tunnel connects outbound; you don't need
any inbound firewall rules.

## 3. Caddy + Tailscale + Cloudflare DNS-01 (private-to-tailnet deployment)

This is the author's setup: the API is only reachable to devices on the
operator's Tailscale tailnet, TLS certs are issued via Cloudflare DNS-01
ACME (no public inbound needed), and the hostname is a subdomain under a
domain whose DNS is managed by Cloudflare.

Add a Caddy vhost that reverse-proxies to the `api` container:

```caddy
{
  email you@<your-domain>
}

util.<your-domain> {
  tls {
    dns cloudflare {$CLOUDFLARE_API_TOKEN}
  }
  reverse_proxy toolkit-api:3000 {
    header_up X-Forwarded-Proto https
  }
}
```

Caddy needs to be on the `toolkit-net` docker network so it can resolve
`toolkit-api`. Add this to Caddy's compose:

```yaml
services:
  caddy:
    # ...
    networks:
      - toolkit-net
      # ...any other networks you route to

networks:
  toolkit-net:
    external: true
    name: toolkit-net
```

Prereqs:

- A Cloudflare API token with `Zone:DNS:Edit` + `Zone:Read` on the domain
- Wildcard DNS record `*.<your-domain>` pointing at your host (Proxied OFF
  if you're using Tailscale MagicDNS + a private IP)
- Caddy built with the `caddy-dns/cloudflare` module (standard docker image
  doesn't include it; build with `xcaddy build --with github.com/caddy-dns/cloudflare`)

## Wiring agents to the deployed endpoint

Once the service is reachable at `https://toolkit.<your-domain>`, the MCP URL is:

```
https://toolkit.<your-domain>/mcp
```

### Mastra (TypeScript)

```ts
import { MCPClient } from '@mastra/mcp'
const toolkit = new MCPClient({ url: 'https://toolkit.<your-domain>/mcp' })
// toolkit.getTools() → every tool in the registry, typed and ready
```

### Any MCP client

Any framework or client that speaks the MCP HTTP/SSE protocol can use the same URL — Mastra, the OpenAI Agents SDK, LangGraph's MCP adapter, the `ai` SDK's MCP integration, [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), or IDE clients that support remote MCP. Configuration shape varies by client; the URL is the only toolkit-specific piece.

## Env vars

All required / optional env vars are listed in `.env.example`. Summary:

| Var | Purpose | Default |
|---|---|---|
| `API_HOST` | Interface to bind inside the container | `0.0.0.0` |
| `API_PORT` | Port to bind inside the container | `3000` |
| `PY_URL` | Internal URL for the Python sidecar | `http://py:8000` |
| `LOG_LEVEL` | `debug \| info \| warn \| error` | `info` |
| `LLM_BASE_URL` | OpenAI-compatible endpoint for `extract_structured` | unset |
| `LLM_API_KEY` | API key for the above | unset |
| `LLM_DEFAULT_MODEL` | Default model ID for `extract_structured` | unset |

## Updating

```bash
cd /path/to/toolkit
git pull
docker compose pull        # if using pre-built images from GHCR
docker compose up -d
```

Images are built and pushed to `ghcr.io/<owner>/toolkit/{api,py}` on push
to `main` (see `.github/workflows/deploy.yml`).
