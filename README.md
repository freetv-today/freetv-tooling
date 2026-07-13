# freetv-tooling

`freetv-tooling` is the orchestration repo for the Free TV project. It coordinates development, builds, assembly, and verification across:

- `freetv-viewer`
- `freetv-server`
- `freetv-data`

The goal is to make local development, production assembly, and future deployment workflows reproducible from a single place.

## What it does

This repo provides scripts to:

- run the viewer and server in local development on separate ports,
- start a lightweight PHP development server for server-side assets,
- build each repo independently,
- assemble a production-ready output tree,
- verify that the expected deployment paths exist,
- and report whether the sibling repos are present.

## Repository layout

Expected sibling structure:

```text
freetv-tooling/
../freetv-viewer/
../freetv-server/
../freetv-data/
```

The exact paths are controlled by `config/paths.json`.

## Configuration

`config/paths.json` defines the local workspace layout, dev ports, and production output paths.

### Important settings

- `repos.viewer`, `repos.server`, `repos.data`: relative paths to the sibling repos.
- `output.root`: root directory for assembled production files.
- `output.*`: subdirectories created or populated during assembly.
- `dev.viewerPort`: Vite dev server port for the viewer.
- `dev.serverPort`: Vite dev server port for the admin/server app.
- `dev.phpPort`: PHP dev server port for the server public directory.
- `dev.viewerBase`: base path for the viewer app.
- `dev.adminBase`: base path for the admin app.

## Scripts

### Development

- `npm run dev:view` — starts the viewer dev server.
- `npm run dev:server` — starts the admin/server dev server.
- `npm run dev:php-server` — starts the PHP dev server from the server `public/` directory.
- `npm run dev:all` — starts all three development processes.

### Build

- `npm run build:view` — builds the viewer.
- `npm run build:server` — builds the admin/server app.
- `npm run build:data` — stages generated data files into the output tree.
- `npm run assemble` — creates the final production directory layout.
- `npm run verify` — checks that the assembled output contains required paths.
- `npm run build:all` — runs the full build pipeline in order.

### Utility

- `npm run status` — confirms that the expected sibling repos exist and shows the output path.

## Production output

The assembled output is written to `output.root`, with the following key structure:

- `/` — viewer app
- `/admin/` — admin/server app
- `/api/` — PHP API assets
- `/admin/tools/` — admin tools
- `/playlists/` — exported playlist data
- `/thumbs/` — generated thumbnails
- `/logs/` — logs
- `/config.json` — generated config file

## Development workflow

Typical local development:

1. Check repo paths with `npm run status`.
2. Start everything with `npm run dev:all`.
3. Work in the viewer or server repo directly.
4. Build the final output with `npm run build:all`.
5. Inspect the assembled tree in the production output directory.

## Future direction

This tooling is designed to grow into:

- unit testing for each repo,
- Git/GitHub CLI integration,
- staging and production deploy branches,
- Dockerized development,
- and future moderation / content ingestion workflows.