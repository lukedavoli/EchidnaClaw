param name string
param location string
param tags object = {}
param managedEnvironmentResourceId string
param identityResourceId string
param containerRegistryLoginServer string
param image string
param cpu int
param memory string
param minReplicas int = 0
param maxReplicas int = 1
param targetPort int = 8080
param ingressExternal bool = false
param activeRevisionsMode string = 'Single'
param transport string = 'auto'
param healthPath string = '/healthz'
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

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
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
    managedEnvironmentId: managedEnvironmentResourceId
    configuration: {
      activeRevisionsMode: activeRevisionsMode
      ingress: {
        allowInsecure: false
        external: ingressExternal
        targetPort: targetPort
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
        transport: transport
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
        {
          name: name
          image: image
          env: concat(resolvedEnvVars, resolvedSecretEnvVars)
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              failureThreshold: 3
              periodSeconds: 10
              timeoutSeconds: 5
            }
            {
              type: 'Readiness'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              failureThreshold: 3
              periodSeconds: 10
              timeoutSeconds: 5
            }
            {
              type: 'Startup'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              failureThreshold: 30
              periodSeconds: 5
              timeoutSeconds: 5
            }
          ]
          resources: {
            cpu: cpu
            memory: memory
          }
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output id string = containerApp.id
output name string = containerApp.name
output fqdn string = containerApp.properties.configuration.ingress.fqdn
output url string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
