// Texas Hold'em hand evaluation

class HandEvaluator {
  static evaluateHand(cards) {
    if (cards.length < 5) return { rank: 0, name: 'High Card', values: [] };

    const hands = this.getAllFiveCardCombinations(cards);
    let bestHand = null;
    let bestRank = 0;

    for (let hand of hands) {
      const evaluation = this.evaluate5Cards(hand);
      if (evaluation.rank > bestRank) {
        bestRank = evaluation.rank;
        bestHand = evaluation;
        bestHand.cards = hand;
      }
    }

    return bestHand;
  }

  static getAllFiveCardCombinations(cards) {
    const combinations = [];
    const n = cards.length;

    function combine(start, combo) {
      if (combo.length === 5) {
        combinations.push([...combo]);
        return;
      }

      for (let i = start; i < n; i++) {
        combo.push(cards[i]);
        combine(i + 1, combo);
        combo.pop();
      }
    }

    combine(0, []);
    return combinations;
  }

  static evaluate5Cards(cards) {
    const sorted = [...cards].sort((a, b) => b.value - a.value);
    const values = sorted.map(c => c.value);
    const suits = sorted.map(c => c.suit);

    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = this.checkStraight(values);
    const valueCounts = this.countValues(values);

    // Royal Flush
    if (isFlush && isStraight && values[0] === 14) {
      return { rank: 10, name: 'Royal Flush', values };
    }

    // Straight Flush
    if (isFlush && isStraight) {
      return { rank: 9, name: 'Straight Flush', values };
    }

    // Four of a Kind
    if (valueCounts[0].count === 4) {
      return { rank: 8, name: 'Four of a Kind', values: [valueCounts[0].value] };
    }

    // Full House
    if (valueCounts[0].count === 3 && valueCounts[1].count === 2) {
      return { rank: 7, name: 'Full House', values: [valueCounts[0].value, valueCounts[1].value] };
    }

    // Flush
    if (isFlush) {
      return { rank: 6, name: 'Flush', values };
    }

    // Straight
    if (isStraight) {
      return { rank: 5, name: 'Straight', values };
    }

    // Three of a Kind
    if (valueCounts[0].count === 3) {
      return { rank: 4, name: 'Three of a Kind', values: [valueCounts[0].value] };
    }

    // Two Pair
    if (valueCounts[0].count === 2 && valueCounts[1].count === 2) {
      return { rank: 3, name: 'Two Pair', values: [valueCounts[0].value, valueCounts[1].value] };
    }

    // One Pair
    if (valueCounts[0].count === 2) {
      return { rank: 2, name: 'One Pair', values: [valueCounts[0].value] };
    }

    // High Card
    return { rank: 1, name: 'High Card', values };
  }

  static checkStraight(values) {
    // Check regular straight
    for (let i = 0; i < 4; i++) {
      if (values[i] - values[i + 1] !== 1) {
        // Check for A-2-3-4-5 (wheel)
        if (values[0] === 14 && values[1] === 5 && values[2] === 4 &&
            values[3] === 3 && values[4] === 2) {
          return true;
        }
        return false;
      }
    }
    return true;
  }

  static countValues(values) {
    const counts = {};
    values.forEach(v => {
      counts[v] = (counts[v] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([value, count]) => ({ value: parseInt(value), count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.value - a.value;
      });
  }

  static compareHands(hand1, hand2) {
    if (hand1.rank !== hand2.rank) {
      return hand1.rank - hand2.rank;
    }

    // Same rank, compare high cards
    for (let i = 0; i < Math.min(hand1.values.length, hand2.values.length); i++) {
      if (hand1.values[i] !== hand2.values[i]) {
        return hand1.values[i] - hand2.values[i];
      }
    }

    return 0; // Exact tie
  }
}

module.exports = HandEvaluator;
