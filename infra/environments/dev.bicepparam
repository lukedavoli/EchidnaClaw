using './main.bicep'

param environmentName = 'dev'
param location = 'australiaeast'
param namePrefix = 'ec-dev'
param tags = {
  owner: 'davoli-software'
}

param foundryMode = 'attach'
param foundryAccountName = 'ec-dev-foundry'
param foundryProjectName = 'echidna-claw-dev'
param foundryProjectDisplayName = 'EchidnaClaw Dev'
param foundryProjectDescription = 'Attached Azure AI Foundry project contract for the EchidnaClaw dev environment.'
param foundryAccountResourceId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/ec-dev-ai/providers/Microsoft.CognitiveServices/accounts/ec-dev-foundry'
param foundryProjectResourceId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/ec-dev-ai/providers/Microsoft.CognitiveServices/accounts/ec-dev-foundry/projects/echidna-claw-dev'
param foundryProjectEndpoint = 'https://ec-dev-foundry.services.ai.azure.com/api/projects/echidna-claw-dev'
param foundryModelInferenceEndpoint = 'https://ec-dev-foundry.services.ai.azure.com/models'
param foundryMemoryStoreName = 'echidna-memory-dev'
param foundryMemoryStoreEndpointOrId = 'https://ec-dev-foundry.services.ai.azure.com/api/projects/echidna-claw-dev/memory_stores/echidna-memory-dev'

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
