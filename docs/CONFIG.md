# Configuration Guide

This project reads config from `tui-test.config.json` or
`.tui-test.config.json`.

Use config to define:

- the workspace root
- named launch targets
- project-wide security defaults
- shell defaults
- defaults for the optional Microsoft `tui-test` bridge

## Discovery and normalization

Config is discovered by searching upward from the working directory.

After loading, the server normalizes paths so that:

- `workspaceRoot` becomes absolute
- target `cwd` values resolve relative to the workspace root
- `isolation.workingDirectory.copyFrom` resolves to an absolute path

## Common example

```json
{
  "workspaceRoot": ".",
  "security": {
    "allowShell": false,
    "allowShellEval": false,
    "allowedCommands": ["node", "cargo", "go", "python3"],
    "envAllowlist": ["PATH", "HOME", "TERM"],
    "inheritEnv": false,
    "artifactRetention": { "maxAgeHours": 168, "maxBundles": 50 }
  },
  "targets": {
    "counter": {
      "runner": "node",
      "cwd": "./examples",
      "launch": ["node", "counter.js"]
    },
    "counter-isolated": {
      "runner": "node",
      "cwd": "./examples",
      "launch": ["node", "counter.js"],
      "isolation": {
        "workingDirectory": {
          "mode": "copy",
          "copyFrom": "./examples"
        }
      }
    }
  }
}
```

## Top-level fields

| Field | Type | What it does |
| ----- | ---- | ------------ |
| `workspaceRoot` | `string` | Required root used for workspace-bounded execution |
| `targets` | `Record<string, TargetConfig>` | Named launch/build/test entries for runner-backed workflows |
| `security` | `SecurityConfig` | Project-wide execution and artifact policy |
| `shell` | `ShellDefaultsConfig` | Default shell adapter preferences for shell-backed launches |
| `microsoftTuiTest` | `MicrosoftTuiTestConfig` | Defaults for the optional Microsoft bridge tool |

## Targets

Each target can define:

| Field | Type | What it does |
| ----- | ---- | ------------ |
| `runner` | `"cargo" \| "go" \| "python" \| "node" \| "binary"` | Selects the runner adapter |
| `cwd` | `string` | Working directory for the target |
| `env` | `Record<string, string>` | Session-local environment overrides |
| `isolation` | `SessionIsolationConfig` | Per-target environment and working-directory isolation |
| `build` | `string[]` | Optional build argv |
| `launch` | `string[]` | Required launch argv |
| `test` | `string[]` | Optional test argv |

Targets are the cleanest way to let agents launch known programs without
guessing commands.

## Isolation fields

### `isolation.environment`

| Field | Type | What it does |
| ----- | ---- | ------------ |
| `inherit` | `boolean` | Opt in or out of inheriting parent env for this launch |
| `allow` | `string[]` | Restrict the final env to specific keys |
| `set` | `Record<string, string>` | Add or override specific environment variables |

### `isolation.workingDirectory`

| Field | Type | What it does |
| ----- | ---- | ------------ |
| `mode` | `"temp" \| "copy"` | Start in an empty temp directory or a copied fixture directory |
| `copyFrom` | `string` | Source path for `mode: "copy"` |
| `retain` | `boolean` | Keep the prepared working directory after close for debugging |

## Security fields

| Field | Type | What it does |
| ----- | ---- | ------------ |
| `allowedCommands` | `string[]` | Allowlist of permitted executables |
| `deniedCommands` | `string[]` | Denylist of blocked executables |
| `allowShell` | `boolean` | Permit shell-backed launches to resolve a shell binary |
| `allowShellEval` | `boolean` | Permit `shell: true` to forward arbitrary command strings through shell `-c` |
| `envAllowlist` | `string[]` | Restrict the resolved child environment to specific keys |
| `inheritEnv` | `boolean` | Inherit full parent `process.env` by default when true |
| `artifactRedactions` | `string[]` | Extra regex patterns for artifact redaction |
| `artifactRetention` | `object` | Retention limits for persisted artifact bundles |

Important behavior:

- `allowShell` does not by itself allow inline `-c` evaluation
- `allowShellEval` exists because shell `-c` bypasses command allowlists
- rules containing a path separator are matched as absolute-path rules
- bare command rules are matched against the resolved executable basename
- invalid `artifactRedactions` patterns fail validation

For the deeper security model, see [SECURITY.md](./SECURITY.md).

## Shell defaults

The optional `shell` block sets project-level defaults for shell-backed
launches.

| Field | Type | What it does |
| ----- | ---- | ------------ |
| `name` | `string` | Preferred shell adapter id |
| `login` | `boolean` | Whether to request login-shell behavior |

## Microsoft bridge defaults

The optional `microsoftTuiTest` block applies only to the dedicated
`run_microsoft_tui_test` tool.

| Field | Type | What it does |
| ----- | ---- | ------------ |
| `configFile` | `string` | Default config path for the bridge |
| `cwd` | `string` | Default working directory for bridge runs |
| `defaultTimeoutMs` | `number` | Default timeout for bridge invocations |

## Breaking changes in 0.2

1. Default env inheritance flipped from full parent inheritance to a minimal allowlist.
2. Shell gating split into `allowShell` and `allowShellEval`.
3. Command allowlist behavior now normalizes resolved paths.
4. Artifacts are redacted before writes and stored with owner-only permissions.
5. The Microsoft bridge no longer inherits full `process.env` by default.
