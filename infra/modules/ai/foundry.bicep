@allowed([
  'attach'
  'create'
])
param mode string = 'attach'

param location string
param tags object = {}
param accountName string = ''
param projectName string = ''
param projectDisplayName string = ''
param projectDescription string = ''
param customSubDomainName string = ''
param deploymentName string = 'gpt-5-4-mini'
param deploymentSkuName string = 'GlobalStandard'
param deploymentCapacity int = 1
param modelFormat string = 'OpenAI'
param modelName string = 'gpt-5.4-mini'
param modelVersion string = 'latest'
param memoryStoreEndpointOrId string = ''
param attachEndpoint string = ''
param attachAccountResourceId string = ''
param attachProjectResourceId string = ''
param attachMemoryStoreEndpointOrId string = ''
param attachDeploymentName string = 'gpt-5-4-mini'

var shouldCreate = mode == 'create'
var normalizedProjectDisplayName = empty(projectDisplayName) ? projectName : projectDisplayName
var normalizedProjectDescription = empty(projectDescription)
  ? 'EchidnaClaw Foundry project for ${projectName}.'
  : projectDescription
var normalizedEndpoint = shouldCreate
  ? 'https://${customSubDomainName}.services.ai.azure.com/api/projects/${project.name}'
  : attachEndpoint

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = if (shouldCreate) {
  name: accountName
  location: location
  kind: 'AIServices'
  tags: tags
  sku: {
    name: 'S0'
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: customSubDomainName
    disableLocalAuth: false
    dynamicThrottlingEnabled: false
    publicNetworkAccess: 'Enabled'
    restrictOutboundNetworkAccess: false
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = if (shouldCreate) {
  parent: account
  name: projectName
  location: location
  tags: tags
  properties: {
    displayName: normalizedProjectDisplayName
    description: normalizedProjectDescription
  }
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = if (shouldCreate) {
  parent: account
  name: deploymentName
  properties: {
    model: {
      format: modelFormat
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
  sku: {
    name: deploymentSkuName
    capacity: deploymentCapacity
  }
}

output endpoint string = normalizedEndpoint
output memoryStoreEndpointOrId string = shouldCreate ? memoryStoreEndpointOrId : attachMemoryStoreEndpointOrId
output defaultModelDeploymentName string = shouldCreate ? deployment.name : attachDeploymentName
output accountResourceId string = shouldCreate ? account.id : attachAccountResourceId
output projectResourceId string = shouldCreate ? project.id : attachProjectResourceId
