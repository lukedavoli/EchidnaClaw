param name string
param location string
param tags object = {}
param managedEnvironmentResourceId string
param identityResourceId string
param identityClientId string
param containerRegistryLoginServer string
param image string
param cpu int
param memory string
param minReplicas int = 0
param maxReplicas int = 1
param cosmosEndpoint string
param cosmosDatabaseName string
param blobAccountUrl string
param uploadsContainerName string
param artifactsContainerName string
param keyVaultUri string
param credentialEncryptionKeyId string
param applicationInsightsConnectionString string
param foundryProjectName string
param foundryEndpoint string
param defaultModelDeploymentName string
param targetPort int = 8080
param secretReferences array = []

var envVars = [
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: applicationInsightsConnectionString
  }
  {
    name: 'ECHIDNA_MONITOR_CONNECTION_STRING'
    value: applicationInsightsConnectionString
  }
  {
    name: 'AZURE_CLIENT_ID'
    value: identityClientId
  }
  {
    name: 'ECHIDNA_SANDBOX_HOST'
    value: '0.0.0.0'
  }
  {
    name: 'ECHIDNA_SANDBOX_PORT'
    value: targetPort
  }
  {
    name: 'ECHIDNA_SANDBOX_WORKSPACE_ROOT'
    value: '/tmp/echidna-claw/sandbox-workspaces'
  }
  {
    name: 'ECHIDNA_SANDBOX_CLEANUP_TTL_MS'
    value: 3600000
  }
  {
    name: 'ECHIDNA_SANDBOX_DEFAULT_TIMEOUT_MS'
    value: 10000
  }
  {
    name: 'ECHIDNA_SANDBOX_MAX_TIMEOUT_MS'
    value: 60000
  }
  {
    name: 'ECHIDNA_SANDBOX_DEFAULT_OUTPUT_LIMIT_BYTES'
    value: 32768
  }
  {
    name: 'ECHIDNA_COSMOS_DB_ENDPOINT'
    value: cosmosEndpoint
  }
  {
    name: 'ECHIDNA_COSMOS_DB_DATABASE_NAME'
    value: cosmosDatabaseName
  }
  {
    name: 'ECHIDNA_COSMOS_DB_CREDENTIAL_SCOPE'
    value: 'https://cosmos.azure.com/.default'
  }
  {
    name: 'ECHIDNA_BLOB_STORAGE_ACCOUNT_URL'
    value: blobAccountUrl
  }
  {
    name: 'ECHIDNA_BLOB_STORAGE_UPLOADS_CONTAINER'
    value: uploadsContainerName
  }
  {
    name: 'ECHIDNA_BLOB_STORAGE_ARTIFACTS_CONTAINER'
    value: artifactsContainerName
  }
  {
    name: 'ECHIDNA_KEY_VAULT_URI'
    value: keyVaultUri
  }
  {
    name: 'ECHIDNA_KEY_VAULT_KEY_ID'
    value: credentialEncryptionKeyId
  }
  {
    name: 'ECHIDNA_FOUNDRY_PROJECT_NAME'
    value: foundryProjectName
  }
  {
    name: 'ECHIDNA_FOUNDRY_PROJECT_ENDPOINT'
    value: foundryEndpoint
  }
  {
    name: 'ECHIDNA_FOUNDRY_DEFAULT_DEPLOYMENT_NAME'
    value: defaultModelDeploymentName
  }
]

var secretEnvVars = [
  for secretReference in secretReferences: {
    name: secretReference.envVarName
    secretRef: secretReference.secretName
  }
]

module base './container-app-base.bicep' = {
  name: '${name}-base'
  params: {
    name: name
    location: location
    tags: tags
    managedEnvironmentResourceId: managedEnvironmentResourceId
    identityResourceId: identityResourceId
    containerRegistryLoginServer: containerRegistryLoginServer
    image: image
    cpu: cpu
    memory: memory
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    targetPort: targetPort
    ingressExternal: false
    envVars: envVars
    secretEnvVars: secretEnvVars
    secretRefs: secretReferences
  }
}

output internalUrl string = base.outputs.url
output appName string = base.outputs.name
