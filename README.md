# Meraki MCP Server

[![Build Status](https://github.com/WYRE-AI/meraki-mcp/actions/workflows/release.yml/badge.svg)](https://github.com/WYRE-AI/meraki-mcp/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides AI assistants with structured access to the [Cisco Meraki Dashboard](https://developer.cisco.com/meraki/api-v1/) — organizations, networks, devices, clients, wireless, switching, and appliance operations.

> **Note:** This project is maintained by [Wyre Technology](https://github.com/WYRE-AI).

## Quick Start

**Claude Code (CLI):**

```bash
claude mcp add meraki-mcp \
  -e MERAKI_API_KEY=your-api-key \
  -e MERAKI_ORG_ID=your-org-id \
  -- npx -y github:WYRE-AI/meraki-mcp
```

See [Installation](#installation) for Docker and from-source methods.

## Features

- **🔌 MCP Protocol Compliance**: Full support for MCP tools over stdio and HTTP transports
- **🌐 Network Coverage**: Tools spanning organizations, networks, devices, clients, wireless, switching, and appliance (MX) operations
- **🔍 Flattened Navigation**: `meraki_navigate` and `meraki_status` are stateless discovery aids — every tool is callable at any time
- **🛟 Safety by Default**: Read-only mode is **ON by default**; writes are gated and destructive actions require explicit confirmation
- **🖼️ Interactive Device Card (MCP Apps)**: `meraki_devices_get` renders as a read-only interactive card in MCP Apps hosts (SEP-1865) — neutral by default, brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env vars
- **🧰 Long-Tail Escape Hatch**: `meraki_raw_request` reaches any Meraki v1 endpoint not covered by a curated tool
- **🐳 Docker Ready**: Containerized deployment with HTTP transport and health checks
- **📊 Structured Logging**: Configurable log levels

## Installation

### Option 1: Docker

The image listens on `0.0.0.0` inside the container and sets `AUTH_MODE=gateway`. Publish the port on loopback and pass the service-to-service secret. In gateway mode the API key arrives on each request as `X-Meraki-Api-Key`.

```bash
docker run -d \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/wyre-ai/meraki-mcp:latest
```

### Option 2: From Source

```bash
git clone https://github.com/WYRE-AI/meraki-mcp.git
cd meraki-mcp
npm ci
npm run build
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `MERAKI_API_KEY` | Meraki Dashboard API key | — |
| `MERAKI_ORG_ID` | Default organization ID (optional) | — |
| `MERAKI_BASE_URL` | Override the Meraki API base URL (optional) | — |
| `READ_ONLY_MODE` | Safety switch — blocks all writes when `true` | `true` |
| `MCP_TRANSPORT` | Transport mode (`stdio` or `http`) | `stdio` |
| `MCP_HTTP_HOST` | Bind address when a secret is configured. Unset binds `127.0.0.1`. The container image sets `0.0.0.0`. | `127.0.0.1` |
| `MCP_HTTP_PORT` | HTTP server port | `8080` |
| `AUTH_MODE` | `env` reads `MERAKI_*` from the environment. `gateway` requires `X-Meraki-Api-Key` on each `/mcp` request. The image and Compose set `gateway`. | `env` |
| `CONDUIT_S2S_SECRET` | Service-to-service secret. Required to start HTTP. Empty and known placeholder values are refused. Never commit a real value. | — |
| `MCP_ALLOW_INSECURE_DEV` | Set to `1` for local HTTP without `CONDUIT_S2S_SECRET`. Logs a warning, skips `X-Gateway-S2S`, and listens on `127.0.0.1` only. | — |
| `LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) | `info` |

> The legacy `READ_ONLY` variable is also honored; `READ_ONLY_MODE` takes precedence.

### HTTP authentication

`MCP_TRANSPORT=http` requires `CONDUIT_S2S_SECRET`. Startup logs an error and exits non-zero when that variable is empty or a known placeholder (`changeme`, `change-me`, `placeholder`, `secret`, `example`, `replace-me`, `s2s-secret`, `your-secret`, `your-s2s-secret`, `replace-with-a-real-secret`). The process never writes the secret to logs. `MCP_ALLOW_INSECURE_DEV=1` starts without a secret, logs a warning, skips `X-Gateway-S2S`, and listens on `127.0.0.1` only — a wider `MCP_HTTP_HOST` such as `0.0.0.0` is ignored and the override is logged. A placeholder secret is still refused when that flag is set.

When `MCP_HTTP_HOST` is unset, the server binds `127.0.0.1`. A configured secret honors `MCP_HTTP_HOST`, including `0.0.0.0`.

With a secret set, every `/mcp` request must include `X-Gateway-S2S`. The value is `t=<unix seconds>,v1=<hex>`. `v1` is HMAC-SHA256 of the ASCII string `t=<unix seconds>`, keyed with `CONDUIT_S2S_SECRET`, encoded as lowercase hex. Timestamps more than 300 seconds from the server clock are rejected. A missing or invalid header returns 401.

`AUTH_MODE=gateway` also requires `X-Meraki-Api-Key` on each `/mcp` request. `X-Meraki-Org-Id` is optional. Those headers are the credential source for that request. A missing API key returns 401.

`/health` stays unauthenticated and does not read vendor credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

Example `X-Gateway-S2S` value (illustrative; mint it with the real secret):

```text
t=1710000000,v1=<hmac-sha256 hex of "t=1710000000">
```

## Safety Model

This server defaults to **read-only**. Write operations (updates, reboots, deletions) are blocked unless you explicitly set `READ_ONLY_MODE=false`.

- **Read tools** (`*_list`, `*_get`) are always available.
- **High-impact writes** (e.g. `meraki_networks_update`, `meraki_clients_update_policy`) are gated by read-only mode.
- **Confirmation-gated tools** additionally require a `confirm_destructive_action: true` argument, even once `READ_ONLY_MODE=false`. The confirmation flag is never forwarded to the Meraki API. Two groups qualify:
  - **Irreversible** — `meraki_networks_delete`, `meraki_devices_remove`.
  - **High blast radius** — `meraki_appliance_firewall_l3_update`, `meraki_switch_ports_update`, `meraki_wireless_ssids_update`, `meraki_devices_reboot`. These are reversible in principle, but each is applied over the same network link the change can break, so an operator can lose the connectivity needed to undo it. `meraki_appliance_firewall_l3_update` also *replaces* the rule set — any rule not in the payload is deleted — and `meraki_wireless_ssids_update` drops every client on the SSID when the PSK or auth mode changes.
- Confirmation is **not** an escape hatch from read-only mode: while `READ_ONLY_MODE` is on, a confirmed call is still blocked.
- The **`meraki_raw_request`** escape hatch classifies the call by HTTP method: `GET` is a read; `POST`/`PUT`/`DELETE` are writes; `DELETE` is destructive.

## Domains

All tools are returned upfront. Use `meraki_navigate` to explore a domain's tools, or `meraki_status` to check connectivity and the configured organization.

| Domain | Tools |
|--------|-------|
| **organizations** | `meraki_organizations_list`, `meraki_organizations_get`, `meraki_organizations_inventory_list` |
| **networks** | `meraki_networks_list`, `meraki_networks_get`, `meraki_networks_update` ⚠, `meraki_networks_delete` ⚠⚠ |
| **devices** | `meraki_devices_list`, `meraki_devices_get`, `meraki_devices_reboot` ⚠⚠, `meraki_devices_remove` ⚠⚠ |
| **clients** | `meraki_clients_list`, `meraki_clients_get`, `meraki_clients_get_policy`, `meraki_clients_update_policy` ⚠ |
| **wireless** | `meraki_wireless_ssids_list`, `meraki_wireless_ssids_update` ⚠⚠, `meraki_wireless_rf_profiles_list` |
| **switch** | `meraki_switch_ports_list`, `meraki_switch_ports_update` ⚠⚠, `meraki_switch_port_statuses_list` |
| **appliance** | `meraki_appliance_firewall_l3_get`, `meraki_appliance_firewall_l3_update` ⚠⚠, `meraki_appliance_vpn_status_get` |
| **(long tail)** | `meraki_raw_request` ⚠⚠ (on `DELETE`) |

⚠ = high-impact write, gated by read-only mode · ⚠⚠ = additionally requires `confirm_destructive_action: true`

## Docker Deployment

Copy `.env.example` to `.env` and set `CONDUIT_S2S_SECRET` (`openssl rand -hex 32`). Leave the example file's secret empty.

Compose publishes `127.0.0.1:8080:8080`, refuses to start when `CONDUIT_S2S_SECRET` is unset, and runs `AUTH_MODE=gateway`. That service has no `MERAKI_API_KEY`, `MERAKI_ORG_ID`, or `env_file`, so a project `.env` cannot inject static vendor credentials. Compose interpolates `CONDUIT_S2S_SECRET` from the environment.

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses `MERAKI_API_KEY` from the environment:

```bash
docker run -d \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -e AUTH_MODE=env \
  -e MERAKI_API_KEY=your-key \
  -e MERAKI_ORG_ID=your-org-id \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/wyre-ai/meraki-mcp:latest
```

## Development

```bash
npm ci
npm run build       # Build the project
npm run start       # Run over stdio
# HTTP refuses to start until CONDUIT_S2S_SECRET is set
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" npm run start:http
# Local HTTP only, without a service-to-service secret (always binds 127.0.0.1)
MCP_ALLOW_INSECURE_DEV=1 npm run start:http
npm run test        # Run tests
```

## Testing

```bash
npm test
```

The test suite covers the safety contract: read-only enforcement, destructive confirmation, and that `confirm_destructive_action` is never forwarded to the SDK.

## License

Apache 2.0 — Copyright WYRE Technology
