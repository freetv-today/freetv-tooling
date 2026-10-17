# CLI command contracts

The future interactive CLI must invoke the existing command functions and preserve these safety boundaries.

| Command | Kind | Inputs and gate | Durable mutation / confirmation policy |
|---|---|---|---|
| `status` | finite, read-only | none | no confirmation |
| `content:compare` | finite, read-only | one snapshot path | no confirmation |
| `verify` | finite, read-only | assembled production directory | no confirmation |
| `dev:*` | long-running | configured ports; port preflight mandatory | cancellation must use the development supervisor |
| `build:viewer`, `build:admin` | finite | configured repository | confirmation recommended because build output changes |
| `stage:exports` | finite, disposable staging | Admin exporters | no durable publication claim |
| `assemble` | finite, transactional | validated staged exports | confirmation recommended; report retained recovery state |
| `data:validate` | finite, read-only validation | configured database and repositories | mandatory before publication |
| `data:publish` | finite, durable transaction | exactly one `--snapshot=PATH`; validation gate mandatory | explicit confirmation required |
| `release:build` | finite, durable package replacement | validated current Data | explicit confirmation required |
| `clean:thumbs` | finite | dry-run by default; `--apply` mutates | explicit confirmation before `--apply` |
| `dev:install-viewer-data` | finite, recoverable replacement | validated Data and Viewer repositories | confirmation recommended |
| `dev:clean-viewer-data` | finite, destructive cleanup | exact Tooling ownership marker | explicit confirmation required |

Release promotion, Data publication, and Admin SQL synchronization use stale-transaction refusal rather than atomic concurrency claims. The CLI must serialize these commands and must not offer parallel execution. A command may report success only after its complete contract finishes; follow-up cleanup or synchronization failures must retain and report their partial-success state.
