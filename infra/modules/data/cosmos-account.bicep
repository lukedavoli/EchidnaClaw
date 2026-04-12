param name string
param location string
param tags object = {}
param databaseName string
param dataContributorPrincipalIds array = []
param enableServerless bool = true

var cosmosDataContributorRoleDefinitionId = '${databaseAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'

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

resource sqlRoleAssignments 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-04-15' = [
  for principalId in dataContributorPrincipalIds: {
    name: guid(databaseAccount.id, databaseName, principalId, 'cosmos-data-contributor')
    parent: databaseAccount
    properties: {
      principalId: principalId
      roleDefinitionId: cosmosDataContributorRoleDefinitionId
      scope: '/dbs/${databaseName}'
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
