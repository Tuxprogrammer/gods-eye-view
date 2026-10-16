/**
 * Status wording for the Meshtastic server rows and the layer's meta line.
 * Browser-only (it translates); model.js stays portable for source.js.
 */
import { t, tn } from '../../i18n/index.js';
import { MESHTASTIC_STALE_AFTER_MS } from './model.js';

/**
 * Meshtastic packets sit at msh/<region>/2/e/<channel>/<gateway>, five levels
 * or more, so a short filter with no wildcard (msh/US) is valid MQTT that can
 * never match one. Say so rather than sit connected and silent.
 * @returns {string|null}
 */
export function topicWarning(topic) {
  const filter = String(topic ?? '');
  if (/[#+]/.test(filter) || filter.split('/').length >= 5) return null;
  return t('Topic {topic} matches nothing: add /#, like msh/US/#', {
    topic: filter || t('(empty)'),
  });
}

/** One short line for a server row. */
export function serverSummary(server, now = Date.now()) {
  if (server.enabled) {
    const warning = topicWarning(server.topic);
    if (warning) return warning;
  }
  switch (server.status) {
    case 'off':
      return t('Off');
    case 'live': {
      const quiet =
        server.lastMessageAt === null ||
        now - server.lastMessageAt > MESHTASTIC_STALE_AFTER_MS;
      return quiet
        ? t('Connected, no traffic lately')
        : t('Live · {rate}/min', { rate: server.messagesPerMinute });
    }
    case 'connecting':
    case 'reconnecting':
      return server.error
        ? t('Reconnecting · {error}', { error: server.error })
        : t('Connecting…');
    case 'auth-failed':
      return server.error || t('Login refused');
    default:
      return server.error || t('Unavailable');
  }
}

/** The layer row's meta line: what the enabled servers are doing, honestly. */
export function serversSummary(servers, now = Date.now()) {
  if (!servers.length) return 'Meshtastic MQTT'; // i18n-ignore: product name
  const on = servers.filter((server) => server.enabled);
  if (!on.length) return t('Turn a server on to listen');
  const live = on.filter((server) => server.status === 'live');
  if (!live.length)
    return on.length === 1
      ? `${on[0].name}: ${serverSummary(on[0], now)}`
      : t('{count} servers connecting…', { count: on.length });
  const rate = live.reduce((sum, s) => sum + s.messagesPerMinute, 0);
  return tn(
    on.length,
    '{live}/{count} server live · {rate}/min',
    '{live}/{count} servers live · {rate}/min',
    { live: live.length, rate },
  );
}
