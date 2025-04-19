#!/usr/bin/env node

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const chmodr = require('chmodr');

// --- Configuration ---
// IMPORTANT: Replace with your actual download URLs
const executableUrls = {
  darwin: "https://github.com/ertiqah/linkedin-mcp-runner/releases/download/v1.0.0/linkedin-mcp-macos", // macOS (darwin)
  win32: "https://github.com/ertiqah/linkedin-mcp-runner/releases/download/v1.0.0/linkedin-mcp-win.exe", // Windows
  // linux: "YOUR_LINUX_EXECUTABLE_URL_HERE",   // Linux
};

const executableNames = {
  darwin: 'linkedin-mcp-macos',
  win32: 'linkedin-mcp-win.exe', // Windows executable name
  // linux: 'linkedin-mcp-linux',
};

const packageName = 'linkedin-mcp-runner'; // Used for cache directory
const cacheDir = path.join(os.homedir(), '.cache', packageName);
// --- End Configuration ---

async function downloadExecutable(url, dest) {
  console.error(`${packageName}: Preparing to download from URL: ${url}`);
  console.error(`${packageName}: Destination path: ${dest}`);
  const writer = fs.createWriteStream(dest);
  try {
    console.error(`${packageName}: Initiating download request...`);
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      // Adding a timeout
      timeout: 60000, // 60 seconds timeout
      // Adding a basic user-agent - sometimes helps with services blocking default agents
      headers: { 
        'User-Agent': 'axios/linkedin-mcp-runner-download' 
      },
      onDownloadProgress: (progressEvent) => {
        const total = parseFloat(progressEvent.total);
        const current = progressEvent.loaded;
        if (total && current) {
          let percentCompleted = Math.floor((current / total) * 100);
          process.stderr.write(`${packageName}: Downloading... ${percentCompleted}%\r`);
        } else {
          process.stderr.write(`${packageName}: Downloading... (Size unknown)\r`);
        }
      },
    });

    console.error(`${packageName}: Download request successful (Status: ${response.status}). Piping to file...`);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
         process.stderr.write('\n'); // New line after progress
         console.error(`${packageName}: File write finished.`);
         resolve();
      });
      writer.on('error', (err) => {
        console.error(`\n${packageName}: Error writing file stream:`, err);
        fs.unlink(dest, () => {}); // Attempt to delete partial file
        reject(err);
      });
    });
  } catch (error) {
     console.error(`\n${packageName}: Download attempt failed.`);
     // Log more detailed error info
     if (error.response) {
       // The request was made and the server responded with a status code
       // that falls out of the range of 2xx
       console.error(`${packageName}: Server responded with status: ${error.response.status}`);
       console.error(`${packageName}: Response headers:`, JSON.stringify(error.response.headers, null, 2));
       // Log response data if available (might be HTML for a 404 page)
       // Limit logging in case it's huge
       if (error.response.data) {
          let responseDataStr = '';
          if (typeof error.response.data === 'object') {
             // If it's a stream or buffer, try to read a bit
             // Note: This might consume the stream, handle with care in production
             // For debugging, just indicate type
             responseDataStr = `[Response Data Type: ${typeof error.response.data}]`;
          } else {
            responseDataStr = error.response.data.toString().substring(0, 500) + '...';
          }
          console.error(`${packageName}: Response data snippet:`, responseDataStr);
       }       
     } else if (error.request) {
       // The request was made but no response was received
       console.error(`${packageName}: No response received from server. Error details:`, error.message);
       console.error(`${packageName}: Request config:`, JSON.stringify(error.request.config, null, 2));
     } else {
       // Something happened in setting up the request that triggered an Error
       console.error(`${packageName}: Error setting up request:`, error.message);
     }
     console.error(`${packageName}: Full error object:`, error);

     // Attempt to delete partial file if writer exists
     if (writer && !writer.closed) {
        writer.close(() => fs.unlink(dest, () => {}));
     } else {
        fs.unlink(dest, () => {});
     }
     throw error; // Re-throw error to be caught by main function
  }
}

function makeExecutable(filePath) {
  console.error(`${packageName}: Setting execute permissions for ${filePath}...`);
  return new Promise((resolve, reject) => {
    chmodr(filePath, 0o755, (err) => { // 0o755 means rwxr-xr-x
      if (err) {
        console.error(`${packageName}: Failed to set execute permissions:`, err);
        reject(err);
      } else {
        console.error(`${packageName}: Execute permissions set.`);
        resolve();
      }
    });
  });
}

async function ensureExecutable(platform) {
  const url = executableUrls[platform];
  const execName = executableNames[platform];

  if (!url || !execName) {
    console.error(`${packageName}: Unsupported platform: ${platform}`);
    process.exit(1);
  }

  const executablePath = path.join(cacheDir, execName);

  console.error(`${packageName}: Checking cache for executable at: ${executablePath}`);
  if (await fs.pathExists(executablePath)) {
    console.error(`${packageName}: Found cached executable.`);
    // Optional: Add version checking/update logic here if needed
    return executablePath;
  }

  console.error(`${packageName}: Executable not found in cache. Ensuring cache directory exists at: ${cacheDir}`);
  await fs.ensureDir(cacheDir);

  try {
    await downloadExecutable(url, executablePath);
    await makeExecutable(executablePath);
    return executablePath;
  } catch (error) {
    console.error(`${packageName}: Failed to ensure executable is available. See download errors above.`);
    process.exit(1);
  }
}

async function main() {
  const platform = os.platform(); // e.g., 'darwin', 'win32', 'linux'
  console.error(`${packageName}: Detected platform: ${platform}`);
  const executablePath = await ensureExecutable(platform);

  console.error(`${packageName}: Starting MCP server using executable: ${executablePath}`);

  // Spawn the Python executable
  const mcpProcess = spawn(executablePath, [], {
    stdio: 'inherit', // Crucial: Inherit stdin, stdout, stderr
    env: {
      ...process.env, // Pass through existing environment variables
    },
  });

  mcpProcess.on('spawn', () => {
    console.error(`${packageName}: MCP process successfully spawned.`);
  });

  mcpProcess.on('error', (err) => {
    console.error(`${packageName}: Failed to start MCP process:`, err);
    process.exit(1);
  });

  mcpProcess.on('close', (code) => {
    console.error(`${packageName}: MCP process exited with code ${code}`);
    process.exit(code === null ? 1 : code); // Propagate exit code
  });

  // Graceful shutdown handling
  process.on('SIGINT', () => {
     console.error(`\n${packageName}: Received SIGINT. Terminating MCP process...`);
     if (!mcpProcess.killed) mcpProcess.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
      console.error(`\n${packageName}: Received SIGTERM. Terminating MCP process...`);
      if (!mcpProcess.killed) mcpProcess.kill('SIGTERM');
  });
}

main().catch(err => {
  console.error(`${packageName}: Unhandled error in main function:`, err);
  process.exit(1);
}); 