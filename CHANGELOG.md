# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Handler-invocation test coverage for every domain (`tests/domains/*.test.ts`, +45 tests).**
  Prior coverage exercised the tool *surface* (names, schemas, `_meta`) and the
  write-path confirmation gating, but no test ever invoked a domain handler's
  `handleCall` for a read tool (`list`/`get`), and the write-path tests didn't
  assert the exact shape of the call handed to the Meraki SDK. New tests mock
  `utils/client.js` and invoke each of the 25 tool handlers directly across all
  seven domains (`organizations`, `networks`, `devices`, `clients`, `wireless`,
  `switch`, `appliance`) plus the `passthrough` escape hatch, asserting both the
  outbound SDK call (method, positional args, camelCased option keys such as
  `per_page` → `perPage`) and the response mapping back into the tool's JSON
  content. Also newly covered: `meraki_devices_get`'s `_card` composition
  (device fetch → `buildDeviceCard` → a second `networks.get` call to resolve
  the network name, including the best-effort fallback when that lookup
  fails or the payload has no serial) and `meraki_devices_remove`'s happy
  path, which previously had no test past its generic confirmation-gating
  check.
- **Interactive device card via MCP Apps (SEP-1865).** `meraki_devices_get` results now render as an interactive card in MCP Apps hosts (Claude Desktop/web, and other hosts advertising the `io.modelcontextprotocol/ui` extension), instead of a wall of JSON. The card shows the device name, model, product type, resolved network name, MAC, LAN IP, firmware, address, tags, and notes. The card is read-only — Meraki device mutations stay behind the confirmation-gated tools. Non-App hosts are unaffected: the tool's JSON payload is unchanged apart from a new `_card` field.
  - The renderable tool advertises the UI via `_meta` (`ui/resourceUri`, plus the nested `ui.resourceUri` form) pointing at a new `ui://meraki/device-card.html` resource served as `text/html;profile=mcp-app`. The card HTML is a self-contained vite single-file bundle embedded at build time (`src/generated/device-card-html.ts`, committed), so it serves identically from stdio and Node HTTP transports. The server now declares the `resources` capability and answers `resources/list` / `resources/read` (`src/resources.ts`).
  - The card is neutral by default (system fonts, no vendor identity, no external fetches) and brandable via `window.__BRAND__` injection or `MCP_BRAND_*` env vars (`MCP_BRAND_NAME`, `MCP_BRAND_LOGO_URL`, `MCP_BRAND_PRIMARY_COLOR`, `MCP_BRAND_ACCENT_COLOR`, `MCP_BRAND_BG`, `MCP_BRAND_TEXT`): at serve time the server replaces the card's BRAND_INJECT marker with an inline, `<`-escaped `window.__BRAND__` script, so self-hosters can theme the card without rebuilding. No brand configured = HTML served unchanged.

### Security
- **Four high-blast-radius tools now require `confirm_destructive_action: true`.**
  `meraki_appliance_firewall_l3_update`, `meraki_switch_ports_update`,
  `meraki_wireless_ssids_update` and `meraki_devices_reboot` passed
  `destructive: false` to `guardWrite`, so once `READ_ONLY_MODE=false` they executed
  with no confirmation step. All four already advertised `destructiveHint: true`, but
  that annotation is advice to the model, not a gate the server enforces — the two
  had silently diverged.

  These four are singled out because each is applied over the very link the change can
  break, so the operator can lose the connectivity needed to undo it:
  `meraki_appliance_firewall_l3_update` *replaces* the whole rule set (any rule omitted
  from the payload is deleted) and can cut off network access;
  `meraki_wireless_ssids_update` drops every client on the SSID, which cannot rejoin
  with the old credentials; `meraki_switch_ports_update` can disable the port or move
  the VLAN out from under the devices behind it; `meraki_devices_reboot` takes the
  device offline.

  Each of the four also gained an explicit `confirm_destructive_action` boolean in its
  input schema — previously only `meraki_networks_delete`, `meraki_devices_remove` and
  `meraki_raw_request` declared one, so without this the new gate would have been
  unsatisfiable and the tools permanently blocked rather than merely confirmable. The
  parameter stays optional, so the first unconfirmed call still reaches the guard and
  returns its "re-invoke with confirmation" message instead of being rejected by
  schema validation.

  `READ_ONLY_MODE` semantics are unchanged, and confirmation is not an escape hatch
  from it: a confirmed call is still blocked while read-only mode is on. As before,
  the confirmation flag is never forwarded to the Meraki API.

### Fixed
- **`meraki_status` and the unknown-tool error advised calling `meraki_navigate`
  to discover tools without qualification.** Conduit suppresses `*_navigate` /
  `*_back` at the gateway (tier filtering lives in the grant resolver, which
  the container cannot see) and replaces them with `conduit__my_access`, so
  that advice pointed callers behind the gateway at a tool that returns
  method-not-found. Both strings now point to `conduit__my_access` for
  gateway callers and keep `meraki_navigate` as the standalone-mode discovery
  path. The tool itself is unchanged. (WYRE-AI/conduit#1236)
- `/health` liveness endpoint now returns an unconditional `200` instead of gating on
  credentials. The Azure Container Apps liveness probe hits `GET /health` with no
  credentials, so the previous credential gate returned `503` and crash-looped the
  container. Credential state is still reported in the response body
  (`credentials.configured`); per-request credential handling for `/mcp` is unchanged.

## [1.0.0] - 2026-07-01

### Added
- Initial scaffold of the Cisco Meraki Dashboard MCP server.
- Flattened navigation (`meraki_navigate`, `meraki_status`) — all tools returned upfront; discovery only, no per-session state.
- Domain tools across `organizations`, `networks`, `devices`, `clients`, `wireless`, `switch`, and `appliance`.
- `meraki_raw_request` long-tail escape hatch for any Meraki v1 endpoint.
- Safety module: read-only mode ON by default, high-impact write gating, and destructive-action confirmation (`confirm_destructive_action`) that is never forwarded to the SDK.
- Dual transport: stdio (`src/index.ts`) and stateless Streamable HTTP (`src/http.ts`) with `/mcp` and `/health` endpoints, plus gateway header credential injection.
- Docker image, semantic-release configuration, and release workflow.
