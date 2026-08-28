# freetv-tooling

`freetv-tooling` is the orchestration repo for the Free TV project. It coordinates development, builds, assembly, and verification across:

- `freetv-viewer`
- `freetv-server`

The goal is to make local development, production assembly, and future deployment workflows reproducible from a single place.

## What it does

This repo provides scripts to:

- run FreeTV Viewer and FreeTV Admin Dashboard in local development on separate ports,
- start a lightweight PHP API Server for Admin API requests,
- build each repo independently,
- stage Server-owned Viewer data and thumbnails,
- assemble a validated local production package,
- verify that the expected deployment paths exist,
- and report whether the sibling repos are present.

## Repository layout

Expected sibling structure:

```text
freetv-tooling/
../freetv-viewer/
../freetv-server/
```

The exact paths are controlled by `config/paths.json`.

## Configuration

`config/paths.json` defines the local workspace layout, dev ports, and production output paths.

### Important settings

- `repos.viewer`, `repos.server`: relative paths to the sibling repos.
- `staging.*`: Tooling-owned Server export staging paths.
- `output.root`: root directory for assembled production files.
- `dev.viewerPort`: FreeTV Viewer Vite port (default `5173`).
- `dev.serverPort`: FreeTV Admin Dashboard Vite port (default `5174`).
- `dev.phpPort`: PHP API Server port (default `8081`).
- `dev.viewerBase`: base path for the viewer app.
- `dev.adminBase`: base path for the admin app.

## Scripts

### Development

- `npm run dev:viewer` — starts FreeTV Viewer.
- `npm run dev:admin` — starts FreeTV Admin Dashboard.
- `npm run dev:php` — starts the PHP API Server from the `freetv-server/public/` directory.
- `npm run dev:all` — starts all three development processes.

### Build

- `npm run build:viewer` — builds FreeTV Viewer.
- `npm run build:admin` — builds FreeTV Admin Dashboard.
- `npm run stage:exports` / `npm run build:data` — stages validated Server Data and Thumbnail exports.
- `npm run assemble` — creates and validates the full local production package.
- `npm run test:assembly` — runs focused production assembler contract tests.
- `npm run verify` — independently verifies an already-assembled local production package.
- `npm run build:all` — builds and verifies the complete local production package.

`build:all` is the authoritative local production workflow and runs, in order:

1. FreeTV Viewer production build
2. FreeTV Admin Dashboard production build
3. Server Data and Thumbnail export staging
4. Local production assembly
5. Independent production verification

The pipeline stops at the first failed stage. Its output is local only: no FTP,
Hostinger access, or deployment occurs. It does not create or copy `.env`;
deployment and secret provisioning remain separate sysadmin steps.

### Utility

- `npm run status` — confirms that the expected sibling repos exist and shows the output path.

## Production output

The assembled output is written to `output.root` as a full local deployment package:

```text
production/
├── composer.json
├── composer.lock
├── vendor/
├── temp/
│   ├── publication-undo/
│   └── thumbnail-undo/
└── public/
    ├── index.html
    ├── assets/
    ├── manifest.json
    ├── service-worker.js
    ├── admin/
    ├── api/
    ├── config.json
    ├── playlists/
    └── thumbs/
```

The package deliberately contains no `.env`; deployment operators provision it separately.

## Development workflow

Typical local development:

1. Check repo paths with `npm run status`.
2. Start everything with `npm run dev:all`.
3. Work in the Viewer or Admin repository directly.
4. Run the full local production pipeline with `npm run build:all`.
5. Inspect the verified package in the configured production output directory.

## Troubleshooting

The Tooling-managed development ports are `5173` for FreeTV Viewer, `5174` for
FreeTV Admin Dashboard, and `8081` for the PHP API Server. Startup stops with a
clear error instead of selecting another port when one is occupied.
The availability check is a startup diagnostic rather than a port lock; Vite's
strict-port mode remains the final guard if another process claims a port during startup.

On Linux or macOS, identify the process using a port with:

```bash
lsof -i :5174
```

Terminate a stale FreeTV development process with `kill <PID>`. Use `kill -9 <PID>`
only if a normal termination fails.

On Windows, use:

```text
netstat -ano | findstr :5174
taskkill /PID <PID>
```

Use `taskkill /PID <PID> /F` only if the normal command fails. Substitute `5173`
or `8081` when checking the Viewer or PHP API port. If the port belongs to a
legitimate unrelated service, do not terminate it; change the corresponding
development port in `config/paths.json` instead.

## Future direction

This tooling is designed to grow into:

- unit testing for each repo,
- Git/GitHub CLI integration,
- staging and production deploy branches,
- Dockerized development,
- and future moderation / content ingestion workflows.
