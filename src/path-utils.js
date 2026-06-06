import path from 'node:path';

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export function assertSafeName(name, fieldName = 'name') {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new HttpError(400, `${fieldName} is required.`);
  }

  if (name.includes('\0') || name.includes('/') || name.includes('\\')) {
    throw new HttpError(400, `${fieldName} must be a single file or folder name.`);
  }

  if (name === '.' || name === '..') {
    throw new HttpError(400, `${fieldName} is not allowed.`);
  }

  return name.trim();
}

export function resolveStoragePath(storageRoot, requestedPath = '') {
  if (typeof requestedPath !== 'string') {
    throw new HttpError(400, 'path must be a string.');
  }

  if (requestedPath.includes('\0')) {
    throw new HttpError(400, 'path contains invalid characters.');
  }

  const normalizedInput = requestedPath.replaceAll('\\', '/').trim();
  if (path.posix.isAbsolute(normalizedInput) || path.win32.isAbsolute(normalizedInput)) {
    throw new HttpError(400, 'absolute paths are not allowed.');
  }

  const segments = normalizedInput
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');

  if (segments.includes('..')) {
    throw new HttpError(400, 'parent directory traversal is not allowed.');
  }

  const absoluteRoot = path.resolve(storageRoot);
  const absolutePath = path.resolve(absoluteRoot, ...segments);
  const relativePath = path.relative(absoluteRoot, absolutePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new HttpError(400, 'path escapes the storage root.');
  }

  return {
    absolutePath,
    relativePath: relativePath === '' ? '' : relativePath.split(path.sep).join('/'),
  };
}

export function childPath(storageRoot, parentPath, childName) {
  const safeName = assertSafeName(childName);
  const parent = resolveStoragePath(storageRoot, parentPath);
  return resolveStoragePath(storageRoot, path.posix.join(parent.relativePath, safeName));
}
