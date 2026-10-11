import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src-tauri/src/site_ui.rs', import.meta.url), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('an Instagram message is a reply only when it has a "replied" label or a smaller quoted message right above it', () => {
  const details = source.slice(source.indexOf('function messageDetailsFromCandidate'), source.indexOf('function reportCandidate'))
  // The decision is made on what sits right above the message, not on words anywhere in the container.
  assert.ok(details.includes('const above = entries.slice(0, -1).filter('))
  assert.ok(details.includes('isReplyLabelText(entry.text)'))
  assert.ok(details.includes('entry.fontSize < actual.fontSize - 0.5'))
  assert.doesNotMatch(details, /container\.textContent[\s\S]{0,120}repl/i, 'no search for reply words in the whole container text')
  // Two messages of one sender, one under the other, are not a quote: the geometry alone is not enough.
  assert.doesNotMatch(details, /isReply: hasReplyLabel \|\| hasQuotedPreview[\s\S]*verticalGap >= -4 && verticalGap <= 72;\s*\}\);\s*return \{/)
  // The label is a short line with a whole word.
  const label = source.slice(source.indexOf('function isReplyLabelText'), source.indexOf('function isGenericInstagramActivity'))
  assert.ok(label.includes('value.length > 90'))
  assert.ok(label.includes(`(?![${String.fromCharCode(92)}p{L}])`))
})

test('an Instagram message is announced only when it sits below the last one seen (by position, not by text or count), and not while another conversation is opening', () => {
  const observer = source.slice(source.indexOf('function installInstagramMessageObserver'), source.indexOf('function installInstagramPersistentNotificationObserver'))
  for (const part of ['function contentBottom(node)', 'function lowestOtherMessage(composerRect)', 'function tailRelation(node)', 'function threadSettling()', 'let lastTailNode = null;']) {
    assert.ok(observer.includes(part), part)
  }
  // Nothing is reported while the conversation settles, and a message that is not below the last one is not new.
  const report = observer.slice(observer.indexOf('function reportCandidate'), observer.indexOf('function queueCandidate'))
  assert.ok(report.indexOf('threadSettling()') > 0 && report.indexOf('threadSettling()') < report.indexOf('announce('))
  assert.ok(report.includes('const relation = tailRelation(newest);'))
  assert.ok(report.includes("if (relation !== 'new') {"))
  // The same message drawn again is followed (its node is the anchor now), so older messages loaded above it
  // do not move the baseline.
  assert.ok(report.includes("if (relation === 'same') {"))
  assert.ok(report.indexOf("relation !== 'new'") < report.indexOf('lastTailBottom = contentBottom(newest);'))
  // What cannot be told is new: no notification is lost to a page that does not look as expected.
  const relation = observer.slice(observer.indexOf('function tailRelation(node)'), observer.indexOf('function threadSettling()'))
  assert.ok(relation.includes("return 'new';"))
  // The new conversation is noticed when it opens (not at the next message), and the observer starts with a baseline.
  assert.ok(observer.includes('window.setInterval(function () {'))
  assert.ok(observer.includes('rememberTail(lowestOtherMessage(composer.getBoundingClientRect()));'))
  // The persistent notification classifier reads Instagram's own wording (before the first colon), not the message.
  const persistent = source.slice(source.indexOf('function eventKind(notificationType, body)'), source.indexOf('function eventKindLabel'))
  assert.ok(persistent.includes("const template = text.indexOf(':') > 0"))
  assert.ok(persistent.includes('.test(template)'))
})

test('why a message was not shown is written to the notification log with a fixed reason and never a message', () => {
  const broker = readFileSync(new URL('../src-tauri/src/notification_broker.rs', import.meta.url), 'utf8')
    .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  assert.ok(broker.includes('pub fn record_adapter_diagnostic('))
  // Only reasons from a fixed list are written; anything else is "other".
  assert.ok(broker.includes('const ADAPTER_DROP_REASONS: &[&str]'))
  assert.ok(broker.includes('"other"'))
  // The page reports its reasons, only from an Instagram page whose origin matches; the shell reports the
  // tab-in-front case (no notification by design) as suppressed.
  assert.ok(source.includes('nebula-site-notification-diagnostic'))
  assert.ok(source.includes('"tab-visible"'))
  assert.ok(source.includes("noteDrop('not-new')"))
  assert.ok(source.includes("noteDrop('thread-settling')"))
})

test('a sender who repeats the same short message is not collapsed into one notification', () => {
  const observer = source.slice(source.indexOf('function installInstagramMessageObserver'), source.indexOf('function installInstagramPersistentNotificationObserver'))
  // Only a moment, not seconds: a re-drawn thread is already told apart by threadAppended.
  assert.ok(observer.includes('now - lastMessageAt < 800'))
  assert.doesNotMatch(observer, /now - lastMessageAt < 5000/)
  const broker = readFileSync(new URL('../src-tauri/src/notification_broker.rs', import.meta.url), 'utf8')
    .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  assert.ok(broker.includes('const SAME_DOM_MESSAGE_WINDOW_MS: u64 = 800;'))
  assert.ok(broker.includes('marker.adapter_kind != Some(ContentAdapterKind::Dom)'))
})

test('a line that is exactly Instagram\'s "<name> replied to you" is a reply label at any size; a message that only says "replied" needs a smaller size', () => {
  const strict = source.slice(source.indexOf('function isStrictReplyLabelText'), source.indexOf('function replyLabelAbove'))
  assert.ok(strict.includes("lower === ending || lower.endsWith(' ' + ending)"))
  assert.ok(strict.includes("'replied to you'"))
  const details = source.slice(source.indexOf('function messageDetailsFromCandidate'), source.indexOf('function reportCandidate'))
  assert.ok(details.includes('isStrictReplyLabelText(entry.text) ||'))
  assert.ok(details.includes('(smallerThanMessage(entry) && isReplyLabelText(entry.text))'))
  const scan = source.slice(source.indexOf('function replyLabelAbove'), source.indexOf('function isGenericInstagramActivity'))
  assert.ok(scan.indexOf('isStrictReplyLabelText(element.textContent)') > scan.indexOf('rect.right <= 0'))
})

test('a reaction under the user\'s own message and a reel, post, story, video or photo from a friend are announced in the page\'s language', () => {
  const observer = source.slice(source.indexOf('function installInstagramMessageObserver'), source.indexOf('function installInstagramPersistentNotificationObserver'))
  for (const part of ['function announce(composerRect, body, eventKind, notificationData, dedupeText)', 'function scanReactions(root)', 'function reportMedia(item)', 'function mediaIn(root)', 'function reactionBadgesIn(root)']) {
    assert.ok(observer.includes(part), part)
  }
  // Nine languages, for the reaction wording and for what was sent.
  for (const language of ['en', 'tr', 'es', 'de', 'fr', 'id', 'ru', 'it', 'ja']) {
    assert.ok(observer.includes(`      ${language}: { reel: '`), `sent phrases ${language}`)
    assert.ok(observer.includes(`      ${language}: function (emoji, text) {`), `reaction phrase ${language}`)
  }
  // Only a reaction under the user's own (right-hand) message is announced; the rest is remembered.
  const scan = observer.slice(observer.indexOf('function scanReactions(root)'), observer.indexOf('// ---- Something that is not text'))
  assert.ok(scan.includes('if (quiet || !mine) continue;'))
  assert.ok(scan.includes("'reaction'"))
  // Media is announced only when it is from others (left side), below the last message seen.
  const media = observer.slice(observer.indexOf('function reportMedia(item)'), observer.indexOf('const mediaAttempts'))
  assert.ok(media.includes("tailRelation(item.node)"))
  assert.ok(media.includes('composerRect.left + composerRect.width / 2) return;'))
  // A reel, a post and a story are told by their address; avatars and emoji are too small to be a photo.
  const detect = observer.slice(observer.indexOf('function mediaIn(root)'), observer.indexOf('function rememberMedia(root)'))
  for (const marker of ["'/reel/'", "'/p/'", "'/stories/'", 'rect.width < 140 || rect.height < 140']) assert.ok(detect.includes(marker), marker)
  // What is on the page when the observer starts or a conversation opens is only remembered.
  assert.ok(observer.includes('rememberMedia(document.body);'))
  assert.ok(observer.includes('reactedKeys.clear();'))
  // The text path posts through the same function.
  const report = observer.slice(observer.indexOf('function reportCandidate'), observer.indexOf('function queueCandidate'))
  assert.ok(report.includes('announce('))
})

test('text drawn on a reel or picture card is not a message, a card nothing recognised is an attachment, and the log is told the shape of what was seen (never text)', () => {
  const observer = source.slice(source.indexOf('function installInstagramMessageObserver'), source.indexOf('function installInstagramPersistentNotificationObserver'))
  assert.ok(observer.includes('function insideMediaCard(node)'))
  const report = observer.slice(observer.indexOf('function reportCandidate'), observer.indexOf('function queueCandidate'))
  assert.ok(report.includes('insideMediaCard(candidate)'))
  assert.ok(report.indexOf('insideMediaCard(candidate)') < report.indexOf('announce('))
  assert.ok(observer.includes("kind: 'attachment'"))
  assert.ok(observer.includes('attachment: '))
  // The shape of an element: tags, roles, picture sizes, the first segment of a link; never its text.
  const describe = observer.slice(observer.indexOf('function describeNode(node)'), observer.indexOf('let armedPath'))
  assert.ok(describe.includes('element.tagName.toLowerCase()'))
  assert.doesNotMatch(describe, /textContent|innerText/)
  const broker = readFileSync(new URL('../src-tauri/src/notification_broker.rs', import.meta.url), 'utf8')
    .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  assert.ok(broker.includes('fn adapter_detail(detail: &str) -> String'))
  assert.ok(broker.includes('.take(240)'))
  for (const reason of ['"media-detected"', '"media-unrecognized"', '"media-text"']) assert.ok(broker.includes(reason), reason)
})

test('a picture is a reel, a post or a photo by what is drawn on and above it, and the author and caption of a card are part of the card', () => {
  const observer = source.slice(source.indexOf('function installInstagramMessageObserver'), source.indexOf('function installInstagramPersistentNotificationObserver'))
  for (const part of ['function pictureCard(node)', 'function pictureKind(node)']) assert.ok(observer.includes(part), part)
  const kind = observer.slice(observer.indexOf('function pictureKind(node)'), observer.indexOf('function mediaIn(root)'))
  // A tall poster (9:16) with the author on it is a reel; a squarer card with the author above it is a post;
  // nothing on or above it is a photo (the avatar column of the message row does not count).
  assert.ok(kind.includes('>= 1.6 ? \'reel\' : \'post\''))
  assert.ok(kind.includes("return node.tagName === 'VIDEO' ? 'video' : 'photo';"))
  const card = observer.slice(observer.indexOf('function pictureCard(node)'), observer.indexOf('function pictureKind(node)'))
  assert.ok(card.includes('rect.left < imageRect.left - 12'))
  // The text on or around a card is matched against the card (author above, caption below), not just the picture.
  const inside = observer.slice(observer.indexOf('function insideMediaCard(node)'), observer.indexOf('function reportMedia(item)'))
  assert.ok(inside.includes('item.cardRect || item.node.getBoundingClientRect()'))
})
