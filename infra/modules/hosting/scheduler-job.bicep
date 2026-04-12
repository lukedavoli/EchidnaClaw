param name string
param location string
param tags object = {}
param managedEnvironmentResourceId string
param identityResourceId string
param containerRegistryLoginServer string
param image string
param cpu int
param memory string
param parallelism int = 1
param replicaCompletionCount int = 1
param replicaTimeoutSeconds int = 900
param replicaRetryLimit int = 1
param scheduleExpression string
param command array = []
param args array = []
param cosmosEndpoint string
param cosmosDatabaseName string
param storageAccountName string
param artifactsContainerName string
param keyVaultUri string
param credentialEncryptionKeyId string
param applicationInsightsConnectionString string
param foundryEndpoint string
param defaultModelDeploymentName string
param sandboxBaseUrl string
param secretReferences array = []

var envVars = [
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: applicationInsightsConnectionString
  }
  {
    name: 'ECHIDNA_JOB_KIND'
    value: 'scheduler'
  }
  {
    name: 'ECHIDNA_SCHEDULER_CRON'
    value: scheduleExpression
  }
  {
    name: 'ECHIDNA_COSMOS_ENDPOINT'
    value: cosmosEndpoint
  }
  {
    name: 'ECHIDNA_COSMOS_DATABASE'
    value: cosmosDatabaseName
  }
  {
    name: 'ECHIDNA_STORAGE_ACCOUNT'
    value: storageAccountName
  }
  {
    name: 'ECHIDNA_ARTIFACTS_CONTAINER'
    value: artifactsContainerName
  }
  {
    name: 'ECHIDNA_KEY_VAULT_URI'
    value: keyVaultUri
  }
  {
    name: 'ECHIDNA_CREDENTIAL_KEY_ID'
    value: credentialEncryptionKeyId
  }
  {
    name: 'ECHIDNA_FOUNDRY_ENDPOINT'
    value: foundryEndpoint
  }
  {
    name: 'ECHIDNA_FOUNDRY_MODEL_DEPLOYMENT'
    value: defaultModelDeploymentName
  }
  {
    name: 'ECHIDNA_SANDBOX_BASE_URL'
    value: sandboxBaseUrl
  }
]

var secretEnvVars = [
  for secretReference in secretReferences: {
    name: secretReference.envVarName
    secretRef: secretReference.secretName
  }
]

module base './container-job-base.bicep' = {
  name: '${name}-base'
  params: {
    triggerType: 'Schedule'
    name: name
    location: location
    tags: tags
    managedEnvironmentResourceId: managedEnvironmentResourceId
    identityResourceId: identityResourceId
    containerRegistryLoginServer: containerRegistryLoginServer
    image: image
    cpu: cpu
    memory: memory
    parallelism: parallelism
    replicaCompletionCount: replicaCompletionCount
    replicaTimeoutSeconds: replicaTimeoutSeconds
    replicaRetryLimit: replicaRetryLimit
    scheduleExpression: scheduleExpression
    command: command
    args: args
    envVars: envVars
    secretEnvVars: secretEnvVars
    secretRefs: secretReferences
  }
}

output jobName string = base.outputs.name
output resourceId string = base.outputs.id
output scheduleExpression string = scheduleExpression
