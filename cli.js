#!/usr/bin/env node

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const readline = require('readline');

// --- Configuration ---
const packageName = 'linkedin-mcp-runner'; // Used for messages
const backendApiUrl = 'https://staging.btensai.com/api/mcp/publish-linkedin-post'; // <<< Updated backend URL

// Get the actual package name and version from package.json
let publishedPackageName = packageName; // Default
let packageVersion = '0.0.0'; // Default
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
// --- End Configuration ---


// --- Setup Functions ---
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
// --- End Setup Functions ---


// --- MCP Server Functions (Pure Node.js) ---

function sendResponse(response) {
  const responseString = JSON.stringify(response);
  console.log(responseString);
}

async function handleRequest(request) {
  if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0' || !request.id === undefined || typeof request.method !== 'string') {
    // Note: Allow request.id to be 0 or null for notifications, but spec says it SHOULD exist for requests requiring response.
    // Let's be strict for now and require non-null id for non-notification methods.
     const id = request?.id ?? null; // Use provided id or null
     if(id !== null && request?.method !== 'initialize') { // Allow initialize without strict id check just in case, but respond if possible
         sendResponse({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request Structure" }, id });
         return;
     }
     // If it's potentially a notification or malformed, we might just ignore or log.
     // For now, let's focus on handling valid requests.
     if(id === null && request?.method !== 'initialize') return; // Ignore notifications for now
  }

  const { method, params, id } = request;

  // --- Handle Initialize Method --- <<< NEW
  if (method === 'initialize') {
      sendResponse({
          jsonrpc: "2.0",
          id: id, // Echo back the request id (should be 0)
          result: {
              capabilities: { /* Define any specific capabilities here if needed */ },
              serverInfo: {
                  name: publishedPackageName,
                  version: packageVersion
              }
          }
      });
      return; // Initialization complete
  }
  // --- End Handle Initialize Method ---

  // --- Handle publish_linkedin_post Method ---
  if (method === 'publish_linkedin_post') {
    const apiKey = process.env.LINKEDIN_MCP_API_KEY;
    const postText = params?.post_text;

    if (!apiKey) {
      sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
      return;
    }
    if (typeof postText !== 'string' || postText.trim() === '') {
      sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid params: 'post_text' required." }, id });
      return;
    }

    try {
      const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
      const payload = { "post_text": postText };
      const apiResponse = await axios.post(backendApiUrl, payload, { headers, timeout: 30000 });

       if (apiResponse.data && apiResponse.data.success) {
            sendResponse({ jsonrpc: "2.0", result: "✅ Successfully published post to LinkedIn.", id });
       } else {
           const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
           sendResponse({ jsonrpc: "2.0", error: { code: -32002, message: `Backend API Error: ${errorMessage}` }, id });
       }

    } catch (error) {
      let errorCode = -32000;
      let errorMessage = `Failed to call backend API: ${error.message}`;
      if (error.response) {
        errorMessage = `Backend API Error (Status ${error.response.status})`;
         if (error.response.status === 401 || error.response.status === 403) { errorCode = -32001; }
         else if (error.response.status === 400) { errorCode = -32602; }
      } else if (error.request) {
        errorMessage = "No response received from backend API.";
        errorCode = -32003;
      }
      sendResponse({ jsonrpc: "2.0", error: { code: errorCode, message: errorMessage }, id });
    }
  // --- End Handle publish_linkedin_post Method ---

  } else {
    // Method not found for any other methods
    sendResponse({ jsonrpc: "2.0", error: { code: -32601, message: `Method not found: ${method}` }, id });
  }
}

// Function to start the MCP server listener
function startMcpServer() {
    console.error(`${packageName}: Setting up MCP listener on stdin/stdout...`);

    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false
    });

    rl.on('line', (line) => {
      console.error(`${packageName}: Received line: ${line.substring(0, 100)}...`); // Log received data
      try {
        const request = JSON.parse(line);
        // Intentionally not awaiting handleRequest to process lines quickly
        handleRequest(request).catch(err => {
            // Catch potential errors within the async handleRequest itself
            console.error(`${packageName}: Error during async handleRequest:`, err);
            // Attempt to send a generic error response if possible
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
      console.error(`${packageName}: stdin closed. Exiting.`);
      process.exit(0);
    });

    // Indicate readiness (optional, but can be useful for debugging)
    console.error(`${packageName}: MCP listener ready.`);
}
// --- End MCP Server Functions ---


// --- Main Execution Logic ---
async function main() {
    const args = process.argv.slice(2);
    if (args.length > 0 && args[0].toLowerCase() === 'setup') {
        const apiKey = parseApiKeyArg(args.slice(1));
        await runSetup(apiKey);
        process.exit(0);
    } else {
        startMcpServer();

        // --- Keep Process Alive --- <<< NEW
        // Add a persistent interval timer to keep the Node.js event loop
        // active and prevent the process from exiting while readline listens.
        console.error(`${packageName}: Setting keep-alive interval.`);
        setInterval(() => {
            // This function doesn't need to do anything.
            // Its existence keeps the event loop busy.
        }, 1 << 30); // Use a very large interval (approx 12 days) to minimize overhead.

        console.error(`${packageName}: Process should remain active indefinitely.`);
    }
}

main().catch(err => {
    console.error(`${packageName}: Unhandled error:`, err);
    process.exit(1);
}); 