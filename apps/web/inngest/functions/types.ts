import type { MonitorType } from '@scanlyfix/db'
import type { EVENTS } from '@/lib/inngest.ts'

/**
 * The payload the sweep emits, once per due monitor.
 *
 * Everything a job needs travels in the event rather than being looked up
 * again: the sweep already joined the project to find what was due, and a
 * second read would be a second chance for the two to disagree.
 */

/*
 * ACTION: Add MonitoringDueEvent alongside your existing MonitorDueEvent.
 *
 * Shared event payload types for all monitor probes.
 * Keeping them here means the sweep and every probe stay in sync on the
 * shape of the data — a field rename is one edit, not three.
 */
 

/** Emitted by monitor-sweep for uptime monitors. Already exists. */
/* uptime error — removed ownerId from data shape since monitor-sweep does not send it,
 * keeping type accurate to actual payload */
export interface MonitorDueEvent {
  name: string
  data: {
    monitorId: string
    type: MonitorType
    projectId: string
    url: string
  }
}


 
/**
 * Emitted by monitor-sweep for domain + SSL monitoring.
 * `type` discriminates which probe picks the event up.
 */

export interface MonitoringDueEvent {
  name: typeof EVENTS.monitorDue
  data: {
    monitorId: string
    projectId: string
    url: string
    type: 'domain' | 'ssl'
  }
}

