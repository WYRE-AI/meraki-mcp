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

```bash
docker run -d \
  -e MERAKI_API_KEY=your-key \
  -e MERAKI_ORG_ID=your-org-id \
  -p 8080:8080 \
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
| `MCP_HTTP_PORT` | HTTP server port | `8080` |
| `AUTH_MODE` | Auth mode (`env` or `gateway`) | `env` |
| `LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) | `info` |

> The legacy `READ_ONLY` variable is also honored; `READ_ONLY_MODE` takes precedence.

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

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
# Edit .env with your Meraki API key (and org ID)
docker run --env-file .env -p 8080:8080 ghcr.io/wyre-ai/meraki-mcp:latest
```

## Development

```bash
npm ci
npm run build       # Build the project
npm run start       # Run over stdio
npm run start:http  # Run the HTTP transport
npm run test        # Run tests
```

## Testing

```bash
npm test
```

The test suite covers the safety contract: read-only enforcement, destructive confirmation, and that `confirm_destructive_action` is never forwarded to the SDK.

## License

Apache 2.0 — Copyright WYRE Technology
