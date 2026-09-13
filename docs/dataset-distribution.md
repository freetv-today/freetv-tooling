# Dataset Publishing and Distribution

This document describes FreeTV’s advanced canonical-dataset and First Run release-package workflows.

These workflows are intended for the FreeTV project maintainer or another operator who wants to maintain and distribute a complete FreeTV dataset from their own repository or hosting environment. They are not required for ordinary Admin Dashboard or Viewer development.

Most administrators only need to organize content in the FreeTV Admin Dashboard and use **Publish** to export static JSON for their Viewer. That normal Viewer-publication workflow is documented in the [`freetv-server` README](https://github.com/freetv-today/freetv-server#publishing).

> [!IMPORTANT]
> FreeTV Tooling prepares and validates files locally. It does not commit changes, push to GitHub, create GitHub releases, upload release packages, update a remote server, or deploy FreeTV. Those remain deliberate operator actions.

## Workflow Terminology

FreeTV uses several related but distinct publication workflows:

| Workflow | Primary owner | Purpose | Result |
| --- | --- | --- | --- |
| Viewer publication | FreeTV Admin Dashboard | Export current MariaDB content for use by a Viewer. | Static Viewer configuration and playlist JSON artifacts. |
| Data Snapshot | FreeTV Admin Dashboard | Capture a point-in-time copy of Admin content and thumbnails for reconciliation. | A validated production-content snapshot ZIP. |
| Dataset reconciliation | FreeTV Tooling | Compare a production snapshot with the current canonical `freetv-data` repository. | A read-only difference report. |
| Dataset publication | FreeTV Tooling | Generate and validate Viewer artifacts, thumbnails, SQL packages, and publication metadata from the current Admin environment. | Updated managed content in the local `freetv-data` repository. |
| Dataset release packaging | FreeTV Tooling | Build the distributable Current Sample Data and Current Official Data packages used by First Run. | Two validated ZIP archives with package metadata and SHA-256 digests. |
| Dataset distribution | Deployment operator | Make the validated packages and their metadata available to other FreeTV installations. | Uploaded packages and a configured metadata endpoint. |

## Supported Workflow

The intended sequence is:

1. Capture a Data Snapshot from the Admin environment being reconciled.
2. Compare the snapshot with the current local `freetv-data` repository.
3. Review and resolve unexpected differences.
4. Run the dataset validation gate.
5. Publish the validated dataset locally to `freetv-data`, recording the reconciled snapshot as provenance.
6. Review and commit the resulting `freetv-data` changes manually.
7. Build the Current Sample Data and Current Official Data release packages.
8. Upload or otherwise distribute the packages manually.
9. Configure the dataset-package metadata endpoint with the final HTTPS URLs and SHA-256 values.
10. Test First Run against the intended metadata endpoint before updating production.

Each step has a different safety boundary. A successful local command does not imply that GitHub, a download host, the metadata endpoint, or a deployed FreeTV installation has been updated.

## Requirements

Before using these workflows, prepare local copies of:

- `freetv-tooling`
- `freetv-server`
- `freetv-data`

The default Tooling configuration expects these repositories to be siblings. Different locations can be configured through `freetv-tooling/config/paths.json`.

Install the npm dependencies in `freetv-tooling` and `freetv-server`, then install the PHP dependencies in `freetv-server` with Composer.

The Admin environment used for dataset generation must also have:

- working MariaDB configuration;
- the current FreeTV database schema;
- readable thumbnails;
- PHP CLI and the PHP extensions required by `freetv-server`; and
- sufficient database privileges to generate and restore the SQL packages used by the validation gate.

Run the Tooling test suite and confirm the configured repository paths before beginning:

```bash
npm test
npm run status
```

## Enabling Data Snapshot

Data Snapshot is an advanced Admin-only feature and is hidden from the Admin Dashboard navigation by default.

Set this Vite frontend variable when running or building the Admin Dashboard:

```dotenv
VITE_ENABLE_DATA_SNAPSHOT=true
```

The value must be exactly `true`. Other values leave the navigation item hidden.

After changing a Vite environment variable, restart the Admin development server or rebuild the Admin production frontend.

The flag controls whether the Data Snapshot navigation item is displayed; it is not the authorization boundary. The snapshot API independently requires an authenticated user with the `admin` role.

## Creating a Data Snapshot

A Data Snapshot captures the Admin environment that will be reconciled with the canonical `freetv-data` repository.

The snapshot contains:

- rows from the `playlists` table;
- rows from the `playlist_shows` table;
- the current `tt*.jpg` thumbnail files;
- file sizes and SHA-256 digests; and
- capture timestamps and record counts.

It does not contain Admin users, login credentials, sessions, problem reports, or other unrelated database tables.

### Create and Download the Snapshot

1. Enable Data Snapshot and start or rebuild the Admin Dashboard.
2. Log in with an account that has the `admin` role.
3. Open **Data Snapshot** from the Admin Dashboard navigation.
4. Select **Create Snapshot**.
5. Review the reported playlist, show, and thumbnail counts.
6. Select **Download Snapshot** and save the ZIP securely.

The Admin creates both a private server-side snapshot and a downloadable ZIP. With the standard runtime layout, they are stored beneath:

```text
temp/data-snapshots/
```

The snapshot uses a UTC timestamp in its name:

```text
freetv-content-snapshot-YYYYMMDDTHHMMSSZ
```

The downloaded archive uses the same name with the `.zip` extension.

### Snapshot Contents

A valid snapshot archive has one top-level directory:

```text
freetv-content-snapshot-YYYYMMDDTHHMMSSZ/
├── manifest.json
├── playlists.json
├── playlist_shows.json
├── thumbs-manifest.json
└── thumbs/
    └── tt*.jpg
```

The snapshot contract requires:

* `format_version` equal to `1`;
* canonical UTC capture timestamps;
* playlist, show, and thumbnail counts that match the captured content;
* sorted and unique thumbnail paths;
* lowercase SHA-256 digests and byte sizes for captured files;
* no missing or unexpected archive entries; and
* no unsafe paths or symbolic links.

The ZIP is verified before the Admin makes it available for download.

> [!NOTE]
> The Data Snapshot status page provides a quick comparison between the recorded official dataset and current production playlist/show counts. That status view does not detect deleted shows or thumbnail changes. Use the Tooling CLI comparison for the complete reconciliation report.

### Snapshot Handling

A snapshot represents the Admin environment during a capture window. Its manifest records both when capture began and when it completed.

Keep the downloaded ZIP unchanged. Tooling validates its directory name, timestamps, contents, counts, sizes, and SHA-256 metadata before accepting it.

Treat snapshots as private operational artifacts. Although authentication tables and credentials are excluded, snapshots contain the complete playlist/show records and thumbnail collection from the captured Admin environment.