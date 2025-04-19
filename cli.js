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
  darwin: "PASTE_YOUR_MACOS_DOWNLOAD_URL_HERE", // macOS (darwin)
  // win32: "YOUR_WINDOWS_EXE_URL_HERE",      // Windows
  // linux: "YOUR_LINUX_EXECUTABLE_URL_HERE",   // Linux
};

const executableNames = {
  darwin: 'linkedin-mcp-macos',
  // win32: 'linkedin-mcp-win.exe',
  // linux: 'linkedin-mcp-linux',
};

const packageName = 'linkedin-mcp-runner'; // Used for cache directory
const cacheDir = path.join(os.homedir(), '.cache', packageName);
// --- End Configuration ---

async function downloadExecutable(url, dest) {
  console.error(`${packageName}: Downloading executable from ${url} to ${dest}...`);
  const writer = fs.createWriteStream(dest);
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      onDownloadProgress: (progressEvent) => {
        const total = parseFloat(progressEvent.total);
        const current = progressEvent.loaded;
        let percentCompleted = Math.floor((current / total) * 100);
        // Simple progress indication to stderr
        process.stderr.write(`${packageName}: Downloading... ${percentCompleted}%\n`);
      },
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
         process.stderr.write('\n'); // New line after progress
         console.error(`${packageName}: Download complete.`);
         resolve();
      });
      writer.on('error', (err) => {
        console.error(`\n${packageName}: Error writing file:`, err);
        fs.unlink(dest, () => {}); // Attempt to delete partial file
        reject(err);
      });
    });
  } catch (error) {
     console.error(`\n${packageName}: Error during download:`, error.message || error);
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

  if (await fs.pathExists(executablePath)) {
    console.error(`${packageName}: Found cached executable: ${executablePath}`);
    // Optional: Add version checking/update logic here if needed
    return executablePath;
  }

  console.error(`${packageName}: Executable not found in cache.`);
  await fs.ensureDir(cacheDir);

  try {
    await downloadExecutable(url, executablePath);
    await makeExecutable(executablePath);
    return executablePath;
  } catch (error) {
    console.error(`${packageName}: Failed to obtain executable. Exiting.`);
    process.exit(1);
  }
}

async function main() {
  const platform = os.platform(); // e.g., 'darwin', 'win32', 'linux'
  const executablePath = await ensureExecutable(platform);

  console.error(`${packageName}: Starting MCP server: ${executablePath}`);

  // Spawn the Python executable
  const mcpProcess = spawn(executablePath, [], {
    stdio: 'inherit', // Crucial: Inherit stdin, stdout, stderr
    env: {
      ...process.env, // Pass through existing environment variables
      // Ensure the API key from MCP config's env block is passed
      // LINKEDIN_MCP_API_KEY should be set by the npx call's environment
    },
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
     console.error(`
${packageName}: Received SIGINT. Terminating MCP process...`);
     mcpProcess.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
      console.error(`
${packageName}: Received SIGTERM. Terminating MCP process...`);
      mcpProcess.kill('SIGTERM');
  });
}

main().catch(err => {
  console.error(`${packageName}: Unhandled error:`, err);
  process.exit(1);
}); 