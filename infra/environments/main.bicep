targetScope = 'resourceGroup'

param environmentName string
param location string
param namePrefix string = 'ec'
param tags object

@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param containerRegistrySku string = 'Basic'

param logAnalyticsRetentionInDays int = 30
param cosmosDatabaseName string
param storageRetentionDays int = 14
param keyVaultKeyName string = 'credential-encryption'
param images object
param apiWorkload object
param sandboxWorkload object
param handsJobConfig object
param schedulerJobConfig object
param workloadBindings object = {
  api: []
  sandbox: []
  hands: []
  scheduler: []
}
param foundry object
param publicEdgeConfig object = {
  customDomainHostName: ''
  telegramWebhookPath: '/telegram/webhook'
}

var normalizedTags = union(tags, {
  project: 'echidna-claw'
  environment: environmentName
  'managed-by': 'bicep'
})

var uniqueSuffix = take(toLower(uniqueString(subscription().subscriptionId, resourceGroup().id, environmentName)), 5)
var projectCode = toLower(replace(namePrefix, '-', ''))
var envCode = toLower(replace(environmentName, '-', ''))
var compactGlobalNameSuffix = '${projectCode}${envCode}${uniqueSuffix}'
var uploadsContainerName = 'blob-uploads-${environmentName}'
var artifactsContainerName = 'blob-artifacts-${environmentName}'

var names = {
  acr: take('acr${compactGlobalNameSuffix}', 50)
  logAnalytics: 'law-ec-${environmentName}'
  appInsights: 'appi-ec-${environmentName}'
  containerAppsEnvironment: 'cae-ec-${environmentName}'
  apiIdentity: 'uai-api-${environmentName}'
  handsIdentity: 'uai-hands-${environmentName}'
  schedulerIdentity: 'uai-scheduler-${environmentName}'
  sandboxIdentity: 'uai-sandbox-${environmentName}'
  apiApp: 'aca-api-${environmentName}'
  sandboxApp: 'aca-sandbox-${environmentName}'
  handsJob: 'acj-hands-${environmentName}'
  schedulerJob: 'acj-scheduler-${environmentName}'
  cosmos: 'cos-ec-${environmentName}'
  storage: take('st${compactGlobalNameSuffix}', 24)
  keyVault: take('kv-ec-${environmentName}-${uniqueSuffix}', 24)
  foundryAccount: take('ais-ec-${environmentName}-${uniqueSuffix}', 64)
  foundryProject: 'aip-ec-${environmentName}'
}

module logAnalytics '../modules/foundation/log-analytics.bicep' = {
  name: 'foundation-log-analytics'
  params: {
    name: names.logAnalytics
    location: location
    tags: normalizedTags
    retentionInDays: logAnalyticsRetentionInDays
  }
}

module appInsights '../modules/foundation/app-insights.bicep' = {
  name: 'foundation-app-insights'
  params: {
    name: names.appInsights
    location: location
    tags: normalizedTags
    workspaceResourceId: logAnalytics.outputs.id
  }
}

module apiIdentity '../modules/foundation/managed-identity.bicep' = {
  name: 'foundation-api-identity'
  params: {
    name: names.apiIdentity
    location: location
    tags: normalizedTags
  }
}

module handsIdentity '../modules/foundation/managed-identity.bicep' = {
  name: 'foundation-hands-identity'
  params: {
    name: names.handsIdentity
    location: location
    tags: normalizedTags
  }
}

module schedulerIdentity '../modules/foundation/managed-identity.bicep' = {
  name: 'foundation-scheduler-identity'
  params: {
    name: names.schedulerIdentity
    location: location
    tags: normalizedTags
  }
}

module sandboxIdentity '../modules/foundation/managed-identity.bicep' = {
  name: 'foundation-sandbox-identity'
  params: {
    name: names.sandboxIdentity
    location: location
    tags: normalizedTags
  }
}

module containerRegistry '../modules/foundation/acr.bicep' = {
  name: 'foundation-container-registry'
  params: {
    name: names.acr
    location: location
    tags: normalizedTags
    sku: containerRegistrySku
    pullPrincipalIds: [
      apiIdentity.outputs.principalId
      handsIdentity.outputs.principalId
      schedulerIdentity.outputs.principalId
      sandboxIdentity.outputs.principalId
    ]
  }
}

module containerAppsEnvironment '../modules/foundation/container-apps-environment.bicep' = {
  name: 'foundation-container-apps-environment'
  params: {
    name: names.containerAppsEnvironment
    location: location
    tags: normalizedTags
    logAnalyticsCustomerId: logAnalytics.outputs.customerId
    logAnalyticsSharedKey: logAnalytics.outputs.primarySharedKey
  }
}

module cosmos '../modules/data/cosmos-account.bicep' = {
  name: 'data-cosmos'
  params: {
    name: names.cosmos
    location: location
    tags: normalizedTags
    databaseName: cosmosDatabaseName
    dataContributorPrincipalIds: [
      apiIdentity.outputs.principalId
      handsIdentity.outputs.principalId
      schedulerIdentity.outputs.principalId
    ]
  }
}

module storage '../modules/data/storage-account.bicep' = {
  name: 'data-storage'
  params: {
    name: names.storage
    location: location
    tags: normalizedTags
    uploadsContainerName: uploadsContainerName
    artifactsContainerName: artifactsContainerName
    retentionDays: storageRetentionDays
    contributorPrincipalIds: [
      apiIdentity.outputs.principalId
      handsIdentity.outputs.principalId
    ]
  }
}

module keyVault '../modules/data/key-vault.bicep' = {
  name: 'data-key-vault'
  params: {
    name: names.keyVault
    location: location
    tags: normalizedTags
    keyName: keyVaultKeyName
    secretReaderPrincipalIds: [
      apiIdentity.outputs.principalId
      handsIdentity.outputs.principalId
      schedulerIdentity.outputs.principalId
      sandboxIdentity.outputs.principalId
    ]
    cryptoUserPrincipalIds: [
      apiIdentity.outputs.principalId
      handsIdentity.outputs.principalId
      sandboxIdentity.outputs.principalId
    ]
  }
}

var foundryAccountName = empty(foundry.accountName) ? names.foundryAccount : foundry.accountName
var foundryProjectName = empty(foundry.projectName) ? names.foundryProject : foundry.projectName
var foundryCustomSubDomainName = empty(foundry.customSubDomainName)
  ? foundryAccountName
  : foundry.customSubDomainName

module foundryContract '../modules/ai/foundry.bicep' = {
  name: 'ai-foundry'
  params: {
    mode: foundry.mode
    location: location
    tags: normalizedTags
    accountName: foundryAccountName
    projectName: foundryProjectName
    projectDisplayName: foundry.projectDisplayName
    projectDescription: foundry.projectDescription
    customSubDomainName: foundryCustomSubDomainName
    deploymentName: foundry.deploymentName
    deploymentSkuName: foundry.deploymentSkuName
    deploymentCapacity: foundry.deploymentCapacity
    modelFormat: foundry.modelFormat
    modelName: foundry.modelName
    modelVersion: foundry.modelVersion
    memoryStoreEndpointOrId: foundry.memoryStoreEndpointOrId
    attachEndpoint: foundry.attachEndpoint
    attachAccountResourceId: foundry.attachAccountResourceId
    attachProjectResourceId: foundry.attachProjectResourceId
    attachMemoryStoreEndpointOrId: foundry.attachMemoryStoreEndpointOrId
    attachDeploymentName: foundry.attachDeploymentName
  }
}

var apiImage = '${containerRegistry.outputs.loginServer}/${images.api.repository}:${images.api.tag}'
var handsImage = '${containerRegistry.outputs.loginServer}/${images.hands.repository}:${images.hands.tag}'
var sandboxImage = '${containerRegistry.outputs.loginServer}/${images.sandbox.repository}:${images.sandbox.tag}'
var schedulerImage = '${containerRegistry.outputs.loginServer}/${images.scheduler.repository}:${images.scheduler.tag}'

module sandboxApp '../modules/hosting/sandbox-app.bicep' = {
  name: 'hosting-sandbox-app'
  params: {
    name: names.sandboxApp
    location: location
    tags: normalizedTags
    managedEnvironmentResourceId: containerAppsEnvironment.outputs.id
    identityResourceId: sandboxIdentity.outputs.id
    identityClientId: sandboxIdentity.outputs.clientId
    containerRegistryLoginServer: containerRegistry.outputs.loginServer
    image: sandboxImage
    cpu: sandboxWorkload.cpu
    memory: sandboxWorkload.memory
    minReplicas: sandboxWorkload.minReplicas
    maxReplicas: sandboxWorkload.maxReplicas
    targetPort: sandboxWorkload.targetPort
    cosmosEndpoint: cosmos.outputs.accountEndpoint
    cosmosDatabaseName: cosmos.outputs.databaseName
    blobAccountUrl: storage.outputs.blobEndpoint
    uploadsContainerName: storage.outputs.uploadsContainerName
    artifactsContainerName: storage.outputs.artifactsContainerName
    keyVaultUri: keyVault.outputs.vaultUri
    credentialEncryptionKeyId: keyVault.outputs.keyId
    applicationInsightsConnectionString: appInsights.outputs.connectionString
    foundryProjectName: foundryProjectName
    foundryEndpoint: foundryContract.outputs.endpoint
    defaultModelDeploymentName: foundryContract.outputs.defaultModelDeploymentName
    secretReferences: workloadBindings.sandbox
  }
}

module apiApp '../modules/hosting/api-app.bicep' = {
  name: 'hosting-api-app'
  params: {
    name: names.apiApp
    location: location
    tags: normalizedTags
    managedEnvironmentResourceId: containerAppsEnvironment.outputs.id
    identityResourceId: apiIdentity.outputs.id
    identityClientId: apiIdentity.outputs.clientId
    identityPrincipalId: apiIdentity.outputs.principalId
    containerRegistryLoginServer: containerRegistry.outputs.loginServer
    image: apiImage
    cpu: apiWorkload.cpu
    memory: apiWorkload.memory
    minReplicas: apiWorkload.minReplicas
    maxReplicas: apiWorkload.maxReplicas
    targetPort: apiWorkload.targetPort
    cosmosEndpoint: cosmos.outputs.accountEndpoint
    cosmosDatabaseName: cosmos.outputs.databaseName
    blobAccountUrl: storage.outputs.blobEndpoint
    uploadsContainerName: storage.outputs.uploadsContainerName
    artifactsContainerName: storage.outputs.artifactsContainerName
    keyVaultUri: keyVault.outputs.vaultUri
    credentialEncryptionKeyId: keyVault.outputs.keyId
    applicationInsightsConnectionString: appInsights.outputs.connectionString
    foundryProjectName: foundryProjectName
    foundryEndpoint: foundryContract.outputs.endpoint
    defaultModelDeploymentName: foundryContract.outputs.defaultModelDeploymentName
    sandboxBaseUrl: sandboxApp.outputs.internalUrl
    secretReferences: workloadBindings.api
  }
}

module handsJob '../modules/hosting/hands-job.bicep' = {
  name: 'hosting-hands-job'
  params: {
    name: names.handsJob
    location: location
    tags: normalizedTags
    managedEnvironmentResourceId: containerAppsEnvironment.outputs.id
    identityResourceId: handsIdentity.outputs.id
    identityClientId: handsIdentity.outputs.clientId
    containerRegistryLoginServer: containerRegistry.outputs.loginServer
    image: handsImage
    cpu: handsJobConfig.cpu
    memory: handsJobConfig.memory
    parallelism: handsJobConfig.parallelism
    replicaCompletionCount: handsJobConfig.replicaCompletionCount
    replicaTimeoutSeconds: handsJobConfig.timeoutSeconds
    replicaRetryLimit: handsJobConfig.retryLimit
    command: handsJobConfig.command
    args: handsJobConfig.args
    cosmosEndpoint: cosmos.outputs.accountEndpoint
    cosmosDatabaseName: cosmos.outputs.databaseName
    blobAccountUrl: storage.outputs.blobEndpoint
    uploadsContainerName: storage.outputs.uploadsContainerName
    artifactsContainerName: storage.outputs.artifactsContainerName
    keyVaultUri: keyVault.outputs.vaultUri
    credentialEncryptionKeyId: keyVault.outputs.keyId
    applicationInsightsConnectionString: appInsights.outputs.connectionString
    foundryProjectName: foundryProjectName
    foundryEndpoint: foundryContract.outputs.endpoint
    defaultModelDeploymentName: foundryContract.outputs.defaultModelDeploymentName
    sandboxBaseUrl: sandboxApp.outputs.internalUrl
    secretReferences: workloadBindings.hands
  }
}

module schedulerJob '../modules/hosting/scheduler-job.bicep' = {
  name: 'hosting-scheduler-job'
  params: {
    name: names.schedulerJob
    location: location
    tags: normalizedTags
    managedEnvironmentResourceId: containerAppsEnvironment.outputs.id
    identityResourceId: schedulerIdentity.outputs.id
    identityClientId: schedulerIdentity.outputs.clientId
    containerRegistryLoginServer: containerRegistry.outputs.loginServer
    image: schedulerImage
    cpu: schedulerJobConfig.cpu
    memory: schedulerJobConfig.memory
    parallelism: schedulerJobConfig.parallelism
    replicaCompletionCount: schedulerJobConfig.replicaCompletionCount
    replicaTimeoutSeconds: schedulerJobConfig.timeoutSeconds
    replicaRetryLimit: schedulerJobConfig.retryLimit
    scheduleExpression: schedulerJobConfig.scheduleExpression
    command: schedulerJobConfig.command
    args: schedulerJobConfig.args
    cosmosEndpoint: cosmos.outputs.accountEndpoint
    cosmosDatabaseName: cosmos.outputs.databaseName
    blobAccountUrl: storage.outputs.blobEndpoint
    uploadsContainerName: storage.outputs.uploadsContainerName
    artifactsContainerName: storage.outputs.artifactsContainerName
    keyVaultUri: keyVault.outputs.vaultUri
    credentialEncryptionKeyId: keyVault.outputs.keyId
    applicationInsightsConnectionString: appInsights.outputs.connectionString
    foundryProjectName: foundryProjectName
    foundryEndpoint: foundryContract.outputs.endpoint
    defaultModelDeploymentName: foundryContract.outputs.defaultModelDeploymentName
    sandboxBaseUrl: sandboxApp.outputs.internalUrl
    secretReferences: workloadBindings.scheduler
  }
}

module publicEdge '../modules/channel/public-edge-contract.bicep' = {
  name: 'channel-public-edge-contract'
  params: {
    apiBaseUrl: apiApp.outputs.baseUrl
    customDomainHostName: publicEdgeConfig.customDomainHostName
    telegramWebhookPath: publicEdgeConfig.telegramWebhookPath
  }
}

module diagnostics '../modules/observability/diagnostic-settings.bicep' = {
  name: 'observability-diagnostic-settings'
  params: {
    workspaceResourceId: logAnalytics.outputs.id
    containerAppsEnvironmentName: containerAppsEnvironment.outputs.name
    apiAppName: apiApp.outputs.appName
    sandboxAppName: sandboxApp.outputs.appName
    handsJobName: handsJob.outputs.jobName
    schedulerJobName: schedulerJob.outputs.jobName
    cosmosAccountName: cosmos.outputs.accountName
    storageAccountName: storage.outputs.accountName
    keyVaultName: keyVault.outputs.vaultName
    containerRegistryName: containerRegistry.outputs.name
  }
}

output apiBaseUrl string = publicEdge.outputs.resolvedApiBaseUrl
output sandboxInternalUrl string = sandboxApp.outputs.internalUrl
output containerRegistryLoginServer string = containerRegistry.outputs.loginServer
output cosmosEndpoint string = cosmos.outputs.accountEndpoint
output cosmosDatabaseName string = cosmos.outputs.databaseName
output storageAccountName string = storage.outputs.accountName
output uploadsContainerName string = storage.outputs.uploadsContainerName
output artifactsContainerName string = storage.outputs.artifactsContainerName
output blobEndpoint string = storage.outputs.blobEndpoint
output keyVaultUri string = keyVault.outputs.vaultUri
output credentialEncryptionKeyId string = keyVault.outputs.keyId
output applicationInsightsConnectionString string = appInsights.outputs.connectionString
output foundryEndpoint string = foundryContract.outputs.endpoint
output foundryMemoryStoreEndpointOrId string = foundryContract.outputs.memoryStoreEndpointOrId
output defaultModelDeploymentName string = foundryContract.outputs.defaultModelDeploymentName
output workloadIdentities object = {
  api: {
    clientId: apiIdentity.outputs.clientId
    principalId: apiIdentity.outputs.principalId
  }
  hands: {
    clientId: handsIdentity.outputs.clientId
    principalId: handsIdentity.outputs.principalId
  }
  scheduler: {
    clientId: schedulerIdentity.outputs.clientId
    principalId: schedulerIdentity.outputs.principalId
  }
  sandbox: {
    clientId: sandboxIdentity.outputs.clientId
    principalId: sandboxIdentity.outputs.principalId
  }
}
output handsJobName string = handsJob.outputs.jobName
output schedulerJobName string = schedulerJob.outputs.jobName
