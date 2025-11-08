# 🐿️ Squirrel Hold'em

A complete Texas Hold'em poker game designed for Raspberry Pi with mobile client support. Perfect for home poker nights!

## Features

- **🎮 Full Texas Hold'em Rules**: Proper betting rounds, hand evaluation, and game flow
- **📺 Raspberry Pi Display**: Beautiful display showing community cards, pot, and game state
- **📱 Mobile Clients**: Players use their phones to view cards and make actions
- **⚙️ Admin Panel**: Configure game settings and manage the game
- **🎨 Beautiful Graphics**: Visually appealing card designs with smooth animations
- **🔄 Real-time Sync**: WebSocket-based real-time updates for all clients

## Prerequisites

- Raspberry Pi (any model with network connectivity)
- Node.js 14+ installed
- Display connected to Raspberry Pi (HDMI monitor or official Pi touchscreen)
- WiFi network for clients to connect

## Installation

### On Raspberry Pi

1. **Clone or download this repository:**
   ```bash
   cd ~
   git clone <repository-url>
   cd SquirrelHoldem
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

   The server will start on port 3000. You'll see:
   ```
   🃏 Squirrel Hold'em server running on port 3000
   📺 Display: http://localhost:3000/display.html
   📱 Client: http://localhost:3000/client.html
   ⚙️  Admin: http://localhost:3000/admin.html
   ```

4. **Find your Pi's IP address:**
   ```bash
   hostname -I
   ```

   Your Raspberry Pi's IP will be something like `192.168.1.100`

## Setup Instructions

### Step 1: Set up the Display

1. On the Raspberry Pi's browser, navigate to:
   ```
   http://localhost:3000/display.html
   ```

2. Make this fullscreen (F11 in most browsers)

3. This will show the poker table, community cards, and pot

### Step 2: Configure Game Settings

1. On any device connected to the same network, open:
   ```
   http://[PI_IP_ADDRESS]:3000/admin.html
   ```
   Replace `[PI_IP_ADDRESS]` with your Pi's IP (e.g., `192.168.1.100`)

2. Configure:
   - Small Blind amount
   - Big Blind amount
   - Starting chips for each player
   - Minimum and maximum players

3. Click "Save Configuration"

### Step 3: Players Join

1. Each player opens their phone's browser and navigates to:
   ```
   http://[PI_IP_ADDRESS]:3000/client.html
   ```

2. Enter your name and click "Join Game"

3. Wait for all players to join (minimum 2 players required)

### Step 4: Start Playing!

1. From the admin panel, click "START GAME"

2. Players will receive their hole cards on their phones

3. The display will show:
   - Community cards as they're dealt
   - Current pot
   - Player information
   - Current player indicator

4. Players take actions on their phones:
   - **Fold**: Give up your hand
   - **Check**: Pass without betting (when no bet to match)
   - **Call**: Match the current bet
   - **Bet/Raise**: Increase the bet amount

## Game Flow

1. **Pre-flop**: Players receive 2 hole cards, betting round starts
2. **Flop**: 3 community cards are dealt, betting round
3. **Turn**: 4th community card dealt, betting round
4. **River**: 5th community card dealt, final betting round
5. **Showdown**: Best hand wins the pot!

## Default Settings

- **Small Blind**: $10
- **Big Blind**: $20
- **Starting Chips**: $1,000
- **Min Players**: 2
- **Max Players**: 10

## Troubleshooting

### Players can't connect

- Make sure all devices are on the same WiFi network
- Check firewall settings on the Raspberry Pi
- Verify the Pi's IP address with `hostname -I`
- Try accessing `http://[PI_IP]:3000` first to test connectivity

### Display not updating

- Refresh the display page
- Check browser console for errors (F12)
- Restart the server with `npm start`

### Game won't start

- Ensure minimum number of players have joined
- Check the admin panel for error messages
- Verify game configuration is valid

## Running on Startup (Optional)

To automatically start the poker game when the Raspberry Pi boots:

1. **Create a systemd service:**
   ```bash
   sudo nano /etc/systemd/system/squirrel-holdem.service
   ```

2. **Add the following content:**
   ```ini
   [Unit]
   Description=Squirrel Hold'em Poker Game
   After=network.target

   [Service]
   ExecStart=/usr/bin/node /home/pi/SquirrelHoldem/server/server.js
   WorkingDirectory=/home/pi/SquirrelHoldem
   StandardOutput=inherit
   StandardError=inherit
   Restart=always
   User=pi

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable and start the service:**
   ```bash
   sudo systemctl enable squirrel-holdem
   sudo systemctl start squirrel-holdem
   ```

4. **Set Chromium to auto-start in kiosk mode** (optional):
   Edit `~/.config/lxsession/LXDE-pi/autostart` and add:
   ```
   @chromium-browser --kiosk --app=http://localhost:3000/display.html
   ```

## Development

### Project Structure

```
SquirrelHoldem/
├── server/
│   ├── server.js          # Main Express + Socket.IO server
│   ├── game.js            # Texas Hold'em game logic
│   ├── deck.js            # Deck and card management
│   └── handEvaluator.js   # Poker hand evaluation
├── public/
│   ├── index.html         # Landing page
│   ├── display.html       # Raspberry Pi display
│   ├── client.html        # Mobile player client
│   ├── admin.html         # Admin configuration panel
│   └── styles.css         # Shared styles
├── package.json
└── README.md
```

### Running in Development Mode

```bash
npm run dev  # Uses nodemon for auto-restart
```

## API Endpoints

- `GET /api/config` - Get current game configuration
- `POST /api/config` - Update game configuration
- `GET /api/game-state` - Get current game state

## Socket Events

### Client → Server
- `joinGame(playerName)` - Join the game
- `startGame()` - Start a new hand (admin)
- `playerAction(action, amount)` - Perform action (fold, check, call, bet, raise)
- `getPlayerState()` - Request private player state

### Server → Client
- `gameState(state)` - Broadcast game state update
- `playerState(state)` - Send private player information
- `gameStarted()` - Game has started
- `showdown(results)` - Showdown results
- `error(message)` - Error notification

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - Feel free to use and modify for your poker nights!

---

**Enjoy your poker game! 🎲🃏🐿️**
