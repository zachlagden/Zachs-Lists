# Default list sync

The default lists are built from a source config and a whitelist stored in MongoDB, in the `system_config` document `default_config`. With sync switched on, those two texts come from another repository, [zachlagden/Pi-hole-Optimized-Blocklists](https://github.com/zachlagden/Pi-hole-Optimized-Blocklists), and this site's worker builds them. List names, formats and URLs are the same with sync on or off.

## What a sync does

`backend/app/services/default_sync.py` runs these steps:

1. It asks the GitHub API for the ten newest commits on `main` that touch `lists/`, sending the ETag of the last successful check. A 304 answer ends the check.
2. It takes the newest of those commits whose author is `github-actions[bot]` and whose message starts with `DEFAULT_SYNC_COMMIT_PREFIX`. That commit is a published build of the other repository. Commits on `main` after it can hold config changes that have not been built, so `main` itself is never read.
3. If the commit is the one already stored, the check ends. Otherwise it fetches `blocklists.conf` and `whitelist.txt` at that commit from `raw.githubusercontent.com`. Each response is capped at 1 MB.
4. It rewrites the whitelist. In the other repository a bare entry allows the domain and its subdomains. Here that meaning is written `@@domain`, so every bare entry gets the `@@` prefix. Wildcard, regex, comment, blank and `@@` lines are kept as they are, in the same order.
5. It validates the source config with the site's own validator and the rewritten whitelist with the worker binary.
6. It refuses a config with fewer than half the sources stored now, unless the sync was forced.
7. It writes the result in one update: `blocklists`, `whitelist`, `revision` plus one, and a `source` block with the repository, commit SHA and date, the SHA-256 of each fetched file, the sync and check times, the ETag and the last error. When the files are the same as the stored ones, only the commit, the ETag and the check time move.

The stored source config keeps the other repository's `main` URLs for its own `custom/*.txt` files, because users copy the stored text as a template. When a default build is admitted, those URLs are rewritten in the job's snapshot to the synced commit, so the build reads the files of that published build.

## Settings

| Variable                     | Default                                   | Meaning                                                                                   |
| ---------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DEFAULT_SYNC_ENABLED`       | `false`                                   | Switches sync on.                                                                         |
| `DEFAULT_SYNC_REPO`          | `zachlagden/Pi-hole-Optimized-Blocklists` | The repository to read, as `owner/name`.                                                  |
| `DEFAULT_SYNC_COMMIT_PREFIX` | `Weekly blocklist update`                 | The start of a published build's commit message.                                          |
| `GITHUB_TOKEN`               | unset                                     | Optional. Sent to `api.github.com` only, to raise the API rate limit. It needs no scopes. |

Without a token the GitHub API allows 60 requests an hour for each IP address. A check makes one API request, so the hourly check uses one of the 60. A 304 answer counts against the limit unless the request carries a token.

## Schedule

All times are UTC.

- Every hour at minute 15, a sync check runs. If it finds a new published build, it requests a default build. On Sunday before 06:30 it leaves the build to the weekly rebuild.
- Sunday 06:30, the weekly default rebuild runs a sync and then always requests a default build.
- Sunday 07:30, the weekly user rebuilds are queued.

The other repository publishes on Sunday, usually between 03:00 and 05:00, and sometimes on other days by hand.

With sync off, the hourly check does nothing and the weekly default rebuild builds the stored config.

## Admin

With sync on, the default config tab of the admin page shows the two texts read-only, with the synced commit, the sync and check times, the last error and a "Sync now" button. `PUT /api/admin/default/config` answers 409 with code `default_config_managed`.

- `GET /api/admin/default/sync` returns the sync status.
- `POST /api/admin/default/sync` runs a sync now. It ignores the stored ETag and fetches both files again. The body `{"force": true}` also accepts a config with fewer than half the stored sources. It requests a default build when the config or the commit changed. The route allows 6 requests an hour.

## Failures

A failed sync changes nothing except `source.last_error` and `source.last_checked_at`. The stored config stays, and builds keep using it. The next check tries again, because the ETag is only stored after a successful check. These fail a sync:

- GitHub cannot be reached, answers with an error status or redirects the API request.
- None of the ten newest commits under `lists/` is a published build.
- A file is larger than 1 MB or is not UTF-8.
- The source config or the rewritten whitelist fails validation.
- The worker binary cannot be run to check the whitelist.
- The source count fell below half and the sync was not forced.

A build request that is refused because a default build is already active is logged and not retried. The running build may have started before the sync, so the new config is built at the next change or weekly rebuild, or by "Rebuild Default Lists" on the admin page.

## Switching it on and off

To switch on, set `DEFAULT_SYNC_ENABLED=true` on the application and redeploy. The first hourly check, or "Sync now" on the admin page, replaces the stored default config and whitelist with the other repository's and requests a build. Back up the `system_config` collection first, because the replaced texts are not kept.

To switch off, unset the variable and redeploy. The stored config stays as last synced and the admin editor accepts edits again. Builds stop pinning the other repository's files to a commit. If the config is edited by hand and sync is later switched back on, use "Sync now" to restore the synced text, because an hourly check changes nothing until the other repository publishes again.
