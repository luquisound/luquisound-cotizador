import type { PasswordLoginParameters } from './pin-auth.ts'
import { LOGIN_BRAND_SVG } from './login-brand.ts'

const loginBrand = LOGIN_BRAND_SVG.replace('<svg ', '<svg role="img" aria-label="Luquisound" ')

type PinLoginError = 'invalid' | 'rate-limit' | 'unavailable'

function errorMessage(error: PinLoginError | undefined): string {
  if (error === 'invalid') return 'Contraseña incorrecta. Revisala e intentá de nuevo.'
  if (error === 'rate-limit') return 'Esperá un momento antes de volver a intentar.'
  if (error === 'unavailable') return 'No se pudo ingresar. Intentá de nuevo más tarde.'
  return ''
}

function validParameters(value: PasswordLoginParameters | undefined): value is PasswordLoginParameters {
  if (!value || value.iterations !== 600000 || !/^[A-Za-z0-9_-]{22}$/.test(value.salt)) return false
  const bytes = atob(value.salt.replace(/-/g, '+').replace(/_/g, '/') + '==')
  return bytes.length === 16 && btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value.salt
}

export function renderPinLoginPage(error?: PinLoginError, status?: number, parameters?: PasswordLoginParameters): Response {
  const ready = validParameters(parameters)
  const message = errorMessage(ready ? error : 'unavailable')
  const responseStatus = status ?? (!ready ? 503 : error === 'invalid' ? 401 : error === 'rate-limit' ? 429 : error === 'unavailable' ? 503 : 200)
  const nonce = ready ? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))) : ''
  const script = ready ? `<script nonce="${nonce}">
(() => {
  const parameters = ${JSON.stringify(parameters)};
  const form = document.getElementById('login-form');
  const password = document.getElementById('password');
  const credential = document.getElementById('credential');
  const button = document.getElementById('login-submit');
  const error = document.getElementById('password-error');
  let busy = false;
  const fail = () => {
    credential.value = '';
    error.textContent = 'No se pudo ingresar. Intentá de nuevo más tarde.';
    error.hidden = false;
  };
  if (!globalThis.crypto?.subtle) { fail(); return; }
  button.disabled = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const entered = password.value;
    const characters = Array.from(entered);
    if (characters.length < 11 || characters.length > 128 || characters.some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127 || (code >= 55296 && code <= 57343);
    })) {
      error.textContent = 'Usá entre 11 y 128 caracteres, sin saltos de línea.';
      error.hidden = false;
      return;
    }
    busy = true;
    credential.value = '';
    button.disabled = true;
    button.textContent = 'Ingresando…';
    form.setAttribute('aria-busy', 'true');
    error.hidden = true;
    try {
      const salt = Uint8Array.from(atob(parameters.salt.replace(/-/g, '+').replace(/_/g, '/') + '=='), (character) => character.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(entered), 'PBKDF2', false, ['deriveBits']);
      const result = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: parameters.iterations }, key, 256));
      credential.value = btoa(String.fromCharCode(...result)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      password.value = '';
      HTMLFormElement.prototype.submit.call(form);
    } catch {
      fail();
      busy = false;
      button.disabled = false;
      button.textContent = 'Ingresar';
      form.removeAttribute('aria-busy');
    }
  });
})();
</script>` : ''
  const html = `<!doctype html>
<html lang="es-AR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <title>Ingresar al cotizador | Luquisound</title>
  <style>
    html { box-sizing: border-box; color-scheme: light; }
    *, *::before, *::after { box-sizing: inherit; }
    body {
      margin: 0;
      min-height: 100svh;
      display: grid;
      place-items: center;
      padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
      background: #edece8;
      color: #171717;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
      -webkit-text-size-adjust: 100%;
    }
    main {
      width: min(100%, 420px);
      min-width: 0;
      padding: clamp(24px, 5vw, 40px);
      border: 1px solid #d8d7d0;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 8px 32px #0000000a;
    }
    .brand { width: min(100%, 260px); margin: 0 0 28px; }
    .brand svg { display: block; width: 100%; height: auto; }
    h1 { margin: 0 0 28px; font-size: clamp(25px, 6vw, 30px); line-height: 1.2; letter-spacing: -.035em; overflow-wrap: anywhere; }
    label { display: block; margin-bottom: 8px; font-size: 15px; font-weight: 650; }
    input[type="password"] {
      display: block;
      width: 100%;
      min-width: 0;
      min-height: 56px;
      padding: 10px 16px;
      border: 2px solid #b9b8af;
      border-radius: 8px;
      background: #fff;
      color: #171717;
      font: inherit;
      font-size: 18px;
      line-height: 1.25;
      letter-spacing: .05em;
      text-align: left;
    }
    input::placeholder { color: #74746d; font-size: 16px; letter-spacing: normal; }
    input:focus-visible, button:focus-visible { outline: 3px solid #171717; outline-offset: 3px; }
    .error { margin: 16px 0 0; padding: 12px; border-left: 4px solid #ffda00; background: #f5f4ef; font-size: 14px; }
    [hidden] { display: none; }
    button {
      width: 100%;
      min-height: 52px;
      margin-top: 24px;
      padding: 12px 16px;
      border: 1px solid #ffda00;
      border-radius: 8px;
      background: #ffda00;
      color: #171717;
      font: inherit;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      touch-action: manipulation;
    }
    button:hover { background: #ffe340; }
    button:active { background: #f0ce00; }
    .remember { margin: 20px 0 0; color: #62625c; font-size: 13px; text-align: center; }
  </style>
</head>
<body>
  <main aria-labelledby="login-title">
    <div class="brand">${loginBrand}</div>
    <h1 id="login-title">Ingresá al cotizador</h1>
    <form id="login-form" action="/login" method="post">
      <label for="password">Contraseña de acceso</label>
      <input id="password" type="password" minlength="11" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" autofocus required${ready ? '' : ' disabled'} placeholder="Ingresá tu contraseña" aria-invalid="${error === 'invalid' ? 'true' : 'false'}" aria-describedby="password-error">
      <input id="credential" name="credential" type="hidden" value="">
      <div aria-live="polite" aria-atomic="true"><p id="password-error" class="error" role="alert"${message ? '' : ' hidden'}>${message}</p></div>
      <button id="login-submit" type="submit" disabled>Ingresar</button>
      <noscript><p class="error">Activá JavaScript en este navegador para ingresar.</p></noscript>
    </form>
    <p class="remember">Tu acceso queda recordado durante 30 días en este navegador.</p>
  </main>
  ${script}
</body>
</html>`

  return new Response(html, {
    status: responseStatus,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; ${ready ? `script-src 'nonce-${nonce}'; ` : ''}form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'same-origin',
    },
  })
}
