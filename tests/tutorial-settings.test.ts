import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  completeGuidedTutorial,
  getTutorialCopy,
  shouldResumeGuidedTutorial,
  startGuidedTutorial,
  TUTORIAL_COMPLETE_KEY,
  TUTORIAL_STARTED_KEY,
} from '../src/core/tutorial.ts'
import { DEFAULT_USER_DISPLAY_NAME } from '../src/core/userProfile.ts'

const SUPPORTED_LOCALES = ['tr', 'en', 'es', 'de', 'fr', 'id', 'ru', 'it', 'ja'] as const

test('a skipped profile uses a neutral default display name', () => {
  assert.equal(DEFAULT_USER_DISPLAY_NAME, 'User')
})

test('the tutorial exposes six complete and uniquely targeted steps in every app locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getTutorialCopy(locale)

    assert.equal(copy.steps.length, 6, locale)
    assert.ok(copy.skipAll.trim(), locale)
    assert.ok(copy.progress.trim(), locale)
    assert.ok(copy.previous.trim(), locale)
    assert.ok(copy.next.trim(), locale)
    assert.ok(copy.finish.trim(), locale)
    assert.equal(new Set(copy.steps.map((step) => step.target)).size, 6, locale)

    for (const step of copy.steps) {
      assert.ok(step.title.trim(), locale)
      assert.ok(step.body.trim(), locale)
      assert.ok(step.action.trim(), locale)
    }

    const semiLunarStep = copy.steps.find((step) => step.target === 'semi-lunar')
    assert.ok(semiLunarStep, locale)
    assert.match(`${semiLunarStep.body} ${semiLunarStep.action}`, /YouTube/i, locale)

    const searchStep = copy.steps.find((step) => step.target === 'home-search')
    assert.ok(searchStep, locale)
    assert.match(`${searchStep.body} ${searchStep.action}`, /Semi-Lunar/i, locale)
    assert.match(searchStep.body, /Ctrl \+ L/i, locale)

    const toolsStep = copy.steps.find((step) => step.target === 'home-toolbar')
    assert.ok(toolsStep, locale)
    assert.match(toolsStep.body, /Semi-Lunar/i, locale)

    // The modules on the left say where to edit them (Settings -> Home -> Edit UI), in the words of the language.
    const widgetsStep = copy.steps.find((step) => step.target === 'home-widgets')
    assert.ok(widgetsStep, locale)
    assert.match(widgetsStep.action, /→.*→/, locale)

    // The statement about the shield is the last step, says what really does the blocking, and asks nothing of the person.
    assert.equal(copy.steps[copy.steps.length - 1].target, 'shield', locale)
    assert.match(copy.steps[copy.steps.length - 1].body, /uBlock Origin Lite/, locale)
  }
})

test('settings has no category for the tutorial; it is started again from About', () => {
  const categorySource = readFileSync(
    new URL('../src/core/settingsCategories.ts', import.meta.url),
    'utf8',
  )
  const settingsSource = readFileSync(
    new URL('../src/components/SettingsPanel/SettingsPanel.tsx', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(categorySource, /id:\s*['"]tutorial['"]/)
  // There is no tab or menu of its own for it any more than there was; About only has the one button that starts it again.
  assert.doesNotMatch(settingsSource, /TutorialMenu/)
})

test('an interrupted guided tutorial resumes until it is completed or skipped', () => {
  const values = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })

  try {
    assert.equal(shouldResumeGuidedTutorial(), false)
    startGuidedTutorial()
    assert.equal(values.get(TUTORIAL_STARTED_KEY), '1')
    assert.equal(shouldResumeGuidedTutorial(), true)

    completeGuidedTutorial()
    assert.equal(values.get(TUTORIAL_COMPLETE_KEY), '1')
    assert.equal(values.has(TUTORIAL_STARTED_KEY), false)
    assert.equal(shouldResumeGuidedTutorial(), false)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
