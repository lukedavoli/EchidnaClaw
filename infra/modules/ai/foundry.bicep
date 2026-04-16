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
param memoryEmbeddingDeploymentName string = 'dep-text-embedding-3-small'
param memoryEmbeddingDeploymentSkuName string = 'GlobalStandard'
param memoryEmbeddingDeploymentCapacity int = 1
param memoryEmbeddingModelFormat string = 'OpenAI'
param memoryEmbeddingModelName string = 'text-embedding-3-small'
param memoryEmbeddingModelVersion string = '1'
param memoryStoreEndpointOrId string = ''
param attachEndpoint string = ''
param attachAccountResourceId string = ''
param attachProjectResourceId string = ''
param attachMemoryStoreEndpointOrId string = ''
param attachDeploymentName string = 'gpt-5-4-mini'
param attachMemoryChatDeploymentName string = ''
param attachMemoryEmbeddingDeploymentName string = ''

var shouldCreate = mode == 'create'
var normalizedEndpoint = shouldCreate
  ? 'https://${customSubDomainName}.services.ai.azure.com/api/projects/${project.name}'
  : attachEndpoint
var cognitiveServicesOpenAiUserRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
)

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = if (shouldCreate) {
  name: accountName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
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
  identity: {
    type: 'SystemAssigned'
  }
  tags: tags
  properties: {}
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

resource memoryEmbeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = if (shouldCreate) {
  parent: account
  name: memoryEmbeddingDeploymentName
  properties: {
    model: {
      format: memoryEmbeddingModelFormat
      name: memoryEmbeddingModelName
      version: memoryEmbeddingModelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
  sku: {
    name: memoryEmbeddingDeploymentSkuName
    capacity: memoryEmbeddingDeploymentCapacity
  }
}

resource accountOpenAiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (shouldCreate) {
  scope: account!
  name: guid(account!.id, 'foundry-account-openai-user')
  properties: {
    principalId: account!.identity.principalId!
    principalType: 'ServicePrincipal'
    roleDefinitionId: cognitiveServicesOpenAiUserRoleDefinitionId
  }
}

resource projectOpenAiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (shouldCreate) {
  scope: account!
  name: guid(account!.id, project!.name, 'foundry-project-openai-user')
  properties: {
    principalId: project!.identity.principalId!
    principalType: 'ServicePrincipal'
    roleDefinitionId: cognitiveServicesOpenAiUserRoleDefinitionId
  }
}

output endpoint string = normalizedEndpoint
output memoryStoreEndpointOrId string = shouldCreate ? memoryStoreEndpointOrId : attachMemoryStoreEndpointOrId
output defaultModelDeploymentName string = shouldCreate ? deployment.name : attachDeploymentName
output memoryChatDeploymentName string = shouldCreate
  ? deployment.name
  : empty(attachMemoryChatDeploymentName)
    ? attachDeploymentName
    : attachMemoryChatDeploymentName
output memoryEmbeddingDeploymentName string = shouldCreate
  ? memoryEmbeddingDeployment.name
  : attachMemoryEmbeddingDeploymentName
output accountResourceId string = shouldCreate ? account.id : attachAccountResourceId
output projectResourceId string = shouldCreate ? project.id : attachProjectResourceId
