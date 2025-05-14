#!/usr/bin/env node

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const readline = require('readline');

// Configuration
const packageName = 'linkedin-mcp-runner';
const backendApiUrl = 'https://ligo.ertiqah.com/api/mcp/publish-linkedin-post';
const backendScheduleApiUrl = 'https://ligo.ertiqah.com/api/mcp/schedule-linkedin-post';
const backendTwitterApiUrl = 'https://ligo.ertiqah.com/api/mcp/publish-twitter-post';
const backendAnalyzeChatApiUrl = 'https://ligo.ertiqah.com/api/mcp/analyze-linkedin-chat';
const backendGeneratePostApiUrl = 'https://ligo.ertiqah.com/api/mcp/generate-linkedin-post';
const backendLinkedinPostsApiUrl = 'https://ligo.ertiqah.com/api/mcp/linkedin/posts';
const backendLinkedinProfileApiUrl = 'https://ligo.ertiqah.com/api/mcp/linkedin/profile';
const backendLinkedinSetUrlApiUrl = 'https://ligo.ertiqah.com/api/mcp/linkedin/set-url';
const backendLinkedinRefreshProfileApiUrl = 'https://ligo.ertiqah.com/api/mcp/linkedin/refresh-profile';
const backendLinkedinRefreshPostsApiUrl = 'https://ligo.ertiqah.com/api/mcp/linkedin/refresh-posts';

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
      } else if (name === 'publish_twitter_post') {
          console.error(`${packageName}: Received call for publish_twitter_post tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;
          const postText = args?.post_text;

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }
          if (typeof postText !== 'string' || postText.trim() === '') {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'post_text' (string) required." }, id });
              return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              const payload = { 
                "post_text": postText
              };
              console.error(`${packageName}: Calling Twitter API: ${backendTwitterApiUrl} with payload:`, JSON.stringify(payload, null, 2));
              const apiResponse = await axios.post(backendTwitterApiUrl, payload, { headers, timeout: 60000 });
              console.error(`${packageName}: Twitter API response status: ${apiResponse.status}`);
              console.error(`${packageName}: Twitter API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                  // Include tweet_id from backend if available
                  const tweetDetails = apiResponse.data.tweet_id ? 
                    ` (Tweet ID: ${apiResponse.data.tweet_id})` : '';
                  
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: { 
                      content: [
                        {
                          type: "text",
                          text: `✅ Successfully published tweet to Twitter${tweetDetails}.`
                        }
                      ],
                      isError: false
                    }, 
                    id 
                  });
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: Twitter API Error: ${errorMessage}`);
                  // Report error within the result object
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to publish tweet to Twitter: ${errorMessage}`
                        }
                      ],
                      isError: true
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call Twitter API: ${error.message}`;
              // Determine a user-facing error message based on the error type
              if (error.response) {
                  errorMessage = `Twitter API Error (Status ${error.response.status})`;
                  console.error(`${packageName}: Twitter API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from Twitter API.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              // Report error within the result object
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to publish tweet to Twitter: ${errorMessage}`
                    }
                  ],
                  isError: true
                }, 
                id 
              });
          }
      } else if (name === 'analyze_linkedin_chat') {
          console.error(`${packageName}: Received call for analyze_linkedin_chat tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;
          const query = args?.query;
          const conversationHistory = args?.conversation_history || [];

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }
          if (typeof query !== 'string' || query.trim() === '') {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'query' (string) required." }, id });
              return;
          }
          if (!Array.isArray(conversationHistory)) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'conversation_history' must be an array." }, id });
              return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              const payload = { 
                "query": query,
                "conversation_history": conversationHistory
              };
              console.error(`${packageName}: Calling analyze chat API: ${backendAnalyzeChatApiUrl} with payload:`, JSON.stringify(payload, null, 2));
              const apiResponse = await axios.post(backendAnalyzeChatApiUrl, payload, { headers, timeout: 60000 });
              console.error(`${packageName}: Analyze chat API response status: ${apiResponse.status}`);
              console.error(`${packageName}: Analyze chat API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.reply) {
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: { 
                      content: [
                        {
                          type: "text",
                          text: apiResponse.data.reply
                        }
                      ],
                      isError: false
                    }, 
                    id 
                  });
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: Analyze chat API Error: ${errorMessage}`);
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to analyze LinkedIn chat: ${errorMessage}`
                        }
                      ],
                      isError: true
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call analyze chat API: ${error.message}`;
              if (error.response) {
                  errorMessage = `Backend API Error (Status ${error.response.status})`;
                  console.error(`${packageName}: Analyze chat API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from analyze chat API.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to analyze LinkedIn chat: ${errorMessage}`
                    }
                  ],
                  isError: true
                }, 
                id 
              });
          }
      } else if (name === 'generate_linkedin_post') {
          console.error(`${packageName}: Received call for generate_linkedin_post tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;
          const content = args?.content;
          const contentType = args?.content_type || 'article';

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }
          if (typeof content !== 'string' || content.trim() === '') {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'content' (string) required." }, id });
              return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              const payload = { 
                "content": content,
                "contentType": contentType
              };
              console.error(`${packageName}: Calling generate post API: ${backendGeneratePostApiUrl} with payload:`, JSON.stringify(payload, null, 2));
              const apiResponse = await axios.post(backendGeneratePostApiUrl, payload, { headers, timeout: 60000 });
              console.error(`${packageName}: Generate post API response status: ${apiResponse.status}`);
              console.error(`${packageName}: Generate post API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                  if (apiResponse.data.variants && Array.isArray(apiResponse.data.variants)) {
                      // Handle the case where we get an array of variant posts
                      const variants = apiResponse.data.variants;
                      
                      // Create content items - first a text description, then one item for each variant
                      const contentItems = [
                          {
                              type: "text",
                              text: `Generated ${variants.length} LinkedIn post variants:`
                          }
                      ];
                      
                      // Add each variant as a separate text item for better formatting
                      variants.forEach((variant, index) => {
                          contentItems.push({
                              type: "text",
                              text: `Option ${index + 1}:\n${variant}`
                          });
                      });
                      
                      sendResponse({ 
                          jsonrpc: "2.0", 
                          result: { 
                              content: contentItems,
                              isError: false
                          }, 
                          id 
                      });
                  } else {
                      // Fallback for backward compatibility
                      sendResponse({ 
                          jsonrpc: "2.0", 
                          result: { 
                              content: [
                                  {
                                      type: "text",
                                      text: apiResponse.data.message || "Successfully generated LinkedIn post, but no variants were returned. Please check the backend implementation."
                                  }
                              ],
                              isError: false
                          }, 
                          id 
                      });
                  }
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: Generate post API Error: ${errorMessage}`);
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to generate LinkedIn post: ${errorMessage}`
                        }
                      ],
                      isError: true
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call generate post API: ${error.message}`;
              if (error.response) {
                  errorMessage = `Backend API Error (Status ${error.response.status})`;
                  console.error(`${packageName}: Generate post API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from generate post API.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to generate LinkedIn post: ${errorMessage}`
                    }
                  ],
                  isError: true
                }, 
                id 
              });
          }
      } else if (name === 'get_linkedin_posts') {
          console.error(`${packageName}: Received call for get_linkedin_posts tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;
          const limit = args?.limit || 5;

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }
          if (typeof limit !== 'number' || limit < 1 || limit > 20) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'limit' must be a number between 1 and 20." }, id });
              return;
          }

          try {
              const headers = { 
                "Authorization": `Bearer ${apiKey}`, 
                "Content-Type": "application/json", 
                "Accept": "*/*" // Accept any content type
              };
              const payload = { limit };
              console.error(`${packageName}: Calling LinkedIn posts API: ${backendLinkedinPostsApiUrl} with payload:`, JSON.stringify(payload, null, 2));
              const apiResponse = await axios.post(backendLinkedinPostsApiUrl, payload, { headers, timeout: 60000 });
              console.error(`${packageName}: LinkedIn posts API response status: ${apiResponse.status}`);
              console.error(`${packageName}: LinkedIn posts API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                  // More flexible posts extraction - handle different response structures
                  const posts = apiResponse.data.posts || [];
                  
                  // Safely map over posts with fallback values for missing properties
                  const formattedPosts = posts.map(post => {
                      if (!post) return {}; // Skip null/undefined posts
                      
                      return {
                          text: post.text || '',
                          postedDate: post.postedDate || post.posted_at || '',
                          postUrl: post.post_url || post.postUrl || '',
                          reactions: post.total_reactions_count || post.reactions || 0,
                          comments: post.comments_count || post.comments || 0,
                          reposts: post.reposts_count || post.reposts || 0
                      };
                  }).filter(post => post.text); // Only include posts with text content

                  // Include staleness info if available
                  const dataInfo = apiResponse.data.data_last_updated || 'Unknown';
                  const stalenessInfo = apiResponse.data.data_staleness_info || '';
                  const infoText = stalenessInfo 
                      ? `Found ${formattedPosts.length} LinkedIn posts. Last updated: ${dataInfo}. ${stalenessInfo}`
                      : `Found ${formattedPosts.length} LinkedIn posts. Last updated: ${dataInfo}`;

                  // Format posts as text to avoid "unsupported content type: data" error
                  let postsAsText = formattedPosts.map((post, index) => {
                    return `Post ${index + 1}:\n` +
                           `Content: ${post.text}\n` +
                           `Posted: ${post.postedDate}\n` +
                           `URL: ${post.postUrl}\n` +
                           `Metrics: ${post.reactions} reactions, ${post.comments} comments, ${post.reposts} reposts\n`;
                  }).join('\n\n');

                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: { 
                      content: [
                        {
                          type: "text",
                          text: infoText
                        },
                        {
                          type: "text",
                          text: postsAsText
                        }
                      ],
                      isError: false
                    }, 
                    id 
                  });
              } else {
                  // More comprehensive error handling
                  const errorMessage = apiResponse.data?.error || 
                                      apiResponse.data?.message ||
                                      "Backend API Error (no detail)";
                                      
                  // Include suggestion if available
                  const suggestion = apiResponse.data?.suggestion 
                      ? `\n\nSuggestion: ${apiResponse.data.suggestion}`
                      : '';
                                      
                  console.error(`${packageName}: LinkedIn posts API Error: ${errorMessage}`);
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to get LinkedIn posts: ${errorMessage}${suggestion}`
                        }
                      ],
                      isError: true
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call LinkedIn posts API: ${error.message}`;
              if (error.response) {
                  // Log complete response for debugging
                  console.error(`${packageName}: LinkedIn posts API Full Response Headers:`, error.response.headers);
                  console.error(`${packageName}: LinkedIn posts API Full Response Body:`, error.response.data);
                  
                  const status = error.response.status;
                  // Extract error message from response data, handling various formats
                  const responseData = error.response.data || {};
                  const extractedError = responseData.error || 
                                        responseData.message ||
                                        (typeof responseData === 'string' ? responseData : null);
                  
                  if (status === 404) {
                      errorMessage = "LinkedIn posts not found. Make sure you've set your LinkedIn URL using set_linkedin_url tool and that the profile is publicly accessible.";
                      // Add suggestion if available
                      if (responseData.suggestion) {
                          errorMessage += `\n\nSuggestion: ${responseData.suggestion}`;
                      }
                  } else if (status === 401 || status === 403) {
                      errorMessage = "Authentication error. Your API key may be invalid or expired.";
                  } else {
                      errorMessage = `Backend API Error (Status ${status}): ${extractedError || "Unknown error"}`;
                  }
                  console.error(`${packageName}: LinkedIn posts API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from LinkedIn posts API. The server may be unavailable or experiencing issues.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to get LinkedIn posts: ${errorMessage}`
                    }
                  ],
                  isError: true
                }, 
                id 
              });
          }
      } else if (name === 'get_linkedin_profile') {
          console.error(`${packageName}: Received call for get_linkedin_profile tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              console.error(`${packageName}: Calling LinkedIn profile API: ${backendLinkedinProfileApiUrl}`);
              const apiResponse = await axios.post(backendLinkedinProfileApiUrl, {}, { headers, timeout: 60000 });
              console.error(`${packageName}: LinkedIn profile API response status: ${apiResponse.status}`);
              console.error(`${packageName}: LinkedIn profile API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                  const profile = apiResponse.data.profile || {};
                  
                  // Format profile as text to avoid "unsupported content type: data" error
                  let profileHeadline = profile.headline || 'No headline';
                  let profileSummary = profile.summary || 'No summary';
                  
                  // Format experience entries
                  let experienceText = 'Experience:';
                  if (profile.experience && Array.isArray(profile.experience) && profile.experience.length > 0) {
                      profile.experience.forEach((exp, index) => {
                          experienceText += `\n\n${index + 1}. ${exp.title || 'Role'} at ${exp.companyName || 'Company'}`;
                          if (exp.dateRange || exp.duration) {
                              experienceText += `\n   Duration: ${exp.dateRange || exp.duration || 'Not specified'}`;
                          }
                          if (exp.description) {
                              experienceText += `\n   Description: ${exp.description}`;
                          }
                      });
                  } else {
                      experienceText += '\n   No experience data available';
                  }
                  
                  // Format education entries
                  let educationText = '\n\nEducation:';
                  if (profile.education && Array.isArray(profile.education) && profile.education.length > 0) {
                      profile.education.forEach((edu, index) => {
                          educationText += `\n\n${index + 1}. ${edu.schoolName || edu.school || 'Institution'}`;
                          if (edu.degree || edu.fieldOfStudy) {
                              educationText += `\n   ${edu.degree || ''} ${edu.fieldOfStudy || ''}`.trim();
                          }
                          if (edu.dateRange || edu.dates) {
                              educationText += `\n   Years: ${edu.dateRange || edu.dates || 'Not specified'}`;
                          }
                      });
                  } else {
                      educationText += '\n   No education data available';
                  }
                  
                  // Combine all text
                  const profileText = `Headline: ${profileHeadline}\n\nSummary: ${profileSummary}\n\n${experienceText}${educationText}`;
                  
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: { 
                      content: [
                        {
                          type: "text",
                          text: `LinkedIn profile data retrieved. Last updated: ${apiResponse.data.data_last_updated || 'Unknown'}`
                        },
                        {
                          type: "text",
                          text: profileText
                        }
                      ],
                      isError: false
                    }, 
                    id 
                  });
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: LinkedIn profile API Error: ${errorMessage}`);
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to get LinkedIn profile: ${errorMessage}. This may occur if you haven't set your LinkedIn URL yet. Try using the set_linkedin_url tool first.`
                        }
                      ],
                      isError: true
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call LinkedIn profile API: ${error.message}`;
              if (error.response) {
                  const status = error.response.status;
                  // Extract error message from response data, handling various formats
                  const responseData = error.response.data || {};
                  const extractedError = responseData.error || 
                                        (typeof responseData === 'string' ? responseData : null);
                  
                  if (status === 404) {
                      errorMessage = "LinkedIn profile not found. Make sure you've set your LinkedIn URL using set_linkedin_url tool and that the profile is publicly accessible.";
                  } else if (status === 401 || status === 403) {
                      errorMessage = "Authentication error. Your API key may be invalid or expired.";
                  } else {
                      errorMessage = `Backend API Error (Status ${status}): ${extractedError || "Unknown error"}`;
                  }
                  console.error(`${packageName}: LinkedIn profile API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from LinkedIn profile API. The server may be unavailable or experiencing issues.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to get LinkedIn profile: ${errorMessage}`
                    }
                  ],
                  isError: true
                }, 
                id 
              });
          }
      } else if (name === 'set_linkedin_url') {
          console.error(`${packageName}: Received call for set_linkedin_url tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;
          const linkedinUrl = args?.linkedin_url;

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }
          if (typeof linkedinUrl !== 'string' || linkedinUrl.trim() === '') {
              sendResponse({ jsonrpc: "2.0", error: { code: -32602, message: "Invalid arguments: 'linkedin_url' (string) required." }, id });
              return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              const payload = { linkedin_url: linkedinUrl };
              console.error(`${packageName}: Calling set LinkedIn URL API: ${backendLinkedinSetUrlApiUrl} with payload:`, JSON.stringify(payload, null, 2));
              const apiResponse = await axios.post(backendLinkedinSetUrlApiUrl, payload, { headers, timeout: 60000 });
              console.error(`${packageName}: Set LinkedIn URL API response status: ${apiResponse.status}`);
              console.error(`${packageName}: Set LinkedIn URL API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: { 
                      content: [
                        {
                          type: "text",
                          text: apiResponse.data.message || "Successfully set LinkedIn URL."
                        }
                      ],
                      isError: false
                    }, 
                    id 
                  });
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: Set LinkedIn URL API Error: ${errorMessage}`);
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to set LinkedIn URL: ${errorMessage}. Please ensure the URL is a valid LinkedIn profile URL (e.g., https://www.linkedin.com/in/username/).`
                        }
                      ],
                      isError: true
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call set LinkedIn URL API: ${error.message}`;
              if (error.response) {
                  const status = error.response.status;
                  if (status === 400) {
                      errorMessage = "Invalid LinkedIn URL format. Please provide a complete LinkedIn profile URL (e.g., https://www.linkedin.com/in/username/).";
                  } else if (status === 401 || status === 403) {
                      errorMessage = "Authentication error. Your API key may be invalid or expired.";
                  } else {
                      errorMessage = `Backend API Error (Status ${status}): ${error.response.data?.error || "Unknown error"}`;
                  }
                  console.error(`${packageName}: Set LinkedIn URL API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from set LinkedIn URL API. The server may be unavailable or experiencing issues.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to set LinkedIn URL: ${errorMessage}`
                    }
                  ],
                  isError: true
                }, 
                id 
              });
          }
      } else if (name === 'refresh_linkedin_profile') {
          console.error(`${packageName}: Received call for refresh_linkedin_profile tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              console.error(`${packageName}: Calling refresh LinkedIn profile API: ${backendLinkedinRefreshProfileApiUrl}`);
              const apiResponse = await axios.post(backendLinkedinRefreshProfileApiUrl, {}, { headers, timeout: 60000 });
              console.error(`${packageName}: Refresh LinkedIn profile API response status: ${apiResponse.status}`);
              console.error(`${packageName}: Refresh LinkedIn profile API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: { 
                      content: [
                        {
                          type: "text",
                          text: apiResponse.data.message || "Successfully refreshed LinkedIn profile data."
                        }
                      ],
                      isError: false
                    }, 
                    id 
                  });
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: Refresh LinkedIn profile API Error: ${errorMessage}`);
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to refresh LinkedIn profile: ${errorMessage}`
                        }
                      ],
                      isError: true
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call refresh LinkedIn profile API: ${error.message}`;
              if (error.response) {
                  // Extract error message from response data, handling various formats
                  const responseData = error.response.data || {};
                  const extractedError = responseData.error || 
                                        (typeof responseData === 'string' ? responseData : null);
                  
                  errorMessage = `Backend API Error (Status ${error.response.status}): ${extractedError || "Unknown error"}`;
                  console.error(`${packageName}: Refresh LinkedIn profile API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from refresh LinkedIn profile API.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to refresh LinkedIn profile: ${errorMessage}`
                    }
                  ],
                  isError: true
                }, 
                id 
              });
          }
      } else if (name === 'refresh_linkedin_posts') {
          console.error(`${packageName}: Received call for refresh_linkedin_posts tool.`);
          const apiKey = process.env.LINKEDIN_MCP_API_KEY;

          if (!apiKey) {
              sendResponse({ jsonrpc: "2.0", error: { code: -32001, message: "Server Configuration Error: API Key not set." }, id });
              return;
          }

          try {
              const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "Accept": "application/json" };
              console.error(`${packageName}: Calling refresh LinkedIn posts API: ${backendLinkedinRefreshPostsApiUrl}`);
              const apiResponse = await axios.post(backendLinkedinRefreshPostsApiUrl, {}, { headers, timeout: 60000 });
              console.error(`${packageName}: Refresh LinkedIn posts API response status: ${apiResponse.status}`);
              console.error(`${packageName}: Refresh LinkedIn posts API response data:`, JSON.stringify(apiResponse.data, null, 2));

              if (apiResponse.data && apiResponse.data.success) {
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: { 
                      content: [
                        {
                          type: "text",
                          text: apiResponse.data.message || "Successfully refreshed LinkedIn posts data."
                        }
                      ],
                      isError: false
                    }, 
                    id 
                  });
              } else {
                  const errorMessage = apiResponse.data?.error || "Backend API Error (no detail)";
                  console.error(`${packageName}: Refresh LinkedIn posts API Error: ${errorMessage}`);
                  sendResponse({ 
                    jsonrpc: "2.0", 
                    result: {
                      content: [
                        {
                          type: "text",
                          text: `Failed to refresh LinkedIn posts: ${errorMessage}`
                        }
                      ],
                      isError: true
                    }, 
                    id 
                  });
              }

          } catch (error) {
              let errorMessage = `Failed to call refresh LinkedIn posts API: ${error.message}`;
              if (error.response) {
                  // Extract error message from response data, handling various formats
                  const responseData = error.response.data || {};
                  const extractedError = responseData.error || 
                                        (typeof responseData === 'string' ? responseData : null);
                  
                  errorMessage = `Backend API Error (Status ${error.response.status}): ${extractedError || "Unknown error"}`;
                  console.error(`${packageName}: Refresh LinkedIn posts API Error Response:`, error.response.data); 
              } else if (error.request) {
                  errorMessage = "No response received from refresh LinkedIn posts API.";
              }
              console.error(`${packageName}: ${errorMessage}`);
              
              sendResponse({ 
                jsonrpc: "2.0", 
                result: { 
                  content: [
                    {
                      type: "text",
                      text: `Failed to refresh LinkedIn posts: ${errorMessage}`
                    }
                  ],
                  isError: true
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
                  },
                  {
                      name: "publish_twitter_post",
                      description: "Publish a text post (tweet) to Twitter.",
                      inputSchema: {
                          type: "object",
                          properties: {
                              post_text: {
                                  type: "string",
                                  description: "The text content of the tweet (maximum 280 characters)."
                              }
                          },
                          required: ["post_text"]
                      }
                  },
                  {
                      name: "analyze_linkedin_chat",
                      description: "Ask questions about the user's LinkedIn profile, content, or network, with support for multi-turn conversations.",
                      inputSchema: {
                          type: "object",
                          properties: {
                              query: {
                                  type: "string",
                                  description: "The question or request about LinkedIn data to be analyzed."
                              },
                              conversation_history: {
                                  type: "array",
                                  description: "Optional. Previous messages in the conversation for context. Each message must have 'role' (user/assistant) and 'content' (text).",
                                  items: {
                                      type: "object",
                                      properties: {
                                          role: {
                                              type: "string",
                                              description: "The sender of the message: 'user' or 'assistant'."
                                          },
                                          content: {
                                              type: "string",
                                              description: "The text content of the message."
                                          }
                                      },
                                      required: ["role", "content"]
                                  }
                              }
                          },
                          required: ["query"]
                      }
                  },
                  {
                      name: "generate_linkedin_post",
                      description: "Generate three LinkedIn post variants from any content (article, newsletter, notes, etc.) to optimize engagement.",
                      inputSchema: {
                          type: "object",
                          properties: {
                              content: {
                                  type: "string",
                                  description: "The source content to transform into LinkedIn posts. Can be articles, emails, newsletters, notes, etc."
                              },
                              content_type: {
                                  type: "string",
                                  description: "Optional. A short description of the content type (e.g., 'article', 'newsletter', 'notes'). Defaults to 'article'."
                              }
                          },
                          required: ["content"]
                      }
                  },
                  {
                      name: "get_linkedin_posts",
                      description: "Retrieve the user's recent LinkedIn posts with engagement metrics.",
                      inputSchema: {
                          type: "object",
                          properties: {
                              limit: {
                                  type: "number",
                                  description: "Optional. Number of posts to retrieve (1-20). Defaults to 5."
                              }
                          }
                      }
                  },
                  {
                      name: "get_linkedin_profile",
                      description: "Retrieve the user's LinkedIn profile information including headline, summary, experience, and education.",
                      inputSchema: {
                          type: "object",
                          properties: {}
                      }
                  },
                  {
                      name: "set_linkedin_url",
                      description: "Set or update the LinkedIn profile URL to analyze. Required before using profile/posts retrieval tools if not set previously.",
                      inputSchema: {
                          type: "object",
                          properties: {
                              linkedin_url: {
                                  type: "string",
                                  description: "The full LinkedIn profile URL (e.g., https://www.linkedin.com/in/username/)"
                              }
                          },
                          required: ["linkedin_url"]
                      }
                  },
                  {
                      name: "refresh_linkedin_profile",
                      description: "Force a refresh of the LinkedIn profile data to update any recent changes.",
                      inputSchema: {
                          type: "object",
                          properties: {}
                      }
                  },
                  {
                      name: "refresh_linkedin_posts",
                      description: "Force a refresh of LinkedIn posts data to capture recently published content.",
                      inputSchema: {
                          type: "object",
                          properties: {}
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