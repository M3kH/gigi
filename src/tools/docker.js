import { runBash } from './bash.js'

export const dockerTool = {
  name: 'docker',
  description: 'Inspect Docker services, containers, and logs. Read-only operations only.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['services', 'ps', 'logs', 'inspect'],
        description: 'Docker action'
      },
      service: { type: 'string', description: 'Service or container name' },
      tail: { type: 'integer', description: 'Number of log lines (default: 50)' }
    },
    required: ['action']
  }
}

export const runDocker = async ({ action, service, tail = 50 }) => {
  switch (action) {
    case 'services':
      return runBash({ command: 'docker service ls --format "table {{.Name}}\t{{.Replicas}}\t{{.Image}}"' })

    case 'ps':
      if (!service) return runBash({ command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"' })
      return runBash({ command: `docker service ps ${service} --format "table {{.Name}}\t{{.CurrentState}}\t{{.Error}}"` })

    case 'logs':
      if (!service) return 'Service name required for logs'
      return runBash({ command: `docker service logs --tail ${tail} --no-task-ids ${service}` })

    case 'inspect':
      if (!service) return 'Service name required for inspect'
      return runBash({ command: `docker service inspect --pretty ${service}` })

    default:
      return `Unknown action: ${action}`
  }
}
