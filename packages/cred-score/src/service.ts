export type CredScoreLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'TRUSTED';

export interface TransactionEvent {
  success: boolean;
  cancelled?: boolean;
  respectedPolicy?: boolean;
  disputeOpened?: boolean;
  refunded?: boolean;
}

export class CredScoreService {
  /**
   * Calculate new CredScore based on a transaction event.
   * Asymmetric: success gives gradual increase, failure causes strong decrease.
   * Score range: 0-100.
   */
  calculateScore(currentScore: number, transaction: TransactionEvent): number {
    let score = currentScore;

    // Success: gradual increase (+2)
    if (transaction.success) {
      score += 2;
    }

    // Failure or cancellation: strong decrease (-8)
    if (!transaction.success || transaction.cancelled) {
      score -= 8;
    }

    // Dispute opened: severe penalty (-15)
    if (transaction.disputeOpened) {
      score -= 15;
    }

    // Refund: moderate penalty (-5)
    if (transaction.refunded) {
      score -= 5;
    }

    // Policy adherence: bonus (+3)
    if (transaction.respectedPolicy) {
      score += 3;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Determine CredScore level from numeric score.
   * LOW: <50, MEDIUM: 50-75, HIGH: 76-90, TRUSTED: >90
   */
  getLevel(score: number): CredScoreLevel {
    if (score > 90) return 'TRUSTED';
    if (score > 75) return 'HIGH';
    if (score >= 50) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Apply temporal decay for inactive agents.
   * Reduces score by 1 point per week of inactivity, minimum 30.
   */
  applyDecay(currentScore: number, daysSinceLastTransaction: number): number {
    const weeksInactive = Math.floor(daysSinceLastTransaction / 7);
    if (weeksInactive <= 0) return currentScore;

    const decayed = currentScore - weeksInactive;
    return Math.max(30, decayed);
  }

  /**
   * Get initial score for a new agent based on KYC level.
   */
  getInitialScore(kycLevel: 'NONE' | 'BASIC' | 'VERIFIED' | 'ENHANCED'): number {
    switch (kycLevel) {
      case 'ENHANCED': return 70;
      case 'VERIFIED': return 60;
      case 'BASIC': return 45;
      case 'NONE': return 30;
    }
  }
}
