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
- Export, validate, and stage current Viewer data and thumbnails
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

Different locations can be configured in `config/paths.json`.

The sibling `production/` directory will be generated later when Tooling assembles a production build; it does not need to exist during setup.

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


## How do I ...  ?

Use this table to find the appropriate Tooling workflow. Each FreeTV repository can also be developed independently; Tooling is most useful when a task crosses repository boundaries.

| I want to... | What do I do? | What happens? |
| --- | --- | --- |
| Check my repository configuration | Run `npm run status`. | Tooling reports the resolved Data, Viewer, Admin Dashboard, and production-output locations and confirms whether the required repositories exist. |
| Run the complete local development environment | Run `npm run dev:all`. | Tooling starts the Viewer, Admin Dashboard, and PHP backend together and stops the coordinated environment when one process exits. |
| Run only the Viewer | Run `npm run dev:viewer`. | Tooling starts the Viewer Vite development server using the configured Viewer port. |
| Run only the Admin Dashboard frontend | Run `npm run dev:admin`. | Tooling starts the Admin Dashboard Vite development server and configures its API proxy for the selected PHP development port. The PHP backend must also be running for API-dependent features. |
| Run only the PHP backend | Run `npm run dev:php`. | Tooling starts PHP from `freetv-server/public/` using the configured PHP development port. |
| Install Viewer data for local development | Run `npm run dev:install-viewer-data`. | Tooling resets the Viewer's disposable `config.json`, playlist JSON, and thumbnail files from the configured `freetv-data` repository. |
| Remove Viewer development data | Run `npm run dev:clean-viewer-data`. | Tooling removes the disposable Viewer data without deleting unrelated Viewer public assets. |
| Change a development port | Edit the appropriate `dev` setting in `config/paths.json`, or use `VIEWER_PORT`, `ADMIN_PORT`, or `PHP_PORT` for a temporary override. | Tooling validates the selected ports before starting the development processes. The Admin API proxy automatically follows the Tooling-managed PHP port unless `VITE_API_PROXY_TARGET` is explicitly set. |
| Build only the Viewer | Run `npm run build:viewer`. | Tooling creates the Viewer production frontend build in the Viewer repository. |
| Build only the Admin Dashboard | Run `npm run build:admin`. | Tooling creates the Admin Dashboard production frontend build in the `freetv-server` repository. |
| Find unused thumbnails | Run `npm run clean:thumbs`. | Tooling performs a dry run and reports thumbnails that are not referenced by the current Admin data. |
| Remove unused thumbnails | Review the dry-run results, then run `npm run clean:thumbs -- --apply`. | Tooling removes the reported unused thumbnails through the Admin thumbnail-cleanup utility. |
| Build the complete production application | Run `npm run build:all`. | Tooling builds both frontends, exports and stages the current Viewer data and thumbnails, assembles the production directory, and independently verifies the result. Nothing is uploaded or deployed automatically. |
| Verify an existing production assembly | Run `npm run verify`. | Tooling independently checks the already-assembled output against the production package contract. |

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

This changes the PHP backend port for that command without modifying `config/paths.json`,
and the Admin Dashboard API proxy automatically uses the same port. An explicit,
non-blank `VITE_API_PROXY_TARGET` is passed through unchanged; empty or whitespace-only
values are treated as unset and replaced with the generated localhost target.

## Project Structure

```text
freetv-tooling/
├── config/
│   └── paths.json             Repository, staging, output, and port configuration
├── scripts/
│   ├── lib/                   Shared validation, staging, assembly, and development utilities
│   ├── dev-*.js               Development-data and application launchers
│   ├── build-*.js             Frontend build and export-staging orchestration
│   ├── assemble.js            Production package assembly
│   ├── verify.js              Independent production-package verification
│   ├── clean-thumbs.js        Admin thumbnail maintenance
│   ├── content-compare.js     Advanced dataset comparison
│   ├── data-*.js              Canonical dataset validation and publication
│   └── release-build.js       First Run dataset release-package builder
├── staging/                   Generated data and thumbnail staging area
├── test/                      Tooling and contract tests
├── package.json               npm commands and runtime metadata
├── package-lock.json          Locked npm dependencies
├── LICENSE                    GNU GPL version 3 license
└── README.md                  Tooling operating documentation
```

The `staging/` directory is generated as needed, ignored by Git, and may be replaced by Tooling during export staging.

## Scripts

The [`How do I...?`](#how-do-i---) table covers the most common workflows. This section provides a concise command reference, including the lower-level commands used by the production pipeline.

### Development

| Command | Purpose |
| --- | --- |
| `npm run dev:install-viewer-data` | Reset the Viewer's disposable development data from the configured `freetv-data` repository. |
| `npm run dev:clean-viewer-data` | Remove the disposable Viewer `config.json`, playlists, and thumbnails without affecting unrelated public assets. |
| `npm run dev:viewer` | Start the Viewer Vite development server. |
| `npm run dev:admin` | Start the Admin Dashboard Vite development server with its PHP API proxy configured. |
| `npm run dev:php` | Start the PHP API development server from `freetv-server/public/`. |
| `npm run dev:all` | Start and coordinate the Viewer, Admin Dashboard, and PHP backend. |

### Production Assembly

| Command | Purpose |
| --- | --- |
| `npm run build:viewer` | Run the Viewer production frontend build. |
| `npm run build:admin` | Run the Admin Dashboard production frontend build. |
| `npm run stage:exports` | Export current Viewer data and thumbnails from `freetv-server`, validate their manifests and contents, and place them in Tooling-owned staging directories. |
| `npm run build:data` | Alias for `npm run stage:exports`. |
| `npm run assemble` | Replace the configured production output with an assembled package created from the validated frontend builds, staged exports, PHP API, Composer runtime, and First Run resources. |
| `npm run verify` | Independently verify an existing production assembly. |
| `npm run build:all` | Run the complete production build, staging, assembly, and verification workflow. |

`npm run build:all` runs these phases in order:

1. Build the FreeTV Viewer.
2. Build the FreeTV Admin Dashboard.
3. Export, validate, and stage Viewer data and thumbnails.
4. Assemble the local production package.
5. Independently verify the assembled package.

The pipeline stops when a phase fails. After all phases succeed, Tooling reports the configured local output directory.

No command in this workflow commits changes, creates a GitHub release, uploads files, provisions `.env`, or deploys the application.

### Maintenance and Testing

| Command | Purpose |
| --- | --- |
| `npm run status` | Show the resolved repository and production-output locations and report whether the expected repositories exist. |
| `npm run clean:thumbs` | Perform a dry run that reports unused Admin thumbnails. |
| `npm run clean:thumbs -- --apply` | Remove thumbnails identified as unused by the Admin thumbnail-cleanup utility. |
| `npm run test:assembly` | Run the focused production-assembly contract tests. |
| `npm run test:verification` | Run the focused production-verification contract tests. |
| `npm test` | Run the complete Tooling test suite. |

Advanced canonical-dataset publication and First Run release-package commands are intentionally documented separately from the normal development and production-assembly workflows.

## Production Output

The assembled application is written to the directory configured by `output.root`. With the default configuration, Tooling generates the sibling `production/` directory:

```text
production/
├── composer.json
├── composer.lock
├── resources/
│   ├── bootstrap/
│   │   └── fresh.json
│   └── freetv-baseline-sample-data.zip
├── sql/
│   └── freetv_mariadb_schema-tables-only.sql
├── vendor/
├── temp/
│   ├── publication-undo/
│   └── thumbnail-undo/
└── public/
    ├── .htaccess
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

The package combines:

* the FreeTV Viewer production build;
* the FreeTV Admin Dashboard production build;
* the PHP API and Composer runtime;
* the current exported Viewer data and thumbnails;
* the database schema and bundled resources required by First Run; and
* empty runtime directories used by Publish and thumbnail undo operations.

Assembly replaces the configured output directory after validating its required inputs. Keep unrelated files outside this Tooling-owned directory.

The production package deliberately contains no `.env`. Deployment operators must provide the PHP runtime configuration and credentials separately.

A successful build produces a verified local deployment package. Tooling does not upload or deploy it.

## Viewer Development Data

The Viewer requires static JSON and thumbnail artifacts but does not require a local PHP backend for normal viewing. Tooling can install the current distributable artifacts from `freetv-data` into the Viewer:

```bash
npm run dev:install-viewer-data
```

This command resets these paths in `freetv-viewer/public/`:

```text
config.json
playlists/
thumbs/
```

These files are disposable local development state. Rerunning the command removes stale files and restores all three paths from the currently configured `freetv-data` repository.

Do not edit the installed Viewer copies as the source of a dataset, and do not commit them from the Viewer repository. The distributable source files belong in `freetv-data`, while MariaDB remains authoritative for working Admin data.

Remove the installed development data when it is no longer needed:

```bash
npm run dev:clean-viewer-data
```

This cleanup affects only the three disposable paths listed above. Other files in `freetv-viewer/public/` are preserved.

## Troubleshooting

### Development Port Already in Use

Tooling uses these ports by default:

| Process | Default port |
| --- | --- |
| FreeTV Viewer | `5173` |
| FreeTV Admin Dashboard | `5174` |
| PHP API Server | `8081` |

Tooling stops with an error when a configured port is occupied instead of silently selecting another port. Vite strict-port mode provides a final check if another process claims a frontend port during startup.

On Linux or macOS, identify the process using a port with:

```bash
lsof -i :5174
```

Terminate a stale FreeTV development process normally:

```bash
kill <PID>
```

Use `kill -9 <PID>` only if normal termination fails.

On Windows, identify and terminate the process with:

```text
netstat -ano | findstr :5174
taskkill /PID <PID>
```

Use `taskkill /PID <PID> /F` only if normal termination fails.

Substitute `5173` or `8081` when checking the Viewer or PHP API port. If the port belongs to a legitimate unrelated service, do not terminate it. Change the corresponding port in `config/paths.json` or use the temporary environment-variable override documented under [Development Ports](#development-ports).

## License

This code is released under the [GPL v3](LICENSE) license.