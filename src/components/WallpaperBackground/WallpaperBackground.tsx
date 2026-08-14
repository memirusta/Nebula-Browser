import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type {
  WallpaperConfig,
} from '../../core/wallpaperConfig'
import {
  videoWallpaperUrl,
} from '../../platform/wallpaperMedia'
import styles from './WallpaperBackground.module.css'

interface WallpaperBackgroundProps {
  config: WallpaperConfig
  active: boolean
  hidden?: boolean
}

function usePlaybackEnvironment():
  boolean {
  const [
    pageActive,
    setPageActive,
  ] = useState(
    () =>
      !document.hidden &&
      document.hasFocus(),
  )

  const [
    reducedMotion,
    setReducedMotion,
  ] = useState(
    () =>
      window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches,
  )

  useEffect(() => {
    const media =
      window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      )

    const refresh =
      () => {
        setPageActive(
          !document.hidden &&
            document.hasFocus(),
        )
      }

    const onMotion =
      () => {
        setReducedMotion(
          media.matches,
        )
      }

    document.addEventListener(
      'visibilitychange',
      refresh,
    )

    window.addEventListener(
      'focus',
      refresh,
    )

    window.addEventListener(
      'blur',
      refresh,
    )

    media.addEventListener(
      'change',
      onMotion,
    )

    return () => {
      document.removeEventListener(
        'visibilitychange',
        refresh,
      )

      window.removeEventListener(
        'focus',
        refresh,
      )

      window.removeEventListener(
        'blur',
        refresh,
      )

      media.removeEventListener(
        'change',
        onMotion,
      )
    }
  }, [])

  return (
    pageActive &&
    !reducedMotion
  )
}

export function WallpaperBackground({
  config,
  active,
  hidden = false,
}: WallpaperBackgroundProps) {
  const videoRef =
    useRef<HTMLVideoElement>(
      null,
    )

  const playbackEnvironment =
    usePlaybackEnvironment()

  const videoUrl =
    useMemo(
      () =>
        videoWallpaperUrl(
          config.videoPath,
        ),
      [
        config.videoPath,
      ],
    )

  const shouldAnimate =
    active &&
    !hidden &&
    playbackEnvironment

  useEffect(() => {
    const video =
      videoRef.current

    if (
      !video ||
      config.mode !==
        'video'
    ) {
      return
    }

    if (
      shouldAnimate
    ) {
      void video
        .play()
        .catch(
          (error) => {
            if (
              import.meta.env.DEV
            ) {
              console.warn(
                '[nebula wallpaper] autoplay was blocked',
                error,
              )
            }
          },
        )

      return
    }

    video.pause()
  }, [
    config.mode,
    shouldAnimate,
    videoUrl,
  ])

  const position =
    `${config.position.x}% ${config.position.y}%`

  const imageStyle:
    CSSProperties | undefined =
      config.mode ===
        'image' &&
      config.imageUrl
        ? {
            backgroundImage:
              `url(${config.imageUrl})`,
            backgroundSize:
              config.fit,
            backgroundPosition:
              position,
          }
        : undefined

  const ambientStyle =
    {
      '--ambient-intensity':
        String(
          config.ambientIntensity,
        ),

      '--ambient-duration':
        `${Math.round(
          28 /
            config.ambientSpeed,
        )}s`,
    } as CSSProperties

  return (
    <div
      className={[
        styles.root,

        hidden
          ? styles.hidden
          : '',
      ]
        .filter(
          Boolean,
        )
        .join(
          ' ',
        )}
      style={
        imageStyle
      }
      data-mode={
        config.mode
      }
      data-custom={
        Boolean(
          config.imageUrl,
        )
      }
      aria-hidden="true"
    >
      {config.mode ===
        'video' &&
        videoUrl && (
          <video
            ref={
              videoRef
            }
            className={
              styles.video
            }
            src={
              videoUrl
            }
            muted
            loop
            playsInline
            preload="auto"
            tabIndex={-1}
            style={{
              objectFit:
                config.fit,

              objectPosition:
                position,
            }}
            onCanPlay={(
              event,
            ) => {
              if (
                shouldAnimate
              ) {
                void event
                  .currentTarget
                  .play()
                  .catch(
                    () => {},
                  )
              }
            }}
          />
        )}

      {config.mode ===
        'ambient' && (
          <div
            className={
              styles.ambient
            }
            data-preset={
              config.ambientPreset
            }
            data-active={
              shouldAnimate
            }
            style={
              ambientStyle
            }
          >
            <span
              className={
                styles.ambientBlobA
              }
            />

            <span
              className={
                styles.ambientBlobB
              }
            />

            <span
              className={
                styles.ambientBlobC
              }
            />
          </div>
        )}

      <div
        className={
          styles.overlay
        }
      />
    </div>
  )
}
