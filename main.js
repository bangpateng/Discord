// discord-auto-send.js
require('dotenv').config();
const axios = require('axios');
const fs = require('fs').promises;
const readline = require('readline');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Get token from .env
const TOKEN = process.env.DISCORD_TOKEN;

// Track sent messages to avoid repetition
const sentMessages = new Set();
let isRateLimited = false;
let rateLimitResetTime = 0;
let botRunning = false;
let messageInterval = null;
let countdownInterval = null;
let secondsLeft = 0;
let currentDelay = 60; // Store initial delay

// For blinking countdown
let showBlink = true;
const resetCursor = '\r\x1b[K'; // Clear line and move cursor to beginning

// Check rate limit before sending messages
async function checkRateLimit(channelId, token) {
  try {
    // Make a lightweight request to check rate limits
    const response = await axios.get(
      `https://discord.com/api/v9/channels/${channelId}/messages?limit=1`,
      {
        headers: {
          'Authorization': token,
          'User-Agent': 'DiscordBot (https://discord.com, 9)',
        }
      }
    );
    
    // Check headers for rate limit info
    const remaining = response.headers['x-ratelimit-remaining'];
    const resetAfter = response.headers['x-ratelimit-reset-after'];
    
    if (remaining && resetAfter) {
      console.log(`Rate limit status: ${remaining} requests remaining, reset in ${resetAfter}s`);
      
      if (parseInt(remaining) <= 1) {
        isRateLimited = true;
        rateLimitResetTime = Date.now() + parseFloat(resetAfter) * 1000;
        console.log(`Rate limit detected! Reset in ${resetAfter} seconds`);
        return false;
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error checking rate limit:', error.message);
    
    if (error.response?.status === 429) {
      const retryAfter = error.response.data.retry_after || 10;
      isRateLimited = true;
      rateLimitResetTime = Date.now() + (retryAfter * 1000);
      console.log(`Rate limited! Need to wait ${retryAfter} seconds`);
      return false;
    }
    
    return true; // Assume not rate limited if error is not 429
  }
}

// Load messages from messages.txt
async function loadMessages() {
  try {
    const content = await fs.readFile('messages.txt', 'utf-8');
    const messages = content.split('\n').filter(msg => msg.trim());
    
    if (messages.length === 0) {
      throw new Error('No messages found in messages.txt');
    }
    
    console.log(`Loaded ${messages.length} messages from messages.txt`);
    return messages;
  } catch (error) {
    console.error('Error reading messages.txt:', error.message);
    process.exit(1);
  }
}

// Get a unique message that hasn't been sent yet
function getUniqueMessage(messages) {
  // If all messages have been sent, reset tracking
  const available = messages.filter(msg => !sentMessages.has(msg));
  if (available.length === 0) {
    console.log('All messages have been sent. Resetting tracking.');
    sentMessages.clear();
    return messages[Math.floor(Math.random() * messages.length)];
  }
  
  // Get a random message from available ones
  const message = available[Math.floor(Math.random() * available.length)];
  sentMessages.add(message);
  return message;
}

// Send message to Discord
async function sendMessage(message, channelId, token) {
  try {
    // Check if we're rate limited
    if (isRateLimited && Date.now() < rateLimitResetTime) {
      const waitTime = Math.ceil((rateLimitResetTime - Date.now()) / 1000);
      console.log(`\n[~] Rate limited. Waiting ${waitTime} seconds before retrying...`);
      return false;
    }
    
    // Check for rate limit before sending
    const canSend = await checkRateLimit(channelId, token);
    if (!canSend) {
      const waitTime = Math.ceil((rateLimitResetTime - Date.now()) / 1000);
      console.log(`\n[~] Detected rate limit. Waiting ${waitTime} seconds...`);
      return false;
    }
    
    isRateLimited = false;
    
    console.log(`\n[>] Sending message: ${message}`);
    
    const response = await axios.post(
      `https://discord.com/api/v9/channels/${channelId}/messages`,
      { content: message },
      { 
        headers: { 
          'Authorization': token,
          'User-Agent': 'DiscordBot (https://discord.com, 9)',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`[+] Message sent successfully!`);
    
    // PERBAIKAN: Selalu reset timer ke waktu awal setelah pesan berhasil dikirim
    startCountdown(currentDelay);
    return true;
  } catch (error) {
    if (error.response?.status === 429) {
      const retryAfter = error.response.data.retry_after || 10;
      rateLimitResetTime = Date.now() + (retryAfter * 1000);
      isRateLimited = true;
      
      console.error(`\n[!] Rate limited! Retry after ${retryAfter} seconds.`);
      console.log(`[i] TIP: Increase your delay to avoid rate limits.`);
      
      // Schedule a check to see when rate limit is over
      setTimeout(() => {
        if (botRunning) {
          console.log(`\n[+] Rate limit period over. Resuming normal operation.`);
          startCountdown(currentDelay); // Reset to original delay
        }
      }, retryAfter * 1000);
      
      return false;
    } else {
      console.error(`\n[!] Error sending message:`, error.message);
      
      if (error.response?.status === 401) {
        console.error('Invalid Discord token. Check your .env file.');
        stopBot();
        return false;
      } else if (error.response?.status === 404) {
        console.error('Channel not found. Check your channel ID.');
        stopBot();
        return false;
      }
    }
    
    return false;
  }
}

// Countdown timer
function startCountdown(seconds) {
  // Clear any existing countdown
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  
  secondsLeft = seconds;
  showBlink = true;
  
  // Update countdown display immediately
  updateCountdownDisplay();
  
  // Set interval for countdown
  countdownInterval = setInterval(() => {
    secondsLeft--;
    
    if (secondsLeft <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      return;
    }
    
    // Toggle blinking effect
    showBlink = !showBlink;
    updateCountdownDisplay();
  }, 1000);
}

// Update countdown display with blinking
function updateCountdownDisplay() {
  // Format time as MM:SS
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  // Change color based on remaining time
  let colorCode;
  if (secondsLeft < 10) {
    colorCode = '\x1b[91m'; // Red
  } else if (secondsLeft < 30) {
    colorCode = '\x1b[93m'; // Yellow
  } else {
    colorCode = '\x1b[92m'; // Green
  }
  
  // Display with blinking effect
  if (showBlink) {
    process.stdout.write(`${resetCursor}[>] Next message in: ${colorCode}${formattedTime}\x1b[0m`);
  } else {
    process.stdout.write(`${resetCursor}[>] Next message in: ${colorCode}${formattedTime}\x1b[0m`);
  }
}

// Function to stop the bot
function stopBot() {
  if (messageInterval) {
    clearInterval(messageInterval);
    messageInterval = null;
  }
  
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  
  botRunning = false;
  console.log('\n\n--- Auto-sending messages stopped ---');
}

// Function to handle user input
async function promptUser() {
  if (!TOKEN) {
    console.error('Error: DISCORD_TOKEN not found in .env file');
    process.exit(1);
  }
  
  rl.question('Enter Discord Channel ID: ', (channelId) => {
    if (!channelId) {
      console.error('Channel ID is required!');
      return promptUser();
    }
    
    rl.question('Enter message delay in seconds (minimum 10 recommended): ', async (delayInput) => {
      // Parse delay with fallback to 60
      let delay = parseInt(delayInput);
      if (isNaN(delay) || delay < 1) {
        delay = 60;
      }
      
      // Save the initial delay globally
      currentDelay = delay;
      
      // Warn if too low
      if (delay < 10) {
        console.warn(`[!] Warning: Delay is set to less than 10 seconds. This may trigger Discord rate limits.`);
        console.warn(`[i] Recommended delay: 10-60 seconds to avoid issues.`);
      }
      
      try {
        // Verify Discord token and channel access
        console.log(`[i] Verifying Discord token and channel access...`);
        await axios.get(`https://discord.com/api/v9/channels/${channelId}`, {
          headers: { 
            'Authorization': TOKEN, 
            'User-Agent': 'DiscordBot (https://discord.com, 9)' 
          }
        });
        console.log(`[+] Verification successful!`);
        
        // Check for existing rate limits
        console.log('[i] Checking current rate limit status...');
        await checkRateLimit(channelId, TOKEN);
        
        // If we're rate limited, inform user and wait
        if (isRateLimited) {
          const waitTime = Math.ceil((rateLimitResetTime - Date.now()) / 1000);
          console.log(`[!] Discord rate limit detected! Need to wait ${waitTime} seconds.`);
          console.log('[i] Bot will automatically start after rate limit expires.');
          
          // Wait for rate limit to expire before starting
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000 + 1000));
          console.log('[+] Rate limit expired. Proceeding with bot startup.');
        }
        
        const messages = await loadMessages();
        
        console.log(`\n--- Auto-sending messages started ---`);
        console.log(`Channel ID: ${channelId}`);
        console.log(`Initial send delay: ${delay} seconds`);
        console.log(`Type "stop" to exit, "status" for bot status\n`);
        
        botRunning = true;
        
        // Start countdown immediately
        startCountdown(currentDelay);
        
        // Function to send a message with rate limit handling
        async function sendWithRateLimit() {
          if (!botRunning) return;
          
          // If we're rate limited, don't try to send yet
          if (isRateLimited && Date.now() < rateLimitResetTime) {
            const waitTime = Math.ceil((rateLimitResetTime - Date.now()) / 1000);
            console.log(`\n[~] Still rate limited. ${waitTime}s remaining before retry.`);
            return;
          }
          
          const message = getUniqueMessage(messages);
          await sendMessage(message, channelId, TOKEN);
        }
        
        // Start interval for sending messages
        messageInterval = setInterval(sendWithRateLimit, currentDelay * 1000);
        
        // Listen for commands
        rl.on('line', (line) => {
          const command = line.trim().toLowerCase();
          
          if (command === 'stop') {
            stopBot();
            rl.close();
          } else if (command === 'status') {
            console.log('\n--- Bot Status ---');
            console.log(`Active: ${botRunning ? 'Yes' : 'No'}`);
            console.log(`Current delay: ${currentDelay}s`);
            console.log(`Next message in: ${secondsLeft}s`);
            console.log(`Rate limited: ${isRateLimited ? 'Yes' : 'No'}`);
            if (isRateLimited) {
              const waitTime = Math.ceil((rateLimitResetTime - Date.now()) / 1000);
              console.log(`Time until rate limit reset: ${waitTime}s`);
            }
            console.log(`Messages sent this session: ${sentMessages.size}`);
            console.log(`Total available messages: ${messages.length}`);
            console.log('-----------------\n');
            
            // Restart countdown display after showing status
            updateCountdownDisplay();
          } else if (command === 'delay') {
            console.log(''); // Print newline
            rl.question('Enter new delay in seconds: ', (newDelay) => {
              const parsedDelay = parseInt(newDelay);
              if (!isNaN(parsedDelay) && parsedDelay > 0) {
                currentDelay = parsedDelay;
                
                // Update the interval
                if (messageInterval) {
                  clearInterval(messageInterval);
                  messageInterval = setInterval(sendWithRateLimit, currentDelay * 1000);
                }
                
                // Restart countdown with new delay
                startCountdown(currentDelay);
                
                console.log(`\n[+] Delay updated to ${currentDelay}s.`);
              } else {
                console.log(`\n[!] Invalid delay value.`);
                // Restore countdown
                updateCountdownDisplay();
              }
            });
          } else if (command) {
            console.log(`\nUnknown command. Available commands: stop, status, delay`);
            // Restore countdown
            updateCountdownDisplay();
          }
        });
        
      } catch (error) {
        console.error(`[!] Error:`, error.message);
        rl.close();
      }
    });
  });
}

// Start the prompt
console.log('Discord Auto Message Sender');
console.log('==========================\n');
promptUser();

// Handle stop signal
process.on('SIGINT', () => {
  stopBot();
  process.exit(0);
});