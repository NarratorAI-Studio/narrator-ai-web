import nextTs from 'eslint-config-next/typescript';
import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build artifacts:
    'server.js',
    'dist/**',
    // Script files (CommonJS):
    'scripts/**/*.js',
    '*.js',
    // Demo directory:
    'narrator-ai-demo/**',
  ]),
  // Architecture invariant: web (BFF) talks to services over HTTP only.
  // Direct DB drivers must not be imported under src/. See docs/architecture.md.
  //
  // The forbidden list covers (a) every package family mentioned in
  // docs/architecture.md, and (b) the underlying connector libraries those
  // ORMs/CLIs depend on, so that switching to a peer wrapper does not
  // silently bypass the rule.
  {
    files: ['src/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            // Postgres / MySQL / Mongo / SQLite raw drivers
            { name: 'pg',                  message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'pg-pool',             message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'pg-native',           message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'postgres',            message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'mysql',               message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'mysql2',              message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'mysql2/promise',      message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'mongodb',             message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'mongoose',            message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'better-sqlite3',      message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'sqlite3',             message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            // Drizzle ORM family
            { name: 'drizzle-orm',         message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'drizzle-zod',         message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'drizzle-kit',         message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            // Prisma family
            { name: 'prisma',              message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { name: '@prisma/client',      message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { name: '@prisma/adapter-pg',  message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { name: '@prisma/migrate',     message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            // TypeORM / Sequelize / Knex / Kysely family
            { name: 'typeorm',             message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'sequelize',           message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'knex',                message: 'Query builder forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'kysely',              message: 'Query builder forbidden in web — call the pricing/backend API over HTTP.' },
            { name: 'kysely-postgres',     message: 'Query builder forbidden in web — call the pricing/backend API over HTTP.' },
          ],
          patterns: [
            { group: ['pg/*'],             message: 'Direct DB driver forbidden in web — call the pricing/backend API over HTTP.' },
            { group: ['drizzle-orm/*'],    message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { group: ['drizzle-kit/*'],    message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { group: ['@prisma/*'],        message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { group: ['typeorm/*'],        message: 'ORM forbidden in web — call the pricing/backend API over HTTP.' },
            { group: ['kysely/*'],         message: 'Query builder forbidden in web — call the pricing/backend API over HTTP.' },
          ],
        },
      ],
      // Block CommonJS `require('pg')` / dynamic `import('mysql2')` and friends.
      // ESLint's no-restricted-imports only handles ESM specifiers; we use a
      // selector rule to cover the runtime forms. The regex escapes `/` and `@`
      // because esquery wraps the value in /.../ syntax.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^(pg|pg-pool|pg-native|postgres|mysql|mysql2|mysql2\\u002Fpromise|mongodb|mongoose|better-sqlite3|sqlite3|drizzle-orm|drizzle-zod|drizzle-kit|prisma|\\u0040prisma\\u002Fclient|\\u0040prisma\\u002Fadapter-pg|\\u0040prisma\\u002Fmigrate|typeorm|sequelize|knex|kysely)$/]",
          message:
            'Direct DB driver / ORM forbidden in web (CommonJS require) — call the pricing/backend API over HTTP. See docs/architecture.md.',
        },
        {
          selector:
            "ImportExpression[source.value=/^(pg|pg-pool|pg-native|postgres|mysql|mysql2|mysql2\\u002Fpromise|mongodb|mongoose|better-sqlite3|sqlite3|drizzle-orm|drizzle-zod|drizzle-kit|prisma|\\u0040prisma\\u002Fclient|\\u0040prisma\\u002Fadapter-pg|\\u0040prisma\\u002Fmigrate|typeorm|sequelize|knex|kysely)$/]",
          message:
            'Direct DB driver / ORM forbidden in web (dynamic import) — call the pricing/backend API over HTTP. See docs/architecture.md.',
        },
      ],
    },
  },
]);

export default eslintConfig;
