import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import axios, { isAxiosError } from 'axios';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Edit2,
  FolderSearch,
  Laptop,
  ListMusic,
  LogOut,
  Monitor,
  Music,
  Plus,
  RefreshCw,
  Repeat,
  Shield,
  ShieldAlert,
  SkipForward,
  Sliders,
  Smartphone,
  Speaker,
  Trash2,
  Tv,
  Volume2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  buildSpotifyAppConfigPayload,
  buildSpotifyDeviceAuthDisconnectRequest,
  buildSpotifyDeviceAuthStartRequest,
  buildSpotifyPlaybackTargetPayload,
  formatSpotifyDeviceAuthStatus,
  formatSpotifyPlaybackDeviceType,
  isSpotifyDeviceAuthSuccessMessage,
  maskSpotifyAppConfigForForm,
  resolveAssignedSpotifyDeviceLabel,
  SPOTIFY_APP_SECRET_MASK,
  type SpotifyAppConfigApiResponse,
  type SpotifyAppConfigFormState,
  type SpotifyDeviceAuthStatusApiResponse,
  type SpotifyPlaybackDevice,
} from './adminSpotifyConfig';
import { resolveWebRuntimeConfig } from './runtimeConfig';
import { translate, useI18n, type MessageKey } from './i18n';

const API_URL = resolveWebRuntimeConfig({
  windowOrigin: window.location.origin,
  windowProtocol: window.location.protocol,
  windowHostname: window.location.hostname,
  isDev: import.meta.env.DEV,
  // Assets and Socket.IO keep their configured proxy base path; HTTP API calls
  // use the canonical /api/v1 origin.
  baseUrl: import.meta.env.DEV ? '/' : (import.meta.env.VITE_PUBLIC_BASE_PATH || '/jukebox/'),
  apiOriginOverride: import.meta.env.VITE_API_ORIGIN,
}).apiRoot;

export interface DeviceSummary {
  id: string;
  device_code: string;
  name: string;
  location: string | null;
  is_active: boolean;
  queue_count?: number;
  current_song_title?: string | null;
  current_song_artist?: string | null;
  last_heartbeat?: string | null;
  override_enabled?: boolean;
  override_autoplay_spotify_playlist_uri?: string | null;
  spotify_playback_device_id?: string | null;
  spotify_player_name?: string | null;
  spotify_player_is_active?: boolean | null;
  spotify_player_connected_at?: string | null;
}

export interface PlaylistPreview {
  id: string;
  uri: string;
  name: string;
  description: string;
  cover_url: string | null;
  owner_name: string;
  total_tracks: number;
}

interface AdminSong {
  id: string;
  title: string;
  artist: string;
  duration_seconds?: number;
  duration_ms?: number;
  total_plays?: number;
  cover_url?: string | null;
}

interface NewDeviceForm {
  device_code: string;
  name: string;
  location: string;
  password: string;
}

interface ScanFolderResponse {
  added: number;
  skipped: number;
  total: number;
  synced?: number;
  syncFailed?: number;
  failedSongs?: Array<{ title: string }>;
}

export type AdminTab = 'spotify-players' | 'fallback' | 'moderation' | 'devices' | 'songs';

const ADMIN_TAB_ORDER: AdminTab[] = ['spotify-players', 'fallback', 'moderation', 'devices', 'songs'];

export interface AdminDashboardProps {
  token: string;
  device: DeviceSummary;
  onSelectDevice?: (device: DeviceSummary) => void;
  onClose?: () => void;
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

async function waitForControllerJob<T>(jobId: string, token: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30 * 60_000) {
    const response = await axios.get<{ data?: { state?: string; failed?: boolean; result?: T } }>(
      `${API_URL}/api/v1/jobs/${encodeURIComponent(jobId)}`,
      { headers: authHeaders(token) },
    );
    const job = response.data.data;
    if (job?.state === 'completed') return job.result as T;
    if (job?.state === 'failed' || job?.failed) throw new Error('Background job failed');
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error('Background job timed out while waiting');
}

const errorMessage = (error: unknown, fallback = translate('tr', 'admin.genericError')) => {
  if (isAxiosError<{ error?: string; message?: string }>(error)) {
    return error.response?.data?.error || error.response?.data?.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
};

const isOnline = (lastHeartbeat?: string | null) => {
  if (!lastHeartbeat) return false;
  return Date.now() - new Date(lastHeartbeat).getTime() < 60000;
};

export function AdminDashboard({ token, device, onSelectDevice, onClose }: AdminDashboardProps) {
  const { t, lang } = useI18n();
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  const tr = (key: MessageKey, params?: Record<string, string | number>) => translate(langRef.current, key, params);
  const errorStatus = (error: unknown) => tr('admin.errorPrefix', { message: errorMessage(error, tr('admin.genericError')) });
  const [activeTab, setActiveTab] = useState<AdminTab>('spotify-players');
  const [tabSlide, setTabSlide] = useState<'next' | 'prev' | null>(null);

  const selectTab = (tab: AdminTab, button?: HTMLElement) => {
    button?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    if (tab === activeTab) return;
    setTabSlide(ADMIN_TAB_ORDER.indexOf(tab) > ADMIN_TAB_ORDER.indexOf(activeTab) ? 'next' : 'prev');
    setActiveTab(tab);
  };

  const tabsNavRef = useRef<HTMLElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleSwipeStart = (event: TouchEvent) => {
    const target = event.target as HTMLElement;
    // Leave text fields and sliders their own horizontal gestures.
    if (event.touches.length !== 1 || target.closest('input, textarea, select, [role="slider"]')) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };

  const handleSwipeEnd = (event: TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const nextIndex = ADMIN_TAB_ORDER.indexOf(activeTab) + (dx < 0 ? 1 : -1);
    const nextTab = ADMIN_TAB_ORDER[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab, tabsNavRef.current?.children[nextIndex] as HTMLElement | undefined);
  };
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [provisioningCodes, setProvisioningCodes] = useState<Record<string, { code: string; expiresAt: string }>>({});
  const [showNewDevice, setShowNewDevice] = useState(false);
  const [newDevice, setNewDevice] = useState<NewDeviceForm>({ device_code: '', name: '', location: '', password: '' });
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ name: '', location: '', password: '' });
  const [spotifyAppConfig, setSpotifyAppConfig] = useState<SpotifyAppConfigFormState>({ client_id: '', client_secret: '' });
  const [spotifyDeviceAuthStatuses, setSpotifyDeviceAuthStatuses] = useState<Record<string, SpotifyDeviceAuthStatusApiResponse | null>>({});
  const [songs, setSongs] = useState<AdminSong[]>([]);

  // Spotify Connect Playback Devices & Kiosk Target State
  const [spotifyPlaybackDevices, setSpotifyPlaybackDevices] = useState<SpotifyPlaybackDevice[]>([]);
  const [loadingSpotifyDevices, setLoadingSpotifyDevices] = useState(false);
  const [updatingKioskTargetId, setUpdatingKioskTargetId] = useState<string | null>(null);

  // Moderation & Content Filtering State
  const [moderationSettings, setModerationSettings] = useState({
    lyrics_filter_enabled: true,
    block_unverified_obscure_tracks: true,
    min_popularity_without_lyrics: 15,
  });
  const [blockedKeywords, setBlockedKeywords] = useState<Array<{ id: string; word: string; category: string; created_at: string }>>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [testForm, setTestForm] = useState({ title: '', artist: '', text: '' });
  const [testResult, setTestResult] = useState<{ foundLyrics?: boolean; isProfane: boolean; matchedWord?: string; testedTextSnippet?: string; message?: string } | null>(null);
  const [testingProfanity, setTestingProfanity] = useState(false);

  const fetchModerationSettings = useCallback(async () => {
    try {
      const res = await axios.get<{ data: typeof moderationSettings }>(`${API_URL}/api/v1/jukebox/admin/moderation/settings`, {
        headers: authHeaders(token),
      });
      if (res.data?.data) {
        setModerationSettings(res.data.data);
      }
    } catch (error) {
      console.warn('Failed to fetch moderation settings:', error);
    }
  }, [token]);

  const fetchBlockedKeywords = useCallback(async () => {
    try {
      const res = await axios.get<{ data: typeof blockedKeywords }>(`${API_URL}/api/v1/jukebox/admin/moderation/keywords`, {
        headers: authHeaders(token),
      });
      if (Array.isArray(res.data?.data)) {
        setBlockedKeywords(res.data.data);
      }
    } catch (error) {
      console.warn('Failed to fetch blocked keywords:', error);
    }
  }, [token]);

  const saveModerationSettings = async () => {
    try {
      setLoading(true);
      await axios.put(`${API_URL}/api/v1/jukebox/admin/moderation/settings`, moderationSettings, {
        headers: authHeaders(token),
      });
      setStatus(tr('admin.moderationSaved'));
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const addBlockedKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/v1/jukebox/admin/moderation/keywords`, { word: newKeyword.trim() }, {
        headers: authHeaders(token),
      });
      setNewKeyword('');
      setStatus(tr('admin.keywordAdded'));
      void fetchBlockedKeywords();
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const deleteBlockedKeyword = async (id: string) => {
    try {
      setLoading(true);
      await axios.delete(`${API_URL}/api/v1/jukebox/admin/moderation/keywords/${id}`, {
        headers: authHeaders(token),
      });
      setStatus(tr('admin.keywordDeleted'));
      void fetchBlockedKeywords();
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const runModerationTest = async () => {
    try {
      setTestingProfanity(true);
      setTestResult(null);
      const res = await axios.post<{ data: NonNullable<typeof testResult> }>(`${API_URL}/api/v1/jukebox/admin/moderation/test`, {
        title: testForm.title.trim(),
        artist: testForm.artist.trim(),
        text: testForm.text.trim(),
      }, {
        headers: authHeaders(token),
      });
      setTestResult(res.data?.data);
    } catch (error) {
      setStatus(tr('admin.testErrorPrefix', { message: errorMessage(error, tr('admin.genericError')) }));
    } finally {
      setTestingProfanity(false);
    }
  };

  // Fallback Playlist (Yedek Çalma Listesi) State
  const [selectedPlaylistDeviceId, setSelectedPlaylistDeviceId] = useState<string>(device.id);
  const [fallbackPlaylistUrl, setFallbackPlaylistUrl] = useState<string>('');
  const [fallbackAutoplayEnabled, setFallbackAutoplayEnabled] = useState<boolean>(true);
  const [playlistPreview, setPlaylistPreview] = useState<PlaylistPreview | null>(null);
  const [fetchingPreview, setFetchingPreview] = useState<boolean>(false);

  const fetchPlaylistPreview = useCallback(async (url: string) => {
    if (!url.trim()) {
      setPlaylistPreview(null);
      return;
    }
    try {
      setFetchingPreview(true);
      const res = await axios.get<{ data: PlaylistPreview }>(`${API_URL}/api/v1/jukebox/admin/playlist-preview`, {
        headers: authHeaders(token),
        params: { url: url.trim() },
      });
      setPlaylistPreview(res.data.data);
    } catch (error) {
      console.warn('Playlist preview fetch error:', error);
      setPlaylistPreview(null);
    } finally {
      setFetchingPreview(false);
    }
  }, [token]);

  const saveFallbackPlaylistConfig = async () => {
    try {
      setLoading(true);
      const targetDeviceId = selectedPlaylistDeviceId || device.id;
      await axios.patch(
        `${API_URL}/api/v1/jukebox/admin/devices/${targetDeviceId}`,
        {
          override_autoplay_spotify_playlist_uri: fallbackPlaylistUrl,
          override_enabled: fallbackAutoplayEnabled,
        },
        { headers: authHeaders(token) }
      );
      setStatus(tr('admin.fallbackSaved'));
      void fetchDevices();
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const clearFallbackPlaylistConfig = async () => {
    if (!window.confirm(tr('admin.fallbackRemoveConfirm'))) return;
    try {
      setLoading(true);
      const targetDeviceId = selectedPlaylistDeviceId || device.id;
      await axios.patch(
        `${API_URL}/api/v1/jukebox/admin/devices/${targetDeviceId}`,
        {
          override_autoplay_spotify_playlist_uri: '',
          override_enabled: false,
        },
        { headers: authHeaders(token) }
      );
      setFallbackPlaylistUrl('');
      setPlaylistPreview(null);
      setFallbackAutoplayEnabled(false);
      setStatus(tr('admin.fallbackRemoved'));
      void fetchDevices();
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const lastLoadedDeviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'fallback') {
      lastLoadedDeviceIdRef.current = null;
      return;
    }
    const target = devices.find((d) => d.id === selectedPlaylistDeviceId) || (device.id === selectedPlaylistDeviceId ? device : null);
    if (target && lastLoadedDeviceIdRef.current !== target.id) {
      lastLoadedDeviceIdRef.current = target.id;
      const uri = target.override_autoplay_spotify_playlist_uri || '';
      setFallbackPlaylistUrl(uri);
      setFallbackAutoplayEnabled(target.override_enabled ?? Boolean(uri));
      if (uri) {
        void fetchPlaylistPreview(uri);
      } else {
        setPlaylistPreview(null);
      }
    }
  }, [activeTab, selectedPlaylistDeviceId, devices, device, fetchPlaylistPreview]);

  useEffect(() => {
    if (activeTab === 'moderation') {
      void fetchModerationSettings();
      void fetchBlockedKeywords();
    }
  }, [activeTab, fetchModerationSettings, fetchBlockedKeywords]);

  const refreshSpotifyDeviceStatuses = useCallback(
    async (nextDevices: DeviceSummary[]) => {
      const entries = await Promise.all(
        nextDevices.map(async (nextDevice) => {
          try {
            const res = await axios.get<{ data: SpotifyDeviceAuthStatusApiResponse }>(`${API_URL}/api/v1/spotify/device-auth/status`, {
              headers: authHeaders(token),
              params: { device_id: nextDevice.id },
            });
            return [nextDevice.id, res.data.data] as const;
          } catch {
            return [nextDevice.id, null] as const;
          }
        }),
      );

      setSpotifyDeviceAuthStatuses(Object.fromEntries(entries));
    },
    [token],
  );

  const fetchDevices = useCallback(async () => {
    try {
      const res = await axios.get<{ data: { devices?: DeviceSummary[] } }>(`${API_URL}/api/v1/jukebox/admin/devices`, {
        headers: authHeaders(token),
      });
      const nextDevices = res.data.data.devices || [];
      setDevices(nextDevices);
      void refreshSpotifyDeviceStatuses(nextDevices);
    } catch (error) {
      console.error('Failed to fetch devices', error);
    }
  }, [refreshSpotifyDeviceStatuses, token]);

  const fetchSpotifyAppConfig = useCallback(async () => {
    try {
      const res = await axios.get<{ data: SpotifyAppConfigApiResponse }>(`${API_URL}/api/v1/spotify/app-config`, {
        headers: authHeaders(token),
      });
      setSpotifyAppConfig(maskSpotifyAppConfigForForm(res.data.data));
    } catch (error) {
      console.error('Failed to fetch Spotify app config', error);
    }
  }, [token]);

  const fetchSongs = useCallback(async () => {
    try {
      const res = await axios.get<{ data: { songs?: AdminSong[] } }>(`${API_URL}/api/v1/jukebox/admin/songs`, {
        headers: authHeaders(token),
      });
      setSongs(res.data.data.songs || []);
    } catch (error) {
      console.error('Failed to fetch songs', error);
    }
  }, [token]);

  const fetchSpotifyPlaybackDevices = useCallback(async () => {
    try {
      setLoadingSpotifyDevices(true);
      const res = await axios.get<{ data: { devices: SpotifyPlaybackDevice[] } }>(
        `${API_URL}/api/v1/spotify/playback-devices`,
        { headers: authHeaders(token) }
      );
      if (Array.isArray(res.data?.data?.devices)) {
        setSpotifyPlaybackDevices(res.data.data.devices);
      } else {
        setSpotifyPlaybackDevices([]);
      }
    } catch (error) {
      console.warn('Failed to fetch Spotify playback devices:', error);
      setSpotifyPlaybackDevices([]);
    } finally {
      setLoadingSpotifyDevices(false);
    }
  }, [token]);

  const assignSpotifyPlaybackTarget = async (
    kioskId: string,
    spotifyDeviceId: string | null,
    spotifyPlayerName?: string | null
  ) => {
    try {
      setUpdatingKioskTargetId(kioskId);
      const payload = buildSpotifyPlaybackTargetPayload(spotifyDeviceId, spotifyPlayerName);
      const res = await axios.put<{ data: { device: DeviceSummary } }>(
        `${API_URL}/api/v1/jukebox/admin/devices/${kioskId}/spotify-playback-target`,
        payload,
        { headers: authHeaders(token) }
      );

      if (res.data?.data?.device) {
        const updated = res.data.data.device;
        setDevices((prev) =>
          prev.map((d) => (d.id === kioskId ? { ...d, ...updated } : d))
        );
      }
      setStatus(spotifyDeviceId ? tr('admin.outputSet', { name: spotifyPlayerName || spotifyDeviceId }) : tr('admin.outputCleared'));
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setUpdatingKioskTargetId(null);
      window.setTimeout(() => setStatus(''), 3500);
    }
  };

  useEffect(() => {
    void fetchDevices();
  }, [fetchDevices]);

  useEffect(() => {
    if (activeTab === 'spotify-players') {
      void fetchSpotifyPlaybackDevices();
    } else if (activeTab === 'devices') {
      void fetchSpotifyAppConfig();
    } else if (activeTab === 'songs') {
      void fetchSongs();
    }
  }, [activeTab, fetchSpotifyPlaybackDevices, fetchSpotifyAppConfig, fetchSongs]);

  useEffect(() => {
    const handleSpotifyMessage = (event: MessageEvent) => {
      if (!isSpotifyDeviceAuthSuccessMessage(event.data)) return;
      setStatus(tr('admin.spotifyDeviceUpdated'));
      void fetchDevices();
      void fetchSpotifyPlaybackDevices();
    };

    window.addEventListener('message', handleSpotifyMessage);
    return () => window.removeEventListener('message', handleSpotifyMessage);
  }, [fetchDevices, fetchSpotifyPlaybackDevices]);

  const skipSong = async () => {
    if (!window.confirm(tr('admin.skipConfirm'))) return;
    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/v1/jukebox/admin/skip`, { device_id: device.id }, { headers: authHeaders(token) });
      setStatus(tr('admin.skipped'));
    } catch {
      setStatus(tr('admin.genericError'));
    } finally {
      setLoading(false);
      window.setTimeout(() => setStatus(''), 3000);
    }
  };

  const processSong = async () => {
    const songId = window.prompt(tr('admin.repairPrompt'));
    if (!songId) return;
    try {
      setLoading(true);
      setStatus(tr('admin.repairing'));
      const queued = await axios.post<{ data: { job_id: string } }>(`${API_URL}/api/v1/jukebox/admin/process-song`, { song_id: songId }, { headers: authHeaders(token) });
      await waitForControllerJob(queued.data.data.job_id, token);
      setStatus(tr('admin.repairDone'));
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const syncMetadata = async () => {
    if (!window.confirm(tr('admin.syncConfirm'))) return;
    try {
      setLoading(true);
      setStatus(tr('admin.syncing'));
      const queued = await axios.post<{ data: { job_id: string } }>(
        `${API_URL}/api/v1/jukebox/admin/sync-metadata`,
        {},
        { headers: authHeaders(token) },
      );
      const result = await waitForControllerJob<{ success: number; failed: number }>(queued.data.data.job_id, token);
      setStatus(tr('admin.syncResult', { success: result.success, failed: result.failed }));
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const createDevice = async () => {
    if (!newDevice.device_code || !newDevice.name || !newDevice.password.trim()) {
      setStatus(tr('admin.deviceFieldsRequired'));
      return;
    }

    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/v1/jukebox/admin/devices`, newDevice, { headers: authHeaders(token) });
      setStatus(tr('admin.deviceCreated'));
      setNewDevice({ device_code: '', name: '', location: '', password: '' });
      setShowNewDevice(false);
      void fetchDevices();
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const toggleDevice = async (deviceId: string, isActive: boolean) => {
    try {
      await axios.patch(`${API_URL}/api/v1/jukebox/admin/devices/${deviceId}`, { is_active: !isActive }, { headers: authHeaders(token) });
      void fetchDevices();
    } catch (error) {
      setStatus(errorStatus(error));
    }
  };

  const updateDevice = async (deviceId: string) => {
    try {
      setLoading(true);
      await axios.patch(`${API_URL}/api/v1/jukebox/admin/devices/${deviceId}`, editValues, { headers: authHeaders(token) });
      setEditingDeviceId(null);
      setStatus(tr('admin.deviceUpdated'));
      void fetchDevices();
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const saveSpotifyAppConfig = async () => {
    try {
      setLoading(true);
      const payload = buildSpotifyAppConfigPayload(spotifyAppConfig);
      const res = await axios.put<{ data: SpotifyAppConfigApiResponse }>(`${API_URL}/api/v1/spotify/app-config`, payload, {
        headers: authHeaders(token),
      });
      setSpotifyAppConfig(maskSpotifyAppConfigForForm(res.data.data));
      setStatus(tr('admin.spotifyAppSaved'));
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const openSpotifyDeviceAuth = async (deviceId: string) => {
    const popup = window.open('', '_blank');
    try {
      setLoading(true);
      const request = buildSpotifyDeviceAuthStartRequest(API_URL, token, deviceId, window.location.origin);
      const res = await axios.post<{ data?: { authUrl?: string } }>(request.url, request.body, { headers: request.headers });
      const authUrl = res.data?.data?.authUrl;
      if (!authUrl) throw new Error(tr('admin.spotifyAuthUrlMissing'));

      if (popup) {
        popup.location.href = authUrl;
        popup.focus();
      } else {
        window.open(authUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      if (popup) popup.close();
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const disconnectSpotifyDeviceAuth = async (event: React.MouseEvent, deviceId: string) => {
    event.stopPropagation();
    try {
      setLoading(true);
      const request = buildSpotifyDeviceAuthDisconnectRequest(API_URL, token, deviceId);
      await axios.delete(request.url, { headers: request.headers });
      setStatus(tr('admin.spotifyDeviceRemoved'));
      void refreshSpotifyDeviceStatuses(devices);
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const logoutAllFromDevice = async (event: React.MouseEvent, deviceId: string) => {
    event.stopPropagation();
    if (!window.confirm(tr('admin.logoutAllConfirm'))) return;
    try {
      setLoading(true);
      await axios.post(`${API_URL}/api/v1/jukebox/admin/devices/${deviceId}/logout-all`, {}, { headers: authHeaders(token) });
      setStatus(tr('admin.sessionsClosed'));
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const provisionKiosk = async (event: React.MouseEvent, deviceId: string) => {
    event.stopPropagation();
    try {
      setLoading(true);
      const response = await axios.post<{ data?: { provisioning_code?: string; expires_at?: string } }>(
        `${API_URL}/api/v1/jukebox/admin/devices/${deviceId}/provision`,
        {},
        { headers: authHeaders(token) },
      );
      const code = response.data?.data?.provisioning_code;
      if (!code) throw new Error('Provisioning code was not returned');
      setProvisioningCodes((current) => ({
        ...current,
        [deviceId]: { code, expiresAt: response.data?.data?.expires_at || '' },
      }));
      setStatus(tr('admin.provisionReady'));
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const copyProvisioningCode = async (event: React.MouseEvent, code: string) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setStatus(tr('admin.codeCopied'));
    } catch {
      setStatus(tr('admin.codeCopyFailed'));
    }
  };

  const startEditing = (event: React.MouseEvent, nextDevice: DeviceSummary) => {
    event.stopPropagation();
    setEditingDeviceId(nextDevice.id);
    setEditValues({ name: nextDevice.name, location: nextDevice.location || '', password: '' });
  };

  const scanFolder = async () => {
    try {
      setLoading(true);
      setStatus(tr('admin.scanning'));
      const queued = await axios.post<{ data: { job_id: string } }>(`${API_URL}/api/v1/jukebox/admin/scan-folder`, {}, {
        headers: authHeaders(token),
      });
      const { added, skipped, total, synced = 0, syncFailed = 0, failedSongs = [] } = await waitForControllerJob<ScanFolderResponse>(queued.data.data.job_id, token);
      let message = tr('admin.scanResult', { added, skipped, total });
      if (synced > 0 || syncFailed > 0) message += tr('admin.scanSyncResult', { synced, failed: syncFailed });
      if (failedSongs.length > 0) message += tr('admin.scanMissing', { titles: failedSongs.map((song) => song.title).join(', ') });
      setStatus(message);
      void fetchSongs();
    } catch (error) {
      setStatus(errorStatus(error));
    } finally {
      setLoading(false);
    }
  };

  const deleteSong = async (songId: string) => {
    if (!window.confirm(tr('admin.deleteSongConfirm'))) return;
    try {
      await axios.delete(`${API_URL}/api/v1/jukebox/admin/songs/${songId}`, { headers: authHeaders(token) });
      setStatus(tr('admin.songDeleted'));
      void fetchSongs();
    } catch (error) {
      setStatus(errorStatus(error));
    }
  };

  const uploadSong = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    let uploaded = 0;
    let failedUploads = 0;

    for (const file of Array.from(files)) {
      try {
        setStatus(tr('admin.uploading', { name: file.name }));
        const formData = new FormData();
        formData.append('song', file);
        await axios.post(`${API_URL}/api/v1/jukebox/admin/upload-song`, formData, {
          headers: { ...authHeaders(token), 'Content-Type': 'multipart/form-data' },
        });
        uploaded += 1;
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
        failedUploads += 1;
      }
    }

    setStatus(tr('admin.uploadResult', { count: uploaded }) + (failedUploads > 0 ? tr('admin.uploadFailedSuffix', { count: failedUploads }) : ''));
    setLoading(false);
    void fetchSongs();
    event.target.value = '';
  };

  return (
    <section className="admin-console-fullscreen">
      <header className="admin-top-bar">
        <div className="admin-title-group">
          <div className="admin-shield-icon">
            <Shield size={22} />
          </div>
          <div>
            <div className="admin-title-row">
              <h2>{t('admin.title')}</h2>
              <span className="admin-badge-red">{t('admin.badge')}</span>
            </div>
            <div className="admin-sub-info">
              <span>{t('admin.activeKiosk')} <strong>{device.name}</strong> ({device.device_code})</span>
              {device.location && <span className="admin-sub-sep">· {device.location}</span>}
            </div>
          </div>
        </div>

        <div className="admin-top-actions">
          {status && <span className="admin-status-pill">{status}</span>}
          <button className="arcade-button quick-action-btn" onClick={skipSong} disabled={loading} title={t('admin.skipTitle')}>
            <SkipForward size={14} /> <span>{t('admin.skip')}</span>
          </button>
          <button className="arcade-button quick-action-btn" onClick={processSong} disabled={loading} title={t('admin.repairTitle')}>
            <Activity size={14} /> <span>{t('admin.repair')}</span>
          </button>
          <button className="arcade-button quick-action-btn" onClick={syncMetadata} disabled={loading} title={t('admin.syncTitle')}>
            <RefreshCw size={14} /> <span>{t('admin.sync')}</span>
          </button>
          {onClose && (
            <button className="admin-modal-close-btn" onClick={onClose} aria-label={t('admin.closePanel')} title={t('common.close')}>
              <X size={20} />
            </button>
          )}
        </div>
      </header>

      <nav className="admin-tabs-nav" role="tablist" ref={tabsNavRef}>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'spotify-players' ? 'active' : ''}`}
          onClick={(event) => selectTab('spotify-players', event.currentTarget)}
          role="tab"
          aria-selected={activeTab === 'spotify-players'}
        >
          <Speaker size={16} />
          <span>{t('admin.tabSpotify')}</span>
          <span className="tab-pill-badge">{spotifyPlaybackDevices.length}</span>
        </button>

        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'fallback' ? 'active' : ''}`}
          onClick={(event) => selectTab('fallback', event.currentTarget)}
          role="tab"
          aria-selected={activeTab === 'fallback'}
        >
          <ListMusic size={16} />
          <span>{t('admin.tabFallback')}</span>
        </button>

        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'moderation' ? 'active' : ''}`}
          onClick={(event) => selectTab('moderation', event.currentTarget)}
          role="tab"
          aria-selected={activeTab === 'moderation'}
        >
          <ShieldAlert size={16} />
          <span>{t('admin.tabModeration')}</span>
          {blockedKeywords.length > 0 && <span className="tab-pill-badge">{blockedKeywords.length}</span>}
        </button>

        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'devices' ? 'active' : ''}`}
          onClick={(event) => selectTab('devices', event.currentTarget)}
          role="tab"
          aria-selected={activeTab === 'devices'}
        >
          <Monitor size={16} />
          <span>{t('admin.tabDevices')}</span>
          <span className="tab-pill-badge">{devices.length}</span>
        </button>

        <button
          type="button"
          className={`admin-tab-btn ${activeTab === 'songs' ? 'active' : ''}`}
          onClick={(event) => selectTab('songs', event.currentTarget)}
          role="tab"
          aria-selected={activeTab === 'songs'}
        >
          <Music size={16} />
          <span>{t('admin.tabSongs')}</span>
          {songs.length > 0 && <span className="tab-pill-badge">{songs.length}</span>}
        </button>
      </nav>

      <div
        key={activeTab}
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
        className={tabSlide ? `admin-content-viewport custom-scrollbar slide-${tabSlide}` : 'admin-content-viewport custom-scrollbar'}
      >

      {activeTab === 'fallback' && (
        <div className="admin-section fallback-playlist-section">
          <div className="section-heading">
            <span>
              <Repeat size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
              {t('admin.fallbackHeading')}
            </span>
          </div>

          <p className="hint-strip">{t('admin.fallbackHint')}</p>

          <div className="admin-form">
            {devices.length > 1 && (
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', display: 'block', marginBottom: 4 }}>
                  {t('admin.targetDevice')}
                </label>
                <select
                  className="arcade-input"
                  value={selectedPlaylistDeviceId}
                  onChange={(e) => setSelectedPlaylistDeviceId(e.target.value)}
                  style={{ background: 'var(--bg-card)', color: '#fff' }}
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.device_code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#fff', display: 'block', marginBottom: 4 }}>
                {t('admin.playlistLabel')}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="arcade-input"
                  style={{ flex: 1 }}
                  placeholder={t('admin.playlistPlaceholder')}
                  value={fallbackPlaylistUrl}
                  onChange={(e) => setFallbackPlaylistUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void fetchPlaylistPreview(fallbackPlaylistUrl);
                    }
                  }}
                />
                <button
                  type="button"
                  className="arcade-button"
                  onClick={() => void fetchPlaylistPreview(fallbackPlaylistUrl)}
                  disabled={fetchingPreview || !fallbackPlaylistUrl.trim()}
                >
                  {fetchingPreview ? t('admin.previewLoading') : t('admin.preview')}
                </button>
              </div>
            </div>

            {playlistPreview && (
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: 12,
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 178, 56, 0.25)',
                  alignItems: 'center',
                }}
              >
                {playlistPreview.cover_url ? (
                  <img
                    src={playlistPreview.cover_url}
                    alt={playlistPreview.name}
                    style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 8,
                      background: 'rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Music size={24} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{playlistPreview.name}</span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: 'rgba(227, 30, 38, 0.2)',
                        color: 'var(--accent-red)',
                        fontWeight: 800,
                      }}
                    >
                      <Repeat size={10} style={{ display: 'inline', marginRight: 3 }} /> {t('admin.loopActive')}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {t('admin.playlistOwner', { owner: playlistPreview.owner_name })} · <strong>{t('admin.playlistTracks', { count: playlistPreview.total_tracks })}</strong>
                  </div>
                  {playlistPreview.description && (
                    <div
                      style={{
                        fontSize: 10,
                        color: 'rgba(255, 255, 255, 0.5)',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {playlistPreview.description}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
              <input
                type="checkbox"
                id="autoplayToggle"
                checked={fallbackAutoplayEnabled}
                onChange={(e) => setFallbackAutoplayEnabled(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent-red)', cursor: 'pointer' }}
              />
              <label htmlFor="autoplayToggle" style={{ fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                {t('admin.autoplayLabel')}
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                className="arcade-button primary"
                style={{ flex: 1 }}
                onClick={saveFallbackPlaylistConfig}
                disabled={loading || !fallbackPlaylistUrl.trim()}
              >
                <Check size={14} style={{ display: 'inline', marginRight: 4 }} /> {t('admin.save')}
              </button>
              {fallbackPlaylistUrl && (
                <button
                  className="arcade-button danger ghost"
                  onClick={clearFallbackPlaylistConfig}
                  disabled={loading}
                >
                  <Trash2 size={14} style={{ display: 'inline', marginRight: 4 }} /> {t('admin.remove')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'moderation' && (
        <div className="admin-section moderation-section">
          <div className="section-heading">
            <span>
              <ShieldAlert size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
              {t('admin.moderationHeading')}
            </span>
          </div>

          <p className="hint-strip" style={{ marginBottom: 16 }}>
            {t('admin.moderationHint')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 1. Moderation Settings */}
            <div className="device-card" style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 16, borderRadius: 12, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sliders size={14} style={{ color: 'var(--accent-red)' }} /> {t('admin.moderationRules')}
              </h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    style={{ marginTop: 2 }}
                    checked={moderationSettings.lyrics_filter_enabled}
                    onChange={(e) => setModerationSettings({ ...moderationSettings, lyrics_filter_enabled: e.target.checked })}
                  />
                  <div>
                    <strong style={{ color: '#fff' }}>{t('admin.lyricsFilter')}</strong>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {t('admin.lyricsFilterHint')}
                    </div>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    style={{ marginTop: 2 }}
                    checked={moderationSettings.block_unverified_obscure_tracks}
                    onChange={(e) => setModerationSettings({ ...moderationSettings, block_unverified_obscure_tracks: e.target.checked })}
                  />
                  <div>
                    <strong style={{ color: '#fff' }}>{t('admin.obscureFilter')}</strong>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {t('admin.obscureFilterHint')}
                    </div>
                  </div>
                </label>

                {moderationSettings.block_unverified_obscure_tracks && (
                  <div style={{ marginLeft: 26, padding: '10px 14px', background: 'rgba(0, 0, 0, 0.25)', borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
                      <span style={{ color: 'var(--muted)' }}>{t('admin.minPopularity')}</span>
                      <strong style={{ color: 'var(--amber)', fontSize: 13 }}>{t('admin.spotifyScore', { value: moderationSettings.min_popularity_without_lyrics })}</strong>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      value={moderationSettings.min_popularity_without_lyrics}
                      onChange={(e) => setModerationSettings({ ...moderationSettings, min_popularity_without_lyrics: Number(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--amber)' }}
                    />
                    <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.4)', marginTop: 4 }}>
                      {t('admin.minPopularityNote', { value: moderationSettings.min_popularity_without_lyrics })}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 4 }}>
                  <button
                    className="arcade-button primary"
                    onClick={saveModerationSettings}
                    disabled={loading}
                    style={{ width: '100%' }}
                  >
                    <Check size={14} style={{ display: 'inline', marginRight: 4 }} /> {t('admin.save')}
                  </button>
                </div>
              </div>
            </div>

            {/* 2. Custom Blocked Keywords */}
            <div className="device-card" style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 16, borderRadius: 12, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} style={{ color: '#ef4444' }} /> {t('admin.blockedHeading', { count: blockedKeywords.length })}
              </h4>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: '0 0 12px' }}>
                {t('admin.blockedHint')}
              </p>

              <form onSubmit={addBlockedKeyword} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  className="arcade-input"
                  placeholder={t('admin.blockedPlaceholder')}
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="arcade-button" disabled={loading || !newKeyword.trim()}>
                  <Plus size={13} style={{ display: 'inline', marginRight: 2 }} /> {t('admin.add')}
                </button>
              </form>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
                {blockedKeywords.map((kw) => (
                  <span
                    key={kw.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#fca5a5',
                      padding: '3px 8px',
                      borderRadius: 12,
                      fontSize: 11,
                    }}
                  >
                    {kw.word}
                    <button
                      type="button"
                      onClick={() => void deleteBlockedKeyword(kw.id)}
                      style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0, display: 'flex' }}
                      title={t('admin.delete')}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {blockedKeywords.length === 0 && (
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{t('admin.blockedEmpty')}</span>
                )}
              </div>
            </div>

            {/* 3. Live Lyrics & Moderation Tester */}
            <div className="device-card" style={{ background: 'rgba(255, 255, 255, 0.03)', padding: 16, borderRadius: 12, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <FolderSearch size={14} style={{ color: '#38bdf8' }} /> {t('admin.testerHeading')}
              </h4>
              <p style={{ color: 'var(--muted)', fontSize: 11, margin: '0 0 12px' }}>
                {t('admin.testerHint')}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    className="arcade-input"
                    placeholder={t('admin.testerTitlePlaceholder')}
                    value={testForm.title}
                    onChange={(e) => setTestForm({ ...testForm, title: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="text"
                    className="arcade-input"
                    placeholder={t('admin.testerArtistPlaceholder')}
                    value={testForm.artist}
                    onChange={(e) => setTestForm({ ...testForm, artist: e.target.value })}
                    style={{ flex: 1 }}
                  />
                </div>
                <button
                  type="button"
                  className="arcade-button"
                  onClick={runModerationTest}
                  disabled={testingProfanity || (!testForm.title.trim() && !testForm.text.trim())}
                >
                  {testingProfanity ? t('admin.testing') : t('admin.runTest')}
                </button>

                {testResult && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 12,
                      borderRadius: 8,
                      background: testResult.isProfane ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                      border: `1px solid ${testResult.isProfane ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)'}`,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {testResult.isProfane ? (
                        <span style={{ color: '#ef4444' }}>
                          {t('admin.testRejected')} {testResult.matchedWord ? t('admin.testMatchedWord', { word: testResult.matchedWord }) : ''}
                        </span>
                      ) : (
                        <span style={{ color: '#22c55e' }}>
                          {t('admin.testApproved')}
                        </span>
                      )}
                    </div>
                    {testResult.message && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{testResult.message}</div>}
                    {testResult.testedTextSnippet && (
                      <pre
                        style={{
                          margin: '8px 0 0',
                          padding: 8,
                          background: 'rgba(0, 0, 0, 0.3)',
                          borderRadius: 4,
                          fontSize: 10,
                          color: '#e5e7eb',
                          maxHeight: 90,
                          overflowY: 'auto',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                        }}
                      >
                        {testResult.testedTextSnippet}...
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'devices' && (
        <div className="admin-section">
          <div className="section-heading">
            <span>{t('admin.devicesHeading')}</span>
            <button onClick={() => setShowNewDevice((value) => !value)}>
              <Plus size={13} /> {t('admin.newDevice')}
            </button>
          </div>

          {showNewDevice && (
            <div className="admin-form">
              <input
                className="arcade-input"
                placeholder={t('admin.deviceCodePlaceholder')}
                value={newDevice.device_code}
                onChange={(event) => setNewDevice({ ...newDevice, device_code: event.target.value.toUpperCase() })}
              />
              <input
                className="arcade-input"
                placeholder={t('admin.deviceNamePlaceholder')}
                value={newDevice.name}
                onChange={(event) => setNewDevice({ ...newDevice, name: event.target.value })}
              />
              <input
                className="arcade-input"
                placeholder={t('admin.locationOptional')}
                maxLength={50}
                value={newDevice.location}
                onChange={(event) => setNewDevice({ ...newDevice, location: event.target.value })}
              />
              <input
                className="arcade-input"
                type="password"
                placeholder={t('admin.devicePasswordPlaceholder')}
                maxLength={50}
                value={newDevice.password}
                onChange={(event) => setNewDevice({ ...newDevice, password: event.target.value })}
              />
              <button className="arcade-button primary" onClick={createDevice} disabled={loading}>
                {t('admin.createDevice')}
              </button>
            </div>
          )}

          <div className="spotify-config">
            <div>
              <strong>{t('admin.spotifyCredentials')}</strong>
              <span>{t('admin.spotifySecretHint', { mask: SPOTIFY_APP_SECRET_MASK })}</span>
            </div>
            <input
              className="arcade-input"
              placeholder="Spotify Client ID"
              value={spotifyAppConfig.client_id}
              onChange={(event) => setSpotifyAppConfig({ ...spotifyAppConfig, client_id: event.target.value })}
            />
            <input
              className="arcade-input"
              type="password"
              placeholder="Spotify Client Secret"
              value={spotifyAppConfig.client_secret}
              onFocus={() => {
                if (spotifyAppConfig.client_secret === SPOTIFY_APP_SECRET_MASK) {
                  setSpotifyAppConfig({ ...spotifyAppConfig, client_secret: '' });
                }
              }}
              onChange={(event) => setSpotifyAppConfig({ ...spotifyAppConfig, client_secret: event.target.value })}
            />
            <button className="arcade-button primary" onClick={saveSpotifyAppConfig} disabled={loading}>
              {t('admin.saveSpotify')}
            </button>
          </div>

          <div className="admin-list custom-scrollbar">
            {devices.map((nextDevice) => {
              const spotifyStatus = nextDevice.id in spotifyDeviceAuthStatuses
                ? formatSpotifyDeviceAuthStatus(spotifyDeviceAuthStatuses[nextDevice.id], lang)
                : undefined;
              const activeDevice = nextDevice.id === device.id;
              const online = isOnline(nextDevice.last_heartbeat);

              return (
                <article className={activeDevice ? 'device-row active' : 'device-row'} key={nextDevice.id} onClick={() => onSelectDevice?.(nextDevice)}>
                  <div className="row-main">
                    <div className="device-title-line">
                      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
                      {editingDeviceId === nextDevice.id ? (
                        <div className="inline-edit" onClick={(event) => event.stopPropagation()}>
                          <input className="arcade-input" value={editValues.name} onChange={(event) => setEditValues({ ...editValues, name: event.target.value })} autoFocus />
                          <input
                            className="arcade-input"
                            placeholder={t('admin.location')}
                            value={editValues.location}
                            onChange={(event) => setEditValues({ ...editValues, location: event.target.value })}
                          />
                          <input
                            className="arcade-input"
                            type="password"
                            placeholder={t('admin.newCredentialPlaceholder')}
                            maxLength={50}
                            autoComplete="new-password"
                            value={editValues.password}
                            onChange={(event) => setEditValues({ ...editValues, password: event.target.value })}
                          />
                          <div className="inline-actions">
                            <button onClick={() => void updateDevice(nextDevice.id)}>
                              <Check size={13} />
                            </button>
                            <button onClick={() => setEditingDeviceId(null)}>
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <strong>
                            {nextDevice.name}
                            <button className="tiny-icon" onClick={(event) => startEditing(event, nextDevice)} title={t('admin.edit')}>
                              <Edit2 size={11} />
                            </button>
                          </strong>
                          <span>
                            {nextDevice.device_code}
                            {nextDevice.location ? ` · ${nextDevice.location}` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                    {nextDevice.current_song_title && (
                      <small>
                        ♪ {nextDevice.current_song_title} - {nextDevice.current_song_artist}
                      </small>
                    )}
                  </div>

                  <div className="device-actions">
                    <span>{t('admin.queueCount', { count: nextDevice.queue_count ?? 0 })}</span>
                    <div>
                      <button onClick={(event) => void provisionKiosk(event, nextDevice.id)} disabled={!nextDevice.is_active || loading}>
                        {t('admin.provision')}
                      </button>
                      <button className="danger ghost" onClick={(event) => void logoutAllFromDevice(event, nextDevice.id)} title={t('admin.logoutAll')}>
                        <LogOut size={13} />
                      </button>
                      <button className={nextDevice.is_active ? 'state-pill online' : 'state-pill offline'} onClick={() => void toggleDevice(nextDevice.id, nextDevice.is_active)}>
                        {nextDevice.is_active ? t('admin.active') : t('admin.inactive')}
                      </button>
                    </div>
                    <div className="spotify-row">
                      <span className={spotifyStatus?.tone === 'success' ? 'spotify-pill ok' : 'spotify-pill'}>
                        {t('admin.spotifyStatus', { status: spotifyStatus?.label || t('admin.checking') })}
                      </span>
                      <button onClick={(event) => { event.stopPropagation(); void openSpotifyDeviceAuth(nextDevice.id); }}>
                        {spotifyStatus?.actionLabel || t('admin.connect')}
                      </button>
                      {spotifyStatus?.isConnected && (
                        <button className="danger ghost" onClick={(event) => void disconnectSpotifyDeviceAuth(event, nextDevice.id)}>
                          {t('admin.disconnect')}
                        </button>
                      )}
                    </div>
                    {provisioningCodes[nextDevice.id] && (
                      <div className="provisioning-code">
                        <span>{t('admin.oneTimeCode')}</span>
                        <code>{provisioningCodes[nextDevice.id].code}</code>
                        <button onClick={(event) => void copyProvisioningCode(event, provisioningCodes[nextDevice.id].code)}>
                          {t('admin.copy')}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
            {devices.length === 0 && <div className="empty-panel slim">{t('admin.noDevices')}</div>}
          </div>
        </div>
      )}

      {activeTab === 'songs' && (
        <div className="admin-section">
          <div className="section-heading">
            <span>{t('admin.songsHeading', { count: songs.length })}</span>
            <div className="button-row">
              <label className="file-button">
                <Plus size={13} /> {t('admin.upload')}
                <input type="file" accept=".mp3,.m4a,.wav,audio/*" multiple onChange={uploadSong} />
              </label>
              <button onClick={scanFolder} disabled={loading}>
                <FolderSearch size={13} /> {t('admin.scan')}
              </button>
            </div>
          </div>

          <p className="hint-strip">
            {t('admin.fileNameFormat')} <code>{t('admin.fileNameExample')}</code>
          </p>

          <div className="admin-list custom-scrollbar">
            {songs.map((song) => {
              const durSec = song.duration_seconds ?? (song.duration_ms ? Math.floor(song.duration_ms / 1000) : 0);
              return (
                <article className="song-row" key={song.id}>
                  {song.cover_url ? (
                    <img
                      src={song.cover_url}
                      alt=""
                      className="admin-song-thumb"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                        const fallback = (e.currentTarget as HTMLElement).parentElement?.querySelector('.admin-song-cover-fallback') as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div
                    className="admin-song-cover-fallback"
                    style={{ display: song.cover_url ? 'none' : 'flex' }}
                  >
                    <Music size={16} />
                  </div>
                  <div className="row-main">
                    <strong>{song.title}</strong>
                    <span>{song.artist}</span>
                    <small>ID: {song.id}</small>
                  </div>
                  <div className="song-meta">
                    <span>
                      {Math.floor(durSec / 60)}:{(durSec % 60).toString().padStart(2, '0')}
                    </span>
                    <span>{t('admin.plays', { count: song.total_plays || 0 })}</span>
                    <button className="danger ghost" onClick={() => void deleteSong(song.id)} title={t('admin.delete')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
            {songs.length === 0 && <div className="empty-panel slim">{t('admin.noSongs')}</div>}
          </div>
        </div>
      )}

      {activeTab === 'spotify-players' && (
        <div className="admin-section-full spotify-players-section">
          <div className="admin-section-header">
            <div className="admin-section-title-wrap">
              <Speaker size={18} className="text-accent-red" />
              <h3>{t('admin.spotifyHeading')}</h3>
            </div>
            <button
              type="button"
              className="arcade-button"
              onClick={() => void fetchSpotifyPlaybackDevices()}
              disabled={loadingSpotifyDevices}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px' }}
            >
              <RefreshCw size={13} className={loadingSpotifyDevices ? 'spin' : ''} />
              <span>{t('admin.scanDevices')}</span>
            </button>
          </div>

          <p className="hint-strip" style={{ marginBottom: 12 }}>
            {t('admin.spotifyHint')}
          </p>

          {/* Kesintisiz Çalışma Bilgi Kartı */}
          <div className="spotify-guarantee-banner">
            <CheckCircle2 size={18} className="guarantee-icon" />
            <div className="guarantee-text">
              <strong>{t('admin.guaranteeTitle')}</strong> {t('admin.guaranteeBody')}
            </div>
          </div>

          <div className="spotify-players-split-grid">
            {/* 1. Algılanan Aktif Spotify Connect Cihazları */}
            <div className="admin-card-panel">
              <div className="panel-title-bar">
                <h4>
                  <Volume2 size={15} style={{ color: '#38bdf8' }} />
                  {t('admin.detectedPlayers', { count: spotifyPlaybackDevices.length })}
                </h4>
                {loadingSpotifyDevices && <span className="panel-loading-badge">{t('admin.scanningDevices')}</span>}
              </div>

              {spotifyPlaybackDevices.length === 0 ? (
                <div className="empty-panel-dashed">
                  <p className="empty-title">{t('admin.noPlayersTitle')}</p>
                  <p className="empty-desc">
                    {t('admin.noPlayersBody')}
                  </p>
                </div>
              ) : (
                <div className="spotify-devices-grid">
                  {spotifyPlaybackDevices.map((dev) => {
                    const typeLower = (dev.type || '').toLowerCase();
                    const TypeIcon = typeLower === 'computer' ? Laptop : typeLower === 'smartphone' ? Smartphone : typeLower.includes('cast') ? Tv : Speaker;
                    return (
                      <div
                        key={dev.id}
                        className={`spotify-dev-card ${dev.is_active ? 'is-playing' : ''}`}
                      >
                        <div className="spotify-dev-top">
                          <span className="spotify-dev-name">
                            <TypeIcon size={16} className={dev.is_active ? 'icon-green' : 'icon-muted'} />
                            {dev.name}
                          </span>
                          <span className={`state-badge ${dev.is_active ? 'playing' : 'ready'}`}>
                            {dev.is_active ? t('admin.playing') : t('admin.ready')}
                          </span>
                        </div>
                        <div className="spotify-dev-meta">
                          <span>{formatSpotifyPlaybackDeviceType(dev.type, lang)}</span>
                          {typeof dev.volume_percent === 'number' && <span>{t('admin.volume', { value: dev.volume_percent })}</span>}
                        </div>
                        <div className="spotify-dev-id">
                          ID: {dev.id.substring(0, 16)}...
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. Kiosk Çıkış Eşleştirmesi */}
            <div className="admin-card-panel">
              <div className="panel-title-bar">
                <h4>
                  <Sliders size={15} style={{ color: 'var(--accent-red)' }} />
                  {t('admin.mappingHeading')}
                </h4>
              </div>
              <p className="panel-subtext">
                {t('admin.mappingHint')}
              </p>

              <div className="kiosk-mapping-list">
                {devices.map((kiosk) => {
                  const assignedInfo = resolveAssignedSpotifyDeviceLabel(
                    kiosk.spotify_playback_device_id,
                    kiosk.spotify_player_name,
                    spotifyPlaybackDevices,
                    lang,
                  );
                  const isCurrentActiveKiosk = kiosk.id === device.id;
                  const isUpdating = updatingKioskTargetId === kiosk.id;

                  return (
                    <div
                      key={kiosk.id}
                      className={`kiosk-mapping-row ${isCurrentActiveKiosk ? 'active-kiosk' : ''}`}
                    >
                      <div className="kiosk-mapping-top">
                        <div className="kiosk-name-block">
                          <strong className="kiosk-name">{kiosk.name}</strong>
                          <span className="kiosk-code">[{kiosk.device_code}]</span>
                          {isCurrentActiveKiosk && (
                            <span className="current-kiosk-badge">{t('admin.thisScreen')}</span>
                          )}
                          {kiosk.location && <span className="kiosk-loc">· {kiosk.location}</span>}
                        </div>
                        <div className="kiosk-target-status">
                          <span
                            className={`kiosk-output-pill ${
                              kiosk.spotify_playback_device_id
                                ? (assignedInfo.isDetected ? 'online' : 'offline')
                                : 'default'
                            }`}
                          >
                            {t('admin.output', { label: assignedInfo.label })}
                          </span>
                          {kiosk.spotify_playback_device_id && (
                            <button
                              type="button"
                              className="arcade-button danger ghost mini-btn"
                              onClick={() => void assignSpotifyPlaybackTarget(kiosk.id, null)}
                              disabled={isUpdating}
                              title={t('admin.clearTargetTitle')}
                            >
                              <X size={12} /> {t('admin.remove')}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Çalar Seçimi Butonları */}
                      <div className="kiosk-target-buttons-wrap">
                        <div className="target-select-label">
                          {t('admin.pickOutput')}
                        </div>
                        {spotifyPlaybackDevices.length > 0 ? (
                          <div className="target-btn-group">
                            {spotifyPlaybackDevices.map((spDev) => {
                              const isCurrent = kiosk.spotify_playback_device_id === spDev.id;
                              return (
                                <button
                                  key={spDev.id}
                                  type="button"
                                  className={`playback-target-btn ${isCurrent ? 'selected' : ''}`}
                                  onClick={() => void assignSpotifyPlaybackTarget(kiosk.id, spDev.id, spDev.name)}
                                  disabled={isUpdating}
                                >
                                  {isCurrent ? <Check size={13} className="btn-icon-check" /> : <Speaker size={13} />}
                                  <span className="btn-dev-name">{spDev.name}</span>
                                  <span className="btn-dev-type">({formatSpotifyPlaybackDeviceType(spDev.type, lang)})</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="no-devices-note">
                            {t('admin.noTargetsNote')}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {devices.length === 0 && (
                  <div className="empty-panel slim">{t('admin.noKiosks')}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
