# Local development

This guide runs the Flask API and the Vite frontend against a throwaway MongoDB filled with fictional data. It needs no GitHub OAuth app and no Rust worker. A seed script creates the accounts, jobs and published lists, and a replay script writes build progress into a job the way the worker does.

Run every command from the repository root.

## Prerequisites

- Docker, for the MongoDB container.
- [uv](https://docs.astral.sh/uv/), for Python 3.12 and the backend packages.
- Node 22 and pnpm 10, for the frontend.
- Rust, only if you want to run real builds or save a whitelist. See [What needs the worker](#what-needs-the-worker).

## Environment variables

Export these in every terminal that runs Flask or one of the scripts.

```sh
export FLASK_ENV=development
export SECRET_KEY=dev-secret-key-change-in-production
export MONGO_URI=mongodb://127.0.0.1:27030/zachs_lists_dev
export DATA_DIR=/tmp/zl-dev-data
export FRONTEND_URL=http://localhost:5173
export DEFAULT_SYNC_ENABLED=false
export RATELIMIT_DEFAULT="10000 per hour"
export PYTHONPATH=backend
```

| Variable               | Why it is set                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLASK_ENV`            | Selects the development config, which turns on debug mode and lets the session cookie travel over plain HTTP. Both scripts refuse to run unless it is `development`.                                |
| `SECRET_KEY`           | Signs the session cookie. This is the default the development config falls back to. Flask and the seed script must use the same value, or the printed cookies are rejected.                         |
| `MONGO_URI`            | Points Flask and the scripts at the throwaway container. Flask's own default is `mongodb://localhost:27017/pihole_lists`. The scripts refuse any host other than `localhost`, `127.0.0.1` or `::1`. |
| `DATA_DIR`             | Holds the generated list files. Flask's own default is `./data`, relative to the directory it starts in.                                                                                            |
| `FRONTEND_URL`         | The only origin allowed by CORS and by Socket.IO. It must match the address the browser shows.                                                                                                      |
| `DEFAULT_SYNC_ENABLED` | `false` stops the hourly default list sync from calling `api.github.com`. It is also off when unset.                                                                                                |
| `RATELIMIT_DEFAULT`    | Raises the default limit of 100 requests per hour per route, which a browser being reloaded during development soon reaches.                                                                        |
| `PYTHONPATH`           | Lets Python import the `app` package from `backend/`.                                                                                                                                               |

`backend/wsgi.py` loads a `.env` file from the repository root if one exists. Exported variables take precedence over it, so the values above win.

Optional settings:

- `ENFORCE_DOMAIN_LIMIT=true` makes a replayed build that is over the domain limit fail instead of completing with a warning.
- `WORKER_BIN` is the path to a built worker binary. See [What needs the worker](#what-needs-the-worker).
- `ROOT_GITHUB_ID=1000002` makes the seeded admin, `sam`, the root user.

No setting turns the scheduler off. In development it does three things worth knowing about:

- Every minute it puts back in the queue any processing job whose heartbeat is over two minutes old. The seeded processing job carries a heartbeat a year ahead, so it stays as seeded.
- On Sundays at 06:30 and 07:30 UTC it queues a rebuild of the default lists and of every account that has a configuration and no active build. With no worker running, those jobs stay queued until you replay them or run the seed again.
- Daily at 04:00 UTC it deletes finished jobs over 30 days old. The seeded jobs are at most eight days old.

## Start the throwaway MongoDB

```sh
docker run -d --rm --name zl-dev-mongo -p 127.0.0.1:27030:27017 mongo:7
```

The container has no volume and no authentication, so the port is published on the loopback address only. Stopping the container deletes its data.

## Install the backend packages

```sh
uv venv .venv && uv pip install -r backend/requirements-dev.txt
```

## Seed the database

```sh
uv run --no-project python backend/scripts/dev_seed.py
```

Each run drops the database named in `MONGO_URI`, rebuilds the `users` and `default` directories under `DATA_DIR`, and prints one line per account to standard output:

```text
alex	session=<value>
sam	session=<value>
jo	session=<value>
```

The script refuses to clear a `DATA_DIR` that holds files it did not create.

What it creates:

| Item           | Contents                                                                                                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alex`         | A regular account with eight sources, a whitelist, six published lists and a limit raised to 10,000,000 by an approved request. Its jobs are two completed scheduled builds, one skipped build, one failed build over the domain limit and one build in mid download. |
| `sam`          | An admin with three sources, four published lists and two completed builds.                                                                                                                                                                                           |
| `jo`           | A regular account over the domain limit, with an open limit review, an unread notification and a pending limit request.                                                                                                                                               |
| Other accounts | Thirty regular accounts with no configuration, among them `casey`, which is disabled, and `dana`, which is banned, and a second admin, `robin`. They fill the admin user list and print no cookie.                                                                    |
| Default lists  | A default configuration, six published lists and one completed build.                                                                                                                                                                                                 |
| Shared content | Three active announcements, one for each type, and one inactive. Ten library entries. One featured list. Thirty days of download analytics for alex's lists and the default lists. Cache metadata with a domain count for every library source.                       |

Every name, address and source is fictional. Sources are on `lists.example.org`, which serves no lists.

Each published list file holds a few hundred sample domains. The domain counts in the manifest and the database are in the millions, so that the interface shows realistic figures. File sizes are the real sizes of the sample files.

A cookie lasts seven days. To print fresh cookies without changing any data:

```sh
uv run --no-project python backend/scripts/dev_seed.py --cookies-only
```

Running the full seed again creates new account ids, so cookies from an earlier run stop working. Signing out in the interface ends every session of that account, and `--cookies-only` then prints a cookie that works.

## Run Flask

Socket.IO needs the gevent WebSocket worker, the same one production uses. `docker/gunicorn.conf.py` selects it. The command below binds to both loopback addresses on port 5000, where the Vite proxy expects it.

```sh
uv run --no-project gunicorn --config docker/gunicorn.conf.py \
  --bind 127.0.0.1:5000 --bind '[::1]:5000' --chdir backend wsgi:app
```

In debug mode the log includes every MongoDB command, several lines a second. To hide those lines:

```sh
uv run --no-project gunicorn --config docker/gunicorn.conf.py \
  --bind 127.0.0.1:5000 --bind '[::1]:5000' --chdir backend wsgi:app 2>&1 \
  | grep --line-buffered -v ' - pymongo\.'
```

Gunicorn does not reload on code changes. Stop it with Ctrl-C and start it again after editing the backend.

`GET http://localhost:5000/health` returns 503 with `no build workers alive` unless a worker or a replay is running. That is expected.

## Run Vite

```sh
pnpm --dir frontend install
pnpm --dir frontend dev
```

Vite serves the frontend on `http://localhost:5173` and proxies `/api`, `/socket.io`, `/lists/` and `/u/` to `http://localhost:5000`. Set `BACKEND_URL` before starting Vite to proxy to Flask on another address. Open the site as `localhost`, not `127.0.0.1`, so the origin matches `FRONTEND_URL`.

## Sign in without GitHub

The seed script prints a signed session cookie for each account. Put one in the browser and the API treats the browser as that account.

In a desktop browser, open `http://localhost:5173`, then run this in the developer console and reload the page:

```js
document.cookie = 'session=<value>; path=/';
```

In a headless browser driven by Playwright:

```js
const { chromium } = require('playwright-core');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addCookies([{ name: 'session', value: '<value>', domain: 'localhost', path: '/' }]);
const page = await context.newPage();
await page.goto('http://localhost:5173/dashboard');
```

With `curl`:

```sh
curl -b 'session=<value>' http://localhost:5000/api/auth/me
```

The "Sign in with GitHub" route does not work unless `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set.

## Replay a build

`backend/scripts/dev_replay_build.py` plays a build into a job document. It claims the job as a worker, then writes progress through the downloading, whitelist and generation stages. Each write is fenced on the claim and raises the job's `rev`, exactly as the worker's writes are. Flask relays every change to browsers as `job:progress` and `job:completed` events.

```sh
uv run --no-project python backend/scripts/dev_replay_build.py --create
```

| Option            | Default     | Meaning                                                                              |
| ----------------- | ----------- | ------------------------------------------------------------------------------------ |
| `--username`      | `alex`      | The account whose build is replayed.                                                 |
| `--create`        | off         | Queue a manual build when the account has no active one. It charges no weekly quota. |
| `--step-seconds`  | `1.0`       | The pause between writes. A full build takes about 25 steps.                         |
| `--outcome`       | `completed` | `completed`, `failed` or `skipped`.                                                  |
| `--error-code`    | none        | With `--outcome failed`, the error code the build ends with. See the list below.     |
| `--sources`       | `0`         | Pad the build with made-up sources up to this many, to exercise a long source table. |
| `--queue-seconds` | `0`         | Leave the build queued for this long before the replay claims it.                    |

Which job it takes:

- A queued job, such as one started with the Build button, is claimed and replayed. Without `--create` this is the only kind it accepts when no build is active.
- A processing job left by the seed or by an interrupted replay is put back in the queue and replayed from the start. This is what happens to alex's seeded build, so `--create` on a fresh seed replays that job and adds no new one.
- A processing job held by a real worker is left alone, and the script exits with an error.

What each outcome does:

- `completed` serves the first source from the cache, marks the third as stale and fails the fourth. It writes a new generation directory under `DATA_DIR`, moves the account's published lists and stats to it, and completes the job with a full result.
- `failed` fails every source, and the job ends with the error code `all_sources_failed`. `--error-code` picks another ending:
  - `invalid_config`, `no_sources` and `superseded` end the build before any source is downloaded.
  - `internal` and `worker_abandoned` end it part of the way through the downloads.
  - `no_domains` ends it after the downloads.
  - `domain_limit_exceeded` ends it after the whitelist, whether or not `ENFORCE_DOMAIN_LIMIT` is set. When the build is within the account's limit, the result reports a limit of 80% of the measured domains.
- `skipped` downloads every source from the cache, and the job ends skipped with the reason "Nothing changed since the last build".

When the job ends, Flask refunds the weekly quota where the real rules say so and updates the account's limit review from the result. For `jo`, a completed replay drops the failed source's category, which brings the lists under the limit and resolves the open review.

While it runs, the replay registers itself as a live worker, so `/health` returns 200. Stopping it with Ctrl-C puts the job back in the queue.

Run the seed script again to return to the starting state.

## What needs the worker

Three things call the Rust worker and do nothing useful without it:

- Real builds. A job queued from the interface stays queued until a worker or the replay script takes it.
- Saving a whitelist. Flask runs the worker binary to check the patterns and returns 503 when it cannot.
- `/health`, which reports 503 while no worker is alive.

To build the worker and point Flask at it:

```sh
cargo build --release --manifest-path rust-worker/Cargo.toml
export WORKER_BIN="$PWD/rust-worker/target/release/blocklist-worker"
```

A real worker fails every build of the seeded configurations, because the seeded sources do not exist.

Validating a configuration in the editor sends real HTTP requests to each source address. For the seeded sources the result is one warning per source, "Could not reach source during validation", and the configuration can still be saved.

## Stop and clean up

Stop Flask and Vite with Ctrl-C, then remove the database and the generated files:

```sh
docker stop zl-dev-mongo
rm -rf /tmp/zl-dev-data
```

## Frontend

The frontend is React 19, React Router 7, TanStack Query 5, Zustand 5 and Tailwind CSS 4, built
with Vite. Run its checks from the repository root:

```sh
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend lint
pnpm --dir frontend test
pnpm --dir frontend build
```

### Where things live

| Path                             | Holds                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| `frontend/src/styles/tokens.css` | The colour tokens for the dark and light themes                         |
| `frontend/src/styles/index.css`  | The Tailwind theme built from the tokens, and the base styles           |
| `frontend/src/components/ui/`    | The shared components                                                   |
| `frontend/src/components/shell/` | The signed-in shell, the public shell and the navigation                |
| `frontend/src/router.tsx`        | Every route, loaded lazily                                              |
| `frontend/src/api/`              | One module per resource: query keys, fetch functions and response types |
| `frontend/src/realtime/`         | Live job events and the bridge that writes them into the query cache    |
| `frontend/src/lib/format.ts`     | Number, size, duration and date formatting                              |
| `frontend/src/pages/dashboard/`  | The dashboard, which is the reference for a rebuilt page                |
| `docs/design/ui-preview/`        | The approved static design                                              |

With Vite running, `http://localhost:5173/dev/components` shows every shared component in every
state in both themes. The route exists only in development builds.

### Building a page

1. Read data with `useQuery` and a query helper from `frontend/src/api/`, such as
   `useQuery(userListsQuery())`. Do not fetch in `useEffect`. Change data with `useMutation`, then
   invalidate the matching key.
2. Show an error with `describeApiError(error, fallback)` from `frontend/src/api/errors.ts`. It
   uses the server's `error` text and adds the wait from `Retry-After` when the request was rate
   limited.
3. Read jobs from `jobsQuery()`. The signed-in shell subscribes to live job events once and writes
   them into that query, so a page that reads it updates without its own socket code.
4. Keep rules that decide what the page says in a plain module beside the page, with a Vitest
   file, as `dashboardFacts.ts` does.
5. Build the page from the components in `frontend/src/components/ui/` and the Tailwind theme
   colours such as `bg-surface`, `text-text-secondary` and `border-border`. Use the `narrow:`
   variant for 820 px and below and `compact:` for 1080 px and below.

### Checking a page in a headless browser

Sign in with a seeded cookie as shown above, then load the page at 1440 px and 390 px wide in both
themes. The theme is stored in `localStorage` under `zl-theme` as `light` or `dark`. For an
accessibility scan, inject `frontend/node_modules/axe-core/axe.min.js` with
`page.addScriptTag({ path })` and run `axe.run()` in the page.
