# Nebula Privacy Policy

Nebula is an open-source web browser. Its source code is publicly available at:

https://github.com/memirusta/Nebula-Browser

Nebula does not include project-operated advertising, analytics, or telemetry services.

Because Nebula is a web browser, it necessarily communicates with network services when you browse the web or use features that require online data.

## Web browsing

When you visit a website, Nebula connects to that website and to resources requested by that website.

Those websites and services may receive normal network information such as your IP address, browser requests, cookies, and other information required for web browsing.

Nebula does not control the privacy practices of websites you choose to visit.

## Search and search suggestions

When you perform a web search, your query is sent to the search engine you selected.

Nebula may also request search suggestions while you type. In that case, the text required to obtain suggestions may be sent to the relevant suggestion service.

Search suggestions are used only to provide interactive search recommendations.

## Weather

Nebula includes an optional weather widget and weather-location features.

When these features are used, location information required to obtain weather data, such as a selected city or geographic coordinates, may be sent to Open-Meteo services.

Weather information is used to display weather inside Nebula.

Users can choose whether to use the weather widget and location-related weather features.

## Google sign-in and synchronization

Google sign-in and synchronization are optional.

If you choose to sign in with Google, Nebula communicates with Google OAuth and Google APIs as required to authenticate your account and perform the synchronization features you request.

Nebula does not initiate Google account synchronization unless the user chooses to use the Google account features.

Information sent to Google is also subject to Google's privacy policies.

## Application updates

Nebula uses GitHub Releases to distribute application updates.

When Nebula checks for available updates, a request may be made to GitHub to retrieve release metadata.

Downloading an update also connects to GitHub's infrastructure.

## Local browser data

Browser data such as settings, browsing history, bookmarks, shortcuts, and other local application state may be stored on the user's device.

Some data may be synchronized with a third-party service only when the user explicitly enables a synchronization feature.

## Passwords and credentials

Nebula includes local credential storage features.

Nebula does not operate a remote password-storage service.

Credentials may still be transmitted to websites when you choose to sign in to those websites, as is required for normal web authentication.

## Third-party components

Nebula includes and uses open-source and platform components, including Microsoft WebView2, the adblock-rust engine, and the filter lists and scripts of EasyList, EasyPrivacy, uBlock Origin and Peter Lowe's server list.

### Nebula Shield

Nebula blocks advertising, trackers and harmful sites with its own built-in shield. The filter lists it uses are part of the app and are only replaced when Nebula itself is updated; the shield does not download anything on its own.

There is one optional exception. If you turn on "Keep the malware list up to date" in Settings, Nebula downloads URLhaus's list of addresses that are serving malware right now, at most every 12 hours, from `malware-filter.gitlab.io` (one fixed HTTPS address, no cookies, no identifier). That server can see your IP address, as any website can. The setting is off by default, and turning it off deletes what was downloaded.

Nebula keeps a count of what the shield has stopped (advertisements, trackers and harmful pages) in a small file on this device. It is shown in Settings > Privacy and is never sent anywhere; you can reset it there.

The shield can also make what a website can read about your computer (canvas, audio and WebGL output, the number of processor cores) slightly different for each site, to make you harder to recognise across sites. This setting is on by default and can be turned off in Settings > Privacy, or per site from the site panel.

These components and external services may be subject to their own privacy policies and terms.

Third-party software licensing information is available in:

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## Code signing

Nebula's Windows release binaries on GitHub are currently not code-signed.

## Changes to this policy

This policy may be updated when Nebula adds, removes, or changes network-connected features.

Changes to this policy are publicly visible in the project's Git history.