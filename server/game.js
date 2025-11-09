// Texas Hold'em Game Logic

const Deck = require('./deck');
const HandEvaluator = require('./handEvaluator');

class PokerGame {
  constructor() {
    this.players = [];
    this.deck = new Deck();
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.dealerIndex = 0;
    this.currentPlayerIndex = 0;
    this.gameState = 'waiting'; // waiting, dealing, preflop, flop, turn, river, showdown
    this.lastAggressorIndex = -1; // Track last player to bet/raise
    this.playersActed = new Set(); // Track who has acted this round
    this.playerSessions = new Map(); // sessionId -> player data
    this.disconnectedPlayers = new Map(); // sessionId -> timeout
    this.lastHandResults = null; // Store results from last completed hand
    this.config = {
      smallBlind: 1,
      bigBlind: 2,
      startingChips: 1000,
      minPlayers: 2,
      maxPlayers: 10,
      autoNextHand: true, // Automatically start next hand
      autoNextHandDelay: 5000, // Delay in ms before starting next hand
      reconnectTimeout: 300000, // 5 minutes to reconnect
      blindTimerEnabled: false, // Enable blind increase timer
      blindTimerMinutes: 15, // Minutes before blinds double
      useRealChips: false // Use real physical chips - display cards only
    };
    this.roundBets = {};
    this.currentHandNumber = 0;
    this.blindTimerStart = null; // Track when timer started
    this.activePlayers = 0; // Track players with chips
    this.paused = false; // Game pause state
    this.pausedAt = null; // When game was paused
    this.totalPausedTime = 0; // Total time spent paused (for timer adjustment)
  }

  generateSessionId() {
    return 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  addPlayer(socketId, name, sessionId = null) {
    // Check if reconnecting with existing session
    if (sessionId && this.playerSessions.has(sessionId)) {
      return this.reconnectPlayer(socketId, sessionId);
    }

    if (this.players.length >= this.config.maxPlayers) {
      return { success: false, message: 'Game is full' };
    }

    if (this.players.find(p => p.socketId === socketId)) {
      return { success: false, message: 'Already in game' };
    }

    // Create new session
    const newSessionId = this.generateSessionId();

    const player = {
      socketId,
      sessionId: newSessionId,
      name,
      chips: this.config.startingChips,
      cards: [],
      bet: 0,
      folded: false,
      allIn: false,
      active: true,
      connected: true,
      lastAction: null, // Track last action (fold, check, call, raise, bet)
      lastActionAmount: 0, // Track amount for raises/bets
      stats: {
        handsPlayed: 0,
        handsWon: 0,
        biggestPot: 0,
        totalWinnings: 0,
        totalLosses: 0,
        currentStreak: 0,
        bestStreak: 0
      }
    };

    this.players.push(player);
    this.playerSessions.set(newSessionId, player);

    // Clear any disconnect timeout if exists
    if (this.disconnectedPlayers.has(newSessionId)) {
      clearTimeout(this.disconnectedPlayers.get(newSessionId));
      this.disconnectedPlayers.delete(newSessionId);
    }

    return { success: true, player, sessionId: newSessionId, isReconnect: false };
  }

  reconnectPlayer(socketId, sessionId) {
    const player = this.playerSessions.get(sessionId);
    if (!player) {
      return { success: false, message: 'Session not found' };
    }

    // Clear disconnect timeout
    if (this.disconnectedPlayers.has(sessionId)) {
      clearTimeout(this.disconnectedPlayers.get(sessionId));
      this.disconnectedPlayers.delete(sessionId);
    }

    // Update socket ID and mark as connected
    player.socketId = socketId;
    player.connected = true;

    return { success: true, player, sessionId, isReconnect: true };
  }

  handleDisconnect(socketId) {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return;

    player.connected = false;

    // Set timeout to remove player if they don't reconnect
    const timeout = setTimeout(() => {
      this.removePlayerBySession(player.sessionId);
    }, this.config.reconnectTimeout);

    this.disconnectedPlayers.set(player.sessionId, timeout);
  }

  removePlayerBySession(sessionId) {
    const index = this.players.findIndex(p => p.sessionId === sessionId);
    if (index !== -1) {
      this.players.splice(index, 1);
      this.playerSessions.delete(sessionId);
      this.disconnectedPlayers.delete(sessionId);

      if (this.players.length < this.config.minPlayers && this.gameState !== 'waiting') {
        this.endGame();
      }
    }
  }

  removePlayer(socketId) {
    // Legacy method - now just calls handleDisconnect
    this.handleDisconnect(socketId);
  }

  startGame() {
    if (this.players.length < this.config.minPlayers) {
      return { success: false, message: 'Not enough players' };
    }

    // Initialize active players count if not set
    if (this.activePlayers === 0) {
      this.activePlayers = this.players.filter(p => p.chips > 0).length;
    }

    // Check for timer expiration and double blinds if needed
    const timerCheck = this.checkBlindTimer();
    const timerExpired = timerCheck.timerExpired;

    // Check for player elimination and double blinds if needed
    const eliminationCheck = this.checkAndHandleElimination();

    this.gameState = 'dealing';
    this.deck.reset();
    this.deck.shuffle();
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.roundBets = {};
    this.playersActed = new Set();
    this.currentHandNumber++;
    this.lastHandResults = null; // Clear previous hand results

    // Reset players and track hands played
    this.players.forEach(player => {
      player.cards = [];
      player.bet = 0;
      player.folded = false;
      player.allIn = false;
      player.active = true;
      player.lastAction = null;
      player.lastActionAmount = 0;
      player.stats.handsPlayed++;
    });

    // Post blinds
    this.postBlinds();

    // Deal hole cards
    this.dealHoleCards();

    this.gameState = 'preflop';
    // Start after big blind (UTG position)
    this.currentPlayerIndex = (this.dealerIndex + 3) % this.players.length;
    // In preflop, big blind is last to act, so set them as last aggressor
    this.lastAggressorIndex = (this.dealerIndex + 2) % this.players.length;

    return {
      success: true,
      blindsDoubled: timerExpired || eliminationCheck.eliminated,
      reason: timerExpired ? 'timer' : (eliminationCheck.eliminated ? 'elimination' : null),
      newBlinds: timerExpired ? timerCheck.newBlinds : (eliminationCheck.eliminated ? eliminationCheck.newBlinds : null)
    };
  }

  // Manual dealing methods for "use real chips" mode
  manualNewDeal() {
    if (this.players.length < this.config.minPlayers) {
      return { success: false, message: 'Not enough players' };
    }

    this.gameState = 'dealing';
    this.deck.reset();
    this.deck.shuffle();
    this.communityCards = [];
    this.currentHandNumber++;

    // Reset players
    this.players.forEach(player => {
      player.cards = [];
      player.folded = false;
      player.active = true;
      player.lastAction = null;
      player.lastActionAmount = 0;
      player.stats.handsPlayed++;
    });

    // Deal hole cards
    this.dealHoleCards();

    this.gameState = 'preflop';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;

    return { success: true };
  }

  manualDealFlop() {
    if (this.gameState !== 'preflop') {
      return { success: false, message: 'Can only deal flop after new deal' };
    }

    // Deal 3 cards for flop
    for (let i = 0; i < 3; i++) {
      this.communityCards.push(this.deck.deal());
    }

    this.gameState = 'flop';
    return { success: true };
  }

  manualDealTurn() {
    if (this.gameState !== 'flop') {
      return { success: false, message: 'Can only deal turn after flop' };
    }

    this.communityCards.push(this.deck.deal());
    this.gameState = 'turn';
    return { success: true };
  }

  manualDealRiver() {
    if (this.gameState !== 'turn') {
      return { success: false, message: 'Can only deal river after turn' };
    }

    this.communityCards.push(this.deck.deal());
    this.gameState = 'river';
    return { success: true };
  }

  postBlinds() {
    const smallBlindIndex = (this.dealerIndex + 1) % this.players.length;
    const bigBlindIndex = (this.dealerIndex + 2) % this.players.length;

    const smallBlindPlayer = this.players[smallBlindIndex];
    const bigBlindPlayer = this.players[bigBlindIndex];

    smallBlindPlayer.bet = Math.min(this.config.smallBlind, smallBlindPlayer.chips);
    smallBlindPlayer.chips -= smallBlindPlayer.bet;
    this.pot += smallBlindPlayer.bet;

    bigBlindPlayer.bet = Math.min(this.config.bigBlind, bigBlindPlayer.chips);
    bigBlindPlayer.chips -= bigBlindPlayer.bet;
    this.pot += bigBlindPlayer.bet;

    this.currentBet = this.config.bigBlind;
  }

  dealHoleCards() {
    for (let i = 0; i < 2; i++) {
      this.players.forEach(player => {
        player.cards.push(this.deck.deal());
      });
    }
  }

  playerAction(socketId, action, amount = 0) {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.folded || this.players[this.currentPlayerIndex].socketId !== socketId) {
      return { success: false, message: 'Not your turn' };
    }

    // Mark this player as having acted
    this.playersActed.add(this.currentPlayerIndex);

    switch (action) {
      case 'fold':
        player.folded = true;
        player.lastAction = 'fold';
        player.lastActionAmount = 0;
        break;

      case 'check':
        if (player.bet < this.currentBet) {
          return { success: false, message: 'Cannot check, must call or raise' };
        }
        player.lastAction = 'check';
        player.lastActionAmount = 0;
        // Check doesn't change aggressor
        break;

      case 'call':
        const callAmount = Math.min(this.currentBet - player.bet, player.chips);
        player.chips -= callAmount;
        player.bet += callAmount;
        this.pot += callAmount;
        player.lastAction = 'call';
        player.lastActionAmount = callAmount;
        if (player.chips === 0) player.allIn = true;
        // Call doesn't change aggressor
        break;

      case 'raise':
        const raiseAmount = Math.min(amount, player.chips);
        if (raiseAmount + player.bet <= this.currentBet) {
          return { success: false, message: 'Raise must be higher than current bet' };
        }
        player.chips -= raiseAmount;
        player.bet += raiseAmount;
        this.pot += raiseAmount;
        this.currentBet = player.bet;
        player.lastAction = 'raise';
        player.lastActionAmount = raiseAmount;
        if (player.chips === 0) player.allIn = true;
        // Raise makes this player the last aggressor
        this.lastAggressorIndex = this.currentPlayerIndex;
        // Clear acted set except for folded/all-in players - everyone needs to respond to the raise
        const newActed = new Set();
        this.players.forEach((p, idx) => {
          if (p.folded || p.allIn) {
            newActed.add(idx);
          }
        });
        newActed.add(this.currentPlayerIndex); // The raiser has acted
        this.playersActed = newActed;
        break;

      case 'bet':
        const betAmount = Math.min(amount, player.chips);
        if (this.currentBet > 0) {
          return { success: false, message: 'Use raise instead' };
        }
        player.chips -= betAmount;
        player.bet += betAmount;
        this.pot += betAmount;
        this.currentBet = player.bet;
        player.lastAction = 'bet';
        player.lastActionAmount = betAmount;
        if (player.chips === 0) player.allIn = true;
        // Bet makes this player the last aggressor
        this.lastAggressorIndex = this.currentPlayerIndex;
        // Clear acted set except for folded/all-in players
        const newActedBet = new Set();
        this.players.forEach((p, idx) => {
          if (p.folded || p.allIn) {
            newActedBet.add(idx);
          }
        });
        newActedBet.add(this.currentPlayerIndex); // The better has acted
        this.playersActed = newActedBet;
        break;

      default:
        return { success: false, message: 'Invalid action' };
    }

    this.nextPlayer();
    return { success: true };
  }

  nextPlayer() {
    const activePlayers = this.players.filter(p => !p.folded && !p.allIn);

    // Only one player left, they win
    if (activePlayers.length === 1) {
      this.lastHandResults = this.endHand();
      return;
    }

    // No active players (all folded or all-in), go to showdown
    if (activePlayers.length === 0) {
      this.nextStreet();
      return;
    }

    // Check if betting round is complete:
    // 1. All active players have matching bets
    // 2. All active players have acted
    const allBetsEqual = activePlayers.every(p => p.bet === this.currentBet);
    const allPlayersActed = activePlayers.every((p, idx) => {
      const playerIndex = this.players.indexOf(p);
      return this.playersActed.has(playerIndex);
    });

    if (allBetsEqual && allPlayersActed) {
      this.nextStreet();
      return;
    }

    // Find next active player
    let nextIndex = (this.currentPlayerIndex + 1) % this.players.length;
    let checked = 0;

    while (checked < this.players.length) {
      const nextPlayer = this.players[nextIndex];
      if (!nextPlayer.folded && !nextPlayer.allIn) {
        this.currentPlayerIndex = nextIndex;
        return;
      }
      nextIndex = (nextIndex + 1) % this.players.length;
      checked++;
    }

    // All players all-in or folded (shouldn't reach here, but just in case)
    this.nextStreet();
  }

  nextStreet() {
    // Reset bets and actions for next round
    this.players.forEach(p => {
      p.bet = 0;
      p.lastAction = null;
      p.lastActionAmount = 0;
    });
    this.currentBet = 0;

    // Reset tracking for new betting round
    this.playersActed = new Set();
    // Mark folded and all-in players as "acted" since they can't act
    this.players.forEach((p, idx) => {
      if (p.folded || p.allIn) {
        this.playersActed.add(idx);
      }
    });
    this.lastAggressorIndex = -1; // No aggressor yet in new round

    switch (this.gameState) {
      case 'preflop':
        this.dealFlop();
        this.gameState = 'flop';
        break;
      case 'flop':
        this.dealTurn();
        this.gameState = 'turn';
        break;
      case 'turn':
        this.dealRiver();
        this.gameState = 'river';
        break;
      case 'river':
        this.showdown();
        return;
    }

    // Start with first player after dealer
    this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length;
    // Skip to next active player
    while (this.players[this.currentPlayerIndex].folded || this.players[this.currentPlayerIndex].allIn) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    }
  }

  dealFlop() {
    this.deck.deal(); // Burn card
    for (let i = 0; i < 3; i++) {
      this.communityCards.push(this.deck.deal());
    }
  }

  dealTurn() {
    this.deck.deal(); // Burn card
    this.communityCards.push(this.deck.deal());
  }

  dealRiver() {
    this.deck.deal(); // Burn card
    this.communityCards.push(this.deck.deal());
  }

  showdown() {
    this.gameState = 'showdown';
    const activePlayers = this.players.filter(p => !p.folded);

    const results = activePlayers.map(player => {
      const hand = HandEvaluator.evaluateHand([...player.cards, ...this.communityCards]);
      return {
        player: {
          socketId: player.socketId,
          name: player.name,
          cards: player.cards
        },
        hand,
        handName: hand.name
      };
    });

    results.sort((a, b) => HandEvaluator.compareHands(b.hand, a.hand));

    // Award pot and update statistics
    if (results.length > 0) {
      const winners = [results[0]];
      for (let i = 1; i < results.length; i++) {
        if (HandEvaluator.compareHands(results[i].hand, results[0].hand) === 0) {
          winners.push(results[i]);
        } else {
          break;
        }
      }

      const winAmount = Math.floor(this.pot / winners.length);
      winners.forEach(w => {
        // Get actual player object from players array
        const actualPlayer = this.players.find(p => p.socketId === w.player.socketId);
        actualPlayer.chips += winAmount;

        // Update statistics
        actualPlayer.stats.handsWon++;
        actualPlayer.stats.totalWinnings += winAmount;
        actualPlayer.stats.currentStreak++;

        if (actualPlayer.stats.currentStreak > actualPlayer.stats.bestStreak) {
          actualPlayer.stats.bestStreak = actualPlayer.stats.currentStreak;
        }

        if (this.pot > actualPlayer.stats.biggestPot) {
          actualPlayer.stats.biggestPot = this.pot;
        }

        // Mark as winner in results
        w.isWinner = true;
        w.winAmount = winAmount;
      });

      // Update losers' statistics
      activePlayers.forEach(p => {
        if (!winners.find(w => w.player.socketId === p.socketId)) {
          p.stats.currentStreak = 0;
        }
      });
    }

    this.gameState = 'waiting';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    this.lastHandResults = results;

    return results;
  }

  endHand() {
    const winner = this.players.find(p => !p.folded);
    let results = [];

    if (winner) {
      const potWon = this.pot;
      winner.chips += this.pot;

      // Update statistics for winner (everyone else folded)
      winner.stats.handsWon++;
      winner.stats.totalWinnings += this.pot;
      winner.stats.currentStreak++;

      if (winner.stats.currentStreak > winner.stats.bestStreak) {
        winner.stats.bestStreak = winner.stats.currentStreak;
      }

      if (this.pot > winner.stats.biggestPot) {
        winner.stats.biggestPot = this.pot;
      }

      // Reset streak for players who folded
      this.players.forEach(p => {
        if (p.folded) {
          p.stats.currentStreak = 0;
        }
      });

      // Create results object similar to showdown for display consistency
      results = [{
        player: {
          socketId: winner.socketId,
          name: winner.name,
          cards: winner.cards
        },
        handName: 'Winner (all others folded)',
        isWinner: true,
        winAmount: potWon
      }];
    }

    this.gameState = 'waiting';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;

    return results;
  }

  endGame() {
    this.gameState = 'waiting';
    this.communityCards = [];
    this.pot = 0;
  }

  doubleBlinds() {
    this.config.smallBlind *= 2;
    this.config.bigBlind *= 2;
    return {
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind
    };
  }

  checkAndHandleElimination() {
    const previousActivePlayers = this.activePlayers;
    this.activePlayers = this.players.filter(p => p.chips > 0).length;

    // If a player was eliminated, double the blinds
    if (previousActivePlayers > 0 && this.activePlayers < previousActivePlayers) {
      const blinds = this.doubleBlinds();
      return {
        eliminated: true,
        playersEliminated: previousActivePlayers - this.activePlayers,
        newBlinds: blinds
      };
    }

    return { eliminated: false };
  }

  checkBlindTimer() {
    if (!this.config.blindTimerEnabled) {
      return { timerExpired: false };
    }

    if (!this.blindTimerStart) {
      this.blindTimerStart = Date.now();
      return { timerExpired: false };
    }

    // Calculate elapsed time excluding paused time
    let elapsed = Date.now() - this.blindTimerStart - this.totalPausedTime;
    if (this.paused && this.pausedAt) {
      elapsed -= (Date.now() - this.pausedAt);
    }

    const timerDuration = this.config.blindTimerMinutes * 60 * 1000;

    if (elapsed >= timerDuration) {
      const blinds = this.doubleBlinds();
      this.blindTimerStart = Date.now(); // Reset timer
      this.totalPausedTime = 0; // Reset paused time
      return {
        timerExpired: true,
        newBlinds: blinds
      };
    }

    return { timerExpired: false };
  }

  getBlindTimerRemaining() {
    if (!this.config.blindTimerEnabled || !this.blindTimerStart) {
      return null;
    }

    // Calculate elapsed time excluding paused time
    let elapsed = Date.now() - this.blindTimerStart - this.totalPausedTime;
    if (this.paused && this.pausedAt) {
      elapsed -= (Date.now() - this.pausedAt);
    }

    const timerDuration = this.config.blindTimerMinutes * 60 * 1000;
    const remaining = Math.max(0, timerDuration - elapsed);

    return {
      remainingMs: remaining,
      remainingMinutes: Math.floor(remaining / 60000),
      remainingSeconds: Math.floor((remaining % 60000) / 1000)
    };
  }

  pauseGame() {
    if (this.paused) {
      return { success: false, message: 'Game already paused' };
    }
    this.paused = true;
    this.pausedAt = Date.now();
    return { success: true };
  }

  resumeGame() {
    if (!this.paused) {
      return { success: false, message: 'Game not paused' };
    }
    // Add this pause duration to total paused time
    if (this.pausedAt) {
      this.totalPausedTime += (Date.now() - this.pausedAt);
    }
    this.paused = false;
    this.pausedAt = null;
    return { success: true };
  }

  getGameState() {
    return {
      players: this.players.map(p => ({
        socketId: p.socketId,
        sessionId: p.sessionId,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        active: p.active,
        connected: p.connected,
        cardCount: p.cards.length,
        lastAction: p.lastAction,
        lastActionAmount: p.lastActionAmount,
        stats: p.stats
      })),
      communityCards: this.communityCards,
      pot: this.pot,
      currentBet: this.currentBet,
      currentPlayerIndex: this.currentPlayerIndex,
      dealerIndex: this.dealerIndex,
      gameState: this.gameState,
      currentHandNumber: this.currentHandNumber,
      config: this.config,
      blinds: {
        small: this.config.smallBlind,
        big: this.config.bigBlind
      },
      blindTimer: this.getBlindTimerRemaining(),
      paused: this.paused
    };
  }

  getPlayerState(socketId) {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return null;

    return {
      sessionId: player.sessionId,
      name: player.name,
      cards: player.cards,
      chips: player.chips,
      bet: player.bet,
      folded: player.folded,
      stats: player.stats,
      isCurrentPlayer: this.players[this.currentPlayerIndex]?.socketId === socketId
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  skipCurrentPlayer() {
    if (this.gameState === 'waiting' || this.gameState === 'showdown') {
      return { success: false, message: 'No active hand' };
    }

    const currentPlayer = this.players[this.currentPlayerIndex];
    if (!currentPlayer) {
      return { success: false, message: 'No current player' };
    }

    // Auto-fold the current player
    currentPlayer.folded = true;
    currentPlayer.lastAction = 'fold';
    currentPlayer.lastActionAmount = 0;
    currentPlayer.stats.currentStreak = 0;

    // Mark them as having acted
    this.playersActed.add(this.currentPlayerIndex);

    // Move to next player
    this.nextPlayer();

    return { success: true, playerName: currentPlayer.name };
  }
}

module.exports = PokerGame;
