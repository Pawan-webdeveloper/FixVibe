import type { MonitorType } from '@scanlyfix/db'

/**
 * The payload the sweep emits, once per due monitor.
 *
 * Everything a job needs travels in the event rather than being looked up
 * again: the sweep already joined the project to find what was due, and a
 * second read would be a second chance for the two to disagree.
 */
export interface MonitorDueEvent {
  name: string
  data: {
    monitorId: string
    type: MonitorType
    projectId: string
    url: string
    ownerId: string
  }
}
