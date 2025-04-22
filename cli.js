#!/usr/bin/env node

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const readline = require('readline');

// Configuration
const packageName = 'linkedin-mcp-runner';
const backendApiUrl = 'https://staging.btensai.com/api/mcp/publish-linkedin-post';
const backendScheduleApiUrl = 'https://staging.btensai.com/api/mcp/schedule-linkedin-post';

// Get the actual package name and version from package.json
let publishedPackageName = packageName;
let packageVersion = '0.0.0';
try {
  const pkgJsonPath = path.join(__dirname, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = require(pkgJsonPath);
    publishedPackageName = pkg.name || packageName;
    packageVersion = pkg.version || packageVersion;
  }
} catch (e) {
  console.error(`${packageName}: Warning - Could not read package.json. Using defaults.`);
}

// Setup Functions
function getConfigPath() {
    const platform = os.platform();
    switch (platform) {
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        case 'win32':
            if (!process.env.APPDATA) {
                console.error("Error: APPDATA environment variable not found."); process.exit(1);
            }
            return path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json');
        case 'linux':
             return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
        default:
            console.error(`Error: Unsupported platform: ${platform}`); process.exit(1);
    }
}

function parseApiKeyArg(args) {
    const apiKeyIndex = args.indexOf('--api-key');
    if (apiKeyIndex !== -1 && apiKeyIndex + 1 < args.length) { return args[apiKeyIndex + 1]; }
    return null;
}

async function runSetup(apiKeyFromArg) {
    console.log(`Running ${packageName} setup...`);
    const configPath = getConfigPath();
    console.log(`Target Claude config file: ${configPath}`);
    let configData = {};
    try {
        if (await fs.pathExists(configPath)) { configData = await fs.readJson(configPath); }
    } catch (err) { console.error(`Error reading config: ${err}`); process.exit(1); }
    if (!configData.mcpServers) { configData.mcpServers = {}; }
    const apiKeyToUse = apiKeyFromArg || "PASTE_YOUR_API_KEY_HERE";
    configData.mcpServers['linkedin'] = {
        command: "npx", args: ["-y", publishedPackageName],
        env: { "LINKEDIN_MCP_API_KEY": apiKeyToUse }
    };
    try {
        await fs.ensureDir(path.dirname(configPath));
        await fs.writeJson(configPath, configData, { spaces: 2 });
        console.log("Configuration updated!");
        console.log("\n----------------------------------------------------------");
        if (apiKeyFromArg) {
            console.log("SUCCESS! Restart Claude Desktop app.");
        } else {
            console.log("ACTION REQUIRED: Open file and PASTE YOUR API KEY:");
            console.log(configPath);
            console.log("Then restart Claude Desktop app.");
        }
        console.log("----------------------------------------------------------\n");
    } catch (err) { console.error(`Error writing config: ${err}`); process.exit(1); }
}

// MCP Server Functions
function sendResponse(response) {
  const responseString = JSON.stringify(response);
  console.log(responseString);
}

async function handleRequest(request) {
  if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0' || !request.id === undefined || typeof request.method !== 'string') {
     const id = request?.id ?? null;
     if(id !== null && request?.method !== 'initialize') {
         sendResponse({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request Structure" }, id });
         return;
     }
     if(id === null && request?.method !== 'initialize') return;
  }

  const { method, params, id } = request;

  // Handle Initialize Method
  if (method === 'initialize') {
      sendResponse({
          jsonrpc: "2.0",
          id: id,
          result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                  experimental: {},
                  prompts: { listChanged: false },
                  resources: { subscribe: false, listChanged: false },
                  tools: { listChanged: false }
              },
              serverInfo: {
                  name: publishedPackageName,
                  version: packageVersion
              }
          }
      });
      console.error(`${packageName}: Sent detailed initialize response.`);
      console.error(`${packageName}: Returned from initialize handler.`); 
      return;
  }

  // Handle tools/call Method
  if (method === 'tools/call') {
      if (!params || typeof params !== 'object') {
          sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid params for tools/call" }, id });
          return;
      }
      const { name, arguments: args } = params;

      if (name === 'publish_linkedin_post') {
          console.error(`${packageName}: Received call for publish_linkedin_post tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;
          const postText = args?.post_text;
          const media = args?.media;

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }
          if (typeof postText !== 'string' || postText.trim() === '') {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'post_text' (string) required." }, id });
              return;
          }
          if (media && (!Array.isArray(media) || media.some(item => !item || typeof item !== 'object' || typeof item.file_url !== 'string' || typeof item.filename !== 'string'))) {
               sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'media' must be an array of objects, each with 'file_url' and 'filename' strings." }, id });
               return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              const payload = { 
                "post_text": postText,
                "media": media || []
               };
              console.error(`${packageName}: Calling backend API: ${backendApiUrl} with payload:`, JSON.stringify(payload, null, 2));
              const apiResponse = await axios.post(backendApiUrl, payload, { headers, timeout: 60000 });
              console.error(`${packageName}: Backend API response status: ${apiResponse.status}`);
              console.error(`${packageName}: Backend API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                  // Include post_urn from backend if available
                  const postDetails = apiResponse.data.post_urn ? 
                    ` (Post ID: ${apiResponse.data.post_urn})` : '';
                  
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: { 
                      content: [
                        {
                          type: "text",
                          text: `✅ Successfully published post to LinkedIn${postDetails}.`
                        }
                      ],
                      isError: false
                    }, 
                    id 
                  });
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: Backend API Error: ${errorMessage}`);
                  // Report error within the result object
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to publish post to LinkedIn: ${errorMessage}`
                        }
                      ],
                      isError: true // Indicate tool execution error
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call backend API: ${error.message}`;
              // Determine a user-facing error message based on the error type
              if (error.response) {
                  errorMessage = `Backend API Error (Status ${error.response.status})`;
                  console.error(`${packageName}: Backend API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from backend API.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              // Report error within the result object
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to publish post to LinkedIn: ${errorMessage}`
                    }
                  ],
                  isError: true // Indicate tool execution error
                }, 
                id 
              });
          }
      } else if (name === 'schedule_linkedin_post') {
          console.error(`${packageName}: Received call for schedule_linkedin_post tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;
          const postText = args?.post_text;
          const scheduledDate = args?.scheduled_date;
          const media = args?.media;

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }
          if (typeof postText !== 'string' || postText.trim() === '') {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'post_text' (string) required." }, id });
              return;
          }
          if (typeof scheduledDate !== 'string' || scheduledDate.trim() === '') {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'scheduled_date' (ISO 8601 string) required." }, id });
              return;
          }
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledDate)) {
             sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'scheduled_date' must be a valid ISO 8601 string (e.g., 2025-12-31T10:00:00Z)." }, id });
             return;
           }
          if (media && (!Array.isArray(media) || media.some(item => !item || typeof item !== 'object' || typeof item.file_url !== 'string' || typeof item.filename !== 'string'))) {
               sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'media' must be an array of objects, each with 'file_url' and 'filename' strings." }, id });
               return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              const payload = {
                "post_text": postText,
                "scheduled_date": scheduledDate,
                "media": media || []
               };
              console.error(`${packageName}: Calling backend schedule API: ${backendScheduleApiUrl} with payload:`, JSON.stringify(payload, null, 2));
              const apiResponse = await axios.post(backendScheduleApiUrl, payload, { headers, timeout: 60000 });
              console.error(`${packageName}: Backend schedule API response status: ${apiResponse.status}`);
              console.error(`${packageName}: Backend schedule API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                   const scheduleDetails = apiResponse.data.scheduled_job_id ?
                     ` (Scheduled Job ID: ${apiResponse.data.scheduled_job_id})` : '';
                   sendResponse({
                     jsonrpc: "2.0",
                     result: {
                       content: [
                         {
                           type: "text",
                           text: `✅ Successfully scheduled post for LinkedIn${scheduleDetails}.`
                         }
                       ],
                       isError: false
                     },
                     id
                   });
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: Backend Schedule API Error: ${errorMessage}`);
                  sendResponse({
                    jsonrpc: "2.0",
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to schedule post for LinkedIn: ${errorMessage}`
                        }
                      ],
                      isError: true // Indicate tool execution error
                    },
                    id
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call backend schedule API: ${error.message}`;
              if (error.response) {
                  const backendError = error.response.data?.error;
                  errorMessage = backendError ? `Backend API Error: ${backendError}` : `Backend API Error (Status ${error.response.status})`;
                  console.error(`${packageName}: Backend Schedule API Error Response:`, error.response.data);
              } else if (error.request) {
                  errorMessage = "No response received from backend schedule API.";
              }
              console.error(`${packageName}: ${errorMessage}`);

              sendResponse({
                jsonrpc: "2.0",
                result: {
                  content: [
                    {
                      type: "text",
                      text: `Failed to schedule post for LinkedIn: ${errorMessage}`
                    }
                  ],
                  isError: true // Indicate tool execution error
                },
                id
              });
          }
      } else {
          console.error(`${packageName}: Received tools/call for unknown tool: ${name}`);
          sendResponse({ jsonrpc: "2.0", error: { code: -32601, message: `Tool not found: ${name}` }, id });
      }
      return;
  }

  // Handle list requests and notifications
  if (method === 'tools/list') {
      console.error(`${packageName}: Received tools/list request, sending known tool.`);
      sendResponse({
          jsonrpc: "2.0",
          id: id,
          result: {
              tools: [
                  {
                      name: "publish_linkedin_post",
                      description: "Publish a text post to LinkedIn, optionally including media (images/videos) specified by URL.",
                      inputSchema: {
                          type: "object",
                          properties: {
                              post_text: {
                                  type: "string",
                                  description: "The text content of the LinkedIn post."
                              },
                              media: {
                                  type: "array",
                                  description: "Optional. A list of media items to attach to the post. Each item must have a 'file_url' pointing to a direct image or video URL and a 'filename'.",
                                  items: {
                                      type: "object",
                                      properties: {
                                          file_url: {
                                              type: "string",
                                              description: "A direct URL to the image or video file (e.g., ending in .jpg, .png, .mp4)."
                                          },
                                          filename: {
                                              type: "string",
                                              description: "A filename for the media item (e.g., 'promo_video.mp4')."
                                          }
                                      },
                                      required: ["file_url", "filename"]
                                  }
                              }
                          },
                          required: ["post_text"]
                      }
                  },
                  {
                      name: "schedule_linkedin_post",
                      description: "Schedule a text post for LinkedIn at a specific future date and time, optionally including media (images/videos) specified by URL.",
                      inputSchema: {
                          type: "object",
                          properties: {
                              post_text: {
                                  type: "string",
                                  description: "The text content of the LinkedIn post to be scheduled."
                              },
                              scheduled_date: {
                                  type: "string",
                                  description: "The date and time to publish the post, in ISO 8601 format (e.g., '2025-12-31T10:00:00Z' or '2025-12-31T15:30:00+05:30'). Must be in the future."
                              },
                              media: {
                                  type: "array",
                                  description: "Optional. A list of media items to attach to the post. Each item must have a 'file_url' pointing to a direct image or video URL and a 'filename'.",
                                  items: {
                                      type: "object",
                                      properties: {
                                          file_url: {
                                              type: "string",
                                              description: "A direct URL to the image or video file (e.g., ending in .jpg, .png, .mp4)."
                                          },
                                          filename: {
                                              type: "string",
                                              description: "A filename for the media item (e.g., 'meeting_notes.mp4')."
                                          }
                                      },
                                      required: ["file_url", "filename"]
                                  }
                              }
                          },
                          required: ["post_text", "scheduled_date"]
                      }
                  }
              ]
          }
      });
      return;
  } else if (method === 'resources/list' || method === 'prompts/list') {
      console.error(`${packageName}: Received ${method} request, sending empty list.`);
      sendResponse({ jsonrpc: "2.0", id: id, result: { [method.split('/')[0]]: [] } });
      return;
  } else if (method === 'notifications/initialized') {
      console.error(`${packageName}: Received notifications/initialized.`);
      return;
  }

  // Default Method not found for others
  console.error(`${packageName}: Method not found: ${method}`);
  sendResponse({ jsonrpc: "2.0", error: { code: -32601, message: `Method not found: ${method}` }, id });
}

// Function to start the MCP server listener
function startMcpServer() {
    console.error(`${packageName}: Setting up MCP listener on stdin/stdout...`);

    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false
    });

    rl.on('line', (line) => {
      console.error(`${packageName}: Received line: ${line.substring(0, 100)}...`);
      try {
        const request = JSON.parse(line);
        handleRequest(request).catch(err => {
            console.error(`${packageName}: Error during async handleRequest:`, err);
            const id = request?.id ?? null;
            if (id !== null) {
                sendResponse({ jsonrpc: "2.0", error: { code: -32000, message: "Internal Server Error during request handling" }, id });
            }
        });
      } catch (e) {
        console.error(`${packageName}: Failed to parse JSON request:`, e);
        sendResponse({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      }
    });

    rl.on('close', () => {
      // Do NOT exit here. If stdin closes, the process should ideally stay alive
      // to handle potential future signals or work.
      console.error(`${packageName}: stdin closed. Process will continue running if keep-alive is active.`);
    });

    console.error(`${packageName}: MCP listener ready.`);
}

// Main Execution Logic
async function main() {

    // Signal and Exception Handling
    process.on('SIGINT', () => {
        console.error(`${packageName}: Received SIGINT. Exiting...`);
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        // Do NOT exit on SIGTERM - Claude sends this after initialize, but expects the server to persist
        console.error(`${packageName}: Received SIGTERM. Ignoring to stay alive for MCP.`);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error(`${packageName}: Unhandled Rejection at:`, promise, 'reason:', reason);
    });

    const args = process.argv.slice(2);
    if (args.length > 0 && args[0].toLowerCase() === 'setup') {
        const apiKey = parseApiKeyArg(args.slice(1));
        await runSetup(apiKey);
        process.exit(0);
    } else {
        startMcpServer();

        // Keep Process Alive
        console.error(`${packageName}: Setting keep-alive interval.`);
        setInterval(() => {
            // Empty function - existence keeps the event loop busy
        }, 60000); // 1-minute interval

        console.error(`${packageName}: Process should remain active indefinitely.`);
    }
}

main().catch(err => {
    console.error(`${packageName}: Unhandled error in main:`, err);
    process.exit(1);
}); 