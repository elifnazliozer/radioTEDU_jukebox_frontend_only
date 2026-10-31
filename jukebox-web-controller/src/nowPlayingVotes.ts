export function getIstanbulDayKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function hasSupervoteAvailableToday(lastSuperVoteAt?: string, now: string | Date = new Date()) {
  return !lastSuperVoteAt || getIstanbulDayKey(lastSuperVoteAt) !== getIstanbulDayKey(now);
}

export function getDisplayedSongScore(item: { song_score?: number | null; priority_score?: number | null }) {
  return item.song_score ?? item.priority_score ?? 0;
}

const scoreFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** Postgres numerics arrive as strings like "0.00"; show them as "0", "12" or "2,5". */
export function formatSongScore(score: number | string | null | undefined) {
  const value = typeof score === 'string' ? Number.parseFloat(score) : score;
  return scoreFormatter.format(typeof value === 'number' && Number.isFinite(value) ? value : 0);
}

export function isSupervoteActive(vote: number | undefined) {
  return vote === 3 || vote === 4;
}

export function resolveDisplayedVote(
  item: { id: string; user_vote?: number },
  myVotes: Record<string, number>,
) {
  return myVotes[item.id] !== undefined ? myVotes[item.id] : item.user_vote;
}
