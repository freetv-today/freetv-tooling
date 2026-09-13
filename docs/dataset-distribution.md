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
- readable Viewer data;
- readable thumbnails;
- PHP CLI and the PHP extensions required by `freetv-server`; and
- sufficient database privileges to generate and restore the SQL packages used by the validation gate.

Run the Tooling test suite and confirm the configured repository paths before beginning:

```bash
npm test
npm run status
````

## Enabling Data Snapshot

Data Snapshot is an advanced Admin-only feature and is hidden from the Admin Dashboard navigation by default.

Set this Vite frontend variable when running or building the Admin Dashboard:

```dotenv
VITE_ENABLE_DATA_SNAPSHOT=true
```

The value must be exactly `true`. Other values leave the navigation item hidden.

After changing a Vite environment variable, restart the Admin development server or rebuild the Admin production frontend.

The flag controls whether the Data Snapshot navigation item is displayed; it is not the authorization boundary. The snapshot API independently requires an authenticated user with the `admin` role.