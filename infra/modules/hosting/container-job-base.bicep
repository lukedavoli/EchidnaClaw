@allowed([
  'Manual'
  'Schedule'
])
param triggerType string = 'Manual'

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
param replicaTimeoutSeconds int = 1800
param replicaRetryLimit int = 1
param scheduleExpression string = '0 */5 * * *'
param command array = []
param args array = []
param envVars array = []
param secretEnvVars array = []
param secretRefs array = []

var resolvedSecrets = [
  for secretRef in secretRefs: {
    name: secretRef.secretName
    identity: secretRef.?identityResourceId ?? identityResourceId
    keyVaultUrl: secretRef.keyVaultSecretUri
  }
]
var resolvedEnvVars = [
  for envVar in envVars: {
    name: envVar.name
    value: string(envVar.value)
  }
]
var resolvedSecretEnvVars = [
  for secretEnvVar in secretEnvVars: {
    name: secretEnvVar.name
    secretRef: secretEnvVar.secretRef
  }
]
var containerDefinition = {
  name: name
  image: image
  command: command
  args: args
  env: concat(resolvedEnvVars, resolvedSecretEnvVars)
  resources: {
    cpu: cpu
    memory: memory
  }
}

resource manualJob 'Microsoft.App/jobs@2024-03-01' = if (triggerType == 'Manual') {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    environmentId: managedEnvironmentResourceId
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: replicaTimeoutSeconds
      replicaRetryLimit: replicaRetryLimit
      manualTriggerConfig: {
        parallelism: parallelism
        replicaCompletionCount: replicaCompletionCount
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: identityResourceId
        }
      ]
      secrets: resolvedSecrets
    }
    template: {
      containers: [
        containerDefinition
      ]
    }
  }
}

resource scheduledJob 'Microsoft.App/jobs@2024-03-01' = if (triggerType == 'Schedule') {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    environmentId: managedEnvironmentResourceId
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: replicaTimeoutSeconds
      replicaRetryLimit: replicaRetryLimit
      scheduleTriggerConfig: {
        cronExpression: scheduleExpression
        parallelism: parallelism
        replicaCompletionCount: replicaCompletionCount
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: identityResourceId
        }
      ]
      secrets: resolvedSecrets
    }
    template: {
      containers: [
        containerDefinition
      ]
    }
  }
}

output id string = triggerType == 'Manual' ? manualJob.id : scheduledJob.id
output name string = triggerType == 'Manual' ? manualJob.name : scheduledJob.name
