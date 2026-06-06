# Node 文件管理器

这是一个基于 Express 的 Node.js 文件管理工程，支持通过浏览器或 REST API 管理服务器本地文件。

默认只管理 `storage/uploads` 目录中的内容，并拒绝绝对路径和 `..` 路径片段，避免访问项目目录之外的文件。

## 功能

- 浏览文件和文件夹
- 创建文件夹
- 上传一个或多个文件
- 下载文件
- 重命名文件或文件夹
- 删除文件或文件夹
- 简单网页管理界面

## 本地运行

```bash
npm install
npm run dev
```

服务默认运行在 <http://localhost:3000>。

生产模式启动：

```bash
npm start
```

运行测试：

```bash
npm test
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 服务端口 |
| `STORAGE_ROOT` | `storage/uploads` | 文件管理根目录 |
| `MAX_UPLOAD_BYTES` | `52428800` | 单个上传文件大小限制，默认 50 MB |

## API

### 健康检查

```http
GET /api/health
```

### 列出目录

```http
GET /api/files?path=docs
```

### 创建文件夹

```http
POST /api/directories
Content-Type: application/json

{
  "path": "docs/images"
}
```

### 上传文件

```http
POST /api/upload
Content-Type: multipart/form-data

path=docs
files=@example.txt
```

### 下载文件

```http
GET /api/download?path=docs/example.txt
```

### 重命名或移动

使用 `newName` 在同一目录重命名：

```http
PATCH /api/files
Content-Type: application/json

{
  "path": "docs/example.txt",
  "newName": "renamed.txt"
}
```

使用 `targetPath` 移动到新位置：

```http
PATCH /api/files
Content-Type: application/json

{
  "path": "docs/example.txt",
  "targetPath": "archive/example.txt"
}
```

### 删除

```http
DELETE /api/files?path=docs/example.txt
```
