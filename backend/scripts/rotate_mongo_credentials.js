const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const crypto = require('node:crypto');
const api = `http://coolify:8080/api/v1/applications/${encodeURIComponent(input.application_uuid)}/envs`;

async function request(method, data) {
  const response = await fetch(api, {
    method,
    headers: {
      Authorization: `Bearer ${input.api_token}`,
      'Content-Type': 'application/json',
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Environment API request failed');
  return response.json();
}

async function rotate() {
  try {
    const rows = await request('GET');
    const row = rows.find((value) => value.key === 'MONGO_URI' && !value.is_preview);
    if (!row) throw new Error('Application database environment variable is missing');
    const original = new URL(row.value);
    if (original.protocol !== 'mongodb:' || original.hostname !== input.database_host) {
      throw new Error('Unexpected database destination');
    }
    const database = original.pathname.slice(1);
    const authDatabase = original.searchParams.get('authSource') || database;
    const previousUser = decodeURIComponent(original.username);
    if (!database || !authDatabase || !previousUser)
      throw new Error('Invalid database configuration');
    const admin = new Mongo('mongodb://127.0.0.1:27017').getDB('admin');
    const authenticated = await admin.auth(
      process.env.MONGO_INITDB_ROOT_USERNAME,
      process.env.MONGO_INITDB_ROOT_PASSWORD,
    );
    if (!authenticated) throw new Error('Database administrator authentication failed');
    const auth = admin.getSiblingDB(authDatabase);
    if (await auth.getUser(input.new_username))
      throw new Error('Rotation user already exists; review before retry');
    const password = crypto.randomBytes(36).toString('base64url');
    await auth.createUser({
      user: input.new_username,
      pwd: password,
      roles: [{ role: 'readWrite', db: database }],
    });
    const replacement = new URL(original.toString());
    replacement.username = input.new_username;
    replacement.password = password;
    const connection = new Mongo(replacement.toString());
    const status = await connection.getDB(database).runCommand({ connectionStatus: 1 });
    if (
      status.ok !== 1 ||
      !status.authInfo.authenticatedUserRoles.some(
        (role) => role.role === 'readWrite' && role.db === database,
      )
    ) {
      throw new Error('Replacement database permissions were not verified');
    }
    await request('PATCH', {
      key: 'MONGO_URI',
      value: replacement.toString(),
      is_preview: false,
      is_buildtime: false,
      is_runtime: true,
      is_literal: row.is_literal,
    });
    const verified = (await request('GET')).find(
      (value) => value.key === 'MONGO_URI' && !value.is_preview,
    );
    if (!verified || verified.value !== replacement.toString() || verified.is_buildtime) {
      throw new Error('Replacement environment was not verified');
    }
    await admin.getSiblingDB(database).security_migration_records.updateOne(
      { _id: 'database-credential-rotation-v1' },
      {
        $set: {
          previous_username: previousUser,
          new_username: input.new_username,
          auth_database: authDatabase,
          created_at: new Date(),
          old_user_revoked: false,
        },
      },
      { upsert: true },
    );
    print(
      JSON.stringify({
        replacement_user_created: true,
        permission_verified: true,
        runtime_environment_updated: true,
        old_user_revoked: false,
      }),
    );
  } catch (error) {
    print(
      JSON.stringify({
        rotation_failed: true,
        detail:
          'Inspect database and environment state before retry; no credential values were printed',
      }),
    );
    process.exitCode = 1;
  }
}

rotate();
