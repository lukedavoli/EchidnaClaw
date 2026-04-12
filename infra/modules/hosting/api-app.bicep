param name string
param location string
param tags object = {}
param managedEnvironmentResourceId string
param identityResourceId string
param identityClientId string
param identityPrincipalId string
param containerRegistryLoginServer string
param image string
param cpu int
param memory string
param minReplicas int = 0
param maxReplicas int = 1
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
param targetPort int = 8080
param secretReferences array = []

var envVars = [
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: applicationInsightsConnectionString
  }
  {
    name: 'ECHIDNA_API_HOST'
    value: '0.0.0.0'
  }
  {
    name: 'ECHIDNA_API_PORT'
    value: targetPort
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
    ingressExternal: true
    envVars: envVars
    secretEnvVars: secretEnvVars
    secretRefs: secretReferences
  }
}

output baseUrl string = base.outputs.url
output appName string = base.outputs.name
output identityClientId string = identityClientId
output identityPrincipalId string = identityPrincipalId
