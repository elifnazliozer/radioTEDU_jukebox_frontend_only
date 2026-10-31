import { describe, expect, it, jest, beforeEach } from '@jest/globals';

import api from '../src/services/api';
import {
  createPodcastFeed,
  deletePodcastFeed,
  listPodcastFeeds,
  hasDuplicatePodcastFeedUrl,
  hasDuplicatePodcastFeedUrlOnServer,
  syncPodcastFeeds,
} from '../src/services/podcastFeedsAdmin';
import {waitForBackgroundJob} from '../src/services/jobsService';

jest.mock('../src/services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../src/services/jobsService', () => ({
  waitForBackgroundJob: jest.fn(),
}));

describe('podcastFeedsAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads podcast feeds from the backend list endpoint', async () => {
    const getMock = api.get as jest.MockedFunction<(path: string) => Promise<any>>;
    getMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          feeds: [
            {
              id: 'feed-1',
              title: 'Morning Show',
              feed_url: 'https://example.com/feed-1.xml',
              is_active: true,
              last_synced_at: '2026-04-10T09:30:00Z',
              last_sync_error: null,
            },
          ],
        },
      },
    });

    await expect(listPodcastFeeds()).resolves.toEqual([
      {
        id: 'feed-1',
        title: 'Morning Show',
        feedUrl: 'https://example.com/feed-1.xml',
        isActive: true,
        lastSyncedAt: '2026-04-10T09:30:00Z',
        lastSyncError: null,
      },
    ]);

    expect(getMock).toHaveBeenCalledWith('/podcast-feeds');
  });

  it('creates podcast feeds through the backend payload shape', async () => {
    const postMock = api.post as jest.MockedFunction<(path: string, body?: any) => Promise<any>>;
    postMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          feed: {
            id: 'feed-2',
            title: 'Late Night',
            feed_url: 'https://example.com/feed-2.xml',
            is_active: true,
            last_synced_at: null,
            last_sync_error: null,
          },
          sync_job_id: '17',
        },
      },
    });

    await expect(
      createPodcastFeed({
        title: 'Late Night',
        feedUrl: 'https://example.com/feed-2.xml',
      }),
    ).resolves.toEqual({
      feed: {
        id: 'feed-2',
        title: 'Late Night',
        feedUrl: 'https://example.com/feed-2.xml',
        isActive: true,
        lastSyncedAt: null,
        lastSyncError: null,
      },
      syncJobId: '17',
    });

    expect(postMock).toHaveBeenCalledWith('/podcast-feeds', {
      title: 'Late Night',
      feed_url: 'https://example.com/feed-2.xml',
    });
  });

  it('returns a null sync job id when the initial sync could not be queued', async () => {
    const postMock = api.post as jest.MockedFunction<(path: string, body?: any) => Promise<any>>;
    postMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          feed: {
            id: 'feed-4',
            title: 'Broken Sync',
            feed_url: 'https://example.com/feed-4.xml',
            is_active: true,
            last_synced_at: null,
            last_sync_error: 'feed fetch failed',
          },
          sync_job_id: null,
        },
      },
    });

    await expect(
      createPodcastFeed({
        title: 'Broken Sync',
        feedUrl: 'https://example.com/feed-4.xml',
      }),
    ).resolves.toEqual({
      feed: {
        id: 'feed-4',
        title: 'Broken Sync',
        feedUrl: 'https://example.com/feed-4.xml',
        isActive: true,
        lastSyncedAt: null,
        lastSyncError: 'feed fetch failed',
      },
      syncJobId: null,
    });
  });

  it('queues a podcast sync job and returns the finished per-feed results', async () => {
    const postMock = api.post as jest.MockedFunction<(path: string, body?: any) => Promise<any>>;
    postMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {job_id: '42', state: 'queued'},
      },
    });
    const waitMock = waitForBackgroundJob as jest.MockedFunction<typeof waitForBackgroundJob>;
    waitMock.mockResolvedValueOnce({
      results: [
        {feed_id: 'feed-1', status: 'synced', processed: 8, upserted: 6, skipped: 2},
        {feed_id: 'feed-2', status: 'failed'},
      ],
    });

    await expect(syncPodcastFeeds()).resolves.toEqual([
      {feedId: 'feed-1', status: 'synced', processed: 8, upserted: 6, skipped: 2},
      {feedId: 'feed-2', status: 'failed', processed: 0, upserted: 0, skipped: 0},
    ]);

    expect(postMock).toHaveBeenCalledWith('/podcast-feeds/sync', {});
    expect(waitMock).toHaveBeenCalledWith('42');
  });

  it('fails when the backend does not queue a sync job', async () => {
    const postMock = api.post as jest.MockedFunction<(path: string, body?: any) => Promise<any>>;
    postMock.mockResolvedValueOnce({data: {success: true, data: {}}});

    await expect(syncPodcastFeeds()).rejects.toThrow('Podcast sync job was not queued');
  });

  it('deletes podcast feeds through the backend delete endpoint', async () => {
    const deleteMock = api.delete as jest.MockedFunction<(path: string) => Promise<any>>;
    deleteMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          feed: {
            id: 'feed-3',
            title: 'Archived Feed',
            feed_url: 'https://example.com/feed-3.xml',
          },
        },
      },
    });

    await expect(deletePodcastFeed('feed-3')).resolves.toEqual({
      id: 'feed-3',
      title: 'Archived Feed',
      feedUrl: 'https://example.com/feed-3.xml',
      isActive: false,
      lastSyncedAt: null,
      lastSyncError: null,
    });

    expect(deleteMock).toHaveBeenCalledWith('/podcast-feeds/feed-3');
  });

  it('detects duplicate podcast feed urls in the current feed list', () => {
    expect(
      hasDuplicatePodcastFeedUrl(
        [
          {
            id: 'feed-1',
            title: 'Morning Show',
            feedUrl: 'https://example.com/feed-1.xml',
            isActive: true,
            lastSyncedAt: null,
            lastSyncError: null,
          },
        ],
        'https://example.com/feed-1.xml',
      ),
    ).toBe(true);

    expect(
      hasDuplicatePodcastFeedUrl(
        [
          {
            id: 'feed-1',
            title: 'Morning Show',
            feedUrl: 'https://example.com/feed-1.xml',
            isActive: true,
            lastSyncedAt: null,
            lastSyncError: null,
          },
        ],
        'https://example.com/other.xml',
      ),
    ).toBe(false);
  });

  it('detects duplicate podcast feed urls against the backend list', async () => {
    const getMock = api.get as jest.MockedFunction<(path: string) => Promise<any>>;
    getMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          feeds: [
            {
              id: 'feed-1',
              title: 'Morning Show',
              feed_url: 'https://example.com/feed-1.xml',
              is_active: true,
              last_synced_at: null,
              last_sync_error: null,
            },
          ],
        },
      },
    });

    await expect(hasDuplicatePodcastFeedUrlOnServer('https://example.com/feed-1.xml')).resolves.toBe(true);
    expect(getMock).toHaveBeenCalledWith('/podcast-feeds');
  });
});
