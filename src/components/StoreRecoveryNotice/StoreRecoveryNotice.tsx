import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getLocaleCopy } from '../../core/locale'
import {
  markStoreRecoveryNoticeSeen,
  shouldShowStoreRecoveryNotice,
} from '../../core/storeRecoveryNotice'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import { useLocale } from '../../hooks/useLocale'
import styles from './StoreRecoveryNotice.module.css'

const COPY = {
  en: {
    eyebrow: 'NEBULA UPDATE',
    title: 'Nebula should work properly now',
    body: 'Over the past few weeks, a bug in our ad-blocking system caused browsing to stop working for some Microsoft Store users.\n\nWe’ve fixed the issue in this update. Sorry for the trouble — especially if this was your first experience with Nebula.',
    continue: 'Continue',
  },
  tr: {
    eyebrow: 'NEBULA GÜNCELLEMESİ',
    title: 'Nebula artık düzgün çalışmalı',
    body: 'Son birkaç haftadır reklam engelleme sistemimizdeki bir hata, bazı Microsoft Store kullanıcılarında gezinmenin durmasına neden oldu.\n\nBu güncellemeyle sorunu düzelttik. Yaşattığımız sorun için özür dileriz — özellikle de bu, Nebula ile ilk deneyiminizse.',
    continue: 'Devam et',
  },
  es: {
    eyebrow: 'ACTUALIZACIÓN DE NEBULA',
    title: 'Nebula ya debería funcionar correctamente',
    body: 'Durante las últimas semanas, un error en nuestro sistema de bloqueo de anuncios impidió navegar a algunos usuarios de Microsoft Store.\n\nHemos solucionado el problema en esta actualización. Sentimos las molestias, especialmente si esta fue tu primera experiencia con Nebula.',
    continue: 'Continuar',
  },
  de: {
    eyebrow: 'NEBULA-UPDATE',
    title: 'Nebula sollte jetzt wieder richtig funktionieren',
    body: 'In den vergangenen Wochen führte ein Fehler in unserem Werbeblocker dazu, dass das Surfen bei einigen Nutzern der Microsoft-Store-Version nicht mehr funktionierte.\n\nMit diesem Update haben wir das Problem behoben. Wir entschuldigen uns für die Unannehmlichkeiten – besonders, wenn dies deine erste Erfahrung mit Nebula war.',
    continue: 'Weiter',
  },
  fr: {
    eyebrow: 'MISE À JOUR DE NEBULA',
    title: 'Nebula devrait maintenant fonctionner correctement',
    body: 'Ces dernières semaines, un problème dans notre système de blocage des publicités a empêché certains utilisateurs de la version Microsoft Store de naviguer.\n\nNous avons corrigé le problème dans cette mise à jour. Désolés pour ce désagrément, surtout s’il s’agissait de votre première expérience avec Nebula.',
    continue: 'Continuer',
  },
  id: {
    eyebrow: 'PEMBARUAN NEBULA',
    title: 'Nebula sekarang seharusnya berfungsi dengan baik',
    body: 'Selama beberapa minggu terakhir, bug pada sistem pemblokiran iklan kami menyebabkan penjelajahan berhenti berfungsi bagi sebagian pengguna Microsoft Store.\n\nMasalah tersebut telah kami perbaiki dalam pembaruan ini. Kami mohon maaf atas gangguannya, terutama jika ini adalah pengalaman pertama Anda dengan Nebula.',
    continue: 'Lanjutkan',
  },
  ru: {
    eyebrow: 'ОБНОВЛЕНИЕ NEBULA',
    title: 'Теперь Nebula должна работать правильно',
    body: 'В последние несколько недель ошибка в нашей системе блокировки рекламы мешала работе браузера у некоторых пользователей версии из Microsoft Store.\n\nВ этом обновлении мы исправили проблему. Приносим извинения за неудобства, особенно если это было ваше первое знакомство с Nebula.',
    continue: 'Продолжить',
  },
  it: {
    eyebrow: 'AGGIORNAMENTO DI NEBULA',
    title: 'Ora Nebula dovrebbe funzionare correttamente',
    body: 'Nelle ultime settimane, un errore nel nostro sistema di blocco degli annunci ha impedito la navigazione ad alcuni utenti della versione Microsoft Store.\n\nAbbiamo risolto il problema con questo aggiornamento. Ci dispiace per il disagio, soprattutto se questa è stata la tua prima esperienza con Nebula.',
    continue: 'Continua',
  },
  ja: {
    eyebrow: 'NEBULA アップデート',
    title: 'Nebula が正常に動作するようになりました',
    body: 'ここ数週間、広告ブロック機能の不具合により、一部の Microsoft Store ユーザーがウェブを閲覧できない問題が発生していました。\n\nこのアップデートで問題を修正しました。ご迷惑をおかけして申し訳ありません。特に、これが Nebula を初めて使ったときの体験だった方には、心よりお詫び申し上げます。',
    continue: '続ける',
  },
} as const

function FixedBrowserGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.4 12.2l3 3.1 6.5-7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function StoreRecoveryNotice() {
  const { locale } = useLocale()
  const copy = getLocaleCopy(COPY, locale)
  const [open, setOpen] = useState(shouldShowStoreRecoveryNotice)
  const dialogRef = useRef<HTMLElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)

  const handleContinue = useCallback(() => {
    markStoreRecoveryNoticeSeen()
    setOpen(false)
  }, [])

  useDialogFocusTrap({
    active: open,
    containerRef: dialogRef,
    initialFocusRef: continueRef,
    onEscape: handleContinue,
  })

  if (!open) return null

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <section
        ref={dialogRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-recovery-notice-title"
        tabIndex={-1}
      >
        <div className={styles.icon}>
          <FixedBrowserGlyph />
        </div>
        <span className={styles.eyebrow}>{copy.eyebrow}</span>
        <h2 id="store-recovery-notice-title">{copy.title}</h2>
        <p>{copy.body}</p>
        <button ref={continueRef} type="button" onClick={handleContinue}>
          {copy.continue}
        </button>
      </section>
    </div>,
    document.body,
  )
}
