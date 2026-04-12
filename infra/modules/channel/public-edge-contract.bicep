param apiBaseUrl string
param telegramWebhookPath string = '/telegram/webhook'
param customDomainHostName string = ''

var publicApiBaseUrl = empty(customDomainHostName) ? apiBaseUrl : 'https://${customDomainHostName}'
var apiHostname = replace(replace(publicApiBaseUrl, 'https://', ''), 'http://', '')

output resolvedApiBaseUrl string = publicApiBaseUrl
output resolvedApiHostname string = apiHostname
output telegramWebhookUrl string = '${publicApiBaseUrl}${telegramWebhookPath}'
