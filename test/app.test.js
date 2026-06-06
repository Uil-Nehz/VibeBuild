import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app.js';

describe('file manager api', () => {
  let baseUrl;
  let server;
  let storageRoot;

  before(async () => {
    process.env.NODE_ENV = 'test';
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-'));
    const app = createApp({ storageRoot });
    await app.locals.ready;
    server = app.listen(0);
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  async function request(pathname, options = {}) {
    return fetch(`${baseUrl}${pathname}`, options);
  }

  it('supports creating folders, uploading, listing, downloading, renaming, and deleting files', async () => {
    let response = await request('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });

    response = await request('/api/directories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'docs' }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).path, 'docs');

    const formData = new FormData();
    formData.append('path', 'docs');
    formData.append('files', new Blob(['Hello from tests'], { type: 'text/plain' }), 'hello.txt');

    response = await request('/api/upload', {
      method: 'POST',
      body: formData,
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).files[0].path, 'docs/hello.txt');

    response = await request('/api/files?path=docs');
    assert.equal(response.status, 200);
    const listing = await response.json();
    assert.equal(listing.path, 'docs');
    assert.equal(listing.files.length, 1);
    assert.equal(listing.files[0].name, 'hello.txt');

    response = await request('/api/download?path=docs%2Fhello.txt');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'Hello from tests');

    response = await request('/api/files', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'docs/hello.txt', newName: 'greeting.txt' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).path, 'docs/greeting.txt');

    response = await request('/api/files?path=docs%2Fgreeting.txt', { method: 'DELETE' });
    assert.equal(response.status, 204);

    response = await request('/api/files?path=docs');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).files, []);
  });

  it('rejects paths that try to leave the storage root', async () => {
    const response = await request('/api/files?path=..%2Fpackage.json');
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /parent directory traversal/);
  });
});
