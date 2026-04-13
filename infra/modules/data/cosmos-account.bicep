param name string
param location string
param tags object = {}
param databaseName string
param agentStateContainerName string = 'agent-state'
param usageEventsContainerName string = 'usage-events'
param dataContributorPrincipalIds array = []
param enableServerless bool = true

var cosmosDataContributorRoleDefinitionId = '${databaseAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
var operationalContainerPartitionKeyPath = '/partitionKey'
var agentStateIndexedPaths = [
  '/id/?'
  '/partitionKey/?'
  '/recordType/?'
  '/agentId/?'
  '/createdAt/?'
  '/updatedAt/?'
  '/lifecycleState/?'
  '/provider/?'
  '/alias/?'
  '/externalHandle/?'
  '/externalChatId/?'
  '/lastInboundSequence/?'
  '/scope/?'
  '/key/?'
  '/status/?'
  '/sequence/?'
  '/receivedAt/?'
  '/requestedAt/?'
  '/state/?'
  '/query/queuePriorityRank/?'
  '/dueAt/?'
  '/taskId/?'
  '/nextDueAt/?'
  '/journalId/?'
  '/recordedAt/?'
  '/credentialId/?'
  '/retentionUntil/?'
]
var usageEventsIndexedPaths = [
  '/id/?'
  '/partitionKey/?'
  '/recordType/?'
  '/agentId/?'
  '/source/?'
  '/model/?'
  '/occurredAt/?'
]

resource databaseAccount 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    enableAutomaticFailover: false
    disableLocalAuth: false
    capabilities: enableServerless ? [
      {
        name: 'EnableServerless'
      }
    ] : []
  }
}

resource sqlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-04-15' = {
  name: databaseName
  parent: databaseAccount
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource agentStateContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-04-15' = {
  name: agentStateContainerName
  parent: sqlDatabase
  properties: {
    resource: {
      id: agentStateContainerName
      partitionKey: {
        paths: [
          operationalContainerPartitionKeyPath
        ]
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
        includedPaths: [
          for path in agentStateIndexedPaths: {
            path: path
          }
        ]
        excludedPaths: [
          {
            path: '/*'
          }
        ]
        compositeIndexes: [
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/lifecycleState'
              order: 'ascending'
            }
            {
              path: '/createdAt'
              order: 'descending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/provider'
              order: 'ascending'
            }
            {
              path: '/externalHandle'
              order: 'ascending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/provider'
              order: 'ascending'
            }
            {
              path: '/externalChatId'
              order: 'ascending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/scope'
              order: 'ascending'
            }
            {
              path: '/key'
              order: 'ascending'
            }
            {
              path: '/status'
              order: 'ascending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/sequence'
              order: 'descending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/state'
              order: 'ascending'
            }
            {
              path: '/query/queuePriorityRank'
              order: 'ascending'
            }
            {
              path: '/dueAt'
              order: 'ascending'
            }
            {
              path: '/createdAt'
              order: 'ascending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/state'
              order: 'ascending'
            }
            {
              path: '/requestedAt'
              order: 'descending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/state'
              order: 'ascending'
            }
            {
              path: '/nextDueAt'
              order: 'ascending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/journalId'
              order: 'ascending'
            }
            {
              path: '/recordedAt'
              order: 'ascending'
            }
          ]
        ]
      }
    }
  }
}

resource usageEventsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-04-15' = {
  name: usageEventsContainerName
  parent: sqlDatabase
  properties: {
    resource: {
      id: usageEventsContainerName
      partitionKey: {
        paths: [
          operationalContainerPartitionKeyPath
        ]
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        automatic: true
        indexingMode: 'consistent'
        includedPaths: [
          for path in usageEventsIndexedPaths: {
            path: path
          }
        ]
        excludedPaths: [
          {
            path: '/*'
          }
        ]
        compositeIndexes: [
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/occurredAt'
              order: 'descending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/agentId'
              order: 'ascending'
            }
            {
              path: '/occurredAt'
              order: 'descending'
            }
          ]
          [
            {
              path: '/recordType'
              order: 'ascending'
            }
            {
              path: '/source'
              order: 'ascending'
            }
            {
              path: '/model'
              order: 'ascending'
            }
            {
              path: '/occurredAt'
              order: 'descending'
            }
          ]
        ]
      }
    }
  }
}

resource sqlRoleAssignments 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-04-15' = [
  for principalId in dataContributorPrincipalIds: {
    name: guid(databaseAccount.id, databaseName, principalId, 'cosmos-data-contributor')
    parent: databaseAccount
    properties: {
      principalId: principalId
      roleDefinitionId: cosmosDataContributorRoleDefinitionId
      scope: databaseAccount.id
    }
    dependsOn: [
      sqlDatabase
    ]
  }
]

output accountResourceId string = databaseAccount.id
output accountName string = databaseAccount.name
output accountEndpoint string = databaseAccount.properties.documentEndpoint
output databaseName string = databaseName
output databaseResourceId string = sqlDatabase.id
output agentStateContainerName string = agentStateContainer.name
output usageEventsContainerName string = usageEventsContainer.name
