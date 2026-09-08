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

test('the tutorial exposes four complete and uniquely targeted steps in every app locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getTutorialCopy(locale)

    assert.equal(copy.steps.length, 4, locale)
    assert.ok(copy.skipAll.trim(), locale)
    assert.ok(copy.progress.trim(), locale)
    assert.ok(copy.previous.trim(), locale)
    assert.ok(copy.next.trim(), locale)
    assert.ok(copy.finish.trim(), locale)
    assert.equal(new Set(copy.steps.map((step) => step.target)).size, 4, locale)

    for (const step of copy.steps) {
      assert.ok(step.title.trim(), locale)
      assert.ok(step.body.trim(), locale)
      assert.ok(step.action.trim(), locale)
    }

    const semiLunarStep = copy.steps.find((step) => step.target === 'semi-lunar')
    assert.ok(semiLunarStep, locale)
    assert.match(`${semiLunarStep.body} ${semiLunarStep.action}`, /YouTube/i, locale)
  }
})

test('settings does not expose the one-time onboarding tutorial as a category', () => {
  const categorySource = readFileSync(
    new URL('../src/core/settingsCategories.ts', import.meta.url),
    'utf8',
  )
  const settingsSource = readFileSync(
    new URL('../src/components/SettingsPanel/SettingsPanel.tsx', import.meta.url),
    'utf8',
  )

  assert.doesNotMatch(categorySource, /id:\s*['"]tutorial['"]/)
  assert.doesNotMatch(settingsSource, /TutorialMenu|onStartTutorial/)
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
