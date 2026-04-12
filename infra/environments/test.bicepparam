using './main.bicep'

param environmentName = 'test'
param location = 'australiaeast'
param namePrefix = 'ec-test'
param tags = {
  owner: 'davoli-software'
}

param foundryMode = 'attach'
param foundryAccountName = 'ec-test-foundry'
param foundryProjectName = 'echidna-claw-test'
param foundryProjectDisplayName = 'EchidnaClaw Test'
param foundryProjectDescription = 'Attached Azure AI Foundry project contract for the EchidnaClaw test environment.'
param foundryAccountResourceId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/ec-test-ai/providers/Microsoft.CognitiveServices/accounts/ec-test-foundry'
param foundryProjectResourceId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/ec-test-ai/providers/Microsoft.CognitiveServices/accounts/ec-test-foundry/projects/echidna-claw-test'
param foundryProjectEndpoint = 'https://ec-test-foundry.services.ai.azure.com/api/projects/echidna-claw-test'
param foundryModelInferenceEndpoint = 'https://ec-test-foundry.services.ai.azure.com/models'
param foundryMemoryStoreName = 'echidna-memory-test'
param foundryMemoryStoreEndpointOrId = 'https://ec-test-foundry.services.ai.azure.com/api/projects/echidna-claw-test/memory_stores/echidna-memory-test'

param deployDefaultModel = false
param defaultModelDeploymentName = 'gpt-5.4-mini'
param defaultModelName = 'gpt-5.4-mini'
param defaultModelPublisher = ''
param defaultModelFormat = 'OpenAI'
param defaultModelVersion = ''
param defaultModelSkuName = 'GlobalStandard'
param defaultModelSkuCapacity = 1
param defaultModelServiceTier = 'Default'
param defaultModelVersionUpgradeOption = 'NoAutoUpgrade'
