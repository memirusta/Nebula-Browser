import { useEffect, useState, type ReactNode } from 'react'
import type { NebulaSettings } from '../../core/nebulaSettings'
import { useLocale } from '../../hooks/useLocale'
import { readShieldStats, resetShieldStats, type ShieldStats } from '../../platform/tauriBrowser'
import { ShieldIcon } from '../ShieldPanel/ShieldIcon'
import { SettingGroup, SettingTextAreaRow, SettingToggleRow } from './SettingControls'
import styles from './SettingsPanel.module.css'
import shield from './ShieldSettings.module.css'

type Privacy = NebulaSettings['privacy']

interface ShieldSettingsProps {
  privacy: Privacy
  onChange: <K extends keyof Privacy>(key: K, value: Privacy[K]) => void
  /** The rows that protect the browser itself (tracking prevention, cookies, HTTPS, signals): they belong to the settings page, which knows them. */
  browserProtection: ReactNode
  /** The sites the protections do not apply to, and the switch for the site that is open. */
  exceptions: ReactNode
  /** The person's own list of addresses to block (the older list, besides the rules of the shield). */
  ownAddresses: ReactNode
}

/** The lists as a person knows them: what they are called, not the name of the file. */
const LIST_NAMES: Record<string, string> = {
  easylist: 'EasyList',
  easyprivacy: 'EasyPrivacy',
  'ubo-filters': 'uBlock filters',
  'ubo-privacy': 'uBlock privacy',
  'ubo-unbreak': 'uBlock unbreak',
  'ubo-badware': 'uBlock badware',
  pgl: 'Peter Lowe',
  'nebula-tr': 'Nebula · Türkçe siteler',
  'nebula-youtube': 'Nebula · YouTube',
}

/** The shield's part of the privacy page: how it is doing, what it blocks, the malware check, the person's own rules and the lists. */
export function ShieldSettings({ privacy, onChange, browserProtection, exceptions, ownAddresses }: ShieldSettingsProps) {
  const { locale, t, tf } = useLocale()
  const [stats, setStats] = useState<ShieldStats | null>(null)

  // What was stopped goes up while the page is open: ask again now and then.
  useEffect(() => {
    let stopped = false
    const load = () => {
      void readShieldStats()
        .then((value) => {
          if (!stopped) setStats(value)
        })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 4000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  const totals = stats?.totals
  const number = (value: number | undefined) => (value ?? 0).toLocaleString(locale)
  const since = totals?.since_ms
    ? new Date(totals.since_ms).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <section id="nebula-shield-settings" className={shield.area} aria-labelledby="nebula-shield-area-title">
      <header className={shield.areaHeader}>
        <span className={[shield.areaIcon, privacy.shield ? '' : shield.areaIconOff].join(' ')} aria-hidden="true">
          <ShieldIcon off={!privacy.shield} />
        </span>
        <div className={shield.areaText}>
          <h2 id="nebula-shield-area-title">Nebula Shield</h2>
          <p>{t('shieldAreaHint')}</p>
        </div>
      </header>

      <SettingGroup>
        <div className={shield.tiles}>
          <div className={shield.tile}>
            <strong>{number(totals?.ads)}</strong>
            <span>{t('shieldStatsAds')}</span>
          </div>
          <div className={shield.tile}>
            <strong>{number(totals?.trackers)}</strong>
            <span>{t('shieldStatsTrackers')}</span>
          </div>
          <div className={shield.tile}>
            <strong>{number(totals?.malware)}</strong>
            <span>{t('shieldStatsMalware')}</span>
          </div>
        </div>
        <div className={shield.statsFoot}>
          <span>{since ? tf('shieldStatsSince', { date: since }) : ''}</span>
          <button type="button" className={styles.actionBtn} onClick={() => void resetShieldStats().then(() => readShieldStats().then(setStats))}>
            {t('shieldStatsReset')}
          </button>
        </div>
        <SettingToggleRow
          label="Nebula Shield"
          hint={t('shieldHint')}
          checked={privacy.shield}
          onChange={() => onChange('shield', !privacy.shield)}
        />
      </SettingGroup>

      <SettingGroup title={t('shieldGroupBlocking')}>
        <SettingToggleRow
          label={t('shieldAds')}
          hint={t('shieldAdsHint')}
          checked={privacy.shieldAds}
          disabled={!privacy.shield}
          onChange={() => onChange('shieldAds', !privacy.shieldAds)}
        />
        <SettingToggleRow
          label={t('shieldTrackers')}
          hint={t('shieldTrackersHint')}
          checked={privacy.shieldTrackers}
          disabled={!privacy.shield}
          onChange={() => onChange('shieldTrackers', !privacy.shieldTrackers)}
        />
        <SettingToggleRow
          label={t('shieldFingerprint')}
          hint={t('shieldFingerprintHint')}
          checked={privacy.shieldFingerprint}
          disabled={!privacy.shield}
          onChange={() => onChange('shieldFingerprint', !privacy.shieldFingerprint)}
        />
      </SettingGroup>

      <SettingGroup title={t('shieldGroupMalware')}>
        <SettingToggleRow
          label={t('shieldMalware')}
          hint={t('shieldMalwareHint')}
          checked={privacy.shieldMalware}
          disabled={!privacy.shield}
          onChange={() => onChange('shieldMalware', !privacy.shieldMalware)}
        />
        <SettingToggleRow
          label={t('shieldMalwareUpdates')}
          hint={t('shieldMalwareUpdatesHint')}
          checked={privacy.shieldMalwareUpdates}
          disabled={!privacy.shield || !privacy.shieldMalware}
          onChange={() => onChange('shieldMalwareUpdates', !privacy.shieldMalwareUpdates)}
        />
      </SettingGroup>

      {browserProtection}

      {exceptions}

      <SettingGroup title={t('shieldGroupRules')}>
        <SettingTextAreaRow
          label={t('shieldCustomRules')}
          hint={t('shieldCustomRulesHint')}
          value={privacy.shieldCustomRules}
          placeholder={'||ads.example^\nexample.com##.banner'}
          onChange={(value) => onChange('shieldCustomRules', value)}
        />
        {ownAddresses}
      </SettingGroup>

      <SettingGroup title={t('shieldGroupLists')}>
        <div className={shield.listsHint}>{t('shieldListsHint')}</div>
        {(stats?.lists ?? []).map((list) => (
          <div className={shield.listRow} key={list.name}>
            <span className={shield.listName}>
              {LIST_NAMES[list.name] ?? list.name}
              {list.own && <span className={shield.own}>{t('shieldListOwn')}</span>}
            </span>
            <span className={shield.listRules}>{tf('shieldListRules', { count: list.rules.toLocaleString(locale) })}</span>
          </div>
        ))}
      </SettingGroup>
    </section>
  )
}
