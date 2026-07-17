import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const openapiSource = readFileSync(new URL('./openapi.ts', import.meta.url), 'utf8')
const deploymentSource = readFileSync(new URL('./mcpDeploymentTools.ts', import.meta.url), 'utf8')

test('OpenAPI source registers deployment tools and schemas', () => {
  assert.match(openapiSource, /import \{ deploymentMcpTools \} from '\.\/mcpDeploymentTools'/)
  assert.match(openapiSource, /\.\.\.deploymentMcpTools/)
  assert.match(openapiSource, /version: '0\.7\.0'/)
  assert.match(openapiSource, /name: 'Deployment'/)
  assert.match(openapiSource, /schemas: \{/)
  assert.match(openapiSource, /first call creates a separate high-risk approval/i)
})

test('deployment tool names are explicit and unique', () => {
  const names = [...deploymentSource.matchAll(/name: '(deployment_[a-z_]+)'/g)].map((match) => match[1])
  assert.deepEqual(names, ['deployment_start', 'deployment_status', 'deployment_logs'])
  assert.equal(new Set(names).size, names.length)
})

test('deployment start requires project and supports bounded targets', () => {
  assert.match(deploymentSource, /required: \['project_id'\]/)
  assert.match(deploymentSource, /enum: \['backend', 'frontend', 'all'\]/)
  assert.match(deploymentSource, /Deployment branch must equal the project default branch/)
  assert.match(deploymentSource, /production_deployment/)
})
