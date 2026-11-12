// Starts the local PostgreSQL server and makes sure the role and databases
// named in .env exist. Tables and demo data come from `pnpm db:setup`.
//
// Uses the Debian/Ubuntu cluster tools (pg_lsclusters, pg_createcluster,
// pg_ctlcluster). Run it as root or as the cluster's owner. Safe to re-run.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import pg from 'pg';

interface Cluster {
  version: number;
  cluster: string;
  port: string;
  running: number;
  owneruid: number;
  socketdir: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// C.UTF-8 keeps the databases UTF-8 with plain code-point sorting. Fall back
// to C, which works with UTF-8 too, if the system doesn't provide it.
function utf8Locale() {
  try {
    const locales = execFileSync('locale', ['-a'], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return locales.split('\n').some((name) => /^C\.utf-?8$/i.test(name))
      ? 'C.UTF-8'
      : 'C';
  } catch {
    return 'C';
  }
}

const locale = utf8Locale();

// The PostgreSQL tools refuse to run if the shell's locale (for example
// LANG=en_US.UTF-8) isn't installed, so they all run under one that is.
const env = { ...process.env, LC_ALL: locale };

function run(command: string, args: string[], input?: string) {
  try {
    return execFileSync(command, args, {
      cwd: '/',
      encoding: 'utf8',
      env,
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail(
        `${command} isn't installed. pnpm db:start manages PostgreSQL clusters ` +
          'with the Debian/Ubuntu tools. Otherwise, start PostgreSQL your usual ' +
          'way and create the databases from .env.',
      );
    }
    fail(`${command} ${args[0] ?? ''} failed. See the output above.`);
  }
}

function listClusters(): Cluster[] {
  return JSON.parse(run('pg_lsclusters', ['--json']) || '[]');
}

// SQL string literal (standard_conforming_strings is on by default).
function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const urls = [process.env.DATABASE_URL, process.env.TEST_DATABASE_URL]
  .filter((url): url is string => !!url)
  .map((url) => new URL(url));

if (!urls.length) {
  fail('Set DATABASE_URL first: copy .env.example to .env.');
}

const [app] = urls;
const port = app.port || '5432';
const role = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);
const databases = urls.map((url) => decodeURIComponent(url.pathname.slice(1)));

if (!['127.0.0.1', 'localhost', '[::1]'].includes(app.hostname)) {
  fail(
    `DATABASE_URL points to ${app.hostname}; db:start only runs a local server.`,
  );
}
if (
  urls.some(
    (url) =>
      url.hostname !== app.hostname ||
      (url.port || '5432') !== port ||
      url.username !== app.username,
  )
) {
  fail('DATABASE_URL and TEST_DATABASE_URL must use the same server and user.');
}
if (!role || !password || databases.some((name) => !name)) {
  fail('The database URLs in .env need a user, password, and database name.');
}

// 1. Find the cluster on the configured port, creating one if there's none.
let cluster = listClusters().find((candidate) => candidate.port === port);

if (!cluster) {
  const others = listClusters();

  if (others.length) {
    fail(
      `No PostgreSQL cluster listens on port ${port}. Existing clusters: ` +
        others.map((c) => `${c.version}/${c.cluster} on ${c.port}`).join(', ') +
        '. Change the port in .env or run pg_lsclusters for details.',
    );
  }

  const version = readdirSync('/usr/lib/postgresql')
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(b) - Number(a))[0];

  if (!version) fail('No PostgreSQL server found in /usr/lib/postgresql.');

  console.log(`Creating PostgreSQL ${version} cluster "main" on port ${port}…`);
  run('pg_createcluster', [
    version,
    'main',
    '--port',
    port,
    '--locale',
    locale,
    '--encoding',
    'UTF8',
  ]);
  cluster = listClusters().find((candidate) => candidate.port === port);

  if (!cluster) fail('pg_createcluster did not create a cluster.');
}

const name = `PostgreSQL ${cluster.version}/${cluster.cluster}`;
const uid = process.getuid?.();

if (uid !== 0 && uid !== cluster.owneruid) {
  fail(`Run pnpm db:start as root or as the owner of ${name}.`);
}

// 2. Start it.
if (cluster.running) {
  console.log(`${name} is already running on port ${port}.`);
} else {
  run('pg_ctlcluster', [String(cluster.version), cluster.cluster, 'start']);
  console.log(`${name} started on port ${port}.`);
}

// 3. Create the role and databases as the cluster owner over the local socket.
// Passing the socket directory explicitly ignores any PGHOST in the shell.
const owner = run('id', ['-nu', String(cluster.owneruid)]).trim();
const psqlArgs = [
  '-X',
  '-q',
  '-v',
  'ON_ERROR_STOP=1',
  '-h',
  cluster.socketdir,
  '-p',
  port,
  '-U',
  owner,
  '-d',
  'postgres',
];

const statements = [
  `SELECT format('CREATE ROLE %I LOGIN', ${literal(role)})
   WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${literal(role)}) \\gexec`,
  `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${literal(role)}, ${literal(password)}) \\gexec`,
  ...databases.map(
    (database) =>
      `SELECT format('CREATE DATABASE %I OWNER %I ENCODING %L LC_COLLATE %L LC_CTYPE %L TEMPLATE template0',
         ${literal(database)}, ${literal(role)}, 'UTF8', ${literal(locale)}, ${literal(locale)})
       WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = ${literal(database)}) \\gexec`,
  ),
];

const psql =
  uid === 0 && cluster.owneruid !== 0
    ? (input: string) =>
        run('runuser', ['-u', owner, '--', 'psql', ...psqlArgs], input)
    : (input: string) => run('psql', psqlArgs, input);

psql(statements.join('\n') + '\n');

// 4. Connect the way the app does to confirm the credentials work.
for (const url of urls) {
  const client = new pg.Client({ connectionString: url.href });

  try {
    await client.connect();
    const { rows } = await client.query<{ encoding: string }>(
      `SELECT pg_encoding_to_char(encoding) AS encoding
       FROM pg_database WHERE datname = current_database()`,
    );
    const database = decodeURIComponent(url.pathname.slice(1));

    if (rows[0].encoding !== 'UTF8') {
      console.warn(
        `Warning: ${database} uses ${rows[0].encoding} instead of UTF8, so text ` +
          `isn't validated. If it holds nothing you need, drop it ` +
          `(${uid === 0 ? `runuser -u ${owner} -- ` : ''}dropdb -h ${cluster.socketdir} -p ${port} ${database}) ` +
          'and run pnpm db:start again.',
      );
    } else {
      console.log(`${database} is ready for ${role}.`);
    }
  } catch (error) {
    fail(
      `Couldn't connect with ${url.protocol}//${url.host}${url.pathname}: ${(error as Error).message}`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

console.log(
  'PostgreSQL is ready. Run pnpm db:setup to add tables and demo data.',
);
