import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import axios, { isAxiosError } from 'axios';
import { io, Socket } from 'socket.io-client';
import {
  AlertCircle,
  ArrowBigDown,
  ArrowBigUp,
  CheckCircle2,
  ChevronRight,
  Disc3,
  Languages,
  ListMusic,
  LogOut,
  Menu,
  Mic2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Star,
  Trophy,
  User,
  X,
} from 'lucide-react';
import { AdminDashboard, type DeviceSummary } from './AdminDashboard';
import { buildQueueRequestPayload, getSearchResultKey, getSongQueueKey, type CatalogSearchSong } from './jukeboxCatalog';
import { buildGuestQueueHeaders } from './guestFingerprint';
import { resolveKioskStatus, type KioskStatus } from './kioskStatus';
import {
  formatSongScore,
  getDisplayedSongScore,
  hasSupervoteAvailableToday,
  isSupervoteActive,
  resolveDisplayedVote,
} from './nowPlayingVotes';
import { resolveWebRuntimeConfig } from './runtimeConfig';
import radioTeduLogo from './assets/radiotedu-logo.png';
import { I18nContext, LANG_STORAGE_KEY, readInitialLang, translate, useI18n, type Lang, type MessageKey } from './i18n';

const runtimeConfig = resolveWebRuntimeConfig({
  windowOrigin: window.location.origin,
  windowProtocol: window.location.protocol,
  windowHostname: window.location.hostname,
  isDev: import.meta.env.DEV,
  // Static assets and Socket.IO keep their configured proxy base path. HTTP API
  // calls use the canonical /api/v1 origin.
  baseUrl: import.meta.env.DEV ? '/' : (import.meta.env.VITE_PUBLIC_BASE_PATH || '/jukebox/'),
  apiOriginOverride: import.meta.env.VITE_API_ORIGIN,
});

const API_URL = runtimeConfig.apiRoot;
const SOCKET_URL = runtimeConfig.socketUrl;
axios.defaults.withCredentials = true;
axios.defaults.headers.common['x-auth-transport'] = 'cookie';
const SOCKET_PATH = runtimeConfig.socketPath;

interface Song extends CatalogSearchSong {
  title: string;
  artist: string;
}

interface QueueSong {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  added_by_name?: string | null;
  duration_seconds?: number | null;
  duration_ms?: number | null;
  user_vote?: number;
  upvotes?: number;
  downvotes?: number;
  super_votes?: number;
  score?: number;
  song_score?: number | null;
  priority_score?: number | null;
}

interface AppUser {
  id: string;
  display_name: string;
  is_guest: boolean;
  total_songs_added: number;
  rank_score?: number;
  monthly_rank_score?: number;
  role?: string;
  last_super_vote_at?: string;
}

interface LeaderboardUser {
  id: string;
  display_name: string;
  total_songs_added: number;
  score?: number;
  rank_score?: number;
  monthly_rank_score?: number;
}

interface QueueState {
  now_playing: QueueSong | null;
  queue: QueueSong[];
}

interface ConnectResponse {
  device: DeviceSummary;
  queue: QueueState;
}

interface ProgressState {
  device_id?: string;
  currentTime: number;
  duration: number;
  percent: number;
}

interface ToastState {
  type: 'success' | 'error';
  text: string;
}

declare global {
  interface Window {
    toggleLeaderboard?: () => void;
  }
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (isAxiosError<{ error?: string; message?: string }>(error)) {
    return error.response?.data?.message || error.response?.data?.error || fallback;
  }

  if (error instanceof Error) return error.message;
  return fallback;
};

const formatTime = (seconds: number) => {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const getInitial = (name?: string | null) => (name?.trim().substring(0, 1) || '?').toUpperCase();

interface LoginViewProps {
  deviceCode: string;
  deviceCodeInput: string;
  setDeviceCodeInput: (value: string) => void;
  connectToDevice: (code: string) => void;
  user: AppUser | null;
  guestName: string;
  setGuestName: (value: string) => void;
  handleGuestLogin: () => void;
  loading: boolean;
  showLoginModal: boolean;
  setShowLoginModal: (value: boolean) => void;
  loginError: string | null;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  handleLogin: () => void;
  logout: () => void;
}

type SearchStatus = 'idle' | 'loading' | 'done' | 'error';
const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_SKELETON_ROWS = [0, 1, 2, 3, 4];
const LYRICS_RETRY_DELAYS_MS = [4000, 10000];

const LanguageToggle = () => {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      className="studio-ghost studio-lang"
      onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}
      title={t('common.switchLanguage')}
      aria-label={t('common.switchLanguage')}
    >
      {lang === 'tr' ? 'EN' : 'TR'}
    </button>
  );
};

interface ConsoleMenuProps {
  user: AppUser;
  onOpenAdmin?: () => void;
  logout: () => void;
}

/** Phone-only account menu: replaces the row of header buttons on narrow screens. */
const ConsoleMenu = ({ user, onOpenAdmin, logout }: ConsoleMenuProps) => {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="studio-menu" ref={menuRef}>
      <button
        type="button"
        className="studio-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('console.menu')}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="studio-avatar">{getInitial(user.display_name)}</span>
        <span className="studio-menu-icon" aria-hidden="true">
          <Menu size={18} />
          <X size={18} />
        </span>
      </button>

      {/* Stays mounted so closing can animate; inert keeps it out of focus and the a11y tree. */}
      <div className={open ? 'studio-menu-panel is-open' : 'studio-menu-panel'} role="menu" inert={!open}>
          <div className="studio-menu-user">
            <strong>{user.display_name}</strong>
            <small>{user.role === 'admin' ? t('console.roleAdmin') : user.is_guest ? t('console.roleGuest') : t('console.roleListener')}</small>
          </div>
          {user.role === 'admin' && onOpenAdmin && (
            <button type="button" role="menuitem" className="is-red" onClick={choose(onOpenAdmin)}>
              <Shield size={16} /> {t('console.adminTitle')}
            </button>
          )}
          <div className="studio-menu-lang">
            <span>
              <Languages size={16} /> {t('console.language')}
            </span>
            <div className="studio-menu-seg" role="group" aria-label={t('console.language')}>
              {(['tr', 'en'] as const).map((option) => (
                <button key={option} type="button" aria-pressed={lang === option} onClick={() => setLang(option)}>
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <button type="button" role="menuitem" className="studio-menu-logout" onClick={choose(logout)}>
            <LogOut size={16} /> {t('console.logout')}
          </button>
      </div>
    </div>
  );
};

const StudioTicker = () => {
  const { t } = useI18n();
  const words = t('ticker.words').split('|');
  return (
    <div className="studio-ticker" aria-hidden="true">
      <div className="studio-ticker-track">
        {[0, 1].map((copy) => (
          <span key={copy}>
            {words.map((word) => (
              <span key={word} className="studio-ticker-item">{word}</span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
};
const EQUALIZER_BARS = Array.from({ length: 36 }, (_, index) => index);

const StudioEqualizer = ({ active }: { active: boolean }) => (
  <div className={active ? 'studio-eq is-live' : 'studio-eq'} aria-hidden="true">
    {EQUALIZER_BARS.map((bar) => (
      <span key={bar} style={{ '--i': bar } as CSSProperties}></span>
    ))}
  </div>
);

const LoginView = ({
  deviceCode,
  deviceCodeInput,
  setDeviceCodeInput,
  connectToDevice,
  user,
  guestName,
  setGuestName,
  handleGuestLogin,
  loading,
  showLoginModal,
  setShowLoginModal,
  loginError,
  email,
  setEmail,
  password,
  setPassword,
  handleLogin,
  logout,
}: LoginViewProps) => {
  const { t } = useI18n();
  return (
  <main className="arcade-login studio studio-login">
    <header className="studio-topbar studio-login-topbar">
      <div className="studio-brand">
        <span className="studio-logo">
          <img className="studio-logo-image" src={radioTeduLogo} alt="RadioTEDU" />
        </span>
        <span className="studio-tag">JUKEBOX</span>
      </div>
      <div className="studio-top-actions">
        <LanguageToggle />
        <span className="studio-live is-on">
          <i></i>
          {t('console.live')}
        </span>
      </div>
    </header>

    <StudioTicker />

    <div className="studio-login-grid">
      <section className="studio-login-hero">
        <p className="studio-kicker">{t('login.kicker')}</p>
        <h1>
          {t('login.heroLine1')}
          <br />
          {t('login.heroLine2')}
          <br />
          <span>{t('login.heroLine3')}</span>
        </h1>
        <p className="studio-login-lead">{t('login.lead')}</p>

        <div className="studio-login-card" aria-hidden="true">
          <div className="studio-label">
            <span>RT / JUKEBOX 01</span>
            <span className="studio-live is-on">
              <i></i>
              {t('console.live')}
            </span>
          </div>
          <StudioEqualizer active />
          <div className="studio-login-card-foot">
            <span>{t('login.cardFoot')}</span>
            <span>24 / 7</span>
          </div>
        </div>
      </section>

      <section className="studio-panel studio-login-panel arcade-login-panel" aria-label={t('login.panelLabel')}>
        {user ? (
          <div className="studio-login-stack">
            <div className="studio-label">
              <span>{t('login.step2')}</span>
              <span>{t('login.step2Count')}</span>
            </div>

            <div className="user-ticket studio-ticket">
              <span className="studio-avatar">{getInitial(user.display_name)}</span>
              <div>
                <span>{t('login.welcome')}</span>
                <strong>{user.display_name}</strong>
              </div>
            </div>

            {!deviceCode ? (
              <div className="studio-login-form">
                <label className="studio-field-label" htmlFor="device-code-input">
                  {t('login.deviceCode')}
                </label>
                <input
                  id="device-code-input"
                  className="arcade-input code-input studio-code-input"
                  placeholder="KIOSK1"
                  value={deviceCodeInput}
                  maxLength={10}
                  autoComplete="off"
                  onChange={(event) => setDeviceCodeInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && deviceCodeInput && !loading) connectToDevice(deviceCodeInput);
                  }}
                />
                <p className="studio-field-help">{t('login.deviceCodeHelp')}</p>
                <button
                  className="studio-primary"
                  onClick={() => connectToDevice(deviceCodeInput)}
                  disabled={loading || !deviceCodeInput}
                >
                  {loading ? t('common.connecting') : t('login.connect')} <ChevronRight size={18} />
                </button>
              </div>
            ) : (
              <button className="studio-primary" onClick={() => connectToDevice(deviceCode)} disabled={loading}>
                {loading ? t('common.connecting') : t('login.enterDevice', { code: deviceCode })} <ChevronRight size={18} />
              </button>
            )}

            <button className="studio-link" onClick={logout}>
              {t('login.switchAccount')}
            </button>
          </div>
        ) : (
          <div className="studio-login-stack">
            <div className="studio-label">
              <span>{t('login.step1')}</span>
              <span>{t('login.step1Count')}</span>
            </div>
            <h2 className="studio-title">{t('login.title')}</h2>

            <div className="login-card studio-login-form">
              <label className="studio-field-label" htmlFor="guest-name-input">
                {t('login.guestLabel')}
              </label>
              <input
                id="guest-name-input"
                className="arcade-input studio-input"
                placeholder={t('login.guestPlaceholder')}
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !loading) handleGuestLogin();
                }}
              />
              <button className="studio-primary" onClick={handleGuestLogin} disabled={loading}>
                {loading ? t('common.connecting') : t('login.quickStart')} <ChevronRight size={18} />
              </button>
              <p className="studio-field-help">{t('login.guestHelp')}</p>
            </div>

            <div className="studio-divider">
              <span>{t('common.or')}</span>
            </div>

            <button className="studio-ghost studio-wide" onClick={() => setShowLoginModal(true)}>
              <User size={16} /> {t('login.memberLogin')}
            </button>
          </div>
        )}
      </section>
    </div>

    {showLoginModal && (
      <div className="modal-screen" role="dialog" aria-modal="true" aria-label={t('login.memberLogin')}>
        <section className="modal-card compact">
          <button className="modal-close" onClick={() => setShowLoginModal(false)} aria-label={t('common.close')}>
            x
          </button>
          <p className="eyebrow amber">{t('login.account')}</p>
          <h2>{t('login.memberLogin')}</h2>
          {loginError && (
            <div className="modal-error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{loginError}</span>
            </div>
          )}
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
          >
            <label>
              {t('login.username')}
              <input
                className="arcade-input"
                placeholder="admin@radiotedu.com"
                value={email}
                autoFocus
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              {t('login.password')}
              <input
                className="arcade-input"
                type="password"
                placeholder="••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button type="submit" className="arcade-button primary" disabled={loading}>
              {loading ? t('login.submitting') : t('login.submit')}
            </button>
          </form>
        </section>
      </div>
    )}
  </main>
  );
};

type LeaderboardPeriod = 'total' | 'monthly';

interface LeaderboardViewProps {
  leaderboard: LeaderboardUser[];
  period: LeaderboardPeriod;
  /** Period the shown rows belong to, plus which way they slide in after a switch. */
  loaded: { period: LeaderboardPeriod; slide: 'next' | 'prev' | null };
  closing: boolean;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  onClose: () => void;
  onExited: () => void;
}

const LeaderboardView = ({ leaderboard, period, loaded, closing, onPeriodChange, onClose, onExited }: LeaderboardViewProps) => {
  const { t } = useI18n();
  return (
  <div
    className={closing ? 'modal-screen studio-admin studio-leaderboard is-closing' : 'modal-screen studio-admin studio-leaderboard'}
    role="dialog"
    aria-modal="true"
    aria-label={t('leaderboard.label')}
    onAnimationEnd={(event) => {
      if (closing && event.target === event.currentTarget) onExited();
    }}
    onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    <section className="modal-card leaderboard-modal">
      <span className="lb-grabber" aria-hidden="true" />
      <div className="studio-label lb-label">
        <span>{t('leaderboard.eyebrow')}</span>
        <button type="button" className="lb-close" onClick={onClose} aria-label={t('leaderboard.close')}>
          <X size={18} />
        </button>
      </div>
      <h2 className="lb-title">{t('leaderboard.title')}</h2>
      <p className="lb-subtitle">{period === 'monthly' ? t('leaderboard.subtitleMonthly') : t('leaderboard.subtitleTotal')}</p>

      <div className="segmented-control" role="tablist" aria-label={t('leaderboard.period')} data-period={period}>
        <span className="segmented-indicator" aria-hidden="true" />
        <button className={period === 'total' ? 'active' : ''} onClick={() => onPeriodChange('total')}>
          {t('leaderboard.total')}
        </button>
        <button className={period === 'monthly' ? 'active' : ''} onClick={() => onPeriodChange('monthly')}>
          {t('leaderboard.monthly')}
        </button>
      </div>

      <div
        key={loaded.period}
        className={loaded.slide ? `leaderboard-list custom-scrollbar slide-${loaded.slide}` : 'leaderboard-list custom-scrollbar'}
      >
        {leaderboard.length === 0 ? (
          <div className="lb-empty">
            <Trophy size={24} />
            <strong>{t('leaderboard.emptyTitle')}</strong>
            <span>{t('leaderboard.emptyBody')}</span>
          </div>
        ) : (
          leaderboard.map((entry, index) => (
            <article className={index === 0 ? 'lb-row is-winner' : 'lb-row'} key={entry.id}>
              <span className="lb-rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="lb-avatar">{getInitial(entry.display_name)}</span>
              <span className="lb-copy">
                <strong>{entry.display_name}</strong>
                <small>{entry.total_songs_added === 1 ? t('leaderboard.songsOne') : t('leaderboard.songs', { count: entry.total_songs_added })}</small>
              </span>
              <span className="lb-score">
                <strong>{entry.score ?? entry.monthly_rank_score ?? entry.rank_score ?? 0}</strong>
                <small>{t('common.points')}</small>
              </span>
            </article>
          ))
        )}
      </div>
    </section>
  </div>
  );
};

const SongCover = ({
  src,
  alt,
  className = 'song-thumb',
  fallbackIconSize = 20,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  fallbackIconSize?: number;
}) => {
  const { t } = useI18n();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasError = Boolean(src && failedSrc === src);

  if (!src || hasError) {
    return (
      <div className={`song-cover-fallback ${className}`} aria-label={alt || t('common.songCover')}>
        <Disc3 size={fallbackIconSize} />
      </div>
    );
  }

  return (
    <img
      src={src}
      className={className}
      alt={alt || ''}
      onError={() => setFailedSrc(src ?? null)}
      loading="lazy"
    />
  );
};

interface QueueItemProps {
  item: QueueSong;
  idx: number;
  myVotes: Record<string, number>;
  handleVote: (queueItemId: string, voteType: number, isSuper?: boolean) => void;
  user: AppUser;
}

const QueueItem = ({ item, idx, myVotes, handleVote, user }: QueueItemProps) => {
  const { t } = useI18n();
  const currentVote = resolveDisplayedVote(item, myVotes);
  const supervoteAvailable = hasSupervoteAvailableToday(user.last_super_vote_at);

  return (
    <article className="queue-item studio-queue-item">
      <div className="studio-queue-index">{String(idx + 1).padStart(2, '0')}</div>
      <SongCover src={item.cover_url} className="studio-thumb" alt={item.title} fallbackIconSize={20} />
      <div className="studio-queue-copy">
        <strong>{item.title}</strong>
        <span>{item.artist}</span>
      </div>
      <div className="studio-queue-votes">
        <div className="studio-queue-score" title={t('vote.score')}>
          <Sparkles size={11} />
          {formatSongScore(getDisplayedSongScore(item))}
        </div>
        <div className="vote-controls" aria-label={t('vote.itemVotes', { title: item.title })}>
          <button
            className={currentVote === 1 ? 'vote active-up' : 'vote'}
            onClick={() => handleVote(item.id, 1)}
            title={t('vote.up')}
          >
            <ArrowBigUp size={17} fill={currentVote === 1 ? 'currentColor' : 'none'} />
          </button>
          <button
            className={currentVote === -1 ? 'vote active-down' : 'vote'}
            onClick={() => handleVote(item.id, -1)}
            title={t('vote.down')}
          >
            <ArrowBigDown size={17} fill={currentVote === -1 ? 'currentColor' : 'none'} />
          </button>
          {!user.is_guest && (
            <button
              className={isSupervoteActive(currentVote) ? 'vote active-super' : 'vote'}
              onClick={() => handleVote(item.id, 1, true)}
              disabled={!supervoteAvailable}
              title={!supervoteAvailable ? t('vote.superUsed') : t('vote.super')}
            >
              <Star size={15} fill={isSupervoteActive(currentVote) ? 'currentColor' : 'none'} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

interface SyncedLyricLine {
  time: number;
  text: string;
}

interface LyricsData {
  synced: boolean;
  lines: SyncedLyricLine[];
  plainLyrics: string | null;
  title: string;
  artist: string;
}

const SyncedLyricsCard = ({
  nowPlaying,
  interpolatedProgress,
}: {
  nowPlaying: QueueSong | null;
  interpolatedProgress: number;
}) => {
  const { t } = useI18n();
  const [lyricsResult, setLyricsResult] = useState<{ trackKey: string; lyrics: LyricsData | null } | null>(null);
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const title = nowPlaying?.title || '';
  const artist = nowPlaying?.artist || '';
  const durationMs = nowPlaying?.duration_ms ?? (nowPlaying?.duration_seconds ? nowPlaying.duration_seconds * 1000 : null);
  const trackKey = title && artist ? JSON.stringify([title, artist, durationMs]) : null;
  const currentLyricsResult = trackKey && lyricsResult?.trackKey === trackKey ? lyricsResult : null;
  const lyrics = currentLyricsResult?.lyrics ?? null;
  const loading = trackKey !== null && currentLyricsResult === null;

  useEffect(() => {
    if (!trackKey) return;

    let isMounted = true;
    let retryTimer: number | undefined;

    const durationSec = durationMs ? Math.round(durationMs / 1000) : undefined;
    const params = new URLSearchParams({
      title,
      artist,
    });
    if (durationSec) params.set('duration', String(durationSec));

    // lrclib is occasionally slow or flaky; if nothing comes back, ask again a little
    // later so lyrics still show up shortly after the song starts.
    const load = (attempt: number) => {
      axios
        .get<{ data: LyricsData | null }>(`${API_URL}/api/v1/jukebox/lyrics?${params.toString()}`)
        .then((res) => res.data.data || null)
        .catch((err) => {
          console.warn('Lyrics fetch error:', err);
          return null;
        })
        .then((nextLyrics) => {
          if (!isMounted) return;
          setLyricsResult({ trackKey, lyrics: nextLyrics });
          const retryDelay = LYRICS_RETRY_DELAYS_MS[attempt];
          if (!nextLyrics && retryDelay !== undefined) {
            retryTimer = window.setTimeout(() => load(attempt + 1), retryDelay);
          }
        });
    };
    load(0);

    return () => {
      isMounted = false;
      window.clearTimeout(retryTimer);
    };
  }, [title, artist, durationMs, trackKey]);

  // Find active line
  let activeIndex = -1;
  if (lyrics?.synced && lyrics.lines.length > 0) {
    for (let i = lyrics.lines.length - 1; i >= 0; i--) {
      if (lyrics.lines[i].time <= interpolatedProgress + 0.2) {
        activeIndex = i;
        break;
      }
    }
  }

  // Center the active line inside the lyrics box only; scrollIntoView would also
  // scroll the page down to the card on every new line.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const line = activeLineRef.current;
    if (!scroller || !line) return;
    const lineTop = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({
      top: lineTop - (scroller.clientHeight - line.offsetHeight) / 2,
      behavior: 'smooth',
    });
  }, [activeIndex]);

  if (!nowPlaying) return null;

  return (
    <div className="member-lyrics-card">
      <div className="lyrics-header">
        <div className="lyrics-header-left">
          <Mic2 size={16} />
          <span>{t('lyrics.title')}</span>
        </div>
        <span className={`lyrics-badge ${lyrics?.synced ? '' : lyrics?.plainLyrics ? 'plain' : 'none'}`}>
          {loading ? t('lyrics.searching') : lyrics?.synced ? t('lyrics.synced') : lyrics?.plainLyrics ? t('lyrics.plain') : t('lyrics.none')}
        </span>
      </div>

      <div className="member-lyrics-scroller custom-scrollbar" ref={scrollerRef}>
        {loading ? (
          <div className="lyrics-placeholder">{t('lyrics.loading')}</div>
        ) : lyrics?.synced && lyrics.lines.length > 0 ? (
          lyrics.lines.map((line, idx) => {
            const isActive = idx === activeIndex;
            const isPast = idx < activeIndex;
            return (
              <div
                key={idx}
                ref={isActive ? activeLineRef : null}
                className={`lyric-line ${isActive ? 'active' : isPast ? 'past' : 'future'}`}
              >
                {line.text}
              </div>
            );
          })
        ) : lyrics?.plainLyrics ? (
          lyrics.plainLyrics
            .split('\n')
            .filter((l) => l.trim().length > 0)
            .map((line, idx) => (
              <div key={idx} className="lyric-line plain-mode">
                {line}
              </div>
            ))
        ) : (
          <div className="lyrics-placeholder">{t('lyrics.empty')}</div>
        )}
      </div>
    </div>
  );
};

interface JukeboxViewProps {
  user: AppUser;
  device: DeviceSummary;
  logout: () => void;
  search: string;
  setSearch: (value: string) => void;
  searchSongs: () => void;
  results: Song[];
  searchStatus: SearchStatus;
  addingSongKey: string | null;
  addToQueue: (song: Song) => void;
  nowPlaying: QueueSong | null;
  queue: QueueSong[];
  fetchCurrentQueue: (deviceId: string) => void;
  progress: ProgressState | null;
  interpolatedProgress: number;
  handleVote: (queueItemId: string, voteType: number, isSuper?: boolean) => void;
  onShowLeaderboard: () => void;
  onOpenAdmin?: () => void;
  myVotes: Record<string, number>;
  showLoginModal: boolean;
  setShowLoginModal: (value: boolean) => void;
  loginError: string | null;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  handleLogin: () => void;
  loading: boolean;
  kioskStatus: KioskStatus;
}

const KIOSK_STATUS_LABELS: Record<KioskStatus, MessageKey> = {
  online: 'status.online',
  offline: 'status.offline',
  checking: 'status.checking',
};

const KIOSK_STATUS_TITLES: Record<KioskStatus, MessageKey> = {
  online: 'status.onlineTitle',
  offline: 'status.offlineTitle',
  checking: 'status.checkingTitle',
};

const JukeboxView = ({
  user,
  device,
  logout,
  search,
  setSearch,
  searchSongs,
  results,
  searchStatus,
  addingSongKey,
  addToQueue,
  nowPlaying,
  queue,
  fetchCurrentQueue,
  progress,
  interpolatedProgress,
  handleVote,
  onShowLeaderboard,
  onOpenAdmin,
  myVotes,
  showLoginModal,
  setShowLoginModal,
  loginError,
  email,
  setEmail,
  password,
  setPassword,
  handleLogin,
  loading,
  kioskStatus,
}: JukeboxViewProps) => {
  const { t } = useI18n();
  const nowPlayingCurrentVote = nowPlaying ? resolveDisplayedVote(nowPlaying, myVotes) : undefined;
  const nowPlayingSongScore = formatSongScore(nowPlaying ? getDisplayedSongScore(nowPlaying) : 0);
  const duration = progress?.duration || (nowPlaying?.duration_ms ? nowPlaying.duration_ms / 1000 : (nowPlaying?.duration_seconds || 0));
  const progressPercent = duration ? Math.min(100, (interpolatedProgress / duration) * 100) : 0;
  const supervoteAvailable = hasSupervoteAvailableToday(user.last_super_vote_at);

  return (
    <div className="jukebox-console studio">
      <header className="studio-topbar">
        <div className="studio-brand">
          <span className="studio-logo">
            <img className="studio-logo-image" src={radioTeduLogo} alt="RadioTEDU" />
          </span>
          <span className="studio-tag">JUKEBOX</span>
        </div>

        <div className={`device-card studio-device is-${kioskStatus}`} title={t(KIOSK_STATUS_TITLES[kioskStatus])}>
          <span className={kioskStatus === 'online' ? 'status-light online' : 'status-light'}></span>
          <span className="studio-onair">{t(KIOSK_STATUS_LABELS[kioskStatus])}</span>
          <strong>{device.name}</strong>
          <span>{device.device_code}</span>
        </div>

        <div className="studio-top-actions">
          <LanguageToggle />
          <button
            type="button"
            className="studio-ghost studio-leaderboard-btn"
            onClick={onShowLeaderboard}
            title={t('console.leaderboard')}
            aria-label={t('console.leaderboard')}
          >
            <Trophy size={15} />
            <span>{t('console.leaderboard')}</span>
          </button>
          {user.role === 'admin' && (
            <button type="button" className="studio-ghost is-red admin-open-btn" onClick={onOpenAdmin} title={t('console.adminTitle')}>
              <Shield size={15} />
              <span>{t('console.admin')}</span>
            </button>
          )}
          <div className="studio-user">
            <span className="studio-avatar">{getInitial(user.display_name)}</span>
            <span className="studio-user-copy">
              <strong>{user.display_name}</strong>
              <small>{user.role === 'admin' ? t('console.roleAdmin') : user.is_guest ? t('console.roleGuest') : t('console.roleListener')}</small>
            </span>
          </div>
          <button type="button" className="studio-icon" onClick={logout} title={t('console.logout')} aria-label={t('console.logout')}>
            <LogOut size={16} />
          </button>
          <ConsoleMenu user={user} onOpenAdmin={onOpenAdmin} logout={logout} />
        </div>
      </header>

      <StudioTicker />

      <div className={!nowPlaying && queue.length === 0 ? 'studio-grid is-idle' : 'studio-grid'}>
        <section className="studio-panel studio-search" aria-label={t('console.searchAria')}>
          <div className="studio-label">
            <span><span className="studio-label-index">01 / </span>{t('console.searchLabel')}</span>
            <span>{results.length === 0 ? t('console.catalog') : results.length === 1 ? t('console.resultCountOne') : t('console.resultCount', { count: results.length })}</span>
          </div>
          <h2 className="studio-title">{t('console.searchTitle')}</h2>

          <label className="search-panel studio-search-field">
            <Search size={18} />
            <input
              className="arcade-input"
              placeholder={t('console.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyUp={(event) => event.key === 'Enter' && searchSongs()}
            />
            {searchStatus === 'loading' ? <span className="studio-spinner studio-search-spinner" aria-label={t('console.searching')} /> : <kbd>Enter</kbd>}
          </label>

          <div
            className={searchStatus === 'loading' && results.length > 0 ? 'studio-results custom-scrollbar is-refreshing' : 'studio-results custom-scrollbar'}
            aria-busy={searchStatus === 'loading'}
          >
            {results.length > 0 ? (
              <>
                <div className="studio-results-head">
                  <span>{addingSongKey ? t('console.adding') : t('console.tapToAdd')}</span>
                  <button type="button" onClick={() => setSearch('')}>{t('console.clear')}</button>
                </div>
                {results.map((song, index) => {
                  const isAdding = addingSongKey === getSongQueueKey(song);
                  return (
                    <button
                      type="button"
                      className={isAdding ? 'search-result studio-result is-adding' : 'search-result studio-result'}
                      key={getSearchResultKey(song, index)}
                      onClick={() => addToQueue(song)}
                      disabled={Boolean(addingSongKey)}
                      aria-busy={isAdding}
                    >
                      <span className="studio-result-index">{String(index + 1).padStart(2, '0')}</span>
                      <SongCover src={song.cover_url} className="studio-thumb" alt={song.title} fallbackIconSize={18} />
                      <span className="studio-result-copy">
                        <strong>{song.title}</strong>
                        <small>{song.artist}</small>
                      </span>
                      <span className="studio-result-add" aria-hidden="true">
                        {isAdding ? <span className="studio-spinner" /> : <Plus size={16} />}
                      </span>
                    </button>
                  );
                })}
              </>
            ) : searchStatus === 'loading' ? (
              <div className="studio-results-skeleton" aria-label={t('console.searching')}>
                {SEARCH_SKELETON_ROWS.map((row) => (
                  <div className="studio-skeleton-row" key={row}>
                    <span className="studio-skeleton-thumb" />
                    <span className="studio-skeleton-lines">
                      <span />
                      <span />
                    </span>
                  </div>
                ))}
              </div>
            ) : searchStatus === 'done' ? (
              <div className="studio-hint">
                <p>{t('console.noResults', { query: search.trim() })}</p>
                <p>{t('console.noResultsHint')}</p>
              </div>
            ) : searchStatus === 'error' ? (
              <div className="studio-hint is-error">
                <p>{t('console.searchError')}</p>
                <p>{t('console.searchRetry')}</p>
              </div>
            ) : (
              <div className="studio-hint is-idle">
                <p>{t('console.searchHint1')}</p>
                <p>{t('console.searchHint2')}</p>
              </div>
            )}
          </div>
        </section>

        <main className="studio-panel studio-stage now-playing-panel">
          <div className="studio-label">
            <span><span className="studio-label-index">02 / </span>{t('console.nowPlaying')}</span>
            <span className={nowPlaying ? 'studio-live is-on' : 'studio-live'}>
              <i></i>
              {nowPlaying ? t('console.live') : t('console.idle')}
            </span>
          </div>

          {nowPlaying ? (
            <div className="studio-now">
              <div className="studio-art">
                <SongCover src={nowPlaying.cover_url} className="studio-cover" alt={nowPlaying.title} fallbackIconSize={64} />
                <span className="studio-vinyl" aria-hidden="true"></span>
              </div>

              <div className="studio-track">
                <h2>{nowPlaying.title}</h2>
                <p className="studio-artist">{nowPlaying.artist}</p>
                <p className="studio-request">
                  <User size={14} /> {t('console.requestedBy')} <strong>{nowPlaying.added_by_name || 'RadioTEDU'}</strong>
                </p>
              </div>

              <StudioEqualizer active />

              <div className="studio-progress">
                <span>{formatTime(interpolatedProgress)}</span>
                <div className="studio-progress-track">
                  <span style={{ width: `${progressPercent}%` }}></span>
                </div>
                <span>{formatTime(duration)}</span>
                <button className="studio-icon small" onClick={() => fetchCurrentQueue(device.id)} title={t('console.sync')} aria-label={t('console.sync')}>
                  <RefreshCw size={13} />
                </button>
              </div>

              <div className="studio-votes">
                <div className="studio-score">
                  <Sparkles size={14} />
                  <strong>{nowPlayingSongScore}</strong>
                  <span>{t('common.points')}</span>
                </div>
                <div className="studio-vote-buttons">
                  <button
                    className={nowPlayingCurrentVote === 1 ? 'vote active-up' : 'vote'}
                    onClick={() => handleVote(nowPlaying.id, 1)}
                    title={t('vote.up')}
                  >
                    <ArrowBigUp size={22} fill={nowPlayingCurrentVote === 1 ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className={nowPlayingCurrentVote === -1 ? 'vote active-down' : 'vote'}
                    onClick={() => handleVote(nowPlaying.id, -1)}
                    title={t('vote.down')}
                  >
                    <ArrowBigDown size={22} fill={nowPlayingCurrentVote === -1 ? 'currentColor' : 'none'} />
                  </button>
                  {!user.is_guest && (
                    <button
                      className={isSupervoteActive(nowPlayingCurrentVote) ? 'vote active-super' : 'vote'}
                      onClick={() => handleVote(nowPlaying.id, 1, true)}
                      disabled={!supervoteAvailable}
                      title={!supervoteAvailable ? t('vote.superUsed') : t('vote.super')}
                    >
                      <Star size={20} fill={isSupervoteActive(nowPlayingCurrentVote) ? 'currentColor' : 'none'} />
                    </button>
                  )}
                </div>
              </div>

              <SyncedLyricsCard nowPlaying={nowPlaying} interpolatedProgress={interpolatedProgress} />
            </div>
          ) : (
            <div className="studio-empty">
              <StudioEqualizer active={false} />
              <h2>
                {t('console.emptyLine1')}
                <br />
                <span>{t('console.emptyLine2')}</span>
              </h2>
              <p>
                {queue.length === 0
                  ? t('console.emptyBody')
                  : kioskStatus === 'offline' ? t('console.waitingOfflineBody') : t('console.waitingBody')}
              </p>
            </div>
          )}
        </main>

        <aside className="studio-panel studio-queue" aria-label={t('console.queueAria')}>
          <div className="studio-label">
            <span><span className="studio-label-index">03 / </span>{t('console.queue')}</span>
            <span>{queue.length === 1 ? t('console.queueCountOne') : t('console.queueCount', { count: queue.length })}</span>
          </div>

          <div className="studio-queue-list custom-scrollbar">
            {queue.length === 0 ? (
              <div className="studio-queue-empty">
                <ListMusic size={28} />
                <strong>{t('console.queueEmpty')}</strong>
                <span>{t('console.queueEmptyBody')}</span>
              </div>
            ) : (
              queue.map((item, index) => (
                <QueueItem key={item.id} item={item} idx={index} myVotes={myVotes} handleVote={handleVote} user={user} />
              ))
            )}
          </div>
        </aside>
      </div>

      {user.is_guest && (
        <div className="guest-status">
          <User size={18} />
          <span>{user.total_songs_added >= 1 ? t('console.guestUsed') : t('console.guestActive')}</span>
          {user.total_songs_added >= 1 ? <button onClick={logout}>{t('console.signUp')}</button> : <strong>{t('console.guestActiveBadge')}</strong>}
        </div>
      )}

      {showLoginModal && (
        <div className="modal-screen" role="dialog" aria-modal="true" aria-label={t('login.memberLogin')}>
          <section className="modal-card compact">
            <button className="modal-close" onClick={() => setShowLoginModal(false)} aria-label={t('common.close')}>
              x
            </button>
            <p className="eyebrow amber">{t('login.account')}</p>
            <h2>{t('login.memberLogin')}</h2>
            {loginError && (
              <div className="modal-error-banner" role="alert">
                <AlertCircle size={16} />
                <span>{loginError}</span>
              </div>
            )}
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                handleLogin();
              }}
            >
              <label>
                {t('login.username')}
                <input
                  className="arcade-input"
                  placeholder="admin@radiotedu.com"
                  value={email}
                  autoFocus
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                {t('login.password')}
                <input
                  className="arcade-input"
                  type="password"
                  placeholder="********"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button type="submit" className="arcade-button primary" disabled={loading}>
                {loading ? t('login.submitting') : t('login.submit')}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

function App() {
  const [lang, setLangState] = useState<Lang>(readInitialLang);
  const langRef = useRef(lang);
  // Callbacks read the language through a ref so switching it doesn't re-create them.
  const tr = (key: MessageKey, params?: Record<string, string | number>) => translate(langRef.current, key, params);

  // Uppercase labels rely on the document language (Turkish i → İ, English i → I).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceCodeInput, setDeviceCodeInput] = useState('');
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [guestName, setGuestName] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [addingSongKey, setAddingSongKey] = useState<string | null>(null);
  const searchRequestIdRef = useRef(0);
  const lastSearchTermRef = useRef('');
  const [queue, setQueue] = useState<QueueSong[]>([]);
  const [nowPlaying, setNowPlaying] = useState<QueueSong | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [interpolatedProgress, setInterpolatedProgress] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [kioskHeartbeat, setKioskHeartbeat] = useState<{ watchingSince: number; lastHeartbeatAt: number | null }>(
    () => ({ watchingSince: Date.now(), lastHeartbeatAt: null }),
  );
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<ToastState | null>(null);
  const [myVotes, setMyVotes] = useState<Record<string, number>>({});
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<'total' | 'monthly'>('total');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardClosing, setLeaderboardClosing] = useState(false);
  const [leaderboardLoaded, setLeaderboardLoaded] = useState<LeaderboardViewProps['loaded']>({ period: 'total', slide: null });
  const leaderboardLoadedPeriodRef = useRef<LeaderboardPeriod>('total');
  const leaderboardCloseTimerRef = useRef<number | undefined>(undefined);
  const openLeaderboard = () => {
    window.clearTimeout(leaderboardCloseTimerRef.current);
    setLeaderboardClosing(false);
    setShowLeaderboard(true);
  };
  const finishLeaderboardClose = () => {
    window.clearTimeout(leaderboardCloseTimerRef.current);
    setShowLeaderboard(false);
    setLeaderboardClosing(false);
  };
  const [showAdminModal, setShowAdminModal] = useState(false);
  const deviceRef = useRef<DeviceSummary | null>(null);
  const leaderboardRequestSeqRef = useRef(0);
  const leaderboardPeriodRef = useRef<'total' | 'monthly'>('total');

  const syncVotesFromQueue = useCallback((nextNowPlaying: QueueSong | null, nextQueue: QueueSong[]) => {
    const nextVotes: Record<string, number> = {};
    if (nextNowPlaying?.user_vote !== undefined) nextVotes[nextNowPlaying.id] = nextNowPlaying.user_vote;
    nextQueue.forEach((item) => {
      if (item.user_vote !== undefined) nextVotes[item.id] = item.user_vote;
    });
    if (Object.keys(nextVotes).length > 0) setMyVotes((prev) => ({ ...prev, ...nextVotes }));
  }, []);

  const fetchCurrentQueue = useCallback(
    async (deviceId: string) => {
      try {
        const [res, playbackRes] = await Promise.all([
          axios.get<QueueState>(`${API_URL}/api/v1/jukebox/queue/${deviceId}`),
          axios.get<{ success: boolean; data: { progressMs?: number; durationMs?: number; isPlaying?: boolean } | null }>(
            `${API_URL}/api/v1/jukebox/kiosk/playback-state/${deviceId}`,
          ).catch(() => null),
        ]);
        const nextQueue = res.data.queue || [];
        const nextNowPlaying = res.data.now_playing || null;
        setQueue(nextQueue);
        setNowPlaying(nextNowPlaying);
        syncVotesFromQueue(nextNowPlaying, nextQueue);

        const pbData = playbackRes?.data?.data;
        if (pbData && typeof pbData.progressMs === 'number' && typeof pbData.durationMs === 'number') {
          const currentTime = pbData.progressMs / 1000;
          const duration = pbData.durationMs / 1000;
          setProgress({
            device_id: deviceId,
            currentTime,
            duration,
            percent: duration > 0 ? (currentTime / duration) * 100 : 0,
          });
          setInterpolatedProgress(currentTime);
        }
      } catch (error) {
        console.error('Failed to sync queue:', error);
      }
    },
    [syncVotesFromQueue],
  );

  const connectToDevice = useCallback(
    async (code: string) => {
      if (!code) return;
      try {
        setLoading(true);
        const res = await axios.post<{ data: ConnectResponse }>(
          `${API_URL}/api/v1/jukebox/connect`,
          { device_code: code },
        );

        const responseData = res.data.data;
        setDevice(responseData.device);
        setQueue(responseData.queue.queue);
        setNowPlaying(responseData.queue.now_playing);
        syncVotesFromQueue(responseData.queue.now_playing, responseData.queue.queue);
        setMsg({ type: 'success', text: tr('toast.connected', { name: responseData.device.name }) });
        setDeviceCode(code);
      } catch {
        setMsg({ type: 'error', text: tr('toast.connectFailed') });
      } finally {
        setLoading(false);
      }
    },
    [syncVotesFromQueue],
  );

  const fetchLeaderboard = useCallback(async (period: 'total' | 'monthly' = leaderboardPeriodRef.current) => {
    const requestSeq = leaderboardRequestSeqRef.current + 1;
    leaderboardRequestSeqRef.current = requestSeq;
    setLeaderboardPeriod(period);

    try {
      const res = await axios.get<{ data: { leaderboard?: LeaderboardUser[] } }>(`${API_URL}/api/v1/users/leaderboard`, {
        params: { period },
      });
      if (leaderboardRequestSeqRef.current !== requestSeq) return;
      setLeaderboard(res.data.data.leaderboard || []);
      // Slide only when the rows switch period; reopening the same period just appears.
      const previousPeriod = leaderboardLoadedPeriodRef.current;
      leaderboardLoadedPeriodRef.current = period;
      setLeaderboardLoaded({
        period,
        slide: previousPeriod === period ? null : period === 'monthly' ? 'next' : 'prev',
      });
    } catch (error) {
      if (leaderboardRequestSeqRef.current !== requestSeq) return;
      console.error('Leaderboard fetch failed:', error);
    }
  }, []);

  useEffect(() => {
    deviceRef.current = device;
  }, [device]);

  useEffect(() => {
    leaderboardPeriodRef.current = leaderboardPeriod;
  }, [leaderboardPeriod]);

  useEffect(() => {
    if (!msg) return undefined;
    const timer = window.setTimeout(() => setMsg(null), 4000);
    return () => window.clearTimeout(timer);
  }, [msg]);

  useEffect(() => {
    if (!progress) return undefined;
    setInterpolatedProgress(progress.currentTime);
    const timer = window.setInterval(() => {
      setInterpolatedProgress((prev) => (prev < progress.duration ? prev + 1 : prev));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [progress]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) setDeviceCode(code);
    localStorage.removeItem('token');
    const savedUser = localStorage.getItem('user');
    if (!savedUser) return;
    void axios.get<{ data: AppUser }>(`${API_URL}/api/v1/auth/me`)
      .then((response) => {
        const parsed = response.data.data;
        setUser(parsed);
        localStorage.setItem('user', JSON.stringify(parsed));
        if (code) void connectToDevice(code);
      })
      .catch(() => localStorage.removeItem('user'));
  }, [connectToDevice]);

  useEffect(() => {
    window.toggleLeaderboard = () => {
      void fetchLeaderboard(leaderboardPeriodRef.current);
      openLeaderboard();
    };
    return () => {
      delete window.toggleLeaderboard;
    };
  }, [fetchLeaderboard]);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          const request = error.config as (typeof error.config & { _cookieAuthRetried?: boolean }) | undefined;
          const isAuthRoute = request?.url?.includes('/auth/login')
            || request?.url?.includes('/auth/register')
            || request?.url?.includes('/auth/guest')
            || request?.url?.includes('/auth/refresh');
          if (request && !request._cookieAuthRetried && !isAuthRoute) {
            request._cookieAuthRetried = true;
            return axios.post(`${API_URL}/api/v1/auth/refresh`, {})
              .then(() => axios(request))
              .catch((refreshError) => {
                localStorage.removeItem('user');
                setUser(null);
                setMsg({ type: 'error', text: tr('toast.sessionExpired') });
                return Promise.reject(refreshError);
              });
          }
          if (!isAuthRoute) {
            localStorage.removeItem('user');
            setUser(null);
            setMsg({ type: 'error', text: tr('toast.sessionExpired') });
          }
        }

        if (error.response?.data?.code === 'SESSION_REQUIRED') {
          const currentDevice = deviceRef.current;
          if (currentDevice?.device_code) {
            void connectToDevice(currentDevice.device_code);
            return Promise.reject(error);
          }
        }

        return Promise.reject(error);
      },
    );

    return () => axios.interceptors.response.eject(interceptor);
  }, [connectToDevice]);

  // One socket per connected device. Depending on `socket` here would make the
  // cleanup tear down every socket this effect just created, looping forever.
  const connectedDeviceId = device?.id;
  useEffect(() => {
    if (!connectedDeviceId) return undefined;

    const newSocket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      auth: {},
      withCredentials: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      transports: ['websocket', 'polling'],
    });
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      setSocket(null);
    };
  }, [connectedDeviceId]);

  useEffect(() => {
    if (!socket || !device) return undefined;

    const handleConnect = () => {
      socket.emit('join_device', device.id);
      void fetchCurrentQueue(device.id);
    };

    const handleQueueUpdated = (data: QueueState) => {
      const nextQueue = data.queue || [];
      const nextNowPlaying = data.now_playing || null;
      setQueue(nextQueue);
      setNowPlaying((prev) => {
        if (prev?.id !== nextNowPlaying?.id) {
          setProgress(null);
        }
        return nextNowPlaying;
      });
      syncVotesFromQueue(nextNowPlaying, nextQueue);
    };

    const handleForceLogout = () => {
      if (user?.role === 'admin') return;
      setDevice(null);
      setMsg({ type: 'error', text: tr('toast.deviceSessionEnded') });
    };

    const handlePlaybackProgress = (data: ProgressState) => setProgress(data);
    const handleSongSkipped = () => void fetchCurrentQueue(device.id);

    if (socket.connected) handleConnect();
    socket.on('connect', handleConnect);
    socket.on('queue_updated', handleQueueUpdated);
    socket.on('force_logout', handleForceLogout);
    socket.on('playback_progress', handlePlaybackProgress);
    socket.on('song_skipped', handleSongSkipped);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('queue_updated', handleQueueUpdated);
      socket.off('force_logout', handleForceLogout);
      socket.off('playback_progress', handlePlaybackProgress);
      socket.off('song_skipped', handleSongSkipped);
      socket.emit('leave_device', device.id);
    };
  }, [device, fetchCurrentQueue, socket, syncVotesFromQueue, user?.role]);

  // ON AIR reflects the kiosk's relayed socket heartbeat, not just our own connection.
  useEffect(() => {
    if (!socket || !connectedDeviceId) return undefined;
    setKioskHeartbeat({ watchingSince: Date.now(), lastHeartbeatAt: null });

    const handleKioskHeartbeat = (data: { device_id?: string }) => {
      if (data?.device_id && data.device_id !== connectedDeviceId) return;
      setKioskHeartbeat((prev) => ({ ...prev, lastHeartbeatAt: Date.now() }));
    };
    const clock = window.setInterval(() => setStatusClock(Date.now()), 5000);

    socket.on('kiosk_heartbeat', handleKioskHeartbeat);
    return () => {
      socket.off('kiosk_heartbeat', handleKioskHeartbeat);
      window.clearInterval(clock);
    };
  }, [socket, connectedDeviceId]);

  const kioskStatus = resolveKioskStatus({ ...kioskHeartbeat, now: Math.max(statusClock, kioskHeartbeat.lastHeartbeatAt ?? 0) });

  useEffect(() => {
    if (!device?.id) return undefined;
    void fetchCurrentQueue(device.id);

    const interval = window.setInterval(() => {
      void fetchCurrentQueue(device.id);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [device?.id, fetchCurrentQueue]);

  const handleGuestLogin = async () => {
    if (!guestName) return;
    try {
      setLoading(true);
      const res = await axios.post<{ data: { user: AppUser } }>(`${API_URL}/api/v1/auth/guest`, {
        display_name: guestName,
      });
      const userData = res.data.data.user;
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
      if (deviceCode) void connectToDevice(deviceCode);
    } catch {
      setMsg({ type: 'error', text: tr('toast.loginFailed') });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      setLoginError(tr('toast.credentialsRequired'));
      return;
    }
    try {
      setLoading(true);
      setLoginError(null);
      const res = await axios.post<{ data: { user: AppUser } }>(`${API_URL}/api/v1/auth/login`, {
        email,
        password,
      });
      setUser(res.data.data.user);
      localStorage.setItem('user', JSON.stringify(res.data.data.user));
      setGuestName('');
      setShowLoginModal(false);
      setLoginError(null);

      const currentCode = deviceCode || deviceCodeInput;
      if (currentCode) void connectToDevice(currentCode);
    } catch (error) {
      const errText = getErrorMessage(error, tr('toast.loginCheck'));
      setLoginError(errText);
      setMsg({ type: 'error', text: errText });
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (queueItemId: string, voteType: number, isSuper = false) => {
    if (!device) return;
    try {
      const response = await axios.post<{ data: { user_vote: number } }>(
        `${API_URL}/api/v1/jukebox/vote`,
        {
          queue_item_id: queueItemId,
          vote: voteType,
          device_id: device.id,
          is_super: isSuper,
        },
      );

      if (isSuper && user) {
        setUser({ ...user, last_super_vote_at: new Date().toISOString() });
      }

      const serverUserVote = response.data.data.user_vote;
      setMyVotes((prev) => {
        if (serverUserVote === 0) {
          const newState = { ...prev };
          delete newState[queueItemId];
          return newState;
        }
        return { ...prev, [queueItemId]: serverUserVote };
      });
    } catch (error) {
      setMsg({ type: 'error', text: getErrorMessage(error, tr('toast.voteFailed')) });
    }
  };

  const logout = async () => {
    const savedDeviceCode = device?.device_code || deviceCode;

    if (device?.id) {
      try {
        await axios.post(
          `${API_URL}/api/v1/jukebox/disconnect`,
          { device_id: device.id },
        );
      } catch (error) {
        console.warn('Failed to delete session:', error);
      }

      localStorage.removeItem(`device_pwd_${device.device_code}`);
      socket?.emit('leave_device', device.id);
    }

    try {
      await axios.post(`${API_URL}/api/v1/auth/logout`, {});
    } catch (error) {
      console.warn('Failed to clear server session:', error);
    }

    setUser(null);
    setDevice(null);
    setQueue([]);
    setNowPlaying(null);
    localStorage.removeItem('user');

    if (savedDeviceCode) {
      setDeviceCode(savedDeviceCode);
      setDeviceCodeInput(savedDeviceCode);
    }
  };

  const searchSongs = useCallback(async (rawTerm: string) => {
    const term = rawTerm.trim();
    if (term.length < MIN_SEARCH_LENGTH) return;
    if (term === lastSearchTermRef.current) return;
    lastSearchTermRef.current = term;

    // Only the newest request may update the list; slower, older responses are dropped.
    const requestId = ++searchRequestIdRef.current;
    setSearchStatus('loading');
    try {
      const res = await axios.get<{ data: { items: Song[] } }>(`${API_URL}/api/v1/jukebox/songs`, {
        params: { search: term },
      });
      if (requestId !== searchRequestIdRef.current) return;
      setResults(res.data.data.items || []);
      setSearchStatus('done');
    } catch (error) {
      if (requestId !== searchRequestIdRef.current) return;
      console.error('Song search failed:', error);
      lastSearchTermRef.current = '';
      setSearchStatus('error');
    }
  }, []);

  // Search as the user types (debounced); Enter still searches immediately.
  useEffect(() => {
    const term = search.trim();
    if (term.length < MIN_SEARCH_LENGTH) {
      searchRequestIdRef.current += 1;
      lastSearchTermRef.current = '';
      setResults([]);
      setSearchStatus('idle');
      return undefined;
    }
    const timer = window.setTimeout(() => void searchSongs(term), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, searchSongs]);

  const addToQueue = async (song: Song) => {
    if (!user || !device || addingSongKey) return;
    try {
      setAddingSongKey(getSongQueueKey(song));
      setLoading(true);
      await axios.post(`${API_URL}/api/v1/jukebox/queue`, buildQueueRequestPayload(device.id, song), {
        headers: buildGuestQueueHeaders(Boolean(user.is_guest)),
      });
      setMsg({ type: 'success', text: tr('toast.songAdded') });
      setSearch('');
      setResults([]);
      void fetchCurrentQueue(device.id);

      if (user.is_guest) {
        setUser({ ...user, total_songs_added: user.total_songs_added + 1 });
      }
    } catch (error) {
      if (isAxiosError<{ code?: string; message?: string }>(error) && error.response?.data?.code === 'GUEST_LIMIT_REACHED') {
        setMsg({ type: 'error', text: tr('toast.guestLimit') });
        setShowLoginModal(true);
      } else if (isAxiosError<{ code?: string }>(error) && error.response?.data?.code === 'MEMBER_SONG_QUOTA_REACHED') {
        setMsg({ type: 'error', text: tr('toast.memberQuota') });
      } else {
        setMsg({ type: 'error', text: getErrorMessage(error, tr('toast.songAddFailed')) });
      }
    } finally {
      setLoading(false);
      setAddingSongKey(null);
    }
  };

  const i18n = {
    lang,
    setLang: (next: Lang) => {
      if (next === langRef.current) return;
      langRef.current = next;
      // Crossfade old and new text where the browser supports view transitions.
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !reduceMotion) {
        document.startViewTransition(() => flushSync(() => setLangState(next)));
      } else {
        setLangState(next);
      }
      try {
        localStorage.setItem(LANG_STORAGE_KEY, next);
      } catch {
        // Storage can be blocked; the choice still applies for this visit.
      }
    },
    t: (key: MessageKey, params?: Record<string, string | number>) => translate(lang, key, params),
  };

  return (
    <I18nContext.Provider value={i18n}>
    <div className="arcade-app-shell">
      {!user || !device ? (
        <LoginView
          deviceCode={deviceCode}
          deviceCodeInput={deviceCodeInput}
          setDeviceCodeInput={setDeviceCodeInput}
          connectToDevice={connectToDevice}
          user={user}
          guestName={guestName}
          setGuestName={setGuestName}
          handleGuestLogin={handleGuestLogin}
          loading={loading}
          showLoginModal={showLoginModal}
          setShowLoginModal={(val) => {
            setShowLoginModal(val);
            if (!val) setLoginError(null);
          }}
          loginError={loginError}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          handleLogin={handleLogin}
          logout={logout}
        />
      ) : (
        <JukeboxView
          user={user}
          device={device}
          logout={logout}
          search={search}
          setSearch={setSearch}
          searchSongs={() => {
            lastSearchTermRef.current = '';
            void searchSongs(search);
          }}
          results={results}
          searchStatus={searchStatus}
          addingSongKey={addingSongKey}
          addToQueue={addToQueue}
          nowPlaying={nowPlaying}
          queue={queue}
          fetchCurrentQueue={fetchCurrentQueue}
          progress={progress}
          interpolatedProgress={interpolatedProgress}
          handleVote={handleVote}
          onShowLeaderboard={() => {
            void fetchLeaderboard();
            openLeaderboard();
          }}
          onOpenAdmin={() => setShowAdminModal(true)}
          myVotes={myVotes}
          showLoginModal={showLoginModal}
          setShowLoginModal={(val) => {
            setShowLoginModal(val);
            if (!val) setLoginError(null);
          }}
          loginError={loginError}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          handleLogin={handleLogin}
          loading={loading}
          kioskStatus={kioskStatus}
        />
      )}

      {showLeaderboard && (
        <LeaderboardView
          leaderboard={leaderboard}
          period={leaderboardPeriod}
          loaded={leaderboardLoaded}
          closing={leaderboardClosing}
          onPeriodChange={(period) => void fetchLeaderboard(period)}
          onClose={() => {
            setLeaderboardClosing(true);
            // animationend never fires if the browser skips animations (e.g. a background tab).
            window.clearTimeout(leaderboardCloseTimerRef.current);
            leaderboardCloseTimerRef.current = window.setTimeout(finishLeaderboardClose, 400);
          }}
          onExited={finishLeaderboardClose}
        />
      )}

      {showAdminModal && device && (
        <div className="modal-screen admin-modal-screen studio-admin" role="dialog" aria-modal="true" aria-label={tr('console.adminTitle')}>
          <div className="modal-card admin-modal-card">
            <AdminDashboard
              token=""
              device={device}
              onSelectDevice={setDevice}
              onClose={() => setShowAdminModal(false)}
            />
          </div>
        </div>
      )}

      {msg && (
        <div className={`toast ${msg.type}`} role="status">
          {msg.type === 'success' ? <CheckCircle2 size={24} /> : <AlertCircle size={24} />}
          <div>
            <span>{msg.type === 'success' ? tr('common.success') : tr('common.error')}</span>
            <strong>{msg.text}</strong>
          </div>
          <button onClick={() => setMsg(null)} aria-label={tr('common.dismissToast')}>
            x
          </button>
        </div>
      )}
    </div>
    </I18nContext.Provider>
  );
}

export default App;
