export type RiskLevel = 'normal' | 'elevated' | 'crisis';

const RANK: Record<RiskLevel, number> = { normal: 0, elevated: 1, crisis: 2 };

export function maxRisk(...levels: RiskLevel[]): RiskLevel {
  return levels.reduce(
    (highest, level) => (RANK[level] > RANK[highest] ? level : highest),
    'normal',
  );
}

/** Normal turns needed before an `elevated` session returns to `normal` (02 §7.2). */
export const ELEVATED_RECOVERY_TURNS = 3;

export interface SessionRisk {
  level: RiskLevel;
  normalStreak: number;
}

/**
 * Sticky session risk (02 §7.2): `crisis` never goes down; `elevated` returns to `normal`
 * after three consecutive normal turns.
 */
export function nextSessionRisk(
  current: SessionRisk,
  turn: RiskLevel,
): SessionRisk {
  if (current.level === 'crisis' || turn === 'crisis') {
    return { level: 'crisis', normalStreak: 0 };
  }
  if (turn === 'elevated') return { level: 'elevated', normalStreak: 0 };
  if (current.level === 'elevated') {
    const streak = current.normalStreak + 1;
    return streak >= ELEVATED_RECOVERY_TURNS
      ? { level: 'normal', normalStreak: 0 }
      : { level: 'elevated', normalStreak: streak };
  }
  return { level: 'normal', normalStreak: 0 };
}
