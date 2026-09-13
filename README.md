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
- Configure repository paths, development ports, staging paths, and production output
- Install and reset disposable Viewer development data
- Build the Viewer and Admin Dashboard independently or together
- Stage validated Admin-published data and thumbnails
- Assemble and independently verify a complete production build
- Detect occupied development ports before starting local services
- Run repository maintenance and data-validation utilities
- Support advanced canonical dataset and First Run release-package workflows

## Requirements

### System Requirements

- Node.js 22 or newer
- npm
- PHP 8.4.1 or newer
- Composer
- MariaDB when running the Admin Dashboard
- A modern web browser for Viewer and Admin development

The PHP backend also requires the PHP extensions documented in the [`freetv-server` requirements](https://github.com/freetv-today/freetv-server#requirements).

### Repository Requirements

The complete Tooling workflow expects local copies of:

- `freetv-tooling`
- `freetv-server`
- `freetv-viewer`
- `freetv-data`

Individual commands may require only some of these repositories. For example, `npm run dev:viewer` requires the Viewer, while `npm run dev:all` requires the Viewer, Admin Dashboard, and PHP backend.

Install npm dependencies separately in:

- `freetv-tooling`
- `freetv-server`
- `freetv-viewer`

Run `composer install` in `freetv-server` to install the PHP runtime dependencies required by the Admin API and production assembly.

FreeTV Tooling does not install MariaDB, create database accounts, initialize the Admin database, or install sibling-repository dependencies automatically.

## Getting Started

Clone or download the four FreeTV repositories into the same parent directory. The default configuration expects this workspace layout:

```text
freetv-data/
freetv-server/
freetv-tooling/
freetv-viewer/
```

Different locations can be configured later in `config/paths.json`.

Install the dependencies for each application:

1. Navigate to `freetv-tooling` and run `npm install`.
2. Navigate to `freetv-server` and run `npm install`.
3. From the same `freetv-server` directory, run `composer install`.
4. Navigate to `freetv-viewer` and run `npm install`.

Configure MariaDB and the PHP runtime by following the [`freetv-server` Getting Started guide](https://github.com/freetv-today/freetv-server#getting-started).

Return to `freetv-tooling` and verify that the configured repositories are available:

```bash
npm run status
```

Install a disposable copy of the current `freetv-data` Viewer artifacts:

```bash
npm run dev:install-viewer-data
```

> [!NOTE]
> The installed Viewer data is disposable local development state. When it is no longer needed, you can remove it with:
>
> ```bash
> npm run dev:clean-viewer-data
> ```

Start the Viewer, Admin Dashboard, and PHP backend together:

```bash
npm run dev:all
```

The default development ports are:

* FreeTV Viewer: `5173`
* FreeTV Admin Dashboard: `5174`
* PHP backend: `8081`

The startup output displays the active ports and application URLs. Keep the command running while developing. Press `Ctrl+C` to stop the coordinated development environment.

## Configuration

`config/paths.json` defines the repository locations, Tooling-owned staging directories, production output, and development ports. Paths are resolved relative to the `freetv-tooling` directory unless described otherwise.

### Path Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `repos.data` | `../freetv-data` | Location of the FreeTV Data repository. |
| `repos.server` | `../freetv-server` | Location of the FreeTV Admin Dashboard repository. |
| `repos.viewer` | `../freetv-viewer` | Location of the FreeTV Viewer repository. |
| `staging.root` | `staging` | Tooling-owned temporary staging directory. It must remain within `freetv-tooling/staging/`. |
| `staging.data` | `data` | Data-artifact staging directory beneath `staging.root`. |
| `staging.thumbnails` | `thumbnails` | Thumbnail staging directory beneath `staging.root`. |
| `output.root` | `../production` | Destination for the assembled production build. It must remain within the Tooling-owned `production/` boundary beside the repositories. |

The data and thumbnail staging directories must remain separate and may not overlap. Tooling validates staging and output paths before replacing their contents.

### Development Ports

| Setting | Default | Process |
| --- | --- | --- |
| `dev.viewerPort` | `5173` | FreeTV Viewer Vite development server |
| `dev.serverPort` | `5174` | FreeTV Admin Dashboard Vite development server |
| `dev.phpPort` | `8081` | PHP API development server |

Ports must be integers from `1` through `65535`. The three coordinated development processes must use different available ports.

The configured ports can be overridden temporarily through environment variables:

| Environment variable | Overrides |
| --- | --- |
| `VIEWER_PORT` | `dev.viewerPort` |
| `ADMIN_PORT` | `dev.serverPort` |
| `PHP_PORT` | `dev.phpPort` |

For example:

```bash
PHP_PORT=8082 npm run dev:all
```

This changes the PHP backend port for that command without modifying `config/paths.json`.

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
