param name string
param location string
param tags object = {}
param artifactsContainerName string = 'artifacts'
param retentionDays int = 14
param contributorPrincipalIds array = []
param readerPrincipalIds array = []

var blobContributorRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var blobReaderRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1')

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  name: 'default'
  parent: storageAccount
}

resource artifactsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: artifactsContainerName
  parent: blobService
  properties: {
    publicAccess: 'None'
  }
}

resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  name: 'default'
  parent: storageAccount
  properties: {
    policy: {
      rules: [
        {
          name: 'expire-artifacts'
          enabled: true
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: retentionDays
                }
              }
              snapshot: {
                delete: {
                  daysAfterCreationGreaterThan: retentionDays
                }
              }
              version: {
                delete: {
                  daysAfterCreationGreaterThan: retentionDays
                }
              }
            }
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                '${artifactsContainerName}/'
              ]
            }
          }
        }
      ]
    }
  }
}

resource contributorAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in contributorPrincipalIds: {
    name: guid(storageAccount.id, principalId, 'storage-blob-contributor')
    scope: storageAccount
    properties: {
      principalId: principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: blobContributorRoleDefinitionId
    }
  }
]

resource readerAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in readerPrincipalIds: {
    name: guid(storageAccount.id, principalId, 'storage-blob-reader')
    scope: storageAccount
    properties: {
      principalId: principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: blobReaderRoleDefinitionId
    }
  }
]

output accountResourceId string = storageAccount.id
output accountName string = storageAccount.name
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
output artifactsContainerName string = artifactsContainerName
