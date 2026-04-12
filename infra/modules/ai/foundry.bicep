targetScope = 'resourceGroup'

@description('Azure region for any Foundry resources created by this module.')
param location string

@description('Common tags applied to any Foundry resources created by this module.')
param tags object = {}

@allowed([
  'attach'
  'create'
])
@description('Whether to attach to existing Foundry resources or create new ones in this resource group.')
param foundryMode string = 'attach'

@minLength(2)
@description('Azure AI Foundry account name.')
param foundryAccountName string

@minLength(2)
@description('Azure AI Foundry project name.')
param foundryProjectName string

@description('Optional display name for the Foundry project. Defaults to the project name.')
param foundryProjectDisplayName string = ''

@description('Optional description for the Foundry project.')
param foundryProjectDescription string = ''

@description('Optional override for the Foundry account resource ID when attach mode targets a different subscription or resource group.')
param foundryAccountResourceId string = ''

@description('Optional override for the Foundry project resource ID when attach mode targets a different subscription or resource group.')
param foundryProjectResourceId string = ''

@description('Optional override for the Foundry project endpoint. Defaults to the standard project URI pattern.')
param foundryProjectEndpoint string = ''

@description('Optional override for the Foundry model inference endpoint. Defaults to the standard model endpoint URI pattern.')
param foundryModelInferenceEndpoint string = ''

@minLength(1)
@description('Logical name of the memory store contract EchidnaClaw uses within the Foundry project.')
param foundryMemoryStoreName string = 'echidna-memory'

@description('Optional override for the Foundry Memory Store endpoint-or-id contract.')
param foundryMemoryStoreEndpointOrId string = ''

@description('Optional override for the custom subdomain used by the Azure AI Services account in create mode.')
param foundryCustomSubdomainName string = ''

@description('SKU for the Azure AI Services account in create mode.')
param foundryAccountSkuName string = 'S0'

@description('Whether local key-based auth is disabled on the account in create mode.')
param foundryDisableLocalAuth bool = true

@description('Whether dynamic throttling is enabled on the account in create mode.')
param foundryDynamicThrottlingEnabled bool = false

@description('Whether outbound network restrictions are enabled on the account in create mode.')
param foundryRestrictOutboundNetworkAccess bool = false

@description('Whether create mode should also provision the default model deployment contract.')
param deployDefaultModel bool = false

@minLength(1)
@description('Deployment name used by EchidnaClaw for the default model contract.')
param defaultModelDeploymentName string = 'gpt-5.4-mini'

@minLength(1)
@description('Underlying model name used for the default model contract.')
param defaultModelName string = 'gpt-5.4-mini'

@description('Optional publisher for the default model contract.')
param defaultModelPublisher string = ''

@minLength(1)
@description('Model format used by the default model contract.')
param defaultModelFormat string = 'OpenAI'

@description('Optional explicit model version for the default model contract.')
param defaultModelVersion string = ''

@description('SKU name for the default model deployment created in create mode.')
param defaultModelSkuName string = 'GlobalStandard'

@minValue(1)
@description('SKU capacity for the default model deployment created in create mode.')
param defaultModelSkuCapacity int = 1

@allowed([
  'Default'
  'Priority'
])
@description('Service tier for the default model deployment created in create mode.')
param defaultModelServiceTier string = 'Default'

@allowed([
  'NoAutoUpgrade'
  'OnceCurrentVersionExpired'
  'OnceNewDefaultVersionAvailable'
])
@description('Version upgrade policy for the default model deployment created in create mode.')
param defaultModelVersionUpgradeOption string = 'NoAutoUpgrade'

var effectiveProjectDisplayName = empty(foundryProjectDisplayName) ? foundryProjectName : foundryProjectDisplayName
var effectiveProjectDescription = empty(foundryProjectDescription) ? 'Azure AI Foundry project contract for EchidnaClaw.' : foundryProjectDescription
var effectiveCustomSubdomainName = empty(foundryCustomSubdomainName) ? toLower(replace(foundryAccountName, '_', '-')) : foundryCustomSubdomainName
var defaultProjectEndpoint = 'https://${foundryAccountName}.services.ai.azure.com/api/projects/${foundryProjectName}'
var defaultModelEndpoint = 'https://${foundryAccountName}.services.ai.azure.com/models'
var effectiveProjectEndpoint = empty(foundryProjectEndpoint) ? defaultProjectEndpoint : foundryProjectEndpoint
var effectiveModelInferenceEndpoint = empty(foundryModelInferenceEndpoint) ? defaultModelEndpoint : foundryModelInferenceEndpoint
var effectiveMemoryStoreEndpointOrId = empty(foundryMemoryStoreEndpointOrId) ? '${effectiveProjectEndpoint}/memory_stores/${foundryMemoryStoreName}' : foundryMemoryStoreEndpointOrId

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' = if (foundryMode == 'create') {
  name: foundryAccountName
  location: location
  kind: 'AIServices'
  sku: {
    name: foundryAccountSkuName
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: effectiveCustomSubdomainName
    disableLocalAuth: foundryDisableLocalAuth
    dynamicThrottlingEnabled: foundryDynamicThrottlingEnabled
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: foundryRestrictOutboundNetworkAccess
  }
  tags: tags
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = if (foundryMode == 'create') {
  parent: foundryAccount
  name: foundryProjectName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: effectiveProjectDisplayName
    description: effectiveProjectDescription
  }
  tags: tags
}

resource defaultModelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-12-01' = if (foundryMode == 'create' && deployDefaultModel) {
  parent: foundryAccount
  name: defaultModelDeploymentName
  sku: {
    name: defaultModelSkuName
    capacity: defaultModelSkuCapacity
  }
  properties: union({
    deploymentState: 'Running'
    model: union({
      format: defaultModelFormat
      name: defaultModelName
    }, empty(defaultModelPublisher) ? {} : {
      publisher: defaultModelPublisher
    }, empty(defaultModelVersion) ? {} : {
      version: defaultModelVersion
    })
    serviceTier: defaultModelServiceTier
    versionUpgradeOption: defaultModelVersionUpgradeOption
  }, {})
  tags: tags
}

var effectiveFoundryAccountResourceId = foundryMode == 'create'
  ? foundryAccount.id
  : (empty(foundryAccountResourceId) ? resourceId('Microsoft.CognitiveServices/accounts', foundryAccountName) : foundryAccountResourceId)

var effectiveFoundryProjectResourceId = foundryMode == 'create'
  ? foundryProject.id
  : (empty(foundryProjectResourceId) ? resourceId('Microsoft.CognitiveServices/accounts/projects', foundryAccountName, foundryProjectName) : foundryProjectResourceId)

var defaultModelDeploymentResourceId = foundryMode == 'create' && deployDefaultModel
  ? defaultModelDeployment.id
  : resourceId('Microsoft.CognitiveServices/accounts/deployments', foundryAccountName, defaultModelDeploymentName)

output mode string = foundryMode
output foundryAccountName string = foundryAccountName
output foundryAccountResourceId string = effectiveFoundryAccountResourceId
output foundryProjectName string = foundryProjectName
output foundryProjectResourceId string = effectiveFoundryProjectResourceId
output foundryEndpoint string = effectiveProjectEndpoint
output foundryModelInferenceEndpoint string = effectiveModelInferenceEndpoint
output foundryMemoryStoreName string = foundryMemoryStoreName
output foundryMemoryStoreEndpointOrId string = effectiveMemoryStoreEndpointOrId
output defaultModelDeploymentName string = defaultModelDeploymentName
output defaultModelDeploymentResourceId string = defaultModelDeploymentResourceId
output defaultModelDeploymentProvisioned bool = foundryMode == 'create' && deployDefaultModel
output defaultModelContract object = {
  deploymentName: defaultModelDeploymentName
  modelName: defaultModelName
  modelFormat: defaultModelFormat
  modelPublisher: defaultModelPublisher
  modelVersion: defaultModelVersion
  skuName: defaultModelSkuName
  skuCapacity: defaultModelSkuCapacity
  serviceTier: defaultModelServiceTier
  versionUpgradeOption: defaultModelVersionUpgradeOption
}
