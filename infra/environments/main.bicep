targetScope = 'resourceGroup'

@minLength(1)
@description('Deployment environment name.')
param environmentName string

@description('Azure region for resources created by this template.')
param location string = resourceGroup().location

@minLength(1)
@description('Shared resource naming prefix, for example ec-dev.')
param namePrefix string

@description('Standard deployment tags.')
param tags object = {}

@allowed([
  'attach'
  'create'
])
@description('Whether to attach to an existing Foundry stack or create one in this resource group.')
param foundryMode string = 'attach'

@minLength(2)
@description('Azure AI Foundry account name.')
param foundryAccountName string

@minLength(2)
@description('Azure AI Foundry project name.')
param foundryProjectName string

@description('Optional display name for the Foundry project. Defaults to a generated name when empty.')
param foundryProjectDisplayName string = ''

@description('Optional description for the Foundry project.')
param foundryProjectDescription string = ''

@description('Optional override for the Foundry account resource ID in attach mode.')
param foundryAccountResourceId string = ''

@description('Optional override for the Foundry project resource ID in attach mode.')
param foundryProjectResourceId string = ''

@description('Optional override for the Foundry project endpoint in attach mode.')
param foundryProjectEndpoint string = ''

@description('Optional override for the Foundry model inference endpoint in attach mode.')
param foundryModelInferenceEndpoint string = ''

@description('Logical memory store name used by the platform.')
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

@description('Whether create mode should also provision the default gpt-5.4-mini deployment contract.')
param deployDefaultModel bool = false

@description('Deployment name used by EchidnaClaw for the default model contract.')
param defaultModelDeploymentName string = 'gpt-5.4-mini'

@description('Underlying model name used for the default model contract.')
param defaultModelName string = 'gpt-5.4-mini'

@description('Optional publisher for the default model contract.')
param defaultModelPublisher string = ''

@description('Model format used by the default model contract.')
param defaultModelFormat string = 'OpenAI'

@description('Optional explicit version for the default model contract.')
param defaultModelVersion string = ''

@description('SKU name for the default model deployment created in create mode.')
param defaultModelSkuName string = 'GlobalStandard'

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

var effectiveTags = union({
  project: 'echidna-claw'
  environment: environmentName
  'managed-by': 'bicep'
}, tags)

var effectiveFoundryProjectDisplayName = empty(foundryProjectDisplayName) ? 'EchidnaClaw ${toUpper(environmentName)}' : foundryProjectDisplayName
var effectiveFoundryProjectDescription = empty(foundryProjectDescription) ? 'Azure AI Foundry contract for the ${environmentName} EchidnaClaw environment.' : foundryProjectDescription
var effectiveFoundryCustomSubdomainName = empty(foundryCustomSubdomainName) ? '${replace(toLower(namePrefix), '-', '')}foundry' : foundryCustomSubdomainName

module foundry '../modules/ai/foundry.bicep' = {
  name: '${namePrefix}-foundry-contract'
  params: {
    location: location
    tags: effectiveTags
    foundryMode: foundryMode
    foundryAccountName: foundryAccountName
    foundryProjectName: foundryProjectName
    foundryProjectDisplayName: effectiveFoundryProjectDisplayName
    foundryProjectDescription: effectiveFoundryProjectDescription
    foundryAccountResourceId: foundryAccountResourceId
    foundryProjectResourceId: foundryProjectResourceId
    foundryProjectEndpoint: foundryProjectEndpoint
    foundryModelInferenceEndpoint: foundryModelInferenceEndpoint
    foundryMemoryStoreName: foundryMemoryStoreName
    foundryMemoryStoreEndpointOrId: foundryMemoryStoreEndpointOrId
    foundryCustomSubdomainName: effectiveFoundryCustomSubdomainName
    foundryAccountSkuName: foundryAccountSkuName
    foundryDisableLocalAuth: foundryDisableLocalAuth
    foundryDynamicThrottlingEnabled: foundryDynamicThrottlingEnabled
    foundryRestrictOutboundNetworkAccess: foundryRestrictOutboundNetworkAccess
    deployDefaultModel: deployDefaultModel
    defaultModelDeploymentName: defaultModelDeploymentName
    defaultModelName: defaultModelName
    defaultModelPublisher: defaultModelPublisher
    defaultModelFormat: defaultModelFormat
    defaultModelVersion: defaultModelVersion
    defaultModelSkuName: defaultModelSkuName
    defaultModelSkuCapacity: defaultModelSkuCapacity
    defaultModelServiceTier: defaultModelServiceTier
    defaultModelVersionUpgradeOption: defaultModelVersionUpgradeOption
  }
}

output environment string = environmentName
output foundryMode string = foundry.outputs.mode
output foundryAccountName string = foundry.outputs.foundryAccountName
output foundryAccountResourceId string = foundry.outputs.foundryAccountResourceId
output foundryProjectName string = foundry.outputs.foundryProjectName
output foundryProjectResourceId string = foundry.outputs.foundryProjectResourceId
output foundryEndpoint string = foundry.outputs.foundryEndpoint
output foundryModelInferenceEndpoint string = foundry.outputs.foundryModelInferenceEndpoint
output foundryMemoryStoreName string = foundry.outputs.foundryMemoryStoreName
output foundryMemoryStoreEndpointOrId string = foundry.outputs.foundryMemoryStoreEndpointOrId
output defaultModelDeploymentName string = foundry.outputs.defaultModelDeploymentName
output defaultModelDeploymentResourceId string = foundry.outputs.defaultModelDeploymentResourceId
output defaultModelDeploymentProvisioned bool = foundry.outputs.defaultModelDeploymentProvisioned
output defaultModelContract object = foundry.outputs.defaultModelContract
