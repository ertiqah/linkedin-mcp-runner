#!/usr/bin/env node

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const readline = require('readline');

// --- Configuration ---
const packageName = 'linkedin-mcp-runner'; // Used for messages
const backendApiUrl =
  "https://staging.btensai.com/api/mcp/publish-linkedin-post";

// Get the actual package name from package.json for the setup command
let publishedPackageName = packageName; // Default
try {
  const pkgJsonPath = path.join(__dirname, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = require(pkgJsonPath);
    publishedPackageName = pkg.name || packageName;
  }
} catch (e) {
  console.error(`${packageName}: Warning - Could not read package.json to confirm published name. Using default.`);
}
// --- End Configuration ---


// --- Setup Functions ---
function getConfigPath() {
    const platform = os.platform();
    switch (platform) {
        case 'darwin': // macOS
            return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        case 'win32': // Windows
            if (!process.env.APPDATA) {
                console.error("Error: APPDATA environment variable not found. Cannot locate config file on Windows.");
                process.exit(1);
            }
            return path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json');
        case 'linux': // Linux
            // Linux path might vary, use common default but mention others
             const standardPath = path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
             // Add checks for snap/flatpak if necessary in the future
             // For now, stick to the standard XDG base directory convention
             return standardPath;
        default:
            console.error(`Error: Unsupported platform for setup: ${platform}`);
            process.exit(1);
    }
}

// Function to parse command line arguments for the API key
function parseApiKeyArg(args) {
    const apiKeyIndex = args.indexOf('--api-key');
    if (apiKeyIndex !== -1 && apiKeyIndex + 1 < args.length) {
        return args[apiKeyIndex + 1];
    }
    return null;
}

async function runSetup(apiKeyFromArg) {
    console.log(`Running ${packageName} setup...`);
    const configPath = getConfigPath();
    console.log(`Target Claude config file: ${configPath}`);

    let configData = {};
    try {
        if (await fs.pathExists(configPath)) {
            console.log("Reading existing configuration file...");
            configData = await fs.readJson(configPath);
            console.log("Existing configuration read successfully.");
        } else {
            console.log("Configuration file does not exist. Creating default structure.");
        }
    } catch (err) {
        console.error(`Error reading configuration file at ${configPath}. It might be corrupted.`, err);
        console.error("Please check the file or delete it to allow recreation.");
        process.exit(1);
    }

    // Ensure mcpServers key exists
    if (!configData.mcpServers) {
        console.log("Adding 'mcpServers' section to configuration...");
        configData.mcpServers = {};
    } else {
         console.log("'mcpServers' section found.");
    }

    // Determine the API key value to use
    const apiKeyToUse = apiKeyFromArg || "PASTE_YOUR_API_KEY_HERE";
    if (apiKeyFromArg) {
        console.log("Using API key provided via --api-key argument.");
    } else {
        console.log("API key not provided via argument. Using placeholder.");
    }

    // Add or update the LinkedIn server entry
    const serverKey = 'linkedin';
    console.log(`Adding/Updating '${serverKey}' entry in 'mcpServers'...`);
    configData.mcpServers[serverKey] = {
        command: "npx",
        args: [
            "-y",
            publishedPackageName
        ],
        env: {
            "LINKEDIN_MCP_API_KEY": apiKeyToUse
        }
    };

    // Write the updated configuration back
    try {
        console.log("Writing updated configuration back to file...");
        await fs.ensureDir(path.dirname(configPath));
        await fs.writeJson(configPath, configData, { spaces: 2 });
        console.log("Configuration updated successfully!");
        console.log("\n----------------------------------------------------------");
        if (apiKeyFromArg) {
            console.log("SUCCESS! LinkedIn MCP Server configured with your API key.");
            console.log("Please restart the Claude Desktop app for changes to take effect.");
        } else {
            console.log("IMPORTANT ACTION REQUIRED:");
            console.log(`Please open the file: ${configPath}`);
            console.log(`Find the 'linkedin' server entry under 'mcpServers'.`);
            console.log("Replace 'PASTE_YOUR_API_KEY_HERE' with your actual LinkedIn MCP API Key.");
            console.log("After adding your API key, restart the Claude Desktop app.");
        }
        console.log("----------------------------------------------------------\n");

    } catch (err) {
        console.error(`Error writing configuration file to ${configPath}.`, err);
        console.error("Please check file permissions and disk space.");
        process.exit(1);
    }
}
// --- End Setup Functions ---


// --- MCP Server Functions (Pure Node.js) ---

// Function to send a JSON-RPC response
function sendResponse(response) {
  const responseString = JSON.stringify(response);
  console.log(responseString); // Write to stdout, MCP expects newline delimited
  // Log for debugging what we sent
  // console.error(`${packageName}: SENT Response: ${responseString}`);
}

// Function to handle incoming requests
async function handleRequest(request) {
  // Simple validation
  if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0' || !request.id || typeof request.method !== 'string') {
    sendResponse({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: request.id || null });
    return;
  }

  const { method, params, id } = request;

  if (method === 'publish_linkedin_post') {
    const apiKey = process.env.LINKEDIN_MCP_API_KEY;
    const postText = params?.post_text;

    if (!apiKey) {
      sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: LINKEDIN_MCP_API_KEY environment variable not set." }, id });
      return;
    }
    if (typeof postText !== 'string' || postText.trim() === '') {
      sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid params: 'post_text' parameter is required and must be a non-empty string." }, id });
      return;
    }

    try {
      const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json" // Good practice to specify accept header
      };
      const payload = {
        "post_text": postText
      };

      // console.error(`${packageName}: Sending request to backend: ${backendApiUrl} with text: ${postText.substring(0, 30)}...`);
      const apiResponse = await axios.post(backendApiUrl, payload, {
         headers,
         timeout: 30000 // 30 second timeout
      });

      // console.error(`${packageName}: Backend response status: ${apiResponse.status}`);
      // console.error(`${packageName}: Backend response data:`, apiResponse.data);

      // Assuming the backend API responds with JSON, check for its success/error structure
       if (apiResponse.data && apiResponse.data.success) {
           // Send success response back to MCP client
            sendResponse({ jsonrpc: "2.0", result: "✅ Successfully published post to LinkedIn.", id });
       } else {
           // Forward the error from the backend API if available, otherwise generic message
           const errorMessage = apiResponse.data?.error || "Backend API indicated failure but provided no specific error message.";
           sendResponse({ jsonrpc: "2.0", error: { code: -32002, message: `Backend API Error: ${errorMessage}` }, id });
       }

    } catch (error) {
      // console.error(`${packageName}: Error calling backend API:`, error);
      let errorCode = -32000; // Default server error
      let errorMessage = `Failed to call backend API: ${error.message}`;

      if (error.response) {
        // The request was made and the server responded with a status code not in 2xx range
        errorMessage = `Backend API responded with status ${error.response.status}.`;
        // Include response body if possible and seems helpful (limit size)
        let responseBody = '';
         try { responseBody = JSON.stringify(error.response.data).substring(0, 200) + '...'; } catch { responseBody = '[Non-JSON response]'; }
         errorMessage += ` Body: ${responseBody}`;
         // Map HTTP errors to JSON-RPC potentially?
         if (error.response.status === 401 || error.response.status === 403) {
             errorCode = -32001; // Auth related error
             errorMessage = `Backend API Authentication/Authorization Error (Status ${error.response.status}). Check API Key.`;
         } else if (error.response.status === 400) {
             errorCode = -32602; // Invalid params often map to 400
             errorMessage = `Backend API reported Invalid Request (Status 400). Detail: ${responseBody}`;
         }

      } else if (error.request) {
        // The request was made but no response was received
        errorMessage = "No response received from backend API (check network/firewall/server status).";
        errorCode = -32003; // Connection error
      }
      // else: Something happened in setting up the request

      sendResponse({ jsonrpc: "2.0", error: { code: errorCode, message: errorMessage }, id });
    }

  } else {
    // Method not found
    sendResponse({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id });
  }
}

// Function to start the MCP server listener
function startMcpServer() {
    // console.error(`${packageName}: Starting MCP server in Node.js mode...`);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false // Important: treat stdin/stdout as streams, not interactive terminal
    });

    rl.on('line', (line) => {
      // console.error(`${packageName}: RECV Request: ${line}`);
      try {
        const request = JSON.parse(line);
        handleRequest(request); // handleRequest is async but we don't wait here - process requests independently
      } catch (e) {
        // Handle JSON parse error specifically
        // console.error(`${packageName}: Failed to parse JSON request:`, e);
        sendResponse({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      }
    });

    rl.on('close', () => {
     // console.error(`${packageName}: stdin closed. Exiting.`);
      process.exit(0);
    });

    // Indicate readiness (optional, but can be useful for debugging)
    // console.error(`${packageName}: Ready to receive MCP requests on stdin.`);
}
// --- End MCP Server Functions ---


// --- Main Execution Logic ---
async function main() {
    const args = process.argv.slice(2);

    if (args.length > 0 && args[0].toLowerCase() === 'setup') {
        // Pass remaining args to runSetup to check for --api-key
        const apiKey = parseApiKeyArg(args.slice(1)); // Pass args *after* 'setup'
        await runSetup(apiKey);
    } else {
        // Run the MCP server directly in this Node.js process
        startMcpServer();
    }
}

main().catch(err => {
    console.error(`${packageName}: Unhandled error in main function:`, err);
    process.exit(1);
}); 