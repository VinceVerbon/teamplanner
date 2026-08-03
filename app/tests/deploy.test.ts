// F18 deploy stack - config validation test-set.
// Keeps deploy/compose.yaml, deploy/app/Dockerfile, deploy/.env.example and the
// root .dockerignore consistent with each other and with the app's runtime
// expectations (migrations path, healthz route, env contract in app/.env.example).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'

const repoRoot = join(__dirname, '..', '..')
const composeRaw = readFileSync(join(repoRoot, 'deploy', 'compose.yaml'), 'utf8')
const compose = parse(composeRaw)
const dockerfile = readFileSync(join(repoRoot, 'deploy', 'app', 'Dockerfile'), 'utf8')
const deployEnv = readFileSync(join(repoRoot, 'deploy', '.env.example'), 'utf8')
const appEnv = readFileSync(join(repoRoot, 'app', '.env.example'), 'utf8')
const dockerignore = readFileSync(join(repoRoot, '.dockerignore'), 'utf8')

function envKeys(content: string): string[] {
  return [...content.matchAll(/^([A-Z_]+)=/gm)].map(m => m[1])
}

describe('F18 compose.yaml', () => {
  it('parses and defines exactly the app and db services', () => {
    expect(Object.keys(compose.services).sort()).toEqual(['tp-app', 'tp-db'])
  })

  it('does not publish the database on a host port', () => {
    expect(compose.services['tp-db'].ports).toBeUndefined()
  })

  it('starts the app only after the db is healthy', () => {
    expect(compose.services['tp-app'].depends_on['tp-db'].condition).toBe('service_healthy')
    expect(compose.services['tp-db'].healthcheck.test.join(' ')).toContain('pg_isready')
  })

  it('persists postgres data in the declared named volume', () => {
    expect(compose.services['tp-db'].volumes).toContain('tp-pgdata:/var/lib/postgresql/data')
    expect(compose.volumes).toHaveProperty('tp-pgdata')
  })

  it('points the app DATABASE_URL at the db service on the stack network', () => {
    expect(compose.services['tp-app'].environment.DATABASE_URL).toContain('@tp-db:5432/')
  })

  it('builds the app from the repo root with the deploy Dockerfile', () => {
    expect(compose.services['tp-app'].build.context).toBe('..')
    expect(compose.services['tp-app'].build.dockerfile).toBe('deploy/app/Dockerfile')
  })

  it('restarts both services unless stopped', () => {
    expect(compose.services['tp-app'].restart).toBe('unless-stopped')
    expect(compose.services['tp-db'].restart).toBe('unless-stopped')
  })
})

describe('F18 Dockerfile', () => {
  it('is a multistage build producing the Nitro server', () => {
    expect(dockerfile.match(/^FROM /gm)).toHaveLength(2)
    expect(dockerfile).toContain('CMD ["node", ".output/server/index.mjs"]')
  })

  it('ships the drizzle migrations at the path server/utils/db.ts resolves', () => {
    // migrateDb() resolves join(process.cwd(), 'server', 'db', 'migrations');
    // WORKDIR is /app, so the migrations must land at /app/server/db/migrations.
    expect(dockerfile).toContain('WORKDIR /app')
    expect(dockerfile).toMatch(/COPY --from=build \S*server\/db\/migrations \/app\/server\/db\/migrations/)
  })

  it('runs as a non-root user', () => {
    expect(dockerfile).toMatch(/^USER app$/m)
  })

  it('healthchecks the /api/healthz route', () => {
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]*\/api\/healthz/)
  })

  it('exposes the port compose maps to', () => {
    expect(dockerfile).toMatch(/^EXPOSE 3000$/m)
    expect(compose.services['tp-app'].ports[0]).toMatch(/:3000$/)
  })
})

describe('F18 env contract', () => {
  it('deploy/.env.example covers every variable compose interpolates', () => {
    const interpolated = [...new Set([...composeRaw.matchAll(/\$\{([A-Z_]+)/g)].map(m => m[1]))]
    const keys = envKeys(deployEnv)
    for (const v of interpolated) expect(keys, `compose interpolates ${v}`).toContain(v)
  })

  it('deploy/.env.example covers every prod-relevant app variable', () => {
    // DATABASE_URL is assembled by compose; TEAMPLANNER_DATA_DIR is PGlite/dev-only.
    const devOnly = ['DATABASE_URL', 'TEAMPLANNER_DATA_DIR']
    const required = envKeys(appEnv).filter(k => !devOnly.includes(k))
    const keys = envKeys(deployEnv)
    for (const v of required) expect(keys, `app/.env.example declares ${v}`).toContain(v)
    for (const v of devOnly) expect(keys, `${v} must not leak into the stack env`).not.toContain(v)
  })

  it('requires the postgres password instead of defaulting it', () => {
    expect(composeRaw).toContain('${POSTGRES_PASSWORD:?')
  })
})

describe('F18 .dockerignore', () => {
  it('keeps host node_modules, local data and the real env out of the build context', () => {
    for (const entry of ['**/node_modules', '**/.data', 'deploy/.env', 'app/.output']) {
      expect(dockerignore).toContain(entry)
    }
  })
})
