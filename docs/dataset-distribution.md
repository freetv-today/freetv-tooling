# Dataset Publishing and Distribution

This document describes FreeTV’s advanced canonical-dataset and First Run release-package workflows.

These workflows are intended for the FreeTV project maintainer or another operator who wants to maintain and distribute a complete FreeTV dataset from their own repository or hosting environment. They are not required for ordinary Admin Dashboard or Viewer development.

Most administrators only need to organize content in the FreeTV Admin Dashboard and use **Publish** to export static JSON for their Viewer. That normal Viewer-publication workflow is documented in the [`freetv-server` README](https://github.com/freetv-today/freetv-server#publishing).

> [!IMPORTANT]
> FreeTV Tooling prepares and validates files locally. It does not commit changes, push to GitHub, create GitHub releases, upload release packages, update a remote server, or deploy FreeTV. Those remain deliberate operator actions.

The v3 dataset validation and release contracts are specific to the official FreeTV dataset. An operator can mirror that dataset and distribution pipeline, but publishing an independently structured white-label dataset would require adapting the validation and packaging contracts. Simplified white-label support is planned for a future FreeTV release.

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
- a MariaDB account that can read the configured FreeTV database and create and drop the disposable `freetv_test_*` databases used by the SQL restore-validation gate.

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

## Comparing a Snapshot

Use `content:compare` to compare a captured Data Snapshot with the canonical dataset in the configured local `freetv-data` repository.

The comparison is read-only. It does not modify the snapshot, `freetv-data`, MariaDB, thumbnails, or any Git repository.

From `freetv-tooling`, run:

```bash
npm run content:compare -- <snapshot-directory-or-zip>
```

For example:

```bash
npm run content:compare -- /path/to/freetv-content-snapshot-20260828T192021Z.zip
```

The command accepts either:

* the downloaded snapshot ZIP; or
* the unmodified top-level snapshot directory extracted from that ZIP.

Comparing a ZIP requires the `unzip` command to be available on the system path.

Tooling resolves the canonical dataset through `repos.data` in `config/paths.json`. It validates both inputs before comparing them, including the snapshot structure, timestamps, counts, file sizes, SHA-256 digests, and safe-path rules.

### Comparison Identity

The comparison uses stable content identifiers rather than MariaDB row IDs:

| Content   | Logical identity                                   |
| --------- | -------------------------------------------------- |
| Playlist  | Playlist filename                                  |
| Show      | Playlist filename plus Internet Archive identifier |
| Thumbnail | Thumbnail filename                                 |

Database-only numeric IDs, foreign-key IDs, and record timestamps are not treated as canonical content identity.

### Compared Fields

For playlists, Tooling compares:

* `dbtitle`
* `dbversion`
* `author`
* `email`
* `link`
* default-playlist status
* playlist order

Legacy `lastupdated` values are excluded because they represent publication and provenance state rather than canonical dataset content.

For shows, Tooling compares:

* category
* active or disabled status
* title
* description
* start year
* end year
* IMDb ID
* group name

A show’s order within a playlist is excluded from canonical equality because `playlist_shows.sort_order` is treated as legacy storage/bootstrap state.

Thumbnails are compared by filename and complete-file SHA-256 digest.

### Reading the Report

For playlists, shows, and thumbnails, the report groups differences into:

| Result          | Meaning                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| Production only | Present in the captured Admin snapshot but absent from local `freetv-data`.          |
| Local only      | Present in local `freetv-data` but absent from the captured Admin snapshot.          |
| Changed         | The same logical item exists in both places, but one or more compared fields differ. |

The report includes:

* aggregate counts for each difference category;
* counts grouped by changed field;
* counts of records differing by only one field; and
* detailed production and local values for each changed record.

If the declared counts in the local `freetv-data/manifest.json` do not match its actual files and records, the report includes metadata warnings.

When no content differs, the report ends with:

```text
No content differences found.
```

> [!IMPORTANT]
> Differences are findings for operator review, not command failures. `content:compare` can exit successfully while reporting production-only, local-only, or changed content. A nonzero exit indicates that the command arguments or one of the inputs could not be safely read or validated.

Review every unexpected difference before continuing. This comparison does not decide which side is correct and does not reconcile either side automatically.

## Validating a Dataset

Run the mandatory dataset validation gate before publishing changes to `freetv-data`.

From `freetv-tooling`, run:

```bash
npm run data:validate
```

This command does not accept a snapshot argument. It validates fresh artifacts generated from the MariaDB database and thumbnail directory configured for the local `freetv-server` environment.

### Validation Process

Tooling performs these operations:

1. Create a temporary validation workspace beneath the configured Tooling staging directory.
2. Export current Viewer configuration and playlist JSON from MariaDB.
3. Export the current thumbnails.
4. Validate the export manifests, counts, file sizes, SHA-256 digests, paths, and contents.
5. Generate six SQL packages:

   * schema with database creation;
   * schema tables only;
   * complete dataset with database creation;
   * complete dataset tables only;
   * sample dataset with database creation; and
   * sample dataset tables only.
6. Cross-check the Viewer export counts against the generated SQL package counts.
7. Restore every SQL package into a uniquely named disposable MariaDB database.
8. Validate the restored schema, records, defaults, relationships, ordering, and sample-data requirements.
9. Confirm that each create-database package is logically equivalent to its corresponding tables-only package.
10. Drop the disposable validation databases and remove the temporary validation workspace.

The disposable databases use names matching:

```text
freetv_test_<package>_<form>_<random-suffix>
```

The validator restricts database names to this pattern before creating or dropping them.

### Database Safety Boundary

SQL generation reads the configured FreeTV database but does not modify it. Admin users, problem reports, report IPs, and locally configured application-setting values are not serialized into the distributable data packages.

SQL restore validation does create and drop separate disposable databases. The configured MariaDB account must therefore have permission to:

* read the source FreeTV database;
* create databases;
* create tables and other schema objects within the disposable databases;
* read the restored schema and records; and
* drop the disposable databases after validation.

The validation process does not intentionally create, replace, or drop the configured source database.

> [!CAUTION]
> Do not run the validation gate with database credentials that can affect unrelated databases unless their privileges are appropriately constrained. The code restricts its generated database names, but database permissions remain an operator responsibility.

### Validation Results

A successful run reports:

```text
GO — Dataset is safe to publish
```

The report includes playlist, complete-show, sample-show, and thumbnail counts and confirms that these checks passed:

* Viewer exports
* SQL generation
* SQL restores
* package-pair equivalence
* cross-checks

It ends with:

```text
No dataset was published.
```

A failed run reports:

```text
NO GO — Dataset is not safe to publish
```

and exits with a nonzero status.

A cleanup failure also makes the validation fail. Review any retained temporary state or disposable database reported by the command before running it again.

### What Validation Does Not Do

`data:validate` does not:

* use or modify the previously captured Data Snapshot;
* update `freetv-data`;
* replace the canonical SQL files in `freetv-server`;
* commit or push Git changes;
* build First Run release ZIPs;
* upload anything; or
* deploy FreeTV.

The separately captured snapshot establishes the production state being reconciled. The validation gate establishes that fresh artifacts generated from the current local Admin environment satisfy the dataset publication contract.

## Publishing the Canonical Dataset

After reviewing the snapshot comparison and receiving a `GO` result from dataset validation, publish the current local Admin data to the configured `freetv-data` repository.

From `freetv-tooling`, run:

```bash
npm run data:publish -- --snapshot=<PATH>
```

For example:

```bash
npm run data:publish -- --snapshot=/path/to/freetv-content-snapshot-20260828T192021Z.zip
```

The command requires exactly one `--snapshot=<PATH>` argument. The path may identify either a valid snapshot ZIP or its unmodified top-level snapshot directory.

Do not store the reconciliation snapshot inside `freetv-data`. Tooling rejects snapshots that overlap the canonical dataset repository.

> [!IMPORTANT]
> Supplying a snapshot records which production capture the operator reconciled before publication. `data:publish` validates the snapshot but does not rerun `content:compare` or require the snapshot and generated dataset to be identical. Reviewing and resolving the comparison report remains an operator responsibility.

### Publication Process

`data:publish` performs these operations:

1. Validate and load the supplied Data Snapshot.
2. Run the mandatory dataset validation gate again.
3. Generate a fresh set of Viewer exports, thumbnails, and SQL packages from the configured local Admin environment.
4. Build a complete publication candidate in Tooling-owned temporary staging.
5. Record the supplied snapshot name and capture timestamp as publication provenance.
6. Validate the candidate’s exact files, manifests, logical counts, byte sizes, and SHA-256 digests.
7. Prepare a publication transaction inside the local `freetv-data` repository.
8. Back up the existing managed paths within that temporary transaction.
9. Promote the new managed paths into `freetv-data`.
10. Remove the temporary transaction and validation staging after success.

The validation gate is rerun even if `npm run data:validate` was run separately. The standalone command provides an explicit checkpoint for operator review; the internal gate prevents publication from proceeding without a current successful validation.

Avoid changing the Admin database or thumbnail directory while publication is running.

### Managed Canonical Paths

Publication replaces only these managed paths in `freetv-data`:

```text
config.json
playlists/
thumbs/
freetv_mariadb_schema-create-db.sql
freetv_mariadb_schema-tables-only.sql
freetv_mariadb_full-create-db.sql
freetv_mariadb_full_data-tables-only.sql
freetv_mariadb_sample-create-db.sql
freetv_mariadb_sample_data-tables-only.sql
manifest.json
```

Other files in the repository, including its README, license, and Git metadata, are not part of the publication transaction.

The publication candidate must contain the exact managed file set. Missing, duplicate, unexpected, unsafe, or symbolic-link entries cause publication to fail.

### Publication Manifest

The generated `freetv-data/manifest.json` records:

* publication format version;
* dataset generation timestamp;
* reconciled snapshot name;
* reconciled snapshot capture timestamp;
* playlist count;
* complete show count;
* sample show count; and
* thumbnail count.

The snapshot information is provenance: it identifies the production capture reviewed by the operator before publication. The published Viewer and SQL artifacts are generated from the current local Admin environment, not copied from the snapshot.

### Local Transaction and Rollback

Tooling performs promotion through a temporary directory named like:

```text
.freetv-publication-<transaction-id>
```

This directory is created inside `freetv-data` and contains prepared replacements and temporary backups of the previous managed paths.

If promotion fails and rollback succeeds, Tooling restores the previous managed content and removes the transaction directory.

If rollback is incomplete, Tooling retains the transaction directory and reports its location. Stop and inspect that recovery state before making changes or running publication again.

Tooling refuses to start a new publication while an unresolved `.freetv-publication-*` directory exists in `freetv-data`.

If all managed paths were promoted but transaction or staging cleanup fails, the dataset may already have been updated even though the command exits with an error. Read the complete error message and inspect both `freetv-data` and the reported temporary path before retrying.

> [!CAUTION]
> The successful transaction backup is temporary and is deleted after publication. Review the resulting Git diff before committing. Git history or a separate operator backup remains the durable recovery mechanism after a successful publication.

### Successful Publication

A successful run reports:

```text
Dataset published locally to freetv-data
```

The result includes playlist, complete-show, sample-show, thumbnail, and thumbnail-byte counts and reports the updated local repository path.

After publication:

1. Review the complete `freetv-data` Git diff.
2. Confirm that only the expected managed paths changed.
3. Run any desired repository checks.
4. Commit and push the changes manually when satisfied.

Publication does not:

* commit or push the `freetv-data` changes;
* create a GitHub release;
* build the Current Sample or Current Official release ZIPs;
* upload files;
* update dataset-package metadata; or
* deploy FreeTV.

