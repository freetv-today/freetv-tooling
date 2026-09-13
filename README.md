# FreeTV Tooling

`freetv-tooling` coordinates development, validation, builds, data workflows, and production assembly across the FreeTV repositories:

- `freetv-server`
- `freetv-viewer`
- `freetv-data`

Each FreeTV repository can be developed independently when appropriate. Use FreeTV Tooling when a task crosses repository boundaries, such as running the complete local development environment, installing Viewer development data, or building a verified production assembly.

FreeTV Tooling prepares files locally. It does not automatically commit changes, create GitHub releases, upload files, or deploy FreeTV.

For help choosing the appropriate repository, see the [FreeTV organization overview](https://github.com/freetv-today).

## Features

- Coordinate the Admin Dashboard, Viewer, PHP backend, and Data repositories
- Run the complete FreeTV development environment from one command
- Configure repository paths, development ports, base paths, and production output
- Install and reset disposable Viewer development data
- Build the Viewer and Admin Dashboard independently or together
- Stage validated Admin-published data and thumbnails
- Assemble and independently verify a complete production build
- Detect occupied development ports before starting local services
- Run repository maintenance and data-validation utilities
- Support advanced canonical dataset and First Run release-package workflows

## Repository layout

Expected sibling structure:

```text
freetv-tooling/
../freetv-data/
../freetv-viewer/
../freetv-server/
```

The exact paths are controlled by `config/paths.json`.

## Configuration

`config/paths.json` defines the local workspace layout, dev ports, and production output paths.

### Important settings

- `repos.data`, `repos.viewer`, `repos.server`: relative paths to the sibling repos.
- `staging.*`: Tooling-owned Server export staging paths.
- `output.root`: root directory for assembled production files.
- `dev.viewerPort`: FreeTV Viewer Vite port (default `5173`).
- `dev.serverPort`: FreeTV Admin Dashboard Vite port (default `5174`).
- `dev.phpPort`: PHP API Server port (default `8081`).
- `dev.viewerBase`: base path for the viewer app.
- `dev.adminBase`: base path for the admin app.

## Scripts

### Development

- `npm run dev:install-viewer-data` — resets the Viewer's disposable public data to the configured `freetv-data` snapshot.
- `npm run dev:clean-viewer-data` — removes the disposable Viewer public data without touching other public assets.
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
- `npm run content:compare -- <snapshot-directory-or-zip>` — prints a read-only production-to-canonical reconciliation report with aggregate changed-field diagnostics.

Playlist comparison intentionally excludes legacy `lastupdated` values because they represent
publication/provenance state rather than canonical dataset content.
Playlist `sort_order` remains canonical, while legacy `playlist_shows.sort_order` is excluded
from canonical show equality.

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

For Viewer development, install a fresh development-data snapshot before starting Vite:

```bash
npm run dev:install-viewer-data
npm run dev:viewer
```

The installed `public/config.json`, `public/playlists/`, and `public/thumbs/` files
inside `freetv-viewer` are disposable local development state. Rerunning
`dev:install-viewer-data` completely resets those three paths to the current
configured `freetv-data` snapshot, including removal of stale files. Do not edit
`freetv-data` through these Viewer copies, and do not commit the copies from the
Viewer repository.

When the local copies are no longer needed, they can be removed explicitly:

```bash
npm run dev:clean-viewer-data
```

`freetv-data` is the published dataset used for development and distribution.
Authoritative working content is maintained by the FreeTV Admin/server system.

The broader typical local workflow is:

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
