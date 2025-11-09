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
    this.config = {
      smallBlind: 10,
      bigBlind: 20,
      startingChips: 1000,
      minPlayers: 2,
      maxPlayers: 10,
      autoNextHand: true, // Automatically start next hand
      autoNextHandDelay: 5000 // Delay in ms before starting next hand
    };
    this.roundBets = {};
  }

  addPlayer(socketId, name) {
    if (this.players.length >= this.config.maxPlayers) {
      return { success: false, message: 'Game is full' };
    }

    if (this.players.find(p => p.socketId === socketId)) {
      return { success: false, message: 'Already in game' };
    }

    const player = {
      socketId,
      name,
      chips: this.config.startingChips,
      cards: [],
      bet: 0,
      folded: false,
      allIn: false,
      active: true
    };

    this.players.push(player);
    return { success: true, player };
  }

  removePlayer(socketId) {
    const index = this.players.findIndex(p => p.socketId === socketId);
    if (index !== -1) {
      this.players.splice(index, 1);
      if (this.players.length < this.config.minPlayers && this.gameState !== 'waiting') {
        this.endGame();
      }
    }
  }

  startGame() {
    if (this.players.length < this.config.minPlayers) {
      return { success: false, message: 'Not enough players' };
    }

    this.gameState = 'dealing';
    this.deck.reset();
    this.deck.shuffle();
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.roundBets = {};
    this.playersActed = new Set();

    // Reset players
    this.players.forEach(player => {
      player.cards = [];
      player.bet = 0;
      player.folded = false;
      player.allIn = false;
      player.active = true;
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
        break;

      case 'check':
        if (player.bet < this.currentBet) {
          return { success: false, message: 'Cannot check, must call or raise' };
        }
        // Check doesn't change aggressor
        break;

      case 'call':
        const callAmount = Math.min(this.currentBet - player.bet, player.chips);
        player.chips -= callAmount;
        player.bet += callAmount;
        this.pot += callAmount;
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
      this.endHand();
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
    // Reset bets for next round
    this.players.forEach(p => p.bet = 0);
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
      return { player, hand };
    });

    results.sort((a, b) => HandEvaluator.compareHands(b.hand, a.hand));

    // Award pot (simple version, doesn't handle side pots)
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
        w.player.chips += winAmount;
      });
    }

    this.gameState = 'waiting';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;

    return results;
  }

  endHand() {
    const winner = this.players.find(p => !p.folded);
    if (winner) {
      winner.chips += this.pot;
    }

    this.gameState = 'waiting';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
  }

  endGame() {
    this.gameState = 'waiting';
    this.communityCards = [];
    this.pot = 0;
  }

  getGameState() {
    return {
      players: this.players.map(p => ({
        socketId: p.socketId,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        active: p.active,
        cardCount: p.cards.length
      })),
      communityCards: this.communityCards,
      pot: this.pot,
      currentBet: this.currentBet,
      currentPlayerIndex: this.currentPlayerIndex,
      dealerIndex: this.dealerIndex,
      gameState: this.gameState,
      config: this.config
    };
  }

  getPlayerState(socketId) {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return null;

    return {
      cards: player.cards,
      chips: player.chips,
      bet: player.bet,
      folded: player.folded,
      isCurrentPlayer: this.players[this.currentPlayerIndex]?.socketId === socketId
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

module.exports = PokerGame;
