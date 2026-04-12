using './main.bicep'

param environmentName = 'prd'
param location = 'australiaeast'
param namePrefix = 'ec'
param tags = {
  project: 'echidna-claw'
  environment: 'prd'
  'managed-by': 'bicep'
  owner: 'davoli-software'
}

param containerRegistrySku = 'Basic'
param logAnalyticsRetentionInDays = 30
param cosmosDatabaseName = 'echidna'
param storageRetentionDays = 14
param keyVaultKeyName = 'credential-encryption'

param images = {
  api: {
    repository: 'echidna/api'
    tag: 'prd'
  }
  hands: {
    repository: 'echidna/hands'
    tag: 'prd'
  }
  sandbox: {
    repository: 'echidna/sandbox'
    tag: 'prd'
  }
  scheduler: {
    repository: 'echidna/hands'
    tag: 'prd'
  }
}

param apiWorkload = {
  cpu: 1
  memory: '2Gi'
  minReplicas: 1
  maxReplicas: 3
  targetPort: 8080
}

param sandboxWorkload = {
  cpu: 1
  memory: '2Gi'
  minReplicas: 0
  maxReplicas: 2
  targetPort: 8080
}

param handsJobConfig = {
  cpu: 1
  memory: '2Gi'
  parallelism: 1
  replicaCompletionCount: 1
  timeoutSeconds: 1800
  retryLimit: 1
  command: []
  args: []
}

param schedulerJobConfig = {
  cpu: 1
  memory: '2Gi'
  parallelism: 1
  replicaCompletionCount: 1
  timeoutSeconds: 900
  retryLimit: 1
  scheduleExpression: '*/5 * * * *'
  command: [
    'node'
    'dist/scheduler.js'
  ]
  args: []
}

param workloadBindings = {
  api: []
  sandbox: []
  hands: []
  scheduler: []
}

param foundry = {
  mode: 'attach'
  accountName: ''
  projectName: ''
  projectDisplayName: 'EchidnaClaw Prd'
  projectDescription: 'EchidnaClaw prd Foundry project.'
  customSubDomainName: ''
  deploymentName: 'gpt-5-4-mini'
  deploymentSkuName: 'GlobalStandard'
  deploymentCapacity: 1
  modelFormat: 'OpenAI'
  modelName: 'gpt-5.4-mini'
  modelVersion: 'latest'
  memoryStoreEndpointOrId: ''
  attachEndpoint: 'https://example.services.ai.azure.com/api/projects/ec-prd'
  attachAccountResourceId: '/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/ec-prd-foundry'
  attachProjectResourceId: '/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/ec-prd-foundry/projects/ec-prd-foundry'
  attachMemoryStoreEndpointOrId: 'memory-stores/ec-prd'
  attachDeploymentName: 'gpt-5-4-mini'
}

param publicEdgeConfig = {
  customDomainHostName: ''
  telegramWebhookPath: '/telegram/webhook'
}
