import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
const dev = appEnv !== 'PROD' && appEnv !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// NEXT_DEV_BUNDLER=webpack opts out of Turbopack at dev time. Turbopack panics
// on some Windows hosts with STATUS_DLL_INIT_FAILED (0xc0000142) when spawning
// webpack-loader worker processes; webpack mode is the documented escape hatch.
// Unset/anything else → Next.js default (Turbopack on Next 16).
const bundlerOverride =
  process.env.NEXT_DEV_BUNDLER === 'webpack'
    ? { webpack: true as const }
    : process.env.NEXT_DEV_BUNDLER === 'turbopack'
      ? { turbopack: true as const }
      : {};

const app = next({ dev, hostname, port, ...bundlerOverride });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : appEnv
      }`,
    );
  });
});
