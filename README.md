# LinkedIn MCP Runner by Ertiqah, LLC

This package allows you to interact with your LinkedIn and Twitter accounts (primarily for posting & scheduling posts) using the Claude Desktop Application. 

## Setup Instructions

Follow these steps to integrate this tool with your Claude Desktop app:

**Step 1: Get Your API Key**

1.  Log in to your account at [ligo.ertiqah.com](https://ligo.ertiqah.com/).
2.  Navigate to the Settings page: [ligo.ertiqah.com/settings#generatekey](https://ligo.ertiqah.com/settings#generatekey)
3.  Click the button to generate a new API key.
4.  Follow the prompts to connect your LinkedIn and/or Twitter profiles if you haven't already.
5.  **Copy the generated API key.** Keep it safe, you'll need it in the next step.

**Step 2: Configure Claude Desktop App**

You have two options to configure Claude:

### Option 1: Automated Setup (Recommended)

This is the easiest method. Open your computer's terminal (Terminal on macOS/Linux, PowerShell or Command Prompt on Windows) and run the following command, replacing `YOUR_API_KEY_HERE` with the key you copied in Step 1:

```bash
npx linkedin-mcp-runner setup --api-key YOUR_API_KEY_HERE
```

This command will automatically find your Claude configuration file and add the necessary settings for this LinkedIn tool.

### Option 2: Manual Setup

If you prefer not to run the setup script or encounter issues, you can configure Claude manually:

1.  **Find your Claude configuration file:**
    *   **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
    *   **Windows:** `%APPDATA%\Claude\claude_desktop_config.json` (You can paste this path directly into the File Explorer address bar)
    *   **Linux:** `~/.config/Claude/claude_desktop_config.json`
2.  **Open the file** with a simple text editor (like TextEdit on Mac, Notepad on Windows, or gedit/nano on Linux).
3.  **Locate the `"mcpServers": { ... }` section.** If it doesn't exist, you'll need to add it carefully within the main JSON structure (`{ ... }`). It should look something like this (you might already have other servers listed):
    ```json
    {
      // ... other settings ...
      "mcpServers": {
        // ... potentially other servers here ...
      }
      // ... other settings ...
    }
    ```
4.  **Add the following entry** inside the `mcpServers` curly braces `{}`. If you already have other servers, add a comma `,` after the previous server's closing brace `}` before adding this one. **Replace `"YOUR_API_KEY_HERE"` with the key you copied in Step 1.**

    ```json
        "linkedin": {
          "command": "npx",
          "args": [
            "-y",
            "linkedin-mcp-runner"
          ],
          "env": {
            "LINKEDIN_MCP_API_KEY": "YOUR_API_KEY_HERE"
          }
        }
    ```
5.  **Save the file.** Ensure the final structure is valid JSON (pay attention to commas between entries and curly braces). You can use an online JSON validator if unsure.

**Step 3: Restart Claude Desktop App**

Whether you used the automated or manual setup, **you must restart the Claude Desktop application** for the new configuration to be loaded.

## Usage

Once the tool is set up and Claude is restarted, you can ask Claude to publish posts to your LinkedIn profile or tweets to your Twitter account.

### LinkedIn Usage

**Basic Posting:**
Simply tell Claude what text you want to post.

*Example:* `"Hey Claude, please post this to my LinkedIn: 'Excited to share our latest company news!'"`

**Posting with an Image or Video:**

You can also include one or more images or a video in your post. To do this:

1.  **Upload your image/video** to an online hosting service that provides **direct links**. A popular free option is [Postimages](https://postimg.cc/). Make sure you get the "Direct Link" after uploading.
2.  **Provide both the post text and the direct link(s)** to Claude.

*Example:* `"Hi Claude, can you publish the following to my LinkedIn profile, including the image?"`

*   *Post Text:* "Check out the highlights from our team event last week!"
*   *Image URL:* `https://i.postimg.cc/your-image-code.jpg`

Claude will then use the `publish_linkedin_post` tool with your text and the media URL you provided.

### Twitter Usage

**Posting a Tweet:**
Simply tell Claude what you want to tweet.

*Example:* `"Hey Claude, please tweet this for me: 'Just launched our new product! Check it out at ligo.ertiqah.com'"`

Claude will use the `publish_twitter_post` tool to send your tweet text to Twitter.

Note: Make sure your Twitter account is properly connected in your ligo.ertiqah.com account settings to enable this functionality.