# Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

Official Nebula Windows releases are built from the public
`memirusta/Nebula-Browser` source repository.

## Team roles

Nebula is currently maintained by a single project maintainer.

- Committers: `memirusta`
- Reviewers: `memirusta`
- Approvers: `memirusta`

Changes submitted by external contributors must be reviewed by the maintainer
before they are merged.

Release signing requests must be manually approved by an approver.

## Build and signing process

Official signed Windows releases are built using GitHub Actions on
GitHub-hosted Windows runners.

The unsigned release artifact is uploaded to GitHub Actions before it is
submitted to SignPath.

SignPath is used to verify the build origin and apply the Windows code-signing
signature.

The SignPath signing certificate is not stored in this repository or on a
developer machine.

Nebula's Tauri updater signature is separate from Windows code signing and is
used to authenticate updater artifacts.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## Source and releases

Source code:
https://github.com/memirusta/Nebula-Browser

Official releases:
https://github.com/memirusta/Nebula-Browser/releases