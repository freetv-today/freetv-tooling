# CLI command contracts

The interactive CLI invokes the existing command functions and preserves these safety boundaries.

| Command | Kind | Inputs and gate | Durable mutation / confirmation policy |
|---|---|---|---|
| `status` | finite, read-only | none | no confirmation |
| `content:compare` | finite, read-only | one snapshot path | no confirmation |
| `verify` | finite, read-only | assembled production directory | no confirmation |
| CLI development launch | detached terminal request | supported graphical terminal and validated selection | returns after the terminal process is spawned; never shares or manipulates Clack input |
| `dev:*` | long-running | selected configured ports; port preflight mandatory; Viewer selections prepare managed development data | the development terminal owns cancellation through the existing supervisor; shutdown never cleans Viewer data |
| `build:viewer`, `build:admin` | finite | configured repository | confirmation recommended because build output changes |
| `stage:exports` | finite, disposable staging | Admin exporters | no durable publication claim |
| `assemble` | finite, transactional | validated staged exports | confirmation recommended; report retained recovery state |
| `data:validate` | finite, read-only validation | configured database and repositories | mandatory before publication |
| `data:publish` | finite, durable transaction | exactly one `--snapshot=PATH`; validation gate mandatory | explicit confirmation required |
| `release:build` | finite, durable package replacement | validated current Data | explicit confirmation required |
| `clean:thumbs` | finite | dry-run by default; `--apply` mutates | explicit confirmation before `--apply` |
| `dev:install-viewer-data` | finite, recoverable replacement | validated Data and Viewer repositories | explicit confirmation required in the CLI |
| `dev:clean-viewer-data` | finite, destructive cleanup | exact Tooling ownership marker | explicit confirmation required |

The CLI currently exposes development, local application builds, the canonical `build:all` production workflow,
individual export/assembly/verification steps, Dataset validation/comparison/publication/release operations, and
the complete Cleanup Tools category.

Development navigation offers all services, Viewer only, Admin and PHP together, and independently installing
Viewer development data. Only selected ports are checked for development launches.
Each development launch selection starts the existing Node development entry point in a separate terminal and immediately restores
the Clack menu. A successful terminal launch is not a claim that service startup succeeded; port, data-preparation,
and process diagnostics remain in the development terminal. Ctrl+C there is handled by the existing supervisor and
does not signal the Clack process. No shared-terminal fallback is permitted when graphical terminal launch fails.
Viewer-containing workflows automatically install development data only when all managed destinations are absent,
reuse a complete valid Tooling-managed installation, and refuse partial, unmarked, symlinked, invalidly marked, or
interrupted transaction state. Admin/PHP-only workflows do not touch Viewer data. Cleanup remains a separate,
explicit operation after normal shutdown, startup failure, or unexpected service failure.
Production builds, export staging, assembly, publication, and release generation require confirmation; read-only
verification, validation, and comparison do not. Snapshot paths are always entered explicitly for comparison and
publication, and publication confirmations default to No.

Thumbnail cleanup is a dry run unless `--apply` is explicitly selected and confirmed. Viewer development-data
installation and removal require confirmation, but confirmation does not bypass source validation, symlink refusal,
the exact Tooling ownership marker, unmarked-content protection, interrupted-transaction refusal, or retained
recovery-state diagnostics. The CLI does not directly traverse or delete Viewer data.

Release promotion, Data publication, and Admin SQL synchronization use stale-transaction refusal rather than atomic concurrency claims. The CLI must serialize these commands and must not offer parallel execution. A command may report success only after its complete contract finishes; follow-up cleanup or synchronization failures must retain and report their partial-success state.

CLI operations are awaited and serialized only within one interactive session; this is not a global cross-process
lock. Finite commands retain their existing cancellation behavior, and the CLI does not claim process-tree
cancellation for an operation already in progress.
