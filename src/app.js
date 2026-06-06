import cors from 'cors';
import express from 'express';
import fs from 'node:fs/promises';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertSafeName, childPath, HttpError, resolveStoragePath } from './path-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDir = path.resolve(__dirname, '..', 'public');
const defaultStorageRoot = path.resolve(process.cwd(), 'storage', 'uploads');

async function pathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function removeUploadedTempFiles(files = []) {
  await Promise.allSettled(files.map((file) => fs.rm(file.path, { force: true })));
}

function toFileResponse(storageRoot, parentRelativePath, entry, stat) {
  const relativePath = path.posix.join(parentRelativePath, entry.name);
  return {
    name: entry.name,
    path: relativePath,
    type: stat.isDirectory() ? 'directory' : 'file',
    size: stat.isDirectory() ? null : stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export function createApp(options = {}) {
  const app = express();
  const storageRoot = path.resolve(options.storageRoot ?? process.env.STORAGE_ROOT ?? defaultStorageRoot);
  const publicDir = path.resolve(options.publicDir ?? defaultPublicDir);
  const tempDir = path.join(storageRoot, '.tmp');

  app.locals.storageRoot = storageRoot;
  app.locals.ready = fs.mkdir(tempDir, { recursive: true });

  const upload = multer({
    dest: tempDir,
    limits: {
      fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024),
      files: 20,
    },
  });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json());

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.use(async (_req, _res, next) => {
    try {
      await app.locals.ready;
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/files', async (req, res, next) => {
    try {
      const requested = resolveStoragePath(storageRoot, req.query.path ?? '');
      const stat = await fs.stat(requested.absolutePath);

      if (!stat.isDirectory()) {
        throw new HttpError(400, 'path must point to a directory.');
      }

      const entries = await fs.readdir(requested.absolutePath, { withFileTypes: true });
      const visibleEntries = entries.filter((entry) => entry.name !== '.tmp');
      const files = await Promise.all(
        visibleEntries.map(async (entry) => {
          const entryPath = path.join(requested.absolutePath, entry.name);
          return toFileResponse(storageRoot, requested.relativePath, entry, await fs.stat(entryPath));
        }),
      );

      files.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      });

      res.json({
        path: requested.relativePath,
        files,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/directories', async (req, res, next) => {
    try {
      const requested = resolveStoragePath(storageRoot, req.body?.path ?? '');

      if (requested.relativePath === '') {
        throw new HttpError(400, 'directory path is required.');
      }

      await fs.mkdir(requested.absolutePath, { recursive: true });
      res.status(201).json({
        name: path.posix.basename(requested.relativePath),
        path: requested.relativePath,
        type: 'directory',
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/upload', upload.array('files'), async (req, res, next) => {
    try {
      const targetDirectory = resolveStoragePath(storageRoot, req.body?.path ?? req.query.path ?? '');
      const stat = await fs.stat(targetDirectory.absolutePath);

      if (!stat.isDirectory()) {
        throw new HttpError(400, 'upload path must point to a directory.');
      }

      if (!req.files?.length) {
        throw new HttpError(400, 'at least one file is required.');
      }

      const uploaded = [];
      for (const file of req.files) {
        const safeName = assertSafeName(path.basename(file.originalname), 'file name');
        const destination = childPath(storageRoot, targetDirectory.relativePath, safeName);

        if (await pathExists(destination.absolutePath)) {
          throw new HttpError(409, `${safeName} already exists.`);
        }

        await fs.rename(file.path, destination.absolutePath);
        const stat = await fs.stat(destination.absolutePath);
        uploaded.push({
          name: safeName,
          path: destination.relativePath,
          type: 'file',
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }

      res.status(201).json({ files: uploaded });
    } catch (error) {
      await removeUploadedTempFiles(req.files);
      next(error);
    }
  });

  app.get('/api/download', async (req, res, next) => {
    try {
      const requested = resolveStoragePath(storageRoot, req.query.path ?? '');
      const stat = await fs.stat(requested.absolutePath);

      if (!stat.isFile()) {
        throw new HttpError(400, 'path must point to a file.');
      }

      res.download(requested.absolutePath, path.basename(requested.absolutePath));
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/files', async (req, res, next) => {
    try {
      const current = resolveStoragePath(storageRoot, req.body?.path ?? '');
      const target = req.body?.targetPath
        ? resolveStoragePath(storageRoot, req.body.targetPath)
        : childPath(storageRoot, path.posix.dirname(current.relativePath), req.body?.newName);

      if (current.relativePath === '') {
        throw new HttpError(400, 'root directory cannot be renamed or moved.');
      }

      if (await pathExists(target.absolutePath)) {
        throw new HttpError(409, 'target path already exists.');
      }

      await fs.rename(current.absolutePath, target.absolutePath);
      const stat = await fs.stat(target.absolutePath);
      res.json({
        name: path.posix.basename(target.relativePath),
        path: target.relativePath,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.isDirectory() ? null : stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/files', async (req, res, next) => {
    try {
      const requested = resolveStoragePath(storageRoot, req.query.path ?? req.body?.path ?? '');

      if (requested.relativePath === '') {
        throw new HttpError(400, 'root directory cannot be deleted.');
      }

      await fs.rm(requested.absolutePath, { recursive: true });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(publicDir));

  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/')) {
      next(new HttpError(404, 'route not found.'));
      return;
    }

    next();
  });

  app.use((error, _req, res, _next) => {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'path not found.' });
      return;
    }

    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.message });
      return;
    }

    const statusCode = error.statusCode ?? 500;
    res.status(statusCode).json({
      error: statusCode === 500 ? 'internal server error.' : error.message,
    });
  });

  return app;
}
