using './main.bicep'

param environmentName = 'dev'
param location = 'australiaeast'
param namePrefix = 'ec'
param tags = {
  project: 'echidna-claw'
  environment: 'dev'
  'managed-by': 'bicep'
  owner: 'davoli-software'
}

param containerRegistrySku = 'Basic'
param logAnalyticsRetentionInDays = 30
param cosmosDatabaseName = 'sqldb-ec-dev'
param storageRetentionDays = 14
param keyVaultKeyName = 'key-credential-dev'

param images = {
  api: {
    repository: 'echidna-claw/api'
    tag: 'latest'
  }
  hands: {
    repository: 'echidna-claw/hands'
    tag: 'latest'
  }
  sandbox: {
    repository: 'echidna-claw/sandbox'
    tag: 'latest'
  }
  scheduler: {
    repository: 'echidna-claw/scheduler'
    tag: 'latest'
  }
}

param apiWorkload = {
  cpu: 1
  memory: '2Gi'
  minReplicas: 0
  maxReplicas: 2
  targetPort: 8080
}

param sandboxWorkload = {
  cpu: 1
  memory: '2Gi'
  minReplicas: 0
  maxReplicas: 1
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
    'apps/scheduler/dist/scheduler.js'
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
  mode: 'create'
  accountName: ''
  projectName: ''
  projectDisplayName: 'EchidnaClaw Dev'
  projectDescription: 'EchidnaClaw development Foundry project.'
  customSubDomainName: ''
  deploymentName: 'dep-gpt-5-4-mini-dev'
  deploymentSkuName: 'GlobalStandard'
  deploymentCapacity: 1
  modelFormat: 'OpenAI'
  modelName: 'gpt-5.4-mini'
  modelVersion: '2026-03-17'
  memoryEmbeddingDeploymentName: 'dep-text-embedding-3-small-dev'
  memoryEmbeddingDeploymentSkuName: 'GlobalStandard'
  memoryEmbeddingDeploymentCapacity: 1
  memoryEmbeddingModelFormat: 'OpenAI'
  memoryEmbeddingModelName: 'text-embedding-3-small'
  memoryEmbeddingModelVersion: '1'
  memoryStoreEndpointOrId: ''
  attachEndpoint: ''
  attachAccountResourceId: ''
  attachProjectResourceId: ''
  attachMemoryStoreEndpointOrId: ''
  attachDeploymentName: ''
  attachMemoryChatDeploymentName: ''
  attachMemoryEmbeddingDeploymentName: ''
}

param publicEdgeConfig = {
  customDomainHostName: ''
  telegramWebhookPath: '/telegram/webhook'
}
