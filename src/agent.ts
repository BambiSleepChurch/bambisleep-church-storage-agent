#!/usr/bin/env node

import express, { Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import * as path from "path";
import * as fs from "fs";
import { MCPFileClient, FileInfo, FolderListing } from "./mcp-client.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = parseInt(process.env.PORT || "3000");
const mcpClient = new MCPFileClient();

// Middleware
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

// WebSocket clients for real-time updates
const wsClients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  console.log("[WebSocket] Client connected");
  wsClients.add(ws);

  ws.on("close", () => {
    console.log("[WebSocket] Client disconnected");
    wsClients.delete(ws);
  });

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleAgentMessage(ws, message);
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
    }
  });

  // Send connection status
  ws.send(JSON.stringify({ type: "status", connected: mcpClient.isConnected() }));
});

// Broadcast to all WebSocket clients
function broadcast(message: object): void {
  const data = JSON.stringify(message);
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Handle agent messages via WebSocket
async function handleAgentMessage(ws: WebSocket, message: { action: string; payload?: unknown }): Promise<void> {
  const { action, payload } = message;

  try {
    let result: unknown;

    switch (action) {
      case "connect":
        await mcpClient.connect();
        result = { success: true };
        broadcast({ type: "status", connected: true });
        break;

      case "list_files":
        result = await mcpClient.listFiles((payload as { folder?: string })?.folder as "IMAGES" | "VIDEOS" | "root" | "all");
        break;

      case "list_images":
        result = await mcpClient.listImages();
        break;

      case "list_videos":
        result = await mcpClient.listVideos();
        break;

      case "upload":
        const { filename, content, type } = payload as { filename: string; content: string; type?: string };
        if (type === "image") {
          result = await mcpClient.uploadImage(filename, content);
        } else if (type === "video") {
          result = await mcpClient.uploadVideo(filename, content);
        } else {
          result = await mcpClient.uploadFile(filename, content, "base64");
        }
        broadcast({ type: "file_changed", action: "upload", filename });
        break;

      case "download":
        const { filename: dlFilename, folder } = payload as { filename: string; folder?: string };
        result = await mcpClient.downloadFile(dlFilename, folder as "IMAGES" | "VIDEOS" | "root");
        break;

      case "delete":
        const { filename: delFilename, folder: delFolder } = payload as { filename: string; folder?: string };
        result = await mcpClient.deleteFile(delFilename, delFolder as "IMAGES" | "VIDEOS" | "root");
        broadcast({ type: "file_changed", action: "delete", filename: delFilename });
        break;

      case "get_info":
        const { filename: infoFilename, folder: infoFolder } = payload as { filename: string; folder?: string };
        result = await mcpClient.getFileInfo(infoFilename, infoFolder as "IMAGES" | "VIDEOS" | "root");
        break;

      case "get_tools":
        result = await mcpClient.getTools();
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    ws.send(JSON.stringify({ type: "response", action, result }));
  } catch (error) {
    ws.send(JSON.stringify({ type: "error", action, message: (error as Error).message }));
  }
}

// REST API Endpoints
app.get("/api/status", (req: Request, res: Response) => {
  res.json({ connected: mcpClient.isConnected() });
});

app.post("/api/connect", async (req: Request, res: Response) => {
  try {
    await mcpClient.connect();
    broadcast({ type: "status", connected: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/files", async (req: Request, res: Response) => {
  try {
    const folder = (req.query.folder as string) || "all";
    const result = await mcpClient.listFiles(folder as "IMAGES" | "VIDEOS" | "root" | "all");
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/images", async (req: Request, res: Response) => {
  try {
    const result = await mcpClient.listImages();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/videos", async (req: Request, res: Response) => {
  try {
    const result = await mcpClient.listVideos();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/file/:folder/:filename", async (req: Request, res: Response) => {
  try {
    const { folder, filename } = req.params;
    const content = await mcpClient.downloadFile(filename, folder as "IMAGES" | "VIDEOS" | "root", "base64");
    
    // Determine MIME type
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
      ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4",
      ".tiff": "image/tiff", ".avif": "image/avif", ".heic": "image/heic",
    };
    const mimeType = mimeTypes[ext] || "application/octet-stream";

    const buffer = Buffer.from(content, "base64");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

app.post("/api/upload", async (req: Request, res: Response) => {
  try {
    const { filename, content, type } = req.body;
    let result: string;

    if (type === "image") {
      result = await mcpClient.uploadImage(filename, content);
    } else if (type === "video") {
      result = await mcpClient.uploadVideo(filename, content);
    } else {
      result = await mcpClient.uploadFile(filename, content, "base64");
    }

    broadcast({ type: "file_changed", action: "upload", filename });
    res.json({ success: true, message: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete("/api/file/:folder/:filename", async (req: Request, res: Response) => {
  try {
    const { folder, filename } = req.params;
    const result = await mcpClient.deleteFile(filename, folder as "IMAGES" | "VIDEOS" | "root");
    broadcast({ type: "file_changed", action: "delete", filename });
    res.json({ success: true, message: result });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/tools", async (req: Request, res: Response) => {
  try {
    const tools = await mcpClient.getTools();
    res.json(tools);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Serve the frontend
app.get("/", (req: Request, res: Response) => {
  res.send(getFrontendHTML());
});

// Frontend HTML
function getFrontendHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BRANDYFICATION Agent</title>
  <style>
    :root {
      --bg: #0a0a0f;
      --bg-card: #12121a;
      --bg-hover: #1a1a25;
      --primary: #8b5cf6;
      --primary-dark: #7c3aed;
      --secondary: #06b6d4;
      --text: #e2e8f0;
      --text-muted: #64748b;
      --border: #1e293b;
      --success: #22c55e;
      --error: #ef4444;
      --warning: #f59e0b;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    .container { max-width: 1400px; margin: 0 auto; padding: 1.5rem; }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.5rem;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 1.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-radius: 9999px;
      font-size: 0.875rem;
    }

    .status.connected { background: rgba(34, 197, 94, 0.1); color: var(--success); }
    .status.disconnected { background: rgba(239, 68, 68, 0.1); color: var(--error); }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    .status.connected .status-dot { background: var(--success); }
    .status.disconnected .status-dot { background: var(--error); }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .toolbar {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1.25rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .btn-primary {
      background: var(--primary);
      color: white;
    }

    .btn-primary:hover { background: var(--primary-dark); }

    .btn-secondary {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover { background: var(--bg-hover); }

    .btn-secondary.active {
      border-color: var(--primary);
      color: var(--primary);
    }

    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
    }

    .tab {
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--text-muted);
      transition: all 0.2s;
    }

    .tab:hover { color: var(--text); background: var(--bg-card); }
    .tab.active { color: var(--primary); background: rgba(139, 92, 246, 0.1); }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }

    .file-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.2s;
      cursor: pointer;
    }

    .file-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
    }

    .file-preview {
      aspect-ratio: 16/10;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .file-preview img, .file-preview video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .file-preview .placeholder {
      font-size: 3rem;
      opacity: 0.3;
    }

    .file-info {
      padding: 0.75rem;
    }

    .file-name {
      font-size: 0.875rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 0.25rem;
    }

    .file-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.8);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 2rem;
    }

    .modal.active { display: flex; }

    .modal-content {
      background: var(--bg-card);
      border-radius: 16px;
      max-width: 90vw;
      max-height: 90vh;
      overflow: auto;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
    }

    .modal-body { padding: 1.5rem; }

    .modal-body img, .modal-body video {
      max-width: 100%;
      max-height: 70vh;
      border-radius: 8px;
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 1.5rem;
      cursor: pointer;
    }

    .close-btn:hover { color: var(--text); }

    .upload-zone {
      border: 2px dashed var(--border);
      border-radius: 12px;
      padding: 3rem;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 1.5rem;
    }

    .upload-zone:hover, .upload-zone.dragover {
      border-color: var(--primary);
      background: rgba(139, 92, 246, 0.05);
    }

    .upload-icon { font-size: 3rem; margin-bottom: 1rem; }
    .upload-text { color: var(--text-muted); }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-muted);
    }

    .empty-state .icon { font-size: 4rem; margin-bottom: 1rem; opacity: 0.3; }

    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      display: none;
      animation: slideIn 0.3s ease;
    }

    .toast.show { display: block; }
    .toast.success { border-color: var(--success); }
    .toast.error { border-color: var(--error); }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .file-actions {
      display: flex;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-top: 1px solid var(--border);
    }

    .action-btn {
      flex: 1;
      padding: 0.375rem;
      border: none;
      border-radius: 4px;
      background: var(--bg);
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.75rem;
    }

    .action-btn:hover { color: var(--text); background: var(--bg-hover); }
    .action-btn.delete:hover { color: var(--error); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <span>📁</span>
        <span>BRANDYFICATION Agent</span>
      </div>
      <div class="status disconnected" id="status">
        <span class="status-dot"></span>
        <span id="status-text">Disconnected</span>
      </div>
    </header>

    <div class="toolbar">
      <button class="btn btn-primary" onclick="connectToServer()">
        <span>🔌</span> Connect
      </button>
      <button class="btn btn-primary" onclick="openUploadModal()">
        <span>📤</span> Upload
      </button>
      <button class="btn btn-secondary" onclick="refreshFiles()">
        <span>🔄</span> Refresh
      </button>
    </div>

    <div class="tabs">
      <div class="tab active" data-folder="all" onclick="switchTab('all')">All Files</div>
      <div class="tab" data-folder="IMAGES" onclick="switchTab('IMAGES')">🖼️ Images</div>
      <div class="tab" data-folder="VIDEOS" onclick="switchTab('VIDEOS')">🎬 Videos</div>
    </div>

    <div id="file-grid" class="grid">
      <div class="empty-state">
        <div class="icon">📂</div>
        <p>Connect to the server to view files</p>
      </div>
    </div>
  </div>

  <!-- Upload Modal -->
  <div class="modal" id="upload-modal">
    <div class="modal-content" style="width: 500px;">
      <div class="modal-header">
        <h3>Upload File</h3>
        <button class="close-btn" onclick="closeModal('upload-modal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="upload-zone" id="upload-zone" onclick="document.getElementById('file-input').click()">
          <div class="upload-icon">📁</div>
          <p class="upload-text">Drop files here or click to browse</p>
          <p class="upload-text" style="font-size: 0.75rem; margin-top: 0.5rem;">
            Images: PNG, JPG, GIF, WEBP, SVG, etc.<br>
            Videos: MP4, GIF
          </p>
        </div>
        <input type="file" id="file-input" hidden multiple accept="image/*,video/mp4,.gif">
      </div>
    </div>
  </div>

  <!-- Preview Modal -->
  <div class="modal" id="preview-modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="preview-title">File Preview</h3>
        <button class="close-btn" onclick="closeModal('preview-modal')">&times;</button>
      </div>
      <div class="modal-body" id="preview-body"></div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <script>
    let ws = null;
    let currentFolder = 'all';
    let files = [];

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
      initWebSocket();
      setupDragDrop();
      setupFileInput();
    });

    function initWebSocket() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host);

      ws.onopen = () => console.log('[WS] Connected');
      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting...');
        setTimeout(initWebSocket, 3000);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWSMessage(data);
      };
    }

    function handleWSMessage(data) {
      switch (data.type) {
        case 'status':
          updateStatus(data.connected);
          if (data.connected) refreshFiles();
          break;
        case 'response':
          handleResponse(data);
          break;
        case 'file_changed':
          showToast(\`File \${data.action}: \${data.filename}\`, 'success');
          refreshFiles();
          break;
        case 'error':
          showToast(data.message, 'error');
          break;
      }
    }

    function handleResponse(data) {
      if (data.action === 'list_files' || data.action === 'list_images' || data.action === 'list_videos') {
        renderFiles(data.result);
      }
    }

    function updateStatus(connected) {
      const statusEl = document.getElementById('status');
      const statusText = document.getElementById('status-text');
      
      if (connected) {
        statusEl.className = 'status connected';
        statusText.textContent = 'Connected';
      } else {
        statusEl.className = 'status disconnected';
        statusText.textContent = 'Disconnected';
      }
    }

    async function connectToServer() {
      try {
        const res = await fetch('/api/connect', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          showToast('Connected to MCP server', 'success');
        }
      } catch (error) {
        showToast('Failed to connect', 'error');
      }
    }

    async function refreshFiles() {
      try {
        let url = '/api/files?folder=' + currentFolder;
        if (currentFolder === 'IMAGES') url = '/api/images';
        if (currentFolder === 'VIDEOS') url = '/api/videos';

        const res = await fetch(url);
        const data = await res.json();
        renderFiles(Array.isArray(data) ? data : [data]);
      } catch (error) {
        console.error('Failed to fetch files:', error);
      }
    }

    function renderFiles(data) {
      const grid = document.getElementById('file-grid');
      let allFiles = [];

      if (Array.isArray(data)) {
        data.forEach(folder => {
          const folderFiles = folder.files || folder.images || folder.videos || [];
          folderFiles.forEach(f => {
            allFiles.push({
              ...f,
              folder: folder.folder.includes('IMAGES') ? 'IMAGES' : 
                      folder.folder.includes('VIDEOS') ? 'VIDEOS' : 'root'
            });
          });
        });
      }

      if (allFiles.length === 0) {
        grid.innerHTML = \`
          <div class="empty-state" style="grid-column: 1/-1;">
            <div class="icon">📂</div>
            <p>No files found</p>
          </div>
        \`;
        return;
      }

      grid.innerHTML = allFiles.map(file => {
        const isImage = isImageFile(file.name);
        const isVideo = isVideoFile(file.name);
        const previewUrl = \`/api/file/\${file.folder}/\${encodeURIComponent(file.name)}\`;

        return \`
          <div class="file-card" onclick="previewFile('\${file.folder}', '\${file.name}')">
            <div class="file-preview">
              \${isImage ? \`<img src="\${previewUrl}" alt="\${file.name}" loading="lazy">\` :
                isVideo ? \`<video src="\${previewUrl}" muted></video>\` :
                \`<div class="placeholder">📄</div>\`}
            </div>
            <div class="file-info">
              <div class="file-name" title="\${file.name}">\${file.name}</div>
              <div class="file-meta">\${file.mimeType || file.type || 'file'}</div>
            </div>
            <div class="file-actions" onclick="event.stopPropagation()">
              <button class="action-btn" onclick="downloadFile('\${file.folder}', '\${file.name}')">⬇️ Download</button>
              <button class="action-btn delete" onclick="deleteFile('\${file.folder}', '\${file.name}')">🗑️ Delete</button>
            </div>
          </div>
        \`;
      }).join('');
    }

    function isImageFile(name) {
      return /\\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?|avif|heic|heif|raw|psd|ai|eps|pcx|tga|exr|hdr)$/i.test(name);
    }

    function isVideoFile(name) {
      return /\\.(mp4|gif)$/i.test(name);
    }

    function switchTab(folder) {
      currentFolder = folder;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector(\`.tab[data-folder="\${folder}"]\`).classList.add('active');
      refreshFiles();
    }

    function previewFile(folder, filename) {
      const modal = document.getElementById('preview-modal');
      const title = document.getElementById('preview-title');
      const body = document.getElementById('preview-body');
      const url = \`/api/file/\${folder}/\${encodeURIComponent(filename)}\`;

      title.textContent = filename;

      if (isImageFile(filename)) {
        body.innerHTML = \`<img src="\${url}" alt="\${filename}">\`;
      } else if (isVideoFile(filename)) {
        body.innerHTML = \`<video src="\${url}" controls autoplay style="max-width:100%;"></video>\`;
      } else {
        body.innerHTML = \`<p>Preview not available for this file type</p>\`;
      }

      modal.classList.add('active');
    }

    async function downloadFile(folder, filename) {
      const url = \`/api/file/\${folder}/\${encodeURIComponent(filename)}\`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      showToast('Download started: ' + filename, 'success');
    }

    async function deleteFile(folder, filename) {
      if (!confirm(\`Delete "\${filename}"?\`)) return;

      try {
        const res = await fetch(\`/api/file/\${folder}/\${encodeURIComponent(filename)}\`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
          showToast('Deleted: ' + filename, 'success');
          refreshFiles();
        }
      } catch (error) {
        showToast('Failed to delete file', 'error');
      }
    }

    function openUploadModal() {
      document.getElementById('upload-modal').classList.add('active');
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('active');
    }

    function setupDragDrop() {
      const zone = document.getElementById('upload-zone');

      ['dragenter', 'dragover'].forEach(event => {
        zone.addEventListener(event, (e) => {
          e.preventDefault();
          zone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(event => {
        zone.addEventListener(event, (e) => {
          e.preventDefault();
          zone.classList.remove('dragover');
        });
      });

      zone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        handleFiles(files);
      });
    }

    function setupFileInput() {
      document.getElementById('file-input').addEventListener('change', (e) => {
        handleFiles(e.target.files);
      });
    }

    async function handleFiles(fileList) {
      for (const file of fileList) {
        await uploadFile(file);
      }
      closeModal('upload-modal');
    }

    async function uploadFile(file) {
      const reader = new FileReader();
      
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4');

        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              content: base64,
              type: isImage ? 'image' : isVideo ? 'video' : 'file'
            })
          });

          const data = await res.json();
          if (data.success) {
            showToast('Uploaded: ' + file.name, 'success');
          }
        } catch (error) {
          showToast('Failed to upload: ' + file.name, 'error');
        }
      };

      reader.readAsDataURL(file);
    }

    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show ' + type;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Close modals on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
      }
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    });
  </script>
</body>
</html>`;
}

// Start server
async function main(): Promise<void> {
  // Auto-connect to MCP server
  try {
    await mcpClient.connect();
  } catch (error) {
    console.error("[Agent] Could not auto-connect to MCP server:", error);
  }

  server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║           BRANDYFICATION Agent v1.0.0                     ║
╠════════════════════════════════════════════════════════════╣
║  Frontend:  http://localhost:${PORT}                         ║
║  WebSocket: ws://localhost:${PORT}                           ║
║  API:       http://localhost:${PORT}/api                     ║
╠════════════════════════════════════════════════════════════╣
║  MCP Status: ${mcpClient.isConnected() ? "Connected ✓" : "Disconnected ✗"}                              ║
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

// Handle shutdown
process.on("SIGINT", async () => {
  console.log("\n[Agent] Shutting down...");
  await mcpClient.disconnect();
  process.exit(0);
});

main().catch(console.error);
