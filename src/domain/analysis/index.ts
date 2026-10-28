/**
 * One deterministic analysis pass over the workspace records visible to the
 * signed-in user. The AI layer may only explain these computed facts.
 */
import type { DatasetSources } from '../types.ts'
import { analyseNeeds, type NeedsAnalysis } from './capacity.ts'
import { analyseMaintenance, type MaintenanceAnalysis } from './maintenance.ts'
import { analysePlan, type PlanAnalysis } from './plan.ts'
import { analyseUtilities, type UtilitiesAnalysis } from './utilities.ts'
import { sortFindings, type Finding, type FindingSeverity } from './types.ts'

export interface AnalysisBundle {
  asOf: string
  capacity: NeedsAnalysis
  utilities: UtilitiesAnalysis
  maintenance: MaintenanceAnalysis
  plan: PlanAnalysis
  findings: Finding[]
  findingCounts: Record<FindingSeverity, number>
}

export function analyseWorkspace(dataset: DatasetSources, asOf: string = new Date().toISOString()): AnalysisBundle {
  const capacity = analyseNeeds(
    dataset.rooms,
    dataset.timetableSlots,
    dataset.buildings,
    dataset.complaints,
    asOf,
  )
  const utilities = analyseUtilities(
    dataset.utilityMeters,
    dataset.utilityReadings,
    dataset.tariffs,
    dataset.buildings,
  )
  const maintenance = analyseMaintenance(
    dataset.rooms,
    dataset.buildings,
    dataset.assets,
    dataset.inspections,
    dataset.complaints,
    dataset.urbanIssues,
    dataset.urbanAssets,
    asOf,
  )

  const sourceFindings = [...capacity.findings, ...utilities.findings, ...maintenance.findings]
  const plan = analysePlan(dataset.planOptions, dataset.decisions, sourceFindings)
  const findings = sortFindings([...sourceFindings, ...plan.findings])

  const findingCounts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  }
  for (const finding of findings) findingCounts[finding.severity] += 1

  return {
    asOf,
    capacity,
    utilities,
    maintenance,
    plan,
    findings,
    findingCounts,
  }
}

export { analyseNeeds, analyseUtilities, analyseMaintenance, analysePlan }
export * from './capacity.ts'
export * from './utilities.ts'
export * from './maintenance.ts'
export * from './plan.ts'
export * from './types.ts'
