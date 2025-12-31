import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import * as path from "path";

export interface FileInfo {
  name: string;
  type?: string;
  mimeType?: string;
  path?: string;
  size?: number;
  sizeHuman?: string;
  created?: string;
  modified?: string;
}

export interface FolderListing {
  folder: string;
  files?: FileInfo[];
  images?: FileInfo[];
  videos?: FileInfo[];
}

export interface QueueStatus {
  active: number;
  waiting: number;
  maxConcurrent: number;
  waitingTickets?: { position: number; ticketId: string; estimatedWait: number }[];
}

export interface DownloadQueueStatus {
  active: { sessionId: string; filename: string; duration: number; ip: string }[];
  waiting: { position: number; sessionId: string; filename: string; waitTime: number }[];
  stats: { activeCount: number; waitingCount: number; maxConcurrent: number };
}

export interface TicketResponse {
  status: "granted" | "queued" | "active" | "expired";
  ticketId: string;
  position?: number;
  waitTime?: number;
  remainingTime?: number;
}

export interface StreamInfo {
  id: string;
  name: string;
  status: string;
  url?: string;
  startedAt?: Date;
  uptime?: number;
  playlistUrl?: string;
}

export class MCPFileClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;
  private serverPath: string;

  constructor(serverPath?: string) {
    this.serverPath = serverPath || path.resolve(process.cwd(), "../dist/index.js");
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    console.log("[MCP Client] Connecting to server:", this.serverPath);

    this.transport = new StdioClientTransport({
      command: "node",
      args: [this.serverPath],
      env: {
        ...process.env,
        STORAGE_DIR: process.env.STORAGE_DIR || path.resolve(process.cwd(), "../BRANDYFICATION"),
      },
    });

    this.client = new Client(
      { name: "brandyfication-agent", version: "1.0.0" },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    this.connected = true;
    console.log("[MCP Client] Connected successfully");
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      await this.client.close();
      this.connected = false;
      console.log("[MCP Client] Disconnected");
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    if (!this.client || !this.connected) {
      throw new Error("Not connected to MCP server");
    }

    const result = await this.client.callTool({ name, arguments: args });
    
    if (result.content && Array.isArray(result.content) && result.content.length > 0) {
      const content = result.content[0];
      if (content.type === "text") {
        return content.text as string;
      }
    }
    
    return "";
  }

  // File Operations
  async listFiles(folder: "IMAGES" | "VIDEOS" | "root" | "all" = "all"): Promise<FolderListing[]> {
    const result = await this.callTool("list_files", { folder });
    return JSON.parse(result);
  }

  async listImages(): Promise<{ folder: string; images: FileInfo[] }> {
    const result = await this.callTool("list_images");
    return JSON.parse(result);
  }

  async listVideos(): Promise<{ folder: string; videos: FileInfo[] }> {
    const result = await this.callTool("list_videos");
    return JSON.parse(result);
  }

  async uploadFile(filename: string, content: string, encoding: "base64" | "utf8" = "base64"): Promise<string> {
    return await this.callTool("upload_file", { filename, content, encoding });
  }

  async uploadImage(filename: string, content: string): Promise<string> {
    return await this.callTool("upload_image", { filename, content });
  }

  async uploadVideo(filename: string, content: string): Promise<string> {
    return await this.callTool("upload_video", { filename, content });
  }

  async downloadFile(filename: string, folder?: "IMAGES" | "VIDEOS" | "root", encoding: "base64" | "utf8" = "base64"): Promise<string> {
    const args: Record<string, unknown> = { filename, encoding };
    if (folder) args.folder = folder;
    return await this.callTool("download_file", args);
  }

  async deleteFile(filename: string, folder?: "IMAGES" | "VIDEOS" | "root"): Promise<string> {
    const args: Record<string, unknown> = { filename };
    if (folder) args.folder = folder;
    return await this.callTool("delete_file", args);
  }

  async getFileInfo(filename: string, folder?: "IMAGES" | "VIDEOS" | "root"): Promise<FileInfo> {
    const args: Record<string, unknown> = { filename };
    if (folder) args.folder = folder;
    const result = await this.callTool("get_file_info", args);
    return JSON.parse(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌀 BRANDYFICATION QUEUE & STREAMING METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  async createDirectory(name: string, parentFolder?: "IMAGES" | "VIDEOS" | "root"): Promise<string> {
    const args: Record<string, unknown> = { name };
    if (parentFolder) args.parentFolder = parentFolder;
    return await this.callTool("create_directory", args);
  }

  async getQueueStatus(): Promise<QueueStatus> {
    const result = await this.callTool("get_queue_status", {});
    return JSON.parse(result);
  }

  async joinDownloadQueue(filename: string, folder?: "IMAGES" | "VIDEOS" | "root"): Promise<TicketResponse> {
    const args: Record<string, unknown> = { filename };
    if (folder) args.folder = folder;
    const result = await this.callTool("join_download_queue", args);
    return JSON.parse(result);
  }

  async checkTicket(ticketId: string): Promise<TicketResponse> {
    const result = await this.callTool("check_ticket", { ticketId });
    return JSON.parse(result);
  }

  async getDownloadQueueStatus(): Promise<DownloadQueueStatus> {
    const result = await this.callTool("get_download_queue_status", {});
    return JSON.parse(result);
  }

  async getActiveStreams(): Promise<StreamInfo[]> {
    const result = await this.callTool("get_active_streams", {});
    return JSON.parse(result);
  }

  async startStream(source: string, type: "rtmp" | "rtsp"): Promise<StreamInfo> {
    const result = await this.callTool("start_stream", { source, type });
    return JSON.parse(result);
  }

  async stopStream(streamId: string): Promise<string> {
    return await this.callTool("stop_stream", { streamId });
  }

  // Get available tools
  async getTools(): Promise<unknown[]> {
    if (!this.client || !this.connected) {
      throw new Error("Not connected to MCP server");
    }
    const result = await this.client.listTools();
    return result.tools;
  }
}
