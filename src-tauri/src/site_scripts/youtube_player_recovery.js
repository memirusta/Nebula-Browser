// YouTube watch pages sometimes leave the player on 0:00 / 0:00 with a spinner: the ad request the page
// waits for never answers (an ad blocker drops it), and nothing but a reload gets the video going.
// This reloads the page once when the player has still loaded nothing a few seconds after a watch page
// opened (also after YouTube's own in-page navigation). Only www.youtube.com, only the top frame,
// never twice for the same video within a minute, never in a hidden tab.
(() => {
  'use strict'
  try {
    if (window.top !== window || location.hostname !== 'www.youtube.com') return
    if (window.__nebulaYoutubeRecovery) return
    Object.defineProperty(window, '__nebulaYoutubeRecovery', { value: true })

    const KEY = 'nebula-youtube-recovery'
    const STUCK_AFTER_MS = 3000
    const REPEAT_GUARD_MS = 60000
    let timer = 0

    const videoId = () =>
      location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null

    const reloadedRecently = (id) => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null')
        return !!saved && saved.id === id && Date.now() - saved.at < REPEAT_GUARD_MS
      } catch (_) {
        // Storage is not available: do not risk reloading in a loop.
        return true
      }
    }

    const remember = (id) => {
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ id, at: Date.now() }))
        return true
      } catch (_) {
        return false
      }
    }

    // Nothing is loaded: no video element, or one that has no data at all.
    const playerIsStuck = () => {
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video')
      return !video || video.readyState === 0
    }

    const check = (id) => {
      timer = 0
      if (videoId() !== id) return
      if (document.visibilityState !== 'visible') {
        // A tab in the background does not load its video; look again when it is shown.
        const again = () => {
          if (document.visibilityState !== 'visible') return
          document.removeEventListener('visibilitychange', again)
          arm()
        }
        document.addEventListener('visibilitychange', again)
        return
      }
      if (!playerIsStuck() || reloadedRecently(id)) return
      if (!remember(id)) return
      location.reload()
    }

    const arm = () => {
      if (timer) clearTimeout(timer)
      timer = 0
      const id = videoId()
      if (!id) return
      timer = setTimeout(() => check(id), STUCK_AFTER_MS)
    }

    // YouTube navigates inside the page when a video is clicked; these events mark each such step.
    window.addEventListener('yt-navigate-start', () => {
      if (timer) clearTimeout(timer)
      timer = 0
    })
    window.addEventListener('yt-navigate-finish', arm)
    document.addEventListener('yt-navigate-finish', arm)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true })
    else arm()
  } catch (_) {
    // A page script that fails must never break the page.
  }
})()
