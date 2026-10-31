import {describe, expect, it, jest} from '@jest/globals';

import {submitGameScore} from '../src/services/gamificationService';

jest.mock('../src/services/gamificationService', () => ({
  startGamePlaySession: jest.fn(),
  submitGameScore: jest.fn(),
}));

import {
  getGameResultMessage,
  submitMobileGameScore,
} from '../src/screens/games/gameSession';

describe('gameSession helpers', () => {
  it('submits a sanitized score bound to the server game session', async () => {
    const submitMock = submitGameScore as jest.MockedFunction<typeof submitGameScore>;
    submitMock.mockResolvedValueOnce({points_awarded: 4} as any);

    await submitMobileGameScore({
      game: {id: 'game-1'} as any,
      score: 42.9,
      sessionId: 'session-1',
    });

    expect(submitMock).toHaveBeenCalledWith('game-1', {
      score: 42,
      session_id: 'session-1',
    });
  });

  it('formats awarded XP result messages without hiding zero awards', () => {
    expect(getGameResultMessage(120, 8)).toBe('120 skor · +8 XP');
    expect(getGameResultMessage(0, 0)).toBe('0 skor · +0 XP');
  });
});
