# BRANDYFICATION Agent

An agentic frontend that connects to the BRANDYFICATION MCP file hosting server.

## Features

- **MCP Client Integration** - Communicates with the file hosting server via MCP protocol
- **Web Frontend** - Beautiful dark-themed UI for browsing files
- **Real-time Updates** - WebSocket connection for live file changes
- **Image Rendering** - Preview all supported image formats
- **Video Playback** - Play MP4 and GIF videos directly
- **Drag & Drop Upload** - Easy file uploads with drag and drop
- **REST API** - Full API access for programmatic control

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│   Web Frontend      │────▶│   Agent Server      │
│   (Browser)         │◀────│   (Express + WS)    │
└─────────────────────┘     └──────────┬──────────┘
                                       │
                                       │ MCP Protocol
                                       │ (stdio)
                                       ▼
                            ┌─────────────────────┐
                            │  File Hosting MCP   │
                            │      Server         │
                            └──────────┬──────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │   BRANDYFICATION/   │
                            │   ├── IMAGES/       │
                            │   └── VIDEOS/       │
                            └─────────────────────┘
```

## Installation

```bash
cd agent
npm install
npm run build
```

## Usage

### Start the Agent

```bash
npm start
```

This will:

1. Start the web server on `http://localhost:3000`
2. Connect to the MCP file hosting server
3. Open the frontend in your browser

### Environment Variables

| Variable      | Description                      | Default             |
| ------------- | -------------------------------- | ------------------- |
| `PORT`        | Web server port                  | `3000`              |
| `STORAGE_DIR` | Storage directory for MCP server | `../BRANDYFICATION` |

### Custom Port

```bash
PORT=8080 npm start
```

## API Endpoints

### Status

- `GET /api/status` - Check MCP connection status
- `POST /api/connect` - Connect to MCP server

### Files

- `GET /api/files?folder=all|IMAGES|VIDEOS|root` - List files
- `GET /api/images` - List images only
- `GET /api/videos` - List videos only
- `GET /api/file/:folder/:filename` - Get file content (rendered)
- `POST /api/upload` - Upload a file
- `DELETE /api/file/:folder/:filename` - Delete a file

### Tools

- `GET /api/tools` - List available MCP tools

## WebSocket API

Connect to `ws://localhost:3000` for real-time updates.

### Send Messages

```javascript
// Connect to MCP server
ws.send(JSON.stringify({ action: "connect" }));

// List files
ws.send(JSON.stringify({ action: "list_files", payload: { folder: "all" } }));

// Upload file
ws.send(
  JSON.stringify({
    action: "upload",
    payload: { filename: "image.png", content: "<base64>", type: "image" },
  })
);

// Delete file
ws.send(
  JSON.stringify({
    action: "delete",
    payload: { filename: "image.png", folder: "IMAGES" },
  })
);
```

### Receive Messages

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "status":
      // { type: "status", connected: true/false }
      break;
    case "response":
      // { type: "response", action: "...", result: ... }
      break;
    case "file_changed":
      // { type: "file_changed", action: "upload/delete", filename: "..." }
      break;
    case "error":
      // { type: "error", message: "..." }
      break;
  }
};
```

## Frontend Features

### File Browser

- View all files organized by folder (All, Images, Videos)
- Thumbnail previews for images
- Video previews on hover

### Upload

- Click to browse or drag & drop files
- Automatic routing to IMAGES or VIDEOS folder
- Progress feedback via toast notifications

### Preview

- Full-size image preview in modal
- Video playback with controls
- Keyboard navigation (Escape to close)

### Actions

- Download files directly
- Delete files with confirmation
- Refresh file list

## Development

### Project Structure

```
agent/
├── src/
│   ├── agent.ts        # Main server + frontend
│   └── mcp-client.ts   # MCP client wrapper
├── dist/               # Compiled JavaScript
├── package.json
└── tsconfig.json
```

### Build

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

## Security

- All file operations go through the MCP server's security measures
- No direct filesystem access from the frontend
- Path traversal prevention inherited from MCP server

## License

MIT
