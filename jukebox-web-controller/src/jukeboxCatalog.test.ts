import { describe, expect, it } from 'vitest';
import {
  buildQueueRequestPayload,
  getSearchResultKey,
  getSongQueueKey,
  type CatalogSearchSong,
} from './jukeboxCatalog';

describe('jukebox catalog helpers', () => {
  it('uses spotify_uri as the stable key for spotify search results', () => {
    const spotifySong: CatalogSearchSong = {
      id: null,
      source_type: 'spotify',
      spotify_uri: 'spotify:track:123',
      title: 'Spotify Song',
      artist: 'Spotify Artist',
      cover_url: 'https://example.com/cover.jpg',
      file_url: null,
    };

    expect(getSearchResultKey(spotifySong, 0)).toBe('spotify:track:123');
  });

  it('builds queue requests with spotify_uri for spotify results', () => {
    const spotifySong: CatalogSearchSong = {
      id: null,
      source_type: 'spotify',
      spotify_uri: 'spotify:track:123',
      title: 'Spotify Song',
      artist: 'Spotify Artist',
      cover_url: 'https://example.com/cover.jpg',
      file_url: null,
    };

    expect(buildQueueRequestPayload('device-1', spotifySong)).toEqual({
      device_id: 'device-1',
      spotify_uri: 'spotify:track:123',
    });
  });

  it('builds queue requests with song_id for local catalog results', () => {
    const localSong: CatalogSearchSong = {
      id: 'local-song-1',
      source_type: 'local',
      spotify_uri: null,
      title: 'Local Song',
      artist: 'Local Artist',
      cover_url: 'https://example.com/local-cover.jpg',
      file_url: '/uploads/songs/local-song.mp3',
    };

    expect(buildQueueRequestPayload('device-1', localSong)).toEqual({
      device_id: 'device-1',
      song_id: 'local-song-1',
    });
  });

  it('keys a song being queued by its Spotify URI, then id, then title and artist', () => {
    const base = { id: null, title: 'Kuzu Kuzu', artist: 'Tarkan', cover_url: null, file_url: null };
    expect(getSongQueueKey({ ...base, source_type: 'spotify', spotify_uri: 'spotify:track:1', id: 'song-1' })).toBe('spotify:track:1');
    expect(getSongQueueKey({ ...base, source_type: 'local', id: 'song-1' })).toBe('song-1');
    expect(getSongQueueKey({ ...base, source_type: 'local' })).toBe('local:Kuzu Kuzu:Tarkan');
  });
});
