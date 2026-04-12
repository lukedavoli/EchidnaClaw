param name string
param location string
param tags object = {}
param tenantId string = subscription().tenantId
param keyName string
param secretReaderPrincipalIds array = []
param cryptoUserPrincipalIds array = []

var keyVaultSecretsUserRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var keyVaultCryptoUserRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12338af0-0e69-4776-bea7-57ae8d297424')

resource vault 'Microsoft.KeyVault/vaults@2023-02-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    enablePurgeProtection: true
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
    softDeleteRetentionInDays: 90
    tenantId: tenantId
  }
}

resource credentialKey 'Microsoft.KeyVault/vaults/keys@2023-02-01' = {
  name: keyName
  parent: vault
  properties: {
    attributes: {
      enabled: true
    }
    keyOps: [
      'encrypt'
      'decrypt'
      'sign'
      'verify'
      'wrapKey'
      'unwrapKey'
    ]
    keySize: 2048
    kty: 'RSA'
  }
}

resource secretReaderAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in secretReaderPrincipalIds: {
    name: guid(vault.id, principalId, 'kv-secrets-user')
    scope: vault
    properties: {
      principalId: principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: keyVaultSecretsUserRoleDefinitionId
    }
  }
]

resource cryptoUserAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in cryptoUserPrincipalIds: {
    name: guid(vault.id, principalId, 'kv-crypto-user')
    scope: vault
    properties: {
      principalId: principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: keyVaultCryptoUserRoleDefinitionId
    }
  }
]

output vaultResourceId string = vault.id
output vaultName string = vault.name
output vaultUri string = vault.properties.vaultUri
output keyId string = credentialKey.properties.keyUriWithVersion
