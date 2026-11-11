import type { Shortcut } from './types'
import { placeholderFavicon } from './faviconPlaceholder.ts'

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { id: 'google', label: 'Google', url: 'https://google.com', favicon: placeholderFavicon('google.com') },
  { id: 'youtube', label: 'YouTube', url: 'https://youtube.com', favicon: placeholderFavicon('youtube.com') },
  { id: 'reddit', label: 'Reddit', url: 'https://reddit.com', favicon: placeholderFavicon('reddit.com') },
  { id: 'reddit2', label: 'Reddit', url: 'https://old.reddit.com', favicon: placeholderFavicon('reddit.com') },
  { id: 'twitter', label: 'Twitter', url: 'https://x.com', favicon: placeholderFavicon('x.com') },
  { id: 'netflix', label: 'Netflix', url: 'https://netflix.com', favicon: placeholderFavicon('netflix.com') },
  { id: 'wikipedia', label: 'Wikipedia', url: 'https://wikipedia.org', favicon: placeholderFavicon('wikipedia.org') },
  { id: 'wikipedia2', label: 'Wikipedia', url: 'https://tr.wikipedia.org', favicon: placeholderFavicon('wikipedia.org') },
  { id: 'notion', label: 'Notion', url: 'https://notion.so', favicon: placeholderFavicon('notion.so') },
  { id: 'spotify', label: 'Spotify', url: 'https://spotify.com', favicon: placeholderFavicon('spotify.com') },
  { id: 'github', label: 'GitHub', url: 'https://github.com', favicon: placeholderFavicon('github.com') },
  { id: 'linkedin', label: 'LinkedIn', url: 'https://linkedin.com', favicon: placeholderFavicon('linkedin.com') },
  { id: 'amazon', label: 'Amazon', url: 'https://amazon.com', favicon: placeholderFavicon('amazon.com') },
  { id: 'instagram', label: 'Instagram', url: 'https://instagram.com', favicon: placeholderFavicon('instagram.com') },
  { id: 'facebook', label: 'Facebook', url: 'https://facebook.com', favicon: placeholderFavicon('facebook.com') },
  { id: 'twitch', label: 'Twitch', url: 'https://twitch.tv', favicon: placeholderFavicon('twitch.tv') },
  { id: 'discord', label: 'Discord', url: 'https://discord.com', favicon: placeholderFavicon('discord.com') },
  { id: 'gmail', label: 'Gmail', url: 'https://mail.google.com', favicon: placeholderFavicon('mail.google.com') },
  { id: 'tiktok', label: 'TikTok', url: 'https://tiktok.com', favicon: placeholderFavicon('tiktok.com') },
  { id: 'stackoverflow', label: 'Stack Overflow', url: 'https://stackoverflow.com', favicon: placeholderFavicon('stackoverflow.com') },
  { id: 'apple', label: 'Apple', url: 'https://apple.com', favicon: placeholderFavicon('apple.com') },
  { id: 'microsoft', label: 'Microsoft', url: 'https://microsoft.com', favicon: placeholderFavicon('microsoft.com') },
  { id: 'pinterest', label: 'Pinterest', url: 'https://pinterest.com', favicon: placeholderFavicon('pinterest.com') },
]

export const WALLPAPER_STORAGE_KEY = 'nebula-wallpaper'
