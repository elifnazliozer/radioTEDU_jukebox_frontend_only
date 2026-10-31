import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminDashboard, type DeviceSummary } from './AdminDashboard';
import { I18nContext, translate, type Lang } from './i18n';
import { server } from './test/mswServer';

const device: DeviceSummary = {
  id: 'device-1',
  device_code: 'KIOSK1',
  name: 'Kiosk',
  location: null,
  is_active: true,
};

const renderAdmin = (lang: Lang) =>
  render(
    <I18nContext.Provider value={{ lang, setLang: () => {}, t: (key, params) => translate(lang, key, params) }}>
      <AdminDashboard token="" device={device} />
    </I18nContext.Provider>,
  );

describe('admin dashboard language', () => {
  beforeEach(() => {
    // Keep the dashboard's data fetches off the network; empty lists are enough to render every tab.
    server.use(http.all(/\/api\/v1\//, () => HttpResponse.json({ success: true, data: [] })));
  });

  it('renders the console chrome and tabs in English', async () => {
    const user = userEvent.setup();
    renderAdmin('en');

    expect(screen.getByRole('heading', { name: 'RadioTEDU Jukebox Admin Console' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Kiosk devices/ })).toBeInTheDocument();
    expect(await screen.findByText('Spotify players on the network (0)')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Song library/ }));
    expect(await screen.findByText('No songs yet. Scan the folder to add some.')).toBeInTheDocument();
  });

  it('keeps the Turkish text when the language is Turkish', () => {
    renderAdmin('tr');

    expect(screen.getByRole('heading', { name: 'RadioTEDU Jukebox Yönetici Konsolu' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Kiosk Cihazları/ })).toBeInTheDocument();
  });
});
