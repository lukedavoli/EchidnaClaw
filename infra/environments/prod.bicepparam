using './main.bicep'

param environmentName = 'prod'
param location = 'australiaeast'
param namePrefix = 'ec-prod'
param tags = {
  owner: 'davoli-software'
}

param foundryMode = 'attach'
param foundryAccountName = 'ec-prod-foundry'
param foundryProjectName = 'echidna-claw-prod'
param foundryProjectDisplayName = 'EchidnaClaw Prod'
param foundryProjectDescription = 'Attached Azure AI Foundry project contract for the EchidnaClaw production environment.'
param foundryAccountResourceId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/ec-prod-ai/providers/Microsoft.CognitiveServices/accounts/ec-prod-foundry'
param foundryProjectResourceId = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/ec-prod-ai/providers/Microsoft.CognitiveServices/accounts/ec-prod-foundry/projects/echidna-claw-prod'
param foundryProjectEndpoint = 'https://ec-prod-foundry.services.ai.azure.com/api/projects/echidna-claw-prod'
param foundryModelInferenceEndpoint = 'https://ec-prod-foundry.services.ai.azure.com/models'
param foundryMemoryStoreName = 'echidna-memory-prod'
param foundryMemoryStoreEndpointOrId = 'https://ec-prod-foundry.services.ai.azure.com/api/projects/echidna-claw-prod/memory_stores/echidna-memory-prod'

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
