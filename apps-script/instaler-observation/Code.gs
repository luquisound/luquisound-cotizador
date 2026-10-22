/* Standalone administrative script. Install its daily trigger only after review. */
var INSTALER_MAX_XLSX_BYTES_ = 3 * 1024 * 1024;
var INSTALER_RECEIVER_URL_ = 'https://ls-cotizador.vercel.app/api/instaler-observation';
var INSTALER_XLSX_MIME_ = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var INSTALER_FAILURE_CODES_ = [
  'configuration', 'oauth', 'access', 'account-mismatch', 'source-invalid',
  'source-changed', 'network', 'rate-limited'
];

function observeInstalerDaily() {
  var properties = PropertiesService.getScriptProperties();
  var mode = properties.getProperty('INSTALER_OBSERVATION_MODE');
  if (!mode || mode === 'disabled') return { status: 'disabled' };
  var config;
  try {
    config = instalerConfig_(properties, mode);
  } catch (error) {
    instalerLog_('failed', 'configuration');
    throw instalerFailure_('configuration');
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { status: 'busy' };
  try {
    var day = new Date().toISOString().slice(0, 10);
    if (properties.getProperty('INSTALER_LAST_ATTEMPT_UTC') === day) {
      return { status: 'already-attempted' };
    }
    // Claim before contacting Drive: failures and interrupted sends are not retried today.
    try {
      properties.setProperty('INSTALER_LAST_ATTEMPT_UTC', day);
    } catch (error) {
      instalerLog_('failed', 'configuration');
      throw instalerFailure_('configuration');
    }
    var result;
    try {
      result = instalerReadDrive_(config);
    } catch (error) {
      result = { status: 'failed', error: instalerErrorCode_(error) };
    }
    var payload = {
      format: 'luquisound.instaler-observation-upload', version: 1, mode: 'observe',
      fileId: config.fileId, account: config.expectedEmail,
      readAt: new Date().toISOString(), result: result
    };
    var received;
    try {
      received = instalerSend_(config, payload);
    } catch (error) {
      instalerLog_('failed', 'receiver');
      throw instalerFailure_('receiver');
    }
    if (result.status === 'failed' || received.status === 'failed') {
      var code = result.status === 'failed' ? result.error : received.error;
      instalerLog_('failed', code);
      throw instalerFailure_(code);
    }
    instalerLog_(received.status);
    return { status: received.status };
  } finally {
    lock.releaseLock();
  }
}

function instalerConfig_(properties, mode) {
  var fileId = properties.getProperty('INSTALER_DRIVE_FILE_ID');
  var email = properties.getProperty('INSTALER_GOOGLE_EXPECTED_EMAIL');
  var secret = properties.getProperty('INSTALER_OBSERVATION_INGEST_SECRET');
  var bypass = properties.getProperty('VERCEL_AUTOMATION_BYPASS_SECRET');
  var url = properties.getProperty('INSTALER_OBSERVATION_URL');
  if (mode !== 'observe' || url !== INSTALER_RECEIVER_URL_
    || typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId)
    || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)
    || typeof bypass !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(bypass)) {
    throw instalerFailure_('configuration');
  }
  return { fileId: fileId, expectedEmail: email.trim().toLowerCase(), secret: secret, bypass: bypass, url: url };
}

function instalerReadDrive_(config) {
  var token;
  try { token = ScriptApp.getOAuthToken(); } catch (error) { throw instalerFailure_('oauth'); }
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw instalerFailure_('oauth');
  var about = instalerGoogleJson_('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', token);
  if (!about.user || typeof about.user.emailAddress !== 'string'
    || about.user.emailAddress.trim().toLowerCase() !== config.expectedEmail) {
    throw instalerFailure_('account-mismatch');
  }
  var path = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(config.fileId);
  var fields = 'id,name,mimeType,size,md5Checksum,modifiedTime,version,capabilities(canDownload)';
  var metadataUrl = path + '?fields=' + encodeURIComponent(fields);
  var before = instalerMetadata_(instalerGoogleJson_(metadataUrl, token), config.fileId);
  var response = instalerGoogleResponse_(path + '?alt=media', token);
  var contentType = instalerContentType_(response);
  if (contentType !== INSTALER_XLSX_MIME_ && contentType !== 'application/octet-stream') {
    throw instalerFailure_('source-invalid');
  }
  var bytes = response.getBlob().getBytes();
  if (!bytes.length || bytes.length > INSTALER_MAX_XLSX_BYTES_ || String(bytes.length) !== before.size) {
    throw instalerFailure_('source-invalid');
  }
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes);
  var checksum = digest.map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
  if (checksum !== before.md5Checksum) throw instalerFailure_('source-invalid');
  var after = instalerMetadata_(instalerGoogleJson_(metadataUrl, token), config.fileId);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw instalerFailure_('source-changed');
  return { status: 'ok', metadata: before, bytesBase64: Utilities.base64Encode(bytes) };
}

function instalerMetadata_(value, fileId) {
  if (!value || value.id !== fileId || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 500
    || value.mimeType !== INSTALER_XLSX_MIME_
    || typeof value.size !== 'string' || !/^[1-9]\d*$/.test(value.size)
    || Number(value.size) > INSTALER_MAX_XLSX_BYTES_
    || typeof value.md5Checksum !== 'string' || !/^[a-f0-9]{32}$/i.test(value.md5Checksum)
    || typeof value.modifiedTime !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value.modifiedTime)
    || !Number.isFinite(Date.parse(value.modifiedTime))
    || typeof value.version !== 'string' || !/^\d{1,20}$/.test(value.version)) {
    throw instalerFailure_('source-invalid');
  }
  if (!value.capabilities || value.capabilities.canDownload !== true) throw instalerFailure_('access');
  return {
    id: value.id, name: value.name, mimeType: value.mimeType, size: value.size,
    md5Checksum: value.md5Checksum.toLowerCase(), modifiedTime: value.modifiedTime,
    version: value.version, capabilities: { canDownload: true }
  };
}

function instalerGoogleResponse_(url, token) {
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get', headers: { Authorization: 'Bearer ' + token },
      followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true
    });
  } catch (error) { throw instalerFailure_('network'); }
  var status = response.getResponseCode();
  if (status === 401) throw instalerFailure_('oauth');
  if (status === 403 || (status >= 300 && status < 400) || status === 404) throw instalerFailure_('access');
  if (status === 429) throw instalerFailure_('rate-limited');
  if (status !== 200) throw instalerFailure_('network');
  return response;
}

function instalerGoogleJson_(url, token) {
  var response = instalerGoogleResponse_(url, token);
  if (instalerContentType_(response) !== 'application/json') throw instalerFailure_('source-invalid');
  var value;
  try {
    var body = response.getContentText();
    if (body.length > 64 * 1024) throw instalerFailure_('source-invalid');
    value = JSON.parse(body);
  } catch (error) { throw instalerFailure_('source-invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw instalerFailure_('source-invalid');
  return value;
}

function instalerSend_(config, payload) {
  var response = UrlFetchApp.fetch(config.url, {
    method: 'post', contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + config.secret, 'x-vercel-protection-bypass': config.bypass },
    payload: JSON.stringify(payload),
    followRedirects: false, muteHttpExceptions: true, validateHttpsCertificates: true
  });
  var status = response.getResponseCode();
  if ((status !== 200 && status !== 502) || instalerContentType_(response) !== 'application/json') {
    throw instalerFailure_('receiver');
  }
  var body = response.getContentText();
  if (body.length > 16 * 1024) throw instalerFailure_('receiver');
  var result = JSON.parse(body);
  if (!result || result.mode !== 'observe' || result.publicationAllowed !== false
    || result.supplierFreshnessEstablished !== false) throw instalerFailure_('receiver');
  if (status === 502 && result.status === 'failed' && INSTALER_FAILURE_CODES_.indexOf(result.error) !== -1) return result;
  if (status !== 200 || ['baseline', 'changed', 'unchanged', 'busy', 'already-attempted'].indexOf(result.status) === -1
    || payload.result.status === 'failed') throw instalerFailure_('receiver');
  return result;
}

function instalerContentType_(response) {
  var headers = response.getAllHeaders();
  var names = Object.keys(headers);
  for (var index = 0; index < names.length; index++) {
    if (names[index].toLowerCase() === 'content-type' && typeof headers[names[index]] === 'string') {
      return headers[names[index]].split(';')[0].trim().toLowerCase();
    }
  }
  return '';
}

function instalerFailure_(code) {
  var error = new Error('Instaler observation failed (' + code + ').');
  error.instalerCode = code;
  return error;
}

function instalerErrorCode_(error) {
  return error && INSTALER_FAILURE_CODES_.indexOf(error.instalerCode) !== -1 ? error.instalerCode : 'network';
}

function instalerLog_(status, error) {
  var event = {
    event: 'instaler-observation', mode: 'observe', publicationAllowed: false,
    supplierFreshnessEstablished: false, status: status
  };
  if (error) event.error = error;
  console.log(JSON.stringify(event));
}
