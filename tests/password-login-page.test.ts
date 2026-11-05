import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { renderPinLoginPage } from '../src/server/pin-login-page.ts'
import type { PasswordLoginParameters } from '../src/server/pin-auth.ts'

const parameters: PasswordLoginParameters = { salt: Buffer.alloc(16, 17).toString('base64url'), iterations: 600000 }
type Submit = (event: { preventDefault(): void }) => Promise<void>

function browser(script: string, passwordValue: string, webCrypto: Pick<Crypto, 'subtle'> | object = crypto) {
  let listener: Submit | undefined
  let prevented = 0
  let submitted = 0
  let submittedCredential = ''
  let submittedPassword = ''
  const attributes = new Map<string, string>()
  const password = { value: passwordValue }
  const credential = { value: '' }
  const button = { disabled: true, textContent: 'Ingresar' }
  const error = { hidden: true, textContent: '' }
  const form = {
    valid: true,
    reportValidity() { return this.valid },
    addEventListener(name: string, callback: Submit) { assert.equal(name, 'submit'); listener = callback },
    setAttribute(name: string, value: string) { attributes.set(name, value) },
    removeAttribute(name: string) { attributes.delete(name) },
  }
  const elements = { 'login-form': form, password, credential, 'login-submit': button, 'password-error': error }
  class Form {
    submit() {
      assert.equal(this, form)
      submitted++
      submittedCredential = credential.value
      submittedPassword = password.value
    }
  }
  runInNewContext(script, {
    document: { getElementById(id: keyof typeof elements) { return elements[id] } },
    crypto: webCrypto, TextEncoder, Uint8Array, atob, btoa, HTMLFormElement: Form,
  }, { timeout: 1000 })
  return {
    form, password, credential, button, error, attributes,
    submit() { assert.ok(listener); return listener({ preventDefault() { prevented++ } }) },
    get prevented() { return prevented }, get submitted() { return submitted },
    get submittedCredential() { return submittedCredential }, get submittedPassword() { return submittedPassword },
  }
}

async function page() {
  const response = renderPinLoginPage(undefined, undefined, parameters)
  const html = await response.text()
  const match = /<script nonce="([A-Za-z0-9+/=]+)">([\s\S]*?)<\/script>/.exec(html)
  assert.ok(match)
  return { response, html, nonce: match[1]!, script: match[2]! }
}

test('login exposes only public KDF parameters and permits exactly its nonce-protected script', async () => {
  const first = await page()
  const second = await page()
  assert.equal(first.response.status, 200)
  assert.notEqual(first.nonce, second.nonce)
  assert.equal(Buffer.from(first.nonce, 'base64').length, 24)
  const csp = first.response.headers.get('Content-Security-Policy')!
  assert.ok(csp.includes(`script-src 'nonce-${first.nonce}'`))
  assert.ok(csp.includes("default-src 'none'"))
  assert.ok(csp.includes("form-action 'self'"))
  assert.equal(first.response.headers.get('Referrer-Policy'), 'same-origin')
  assert.equal(first.response.headers.get('Cache-Control'), 'private, no-store')
  const rawInput = /<input id="password"[^>]*>/.exec(first.html)![0]
  assert.doesNotMatch(rawInput, /\sname=|\spattern=|\smaxlength=/)
  assert.match(rawInput, /autocomplete="current-password"/)
  assert.deepEqual([...first.html.matchAll(/<input[^>]*\sname="([^"]+)"/g)].map((match) => match[1]), ['credential'])
  assert.match(first.html, /<noscript>/)
})

test('native login script derives the exact synthetic password and submits once without plaintext', async () => {
  const { script } = await page()
  const password = ' Ab12cd34Ef'
  assert.equal(password.length, 11)
  const state = browser(script, password)
  assert.equal(state.button.disabled, false)
  const first = state.submit()
  assert.equal(state.button.disabled, true)
  assert.equal(state.attributes.get('aria-busy'), 'true')
  await state.submit()
  await first
  const expected = pbkdf2Sync(password, Buffer.from(parameters.salt, 'base64url'), 600000, 32, 'sha256').toString('base64url')
  assert.equal(state.submittedCredential, expected)
  assert.match(state.submittedCredential, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(state.submittedPassword, '')
  assert.equal(state.password.value, '')
  assert.equal(state.submitted, 1)
  assert.equal(state.prevented, 2)
})

test('a derivation failure clears the credential, preserves the draft and permits an explicit retry', async () => {
  const { script } = await page()
  let failures = 1
  const subtle = {
    importKey: crypto.subtle.importKey.bind(crypto.subtle),
    deriveBits: (...args: Parameters<SubtleCrypto['deriveBits']>) => {
      if (failures-- > 0) return Promise.reject(new Error('Synthetic crypto failure'))
      return crypto.subtle.deriveBits(...args)
    },
  } as SubtleCrypto
  const state = browser(script, 'Synthetic11', { subtle })
  await state.submit()
  assert.equal(state.submitted, 0)
  assert.equal(state.credential.value, '')
  assert.equal(state.password.value, 'Synthetic11')
  assert.equal(state.button.disabled, false)
  assert.equal(state.error.hidden, false)
  assert.equal(state.attributes.has('aria-busy'), false)
  assert.doesNotMatch(state.error.textContent, /Synthetic/)
  await state.submit()
  assert.equal(state.submitted, 1)
})

test('the script blocks unsupported crypto, invalid length, controls, unpaired surrogates and invalid form state', async () => {
  const { script } = await page()
  const unsupported = browser(script, 'Synthetic11', {})
  assert.equal(unsupported.button.disabled, true)
  assert.equal(unsupported.error.hidden, false)
  for (const value of ['short', 'a'.repeat(129), 'Synthetic\n11', 'Synthetic\u007f11', 'Synthetic\ud80011']) {
    const state = browser(script, value)
    await state.submit()
    assert.equal(state.submitted, 0)
    assert.equal(state.credential.value, '')
    assert.equal(state.error.hidden, false)
  }
  const invalid = browser(script, 'Synthetic11')
  invalid.form.valid = false
  await invalid.submit()
  assert.equal(invalid.submitted, 0)
})

test('Unicode length uses code points and preserves the exact bytes of a long chosen password', async () => {
  const { script } = await page()
  const password = '😀'.repeat(128)
  const state = browser(script, password)
  await state.submit()
  assert.equal(state.submitted, 1)
  assert.equal(state.submittedCredential, pbkdf2Sync(password, Buffer.from(parameters.salt, 'base64url'), 600000, 32, 'sha256').toString('base64url'))
})

test('missing or invalid public parameters disable the form without reflecting untrusted values', async () => {
  for (const value of [undefined, { ...parameters, salt: 'B'.repeat(22) }, { ...parameters, salt: '</script><script>bad()</script>' }, { ...parameters, iterations: 1 }]) {
    const response = renderPinLoginPage(undefined, undefined, value as PasswordLoginParameters | undefined)
    const html = await response.text()
    assert.equal(response.status, 503)
    assert.doesNotMatch(html, /<script|bad\(\)/)
    assert.match(html, /required disabled/)
    assert.match(html, /id="login-submit" type="submit" disabled/)
  }
})
