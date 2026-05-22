// ABOUTME: Tests for the HTTP HEAD probe that detects repository visibility.
// ABOUTME: Uses an in-process Node http server — never hits the public internet.

/**
 * Open-Source Detection - HTTP Probe Tests
 *
 * Exercises probeRepoVisibility against an in-process Node http server on
 * 127.0.0.1:0 (random port). NEVER hits the public internet.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { probeRepoVisibility } from './visibility-probe';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let baseUrl = '';
const routes = new Map<string, Handler>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const handler = routes.get(req.url ?? '/');
    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  routes.clear();
});

function setRoute(pathname: string, handler: Handler): void {
  routes.set(pathname, handler);
}

describe('probeRepoVisibility', () => {
  it('returns public for a 200 response', async () => {
    setRoute('/ok', (_req, res) => {
      res.writeHead(200).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/ok`);

    expect(result.status).toBe('public');
    expect(result.httpStatus).toBe(200);
    expect(result.reason).toBeUndefined();
  });

  it('returns public for a 204 response', async () => {
    setRoute('/no-content', (_req, res) => {
      res.writeHead(204).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/no-content`);

    expect(result.status).toBe('public');
    expect(result.httpStatus).toBe(204);
  });

  it('returns private for a 404 response', async () => {
    setRoute('/missing', (_req, res) => {
      res.writeHead(404).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/missing`);

    expect(result.status).toBe('private');
    expect(result.httpStatus).toBe(404);
    expect(result.reason).toBe('http-404');
  });

  it('returns private for a 401 response', async () => {
    setRoute('/auth', (_req, res) => {
      res.writeHead(401).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/auth`);

    expect(result.status).toBe('private');
    expect(result.httpStatus).toBe(401);
    expect(result.reason).toBe('http-401');
  });

  it('returns private for a 403 response', async () => {
    setRoute('/forbidden', (_req, res) => {
      res.writeHead(403).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/forbidden`);

    expect(result.status).toBe('private');
    expect(result.httpStatus).toBe(403);
    expect(result.reason).toBe('http-403');
  });

  it('returns private for a 500 response', async () => {
    setRoute('/boom', (_req, res) => {
      res.writeHead(500).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/boom`);

    expect(result.status).toBe('private');
    expect(result.httpStatus).toBe(500);
    expect(result.reason).toBe('http-500');
  });

  it('returns private for a 429 rate-limited response', async () => {
    setRoute('/rate', (_req, res) => {
      res.writeHead(429).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/rate`);

    expect(result.status).toBe('private');
    expect(result.httpStatus).toBe(429);
    expect(result.reason).toBe('http-429');
  });

  it('follows a 301 to a 200 (returns public)', async () => {
    setRoute('/redirect', (_req, res) => {
      res.writeHead(301, { Location: `${baseUrl}/final` }).end();
    });
    setRoute('/final', (_req, res) => {
      res.writeHead(200).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/redirect`);

    expect(result.status).toBe('public');
    expect(result.httpStatus).toBe(200);
  });

  it('follows a 302 to a 404 (returns private)', async () => {
    setRoute('/temp', (_req, res) => {
      res.writeHead(302, { Location: `${baseUrl}/missing-final` }).end();
    });
    setRoute('/missing-final', (_req, res) => {
      res.writeHead(404).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/temp`);

    expect(result.status).toBe('private');
    expect(result.httpStatus).toBe(404);
    expect(result.reason).toBe('http-404');
  });

  it('returns unreachable on timeout', async () => {
    setRoute('/slow', (_req, res) => {
      const t = setTimeout(() => res.end(), 5000);
      res.on('close', () => clearTimeout(t));
    });

    const result = await probeRepoVisibility(`${baseUrl}/slow`, { timeoutMs: 50 });

    expect(result.status).toBe('unreachable');
    expect(result.httpStatus).toBeNull();
    expect(result.reason).toBe('timeout');
  });

  it('returns unreachable for connection refused', async () => {
    // Port 1 is the TCPMUX port — almost never bound on dev machines.
    const target = baseUrl.replace(/:\d+/, ':1');
    const result = await probeRepoVisibility(target, { timeoutMs: 2000 });

    expect(result.status).toBe('unreachable');
    expect(result.httpStatus).toBeNull();
    expect(result.reason).toBeDefined();
  });

  it('honors an external AbortSignal that is already aborted', async () => {
    setRoute('/ok2', (_req, res) => {
      res.writeHead(200).end();
    });
    const ac = new AbortController();
    ac.abort(new Error('caller cancelled'));

    const result = await probeRepoVisibility(`${baseUrl}/ok2`, { signal: ac.signal });

    expect(result.status).toBe('unreachable');
    expect(result.httpStatus).toBeNull();
    expect(result.reason).toBe('aborted');
  });

  it('honors an external AbortSignal that aborts mid-flight', async () => {
    setRoute('/delay', (_req, res) => {
      const t = setTimeout(() => res.end(), 500);
      res.on('close', () => clearTimeout(t));
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error('mid-flight cancel')), 20);

    const result = await probeRepoVisibility(`${baseUrl}/delay`, {
      signal: ac.signal,
      timeoutMs: 5000,
    });

    expect(result.status).toBe('unreachable');
    expect(result.httpStatus).toBeNull();
    expect(result.reason).toBe('aborted');
  });

  it('uses the injected fetchImpl when provided', async () => {
    let calls = 0;
    const stub: typeof fetch = async (input, _init) => {
      calls += 1;
      void input;
      return new Response(null, { status: 200 });
    };

    const result = await probeRepoVisibility('https://example.invalid/repo', {
      fetchImpl: stub,
    });

    expect(calls).toBe(1);
    expect(result.status).toBe('public');
    expect(result.httpStatus).toBe(200);
  });

  it('sets the User-Agent header to the default', async () => {
    let captured: string | undefined;
    setRoute('/ua', (req, res) => {
      captured = req.headers['user-agent'];
      res.writeHead(200).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/ua`);

    expect(result.status).toBe('public');
    expect(captured).toBe('agentic-bookmarks opensource-detection');
  });

  it('overrides the User-Agent when userAgent option is provided', async () => {
    let captured: string | undefined;
    setRoute('/ua2', (req, res) => {
      captured = req.headers['user-agent'];
      res.writeHead(200).end();
    });

    const result = await probeRepoVisibility(`${baseUrl}/ua2`, {
      userAgent: 'custom-agent/1.2.3',
    });

    expect(result.status).toBe('public');
    expect(captured).toBe('custom-agent/1.2.3');
  });
});
